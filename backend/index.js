const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { randomUUID } = require('crypto');
const { parseUlogHeader } = require('./ulgParser');

const app = express();
const port = process.env.PORT || 3001;
const parsedLogStore = new Map();
const DEFAULT_ROLE_TOPIC_POLICY = {
  customer: [
    'actuator_outputs',
    'battery_status',
    'input_rc',
    'vehicle_status_0',
    'vehicle_local_position',
    'vehicle_local_position_setpoint',
    'sensor_combined',
    'vehicle_visual_odometry',
  ],
  aftersales: [
    'actuator_outputs',
    'battery_status',
    'input_rc',
    'vehicle_status_0',
    'vehicle_local_position',
    'vehicle_local_position_setpoint',
    'sensor_combined',
    'vehicle_visual_odometry',
    'sensor_accel_0',
    'sensor_gyro_0',
    'sensor_baro_0',
    'vehicle_attitude',
    'vehicle_attitude_setpoint',
  ],
  engineer: '*',
};
let ROLE_TOPIC_POLICY = { ...DEFAULT_ROLE_TOPIC_POLICY };

function loadRoleTopicPolicyFromFile() {
  const policyPath = path.join(__dirname, '..', 'docs', 'role-topic-policy.txt');
  if (!fs.existsSync(policyPath)) {
    return { ...DEFAULT_ROLE_TOPIC_POLICY };
  }

  const text = fs.readFileSync(policyPath, 'utf8');
  const lines = text.split(/\r?\n/);
  const parsed = {};
  let currentRole = '';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('===')) {
      continue;
    }

    const roleMatch = line.match(/^\[(.+)\]$/);
    if (roleMatch) {
      currentRole = roleMatch[1].trim();
      if (currentRole) {
        parsed[currentRole] = [];
      }
      continue;
    }

    if (!currentRole) continue;

    if (line === '*') {
      parsed[currentRole] = '*';
      continue;
    }

    if (parsed[currentRole] !== '*') {
      parsed[currentRole].push(line);
    }
  }

  // Merge with defaults to guarantee required roles exist.
  return {
    ...DEFAULT_ROLE_TOPIC_POLICY,
    ...parsed,
  };
}

ROLE_TOPIC_POLICY = loadRoleTopicPolicyFromFile();

function topicMatchesPolicy(policyTopic, actualTopic) {
  if (policyTopic === actualTopic) return true;
  // Allow base-topic policy like "actuator_outputs" to match instance topics
  // such as "actuator_outputs_0" / "actuator_outputs_1".
  if (actualTopic.startsWith(`${policyTopic}_`)) return true;
  return false;
}

function decodeUploadedFileName(fileName) {
  return Buffer.from(fileName, 'latin1').toString('utf8');
}

function buildSeed(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) % 1000003;
  }
  return hash;
}

function generateTimeSeries(metadata, seed) {
  const points = 180;
  const base = (metadata.fileSizeBytes + seed) % 97;
  const altitude = [];
  const speed = [];
  const voltage = [];

  for (let i = 0; i < points; i += 1) {
    const t = i;
    const climbProfile = Math.sin(i / 22) * 8 + i * 0.06;
    const turbulence = Math.sin((i + base) / 7) * 0.9;
    const alt = Math.max(0, 42 + climbProfile + turbulence);
    const spd = Math.max(0, 9 + Math.sin(i / 10) * 3 + Math.cos(i / 17) * 1.2);
    const voltDrop = i * 0.018;
    const voltNoise = Math.sin((i + base) / 13) * 0.07;
    const volt = Math.max(13.6, 16.8 - voltDrop + voltNoise);

    altitude.push([t, Number(alt.toFixed(2))]);
    speed.push([t, Number(spd.toFixed(2))]);
    voltage.push([t, Number(volt.toFixed(2))]);
  }

  return { altitude, speed, voltage };
}

