const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const {
  buildLogUnlockAnalysis,
  buildParsedLog,
  ensureStoredLogParsed,
} = require('./services/logParserService');
const { hasUnlockedFlight } = require('./services/unlockFlightService');
const {
  VALID_TUNING_AXES,
  VALID_TUNING_LOOPS,
  computeTuningMetrics,
} = require('./services/tuningMetricsService');
const { proposeTuningChanges } = require('./services/tuningProposalService');
const { reviewTuningProposal } = require('./services/tuningReviewService');
const {
  getAvailableRoles,
  resolveRole,
  filterTopicChartsByRole,
} = require('./services/rolePolicyService');

const app = express();
const port = process.env.PORT || 3001;
const parsedLogStore = new Map();

function decodeUploadedFileName(fileName) {
  return Buffer.from(fileName, 'latin1').toString('utf8');
}

function removeUploadedTempFile(filePath) {
  if (!filePath) return;
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // Best-effort cleanup for batch uploads.
  }
}

function resolveBatchFailureReason(error) {
  if (!error) return 'ULG parsing failed.';
  if (error.message === 'ULG_FILE_TOO_SMALL') {
    return 'ULG file is too small.';
  }
  if (error.message === 'INVALID_ULG_MAGIC') {
    return 'Invalid ULG file header.';
  }
  if (typeof error.stderr === 'string' && error.stderr.trim()) {
    const stderrLines = error.stderr.trim().split(/\r?\n/);
    return stderrLines[stderrLines.length - 1] || 'ULG parsing failed.';
  }
  return error.message || 'ULG parsing failed.';
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
    const parsedLog = buildParsedLog(req.file.path, safeOriginalName);
    parsedLogStore.set(parsedLog.logId, parsedLog);

    return res.status(201).json({
      message: 'ULG file uploaded and parsed (header metadata).',
      logId: parsedLog.logId,
      file: {
        originalName: safeOriginalName,
        size: req.file.size,
      },
      metadata: parsedLog.metadata,
      diagnostics: parsedLog.diagnostics,
      topicCharts: parsedLog.topicCharts,
      dataSource: parsedLog.dataSource,
      usedTopics: parsedLog.usedTopics,
      modeSegments: parsedLog.modeSegments,
    });
  } catch (error) {
    return res.status(400).json({
      message: 'ULG parsing failed.',
      reason: error.message,
    });
  }
});

app.post('/api/logs/batch-analyze', upload.array('logFiles'), (req, res) => {
  const files = Array.isArray(req.files) ? req.files : [];

  if (files.length === 0) {
    return res.status(400).json({
      message: 'No files uploaded.',
      unlockedLogs: [],
      unlockedLogDetails: [],
      failedLogs: [],
      total: 0,
      unlockedCount: 0,
      failedCount: 0,
    });
  }

  const unlockedLogs = [];
  const unlockedLogDetails = [];
  const failedLogs = [];

  for (const file of files) {
    const safeOriginalName = decodeUploadedFileName(file.originalname);
    const extension = path.extname(safeOriginalName).toLowerCase();

    try {
      if (extension !== '.ulg') {
        failedLogs.push({
          fileName: safeOriginalName,
          reason: 'Only .ulg files are supported now.',
        });
        continue;
      }

      const parsedLog = buildLogUnlockAnalysis(file.path, safeOriginalName);

      if (hasUnlockedFlight(parsedLog)) {
        unlockedLogs.push(safeOriginalName);
        unlockedLogDetails.push({
          fileName: safeOriginalName,
          flightTimeS: parsedLog.unlockSummary?.flightTimeS ?? null,
          logStartTimestampUs: parsedLog.metadata?.logStartTimestampUs ?? null,
        });
      }
    } catch (error) {
      failedLogs.push({
        fileName: safeOriginalName,
        reason: resolveBatchFailureReason(error),
      });
    } finally {
      removeUploadedTempFile(file.path);
    }
  }

  return res.json({
    unlockedLogs,
    unlockedLogDetails,
    failedLogs,
    total: files.length,
    unlockedCount: unlockedLogs.length,
    failedCount: failedLogs.length,
  });
});

app.get('/api/logs/chart-data', (req, res) => {
  const logId = typeof req.query.logId === 'string' ? req.query.logId : '';
  const roleRaw = typeof req.query.role === 'string' ? req.query.role : undefined;
  const role = resolveRole(roleRaw);
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

  ensureStoredLogParsed(stored);

  const filteredTopicCharts = filterTopicChartsByRole(stored.topicCharts, role);

  res.json({
    message: 'Chart data generated from uploaded ULG metadata.',
    dataSource: stored.dataSource,
    role,
    availableRoles: getAvailableRoles(),
    logId,
    fileName: stored.fileName,
    uploadedAt: stored.uploadedAt,
    metadata: stored.metadata,
    usedTopics: filteredTopicCharts.map((item) => item.topic),
    modeSegments: Array.isArray(stored.modeSegments) ? stored.modeSegments : [],
    series: filteredTopicCharts.flatMap((item) => item.series),
    topicCharts: filteredTopicCharts,
    diagnostics: stored.diagnostics,
  });
});

