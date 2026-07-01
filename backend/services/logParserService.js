const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { randomUUID } = require('crypto');
const { parseUlogHeader } = require('../ulgParser');
const {
  buildFallbackSeed,
  generateFallbackTimeSeries,
  buildFallbackTopicCharts,
} = require('./fallbackDataService');

const PYTHON_PARSER_MAX_BUFFER_BYTES = 1024 * 1024 * 256;

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
  const parserScriptPath = path.join(__dirname, '..', 'scripts', 'parse_ulg.py');
  const output = execFileSync(
    'python',
    ['-X', 'utf8', parserScriptPath, filePath],
    {
      encoding: 'utf8',
      maxBuffer: PYTHON_PARSER_MAX_BUFFER_BYTES,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  return JSON.parse(output);
}

function parsePx4UnlockSummary(filePath) {
  const parserScriptPath = path.join(__dirname, '..', 'scripts', 'parse_ulg.py');
  const output = execFileSync(
    'python',
    ['-X', 'utf8', parserScriptPath, '--unlock-summary', filePath],
    {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  return JSON.parse(output);
}

function parsePx4RawSignals(filePath) {
  const parserScriptPath = path.join(__dirname, '..', 'scripts', 'parse_ulg.py');
  const output = execFileSync(
    'python',
    ['-X', 'utf8', parserScriptPath, '--raw-signals', filePath],
    {
      encoding: 'utf8',
      maxBuffer: PYTHON_PARSER_MAX_BUFFER_BYTES,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  return JSON.parse(output);
}

function buildDefaultUnlockSummary() {
  return {
    hasUnlockedFlight: false,
    sources: [],
    flightTimeS: null,
  };
}

function buildDefaultParameterProfile() {
  return {
    initialParameters: {},
    changedParameters: [],
  };
}

function normalizeUnlockSummary(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return buildDefaultUnlockSummary();
  }

  const unlockSummary = parsed.unlockSummary;
  if (!unlockSummary || typeof unlockSummary !== 'object') {
    return buildDefaultUnlockSummary();
  }

  return {
    hasUnlockedFlight: unlockSummary.hasUnlockedFlight === true,
    sources: Array.isArray(unlockSummary.sources) ? unlockSummary.sources : [],
    flightTimeS:
      typeof unlockSummary.flightTimeS === 'number' &&
      Number.isFinite(unlockSummary.flightTimeS)
        ? unlockSummary.flightTimeS
        : null,
  };
}

function normalizeParameterProfile(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return buildDefaultParameterProfile();
  }

  const parameterProfile = parsed.parameterProfile;
  if (!parameterProfile || typeof parameterProfile !== 'object') {
    return buildDefaultParameterProfile();
  }

  const initialParameters = {};
  const sourceInitial =
    parameterProfile.initialParameters &&
    typeof parameterProfile.initialParameters === 'object'
      ? parameterProfile.initialParameters
      : {};

  for (const [name, value] of Object.entries(sourceInitial)) {
    if (typeof name !== 'string') continue;
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) continue;
    initialParameters[name] = numericValue;
  }

  const changedParameters = Array.isArray(parameterProfile.changedParameters)
    ? parameterProfile.changedParameters
        .map((item) => {
          const name = typeof item?.name === 'string' ? item.name : '';
          const value = Number(item?.value);
          const timeS = Number(item?.timeS);
          const timestampUs = Number(item?.timestampUs);

          if (!name || !Number.isFinite(value) || !Number.isFinite(timeS)) {
            return null;
          }

          return {
            name,
            value,
            timeS,
            timestampUs: Number.isFinite(timestampUs) ? timestampUs : null,
          };
        })
        .filter(Boolean)
        .sort((left, right) => left.timeS - right.timeS)
    : [];

  return {
    initialParameters,
    changedParameters,
  };
}

function parseOrFallbackSeries(filePath, fallbackSeriesMap, options = {}) {
  let topicCharts = buildFallbackTopicCharts(fallbackSeriesMap);
  let dataSource = 'header-derived-simulated-series';
  let usedTopics = [];
  let modeSegments = [];
  let unlockSummary = buildDefaultUnlockSummary();
  let parameterProfile = buildDefaultParameterProfile();

  try {
    const parsed = parsePx4Series(filePath);
    unlockSummary = normalizeUnlockSummary(parsed);
    parameterProfile = normalizeParameterProfile(parsed);
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
      modeSegments = Array.isArray(parsed.modeSegments) ? parsed.modeSegments : [];
    }
  } catch (parseError) {
    if (options.allowFallback === false) {
      throw parseError;
    }
    usedTopics = [];
  }

  return {
    topicCharts,
    dataSource,
    usedTopics,
    modeSegments,
    unlockSummary,
    parameterProfile,
    series: topicCharts.flatMap((item) => item.series),
  };
}

function resolveLegacyStoredPath(stored) {
  const uploadsDir = path.join(__dirname, '..', 'uploads');
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

function buildParsedLog(filePath, fileName, options = {}) {
  const metadata = parseUlogHeader(filePath);
  const logId = randomUUID();
  const seed = buildFallbackSeed(`${fileName}-${logId}`);
  const fallbackSeriesMap = generateFallbackTimeSeries(metadata, seed);
  const parsedResult = parseOrFallbackSeries(filePath, fallbackSeriesMap, options);
  const topicCharts = parsedResult.topicCharts;
  const series = parsedResult.series;
  const dataSource = parsedResult.dataSource;
  const usedTopics = parsedResult.usedTopics;
  const modeSegments = parsedResult.modeSegments;
  const unlockSummary = parsedResult.unlockSummary;
  const parameterProfile = parsedResult.parameterProfile;

  const diagnostics = buildDiagnostics(
    dataSource === 'px4-topics-derived'
      ? mapSeriesFromTopicCharts(topicCharts)
      : seriesArrayToMap(series),
  );

  return {
    logId,
    fileName,
    uploadedAt: new Date().toISOString(),
    metadata,
    series,
    topicCharts,
    diagnostics,
    dataSource,
    usedTopics,
    modeSegments,
    unlockSummary,
    parameterProfile,
    storedPath: filePath,
  };
}

function buildLogUnlockAnalysis(filePath, fileName) {
  const metadata = parseUlogHeader(filePath);
  const parsed = parsePx4UnlockSummary(filePath);

  return {
    fileName,
    metadata,
    unlockSummary: normalizeUnlockSummary(parsed),
  };
}

function ensureStoredLogParsed(stored) {
  if (!stored.storedPath) {
    const guessedPath = resolveLegacyStoredPath(stored);
    if (guessedPath) {
      stored.storedPath = guessedPath;
    }
  }

  if (
    stored.storedPath &&
    (!stored.topicCharts || stored.topicCharts.length <= 2 || !stored.parameterProfile)
  ) {
    const fallbackSeriesMap = generateFallbackTimeSeries(
      stored.metadata,
      buildFallbackSeed(`${stored.fileName}-${stored.logId}`),
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
    stored.modeSegments = reparsed.modeSegments;
    stored.unlockSummary = reparsed.unlockSummary;
    stored.parameterProfile = reparsed.parameterProfile;
    stored.diagnostics = diagnostics;
  }

  return stored;
}

module.exports = {
  buildParsedLog,
  buildLogUnlockAnalysis,
  ensureStoredLogParsed,
  parsePx4RawSignals,
};