function buildDiagnostics(seriesMap) {
  const altitudeValues = seriesMap.altitude.map((item) => item[1]);
  const speedValues = seriesMap.speed.map((item) => item[1]);
  const voltageValues = seriesMap.voltage.map((item) => item[1]);

  const minVoltage = voltageValues.length ? Math.min(...voltageValues) : null;
  const maxSpeed = speedValues.length ? Math.max(...speedValues) : null;
  const maxAltitude = altitudeValues.length ? Math.max(...altitudeValues) : null;

  const diagnostics = [];

  if (minVoltage !== null) {
    if (minVoltage < 14.2) {
      diagnostics.push({
        level: 'warning',
        ruleCode: 'LOW_BATTERY',
        title: 'Battery voltage drop detected',
        detail: `Minimum voltage: ${minVoltage.toFixed(2)}V`,
      });
    } else {
      diagnostics.push({
        level: 'ok',
        ruleCode: 'BATTERY_NORMAL',
        title: 'Battery voltage is stable',
        detail: `Minimum voltage: ${minVoltage.toFixed(2)}V`,
      });
    }
  }

  if (maxSpeed !== null) {
    if (maxSpeed > 14.5) {
      diagnostics.push({
        level: 'warning',
        ruleCode: 'HIGH_SPEED',
        title: 'Peak speed is above expected range',
        detail: `Peak speed: ${maxSpeed.toFixed(2)}m/s`,
      });
    } else {
      diagnostics.push({
        level: 'ok',
        ruleCode: 'SPEED_NORMAL',
        title: 'Speed is within expected range',
        detail: `Peak speed: ${maxSpeed.toFixed(2)}m/s`,
      });
    }
  }

  if (maxAltitude !== null) {
    diagnostics.push({
      level: 'info',
      ruleCode: 'ALTITUDE_SUMMARY',
      title: 'Altitude summary',
      detail: `Maximum altitude: ${maxAltitude.toFixed(2)}m`,
    });
  }

  return diagnostics;
}

function mapSeriesFromTopicCharts(topicCharts) {
  const altitudeCandidates = ['高度', 'Altitude', 'altitude', 'z'];
  const speedCandidates = ['速度', 'Speed', 'speed', 'speed_3d'];
  const voltageCandidates = ['voltage_v', 'Voltage', '电压'];

  const seriesMap = {
    altitude: [],
    speed: [],
    voltage: [],
  };

  for (const topic of topicCharts) {
    for (const s of topic.series || []) {
      if (!seriesMap.altitude.length && altitudeCandidates.includes(s.name)) {
        seriesMap.altitude = Array.isArray(s.points) ? s.points : [];
      }
      if (!seriesMap.speed.length && speedCandidates.includes(s.name)) {
        seriesMap.speed = Array.isArray(s.points) ? s.points : [];
      }
      if (!seriesMap.voltage.length && voltageCandidates.includes(s.name)) {
        seriesMap.voltage = Array.isArray(s.points) ? s.points : [];
      }
    }
  }

  return seriesMap;
}

