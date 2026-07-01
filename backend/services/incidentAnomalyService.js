const { getIncidentAnomalyDetectors } = require('./incidentAnomalyDetectors');

const DETECTOR_VERSION = 'incident-anomaly.v2.0';

function hasSignal(signals, id) {
  return Array.isArray(signals?.[id]?.points) && signals[id].points.length > 0;
}

function compareSeverity(left, right) {
  const order = { none: 0, info: 1, warning: 2, critical: 3 };
  return (order[left] || 0) - (order[right] || 0);
}

function maxSeverity(findings) {
  return findings.reduce(
    (current, finding) => (compareSeverity(finding.severity, current) > 0 ? finding.severity : current),
    'none',
  );
}

function normalizeDetectorResult(result) {
  if (Array.isArray(result)) return result;
  return result ? [result] : [];
}

function buildAnomalySummary({ signals = {}, analysisCapability = {}, dataQuality = null }) {
  const detectorResults = getIncidentAnomalyDetectors()
    .flatMap((detector) =>
      normalizeDetectorResult(detector.run({
        signals,
        analysisCapability,
        dataQuality,
      })),
    );

  const findings = detectorResults
    .flatMap((result) => result.findings || [])
    .sort((a, b) => a.startTimeS - b.startTimeS || a.id.localeCompare(b.id));
  const earliestAnomalyTimeS = findings.length > 0 ? findings[0].startTimeS : null;
  const severity = maxSeverity(findings);
  const notAvailable = dataQuality?.level === 'invalid' || !hasSignal(signals, 'log.timeS');

  return {
    version: DETECTOR_VERSION,
    status: notAvailable
      ? 'not_available'
      : findings.length > 0
        ? 'needs_review'
        : 'no_critical_detected',
    severity,
    earliestAnomalyTimeS,
    findings,
    detectorResults,
    limitations: [
      'V2 reports anomaly phenomena only and does not output root causes, hardware fault claims, accident probability, or AI narrative.',
      'Missing detector signals disable only the affected detector; no anomaly is inferred from missing optional data.',
    ],
  };
}

module.exports = {
  buildAnomalySummary,
};