app.post('/api/tuning/metrics', (req, res) => {
  const logId = typeof req.body?.logId === 'string' ? req.body.logId.trim() : '';
  const axis = typeof req.body?.axis === 'string' ? req.body.axis.trim() : '';
  const loop = typeof req.body?.loop === 'string' ? req.body.loop.trim() : '';
  const segment =
    req.body?.segment && typeof req.body.segment === 'object'
      ? req.body.segment
      : undefined;

  if (!logId) {
    return res.status(400).json({
      message: 'logId is required.',
    });
  }

  if (!VALID_TUNING_AXES.includes(axis)) {
    return res.status(400).json({
      message: `axis must be one of: ${VALID_TUNING_AXES.join(', ')}.`,
    });
  }

  if (!VALID_TUNING_LOOPS.includes(loop)) {
    return res.status(400).json({
      message: `loop must be one of: ${VALID_TUNING_LOOPS.join(', ')}.`,
    });
  }

  const stored = parsedLogStore.get(logId);
  if (!stored) {
    return res.status(404).json({
      message: 'Log not found. Please upload first.',
      logId,
    });
  }

  ensureStoredLogParsed(stored);

  return res.json(
    computeTuningMetrics(stored, {
      axis,
      loop,
      segment,
    }),
  );
});

app.post('/api/tuning/propose', (req, res) => {
  const axis = typeof req.body?.axis === 'string' ? req.body.axis.trim() : '';
  const loop = typeof req.body?.loop === 'string' ? req.body.loop.trim() : '';

  if (!VALID_TUNING_AXES.includes(axis)) {
    return res.status(400).json({
      message: `axis must be one of: ${VALID_TUNING_AXES.join(', ')}.`,
    });
  }

  if (!VALID_TUNING_LOOPS.includes(loop)) {
    return res.status(400).json({
      message: `loop must be one of: ${VALID_TUNING_LOOPS.join(', ')}.`,
    });
  }

  if (!req.body?.currentParams || typeof req.body.currentParams !== 'object') {
    return res.status(400).json({
      message: 'currentParams is required.',
    });
  }

  if (!req.body?.bounds || typeof req.body.bounds !== 'object') {
    return res.status(400).json({
      message: 'bounds is required.',
    });
  }

  if (!req.body?.metrics || typeof req.body.metrics !== 'object') {
    return res.status(400).json({
      message: 'metrics is required.',
    });
  }

  return res.json(
    proposeTuningChanges({
      axis,
      loop,
      currentParams: req.body.currentParams,
      bounds: req.body.bounds,
      metrics: req.body.metrics,
    }),
  );
});

app.post('/api/tuning/review', async (req, res) => {
  const axis = typeof req.body?.axis === 'string' ? req.body.axis.trim() : '';
  const loop = typeof req.body?.loop === 'string' ? req.body.loop.trim() : '';
  const stage = typeof req.body?.stage === 'string' ? req.body.stage.trim() : '';

  if (!VALID_TUNING_AXES.includes(axis)) {
    return res.status(400).json({
      message: `axis must be one of: ${VALID_TUNING_AXES.join(', ')}.`,
    });
  }

  if (!VALID_TUNING_LOOPS.includes(loop)) {
    return res.status(400).json({
      message: `loop must be one of: ${VALID_TUNING_LOOPS.join(', ')}.`,
    });
  }

  if (!stage) {
    return res.status(400).json({
      message: 'stage is required.',
    });
  }

  if (!req.body?.currentParams || typeof req.body.currentParams !== 'object') {
    return res.status(400).json({
      message: 'currentParams is required.',
    });
  }

  if (!req.body?.bounds || typeof req.body.bounds !== 'object') {
    return res.status(400).json({
      message: 'bounds is required.',
    });
  }

  if (!req.body?.metrics || typeof req.body.metrics !== 'object') {
    return res.status(400).json({
      message: 'metrics is required.',
    });
  }

  if (!req.body?.proposal || typeof req.body.proposal !== 'object') {
    return res.status(400).json({
      message: 'proposal is required.',
    });
  }

  return res.json(
    await reviewTuningProposal({
      axis,
      loop,
      stage,
      vehicle:
        req.body?.vehicle && typeof req.body.vehicle === 'object'
          ? req.body.vehicle
          : {},
      currentParams: req.body.currentParams,
      bounds: req.body.bounds,
      metrics: req.body.metrics,
      proposal: req.body.proposal,
    }),
  );
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Backend server scaffold running at http://localhost:${port}`);
  });
}

module.exports = {
  app,
};