function parsePx4Series(filePath) {
  const parserScriptPath = path.join(__dirname, 'scripts', 'parse_ulg.py');
  const output = execFileSync(
    'python',
    ['-X', 'utf8', parserScriptPath, filePath],
    {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 64,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  return JSON.parse(output);
}

function buildTopicChartsFromFallback(fallbackSeriesMap) {
  return [
    {
      topic: 'vehicle_local_position',
      title: 'vehicle_local_position',
      series: [
        { name: 'altitude', unit: 'm', points: fallbackSeriesMap.altitude },
        { name: 'speed', unit: 'm/s', points: fallbackSeriesMap.speed },
      ],
    },
    {
      topic: 'battery_status',
      title: 'battery_status',
      series: [{ name: 'voltage_v', unit: 'V', points: fallbackSeriesMap.voltage }],
    },
  ];
}

function parseOrFallbackSeries(filePath, fallbackSeriesMap) {
  let topicCharts = buildTopicChartsFromFallback(fallbackSeriesMap);
  let dataSource = 'header-derived-simulated-series';
  let usedTopics = [];

  try {
    const parsed = parsePx4Series(filePath);
    if (parsed && Array.isArray(parsed.topicCharts) && parsed.topicCharts.length > 0) {
      topicCharts = parsed.topicCharts.map((topic) => ({
        topic: typeof topic.topic === 'string' ? topic.topic : 'unknown_topic',
        title: typeof topic.title === 'string' ? topic.title : 'unknown_topic',
        series: Array.isArray(topic.series)
          ? topic.series.map((item) => ({
              name: item.name,
              unit: item.unit,
              points: Array.isArray(item.points) ? item.points : [],
            }))
          : [],
      }));
      dataSource =
        typeof parsed.dataSource === 'string'
          ? parsed.dataSource
          : 'px4-topics-derived';
      usedTopics = Array.isArray(parsed.usedTopics) ? parsed.usedTopics : [];
    }
  } catch (parseError) {
    usedTopics = [];
  }

  return {
    topicCharts,
    dataSource,
    usedTopics,
    series: topicCharts.flatMap((item) => item.series),
  };
}

function resolveLegacyStoredPath(stored) {
  const uploadsDir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(uploadsDir)) return '';

  const targetSize = Number(stored?.metadata?.fileSizeBytes || 0);
  if (!targetSize) return '';

  const targetTime = new Date(stored.uploadedAt || 0).getTime();
  const files = fs.readdirSync(uploadsDir);
  const candidates = [];

  for (const file of files) {
    const fullPath = path.join(uploadsDir, file);
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) continue;
    if (stat.size !== targetSize) continue;
    const mtime = stat.mtime.getTime();
    const timeDiff = Math.abs(mtime - targetTime);
    candidates.push({ fullPath, timeDiff });
  }

  if (candidates.length === 0) return '';
  candidates.sort((a, b) => a.timeDiff - b.timeDiff);
  return candidates[0].fullPath;
}

function seriesArrayToMap(seriesArray) {
  const map = {
    altitude: [],
    speed: [],
    voltage: [],
  };

  for (const item of seriesArray) {
    if (!item || !Array.isArray(item.points)) continue;
    if (item.name === 'Altitude') map.altitude = item.points;
    if (item.name === 'Speed') map.speed = item.points;
    if (item.name === 'Voltage') map.voltage = item.points;
  }

  return map;
}

app.use(cors());
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend scaffold is running.' });
});

app.get('/api/logs', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
  const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
  const pageSize = Math.min(
    50,
    Math.max(1, Number.parseInt(String(req.query.pageSize || '8'), 10) || 8),
  );

  const logs = Array.from(parsedLogStore.values())
    .map((item) => ({
      logId: item.logId,
      fileName: item.fileName,
      uploadedAt: item.uploadedAt,
      metadata: item.metadata,
    }))
    .filter((item) => (q ? item.fileName.toLowerCase().includes(q) : true))
    .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

  const total = logs.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;
  const items = logs.slice(start, start + pageSize);

  res.json({
    total,
    page: safePage,
    pageSize,
    pageCount,
    q,
    items,
  });
});

