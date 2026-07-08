const { parsePx4RawSignals } = require('./logParserService');
const { mapStandardSignals } = require('./px4TopicAdapterService');
const { evaluateFlightSummaryDataGate } = require('./dataGateService');
const { analyzeFlightPhases } = require('./flightPhaseAnalyzerService');
const { analyzeFlightStatus } = require('./flightStatusAnalyzerService');
const {
  attachChartsToFlightStatus,
  attachChartsToPhases,
} = require('./chartDataBuilderService');
const { generateFlightSummaryMarkdown } = require('./reportGeneratorService');

const CONTRACT_VERSION = 'flight-summary.v1';

function pointsFor(signals, id) {
  return Array.isArray(signals?.[id]?.points) ? signals[id].points : [];
}

function firstTransition(points, predicate, fromValue, toValue) {
  if (!Array.isArray(points) || points.length < 2) return null;
  let previous = predicate(points[0][1]);
  for (let index = 1; index < points.length; index += 1) {
    const current = predicate(points[index][1]);
    if (previous === fromValue && current === toValue) return points[index][0];
    previous = current;
  }
  return null;
}

function roundNullable(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(3)) : null;
}

function buildSummary(stored, signals, dataGate, phases, flightStatus) {
  const timePoints = pointsFor(signals, 'log.timeS');
  const armedPoints = pointsFor(signals, 'vehicle.armed');
  const landedPoints = pointsFor(signals, 'vehicle.landed');
  const startS = timePoints[0]?.[0] ?? 0;
  const endS = timePoints.at(-1)?.[0] ?? null;
  const totalDurationS = typeof endS === 'number' ? endS - startS : null;
  return {
    totalDurationS: roundNullable(totalDurationS),
    armedAtS: roundNullable(firstTransition(armedPoints, (value) => Number(value) > 0.5, false, true)),
    takeoffAtS: roundNullable(firstTransition(landedPoints, (value) => Number(value) > 0.5, true, false)),
    landingAtS: roundNullable(
      phases.find((phase) => phase.id === 'landed_complete')?.startS ??
        firstTransition(landedPoints, (value) => Number(value) > 0.5, false, true),
    ),
    failsafeTriggered: flightStatus?.failsafe?.triggered ?? null,
    dataCompleteness: dataGate.missingOptional.length > 0 ? 'partial' : 'complete',
    armedFlightTimeS: stored.unlockSummary?.flightTimeS ?? null,
  };
}

function buildBlockedResponse(stored, dataGate, parseError = null) {
  return {
    contractVersion: CONTRACT_VERSION,
    code: 'DATA_GATE_BLOCKED',
    message: 'Log data is insufficient for flight summary analysis.',
    logId: stored.logId,
    fileName: stored.fileName,
    uploadedAt: stored.uploadedAt,
    metadata: stored.metadata,
    dataGate,
    summary: null,
    phases: [],
    flightStatus: null,
    reportMarkdown: null,
    parser: {
      success: parseError === null,
      error: parseError ? String(parseError.message || parseError) : null,
    },
  };
}

function buildFlightSummaryResponse(stored) {
  let rawSignalPayload;
  try {
    rawSignalPayload = parsePx4RawSignals(stored.storedPath);
  } catch (error) {
    const dataGate = evaluateFlightSummaryDataGate({ rawTopics: [] });
    return buildBlockedResponse(stored, dataGate, error);
  }

  const dataGate = evaluateFlightSummaryDataGate(rawSignalPayload);
  if (!dataGate.canAnalyze) {
    return buildBlockedResponse(stored, dataGate);
  }

  const normalized = mapStandardSignals(rawSignalPayload);
  const basePhases = analyzeFlightPhases({
    signals: normalized.signals,
    modeSegments: stored.modeSegments,
  });
  const phases = attachChartsToPhases(basePhases, normalized.signals);
  const baseFlightStatus = analyzeFlightStatus({
    signals: normalized.signals,
    phases,
  });
  const flightStatus = attachChartsToFlightStatus(baseFlightStatus, normalized.signals);
  const summary = buildSummary(stored, normalized.signals, dataGate, phases, flightStatus);
  const reportMarkdown = generateFlightSummaryMarkdown({
    fileName: stored.fileName,
    summary,
    phases,
    flightStatus,
    dataGate,
  });

  return {
    contractVersion: CONTRACT_VERSION,
    code: 'OK',
    message: 'Flight summary generated from uploaded ULog data.',
    logId: stored.logId,
    fileName: stored.fileName,
    uploadedAt: stored.uploadedAt,
    metadata: stored.metadata,
    dataGate,
    summary,
    phases,
    flightStatus,
    reportMarkdown,
    parser: {
      success: true,
      error: null,
    },
  };
}

module.exports = {
  CONTRACT_VERSION,
  buildFlightSummaryResponse,
};
