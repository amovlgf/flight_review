const express = require('express');
const { buildIncidentAnalysisV13 } = require('../services/incidentAnalysisService');

function createIncidentAnalysisRouter({ parsedLogStore, ensureStoredLogParsed }) {
  if (!parsedLogStore || typeof parsedLogStore.get !== 'function') {
    throw new TypeError('parsedLogStore is required for incident analysis routes.');
  }
  if (typeof ensureStoredLogParsed !== 'function') {
    throw new TypeError('ensureStoredLogParsed is required for incident analysis routes.');
  }

  const router = express.Router();

  router.post('/api/logs/:logId/incident-analysis', (req, res) => {
    const logId = typeof req.params.logId === 'string' ? req.params.logId.trim() : '';
    if (!logId) {
      return res.status(400).json({
        message: 'logId is required.',
        code: 'LOG_ID_REQUIRED',
      });
    }

    const stored = parsedLogStore.get(logId);
    if (!stored) {
      return res.status(404).json({
        message: 'Log not found. Please upload first.',
        code: 'LOG_NOT_FOUND',
        logId,
      });
    }

    ensureStoredLogParsed(stored);
    return res.json(buildIncidentAnalysisV13(stored));
  });

  return router;
}

module.exports = {
  createIncidentAnalysisRouter,
};