app.post('/api/logs/upload', upload.single('logFile'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded.' });
  }

  const safeOriginalName = decodeUploadedFileName(req.file.originalname);
  const extension = path.extname(safeOriginalName).toLowerCase();
  if (extension !== '.ulg') {
    return res.status(400).json({
      message: 'Only .ulg files are supported now.',
      fileName: safeOriginalName,
    });
  }

  try {
    const metadata = parseUlogHeader(req.file.path);
    const logId = randomUUID();
    const seed = buildSeed(`${safeOriginalName}-${logId}`);
    const fallbackSeriesMap = generateTimeSeries(metadata, seed);
    const parsedResult = parseOrFallbackSeries(req.file.path, fallbackSeriesMap);
    const topicCharts = parsedResult.topicCharts;
    const series = parsedResult.series;
    const dataSource = parsedResult.dataSource;
    const usedTopics = parsedResult.usedTopics;

    const diagnostics = buildDiagnostics(
      dataSource === 'px4-topics-derived'
        ? mapSeriesFromTopicCharts(topicCharts)
        : seriesArrayToMap(series),
    );

    parsedLogStore.set(logId, {
      logId,
      fileName: safeOriginalName,
      uploadedAt: new Date().toISOString(),
      metadata,
      series,
      topicCharts,
      diagnostics,
      dataSource,
      usedTopics,
      storedPath: req.file.path,
    });

    return res.status(201).json({
      message: 'ULG file uploaded and parsed (header metadata).',
      logId,
      file: {
        originalName: safeOriginalName,
        size: req.file.size,
      },
      metadata,
      diagnostics,
      topicCharts,
      dataSource,
      usedTopics,
    });
  } catch (error) {
    return res.status(400).json({
      message: 'ULG parsing failed.',
      reason: error.message,
    });
  }
});

app.get('/api/logs/chart-data', (req, res) => {
  const logId = typeof req.query.logId === 'string' ? req.query.logId : '';
  const roleRaw = typeof req.query.role === 'string' ? req.query.role : 'aftersales';
  const role = Object.prototype.hasOwnProperty.call(ROLE_TOPIC_POLICY, roleRaw)
    ? roleRaw
    : 'aftersales';
  if (!logId) {
    return res.status(400).json({
      message: 'logId is required.',
      series: [],
    });
  }

  const stored = parsedLogStore.get(logId);
  if (!stored) {
    return res.status(404).json({
      message: 'Log not found. Please upload first.',
      logId,
      series: [],
    });
  }

  if (!stored.storedPath) {
    const guessedPath = resolveLegacyStoredPath(stored);
    if (guessedPath) {
      stored.storedPath = guessedPath;
    }
  }

  if (stored.storedPath && (!stored.topicCharts || stored.topicCharts.length <= 2)) {
    const fallbackSeriesMap = generateTimeSeries(
      stored.metadata,
      buildSeed(`${stored.fileName}-${stored.logId}`),
    );
    const reparsed = parseOrFallbackSeries(stored.storedPath, fallbackSeriesMap);
    const diagnostics = buildDiagnostics(
      reparsed.dataSource === 'px4-topics-derived'
        ? mapSeriesFromTopicCharts(reparsed.topicCharts)
        : seriesArrayToMap(reparsed.series),
    );
    stored.topicCharts = reparsed.topicCharts;
    stored.series = reparsed.series;
    stored.dataSource = reparsed.dataSource;
    stored.usedTopics = reparsed.usedTopics;
    stored.diagnostics = diagnostics;
  }

  let filteredTopicCharts = stored.topicCharts;
  const policy = ROLE_TOPIC_POLICY[role];
  if (policy !== '*') {
    filteredTopicCharts = (stored.topicCharts || []).filter((topic) =>
      policy.some((item) => topicMatchesPolicy(item, topic.topic)),
    );
  }

  res.json({
    message: 'Chart data generated from uploaded ULG metadata.',
    dataSource: stored.dataSource,
    role,
    availableRoles: Object.keys(ROLE_TOPIC_POLICY),
    logId,
    fileName: stored.fileName,
    uploadedAt: stored.uploadedAt,
    metadata: stored.metadata,
    usedTopics: filteredTopicCharts.map((item) => item.topic),
    series: filteredTopicCharts.flatMap((item) => item.series),
    topicCharts: filteredTopicCharts,
    diagnostics: stored.diagnostics,
  });
});

app.listen(port, () => {
  console.log(`Backend server scaffold running at http://localhost:${port}`);
});
