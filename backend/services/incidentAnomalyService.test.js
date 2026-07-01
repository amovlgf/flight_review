const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAnomalySummary } = require('./incidentAnomalyService');

function makeSignal(id, points) {
  return {
    id,
    topic: id.replaceAll('.', '_'),
    instance: 0,
    field: id.split('.').at(-1),
    points,
  };
}

const baseCapability = {
  timeline: true,
  phaseDetection: true,
  eventExtraction: true,
  attitudeAnalysis: false,
  rateAnalysis: false,
  actuatorAnalysis: false,
  batteryAnalysis: true,
  estimatorAnalysis: true,
  reasons: [],
};

test('V2 anomaly summary does not infer anomalies from missing detector signals', () => {
  const summary = buildAnomalySummary({
    signals: {
      'log.timeS': makeSignal('log.timeS', [
        [0, 0],
        [10, 10],
      ]),
    },
    analysisCapability: baseCapability,
    dataQuality: { level: 'partial' },
  });

  assert.equal(summary.version, 'incident-anomaly.v2.0');
  assert.equal(summary.status, 'no_critical_detected');
  assert.equal(summary.severity, 'none');
  assert.equal(summary.earliestAnomalyTimeS, null);
  assert.deepEqual(summary.findings, []);
  assert.equal(
    summary.detectorResults.find((item) => item.id === 'attitude_tracking_error')?.status,
    'unavailable',
  );
});

test('V2 anomaly summary reports confirmed logged battery warning flags', () => {
  const summary = buildAnomalySummary({
    signals: {
      'log.timeS': makeSignal('log.timeS', [
        [0, 0],
        [30, 30],
      ]),
      'failsafeFlag.batteryWarning': makeSignal('failsafeFlag.batteryWarning', [
        [0, 0],
        [12, 1],
        [18, 0],
      ]),
    },
    analysisCapability: baseCapability,
    dataQuality: { level: 'complete' },
  });

  assert.equal(summary.status, 'needs_review');
  assert.equal(summary.severity, 'warning');
  assert.equal(summary.earliestAnomalyTimeS, 12);
  assert.equal(summary.findings.length, 1);
  assert.equal(summary.findings[0].detectorId, 'battery_logged_flags');
  assert.equal(summary.findings[0].confidence, 'confirmed');
  assert.deepEqual(summary.findings[0].evidenceSignals, ['failsafeFlag.batteryWarning']);
  assert.match(summary.findings[0].limitations[0], /not a root-cause/);
});

test('V2 anomaly summary suppresses short failsafe flag bounces', () => {
  const summary = buildAnomalySummary({
    signals: {
      'log.timeS': makeSignal('log.timeS', [
        [0, 0],
        [10, 10],
      ]),
      'vehicle.failsafe': makeSignal('vehicle.failsafe', [
        [0, 0],
        [2, 1],
        [2.2, 0],
        [10, 0],
      ]),
    },
    analysisCapability: baseCapability,
    dataQuality: { level: 'complete' },
  });

  assert.equal(summary.status, 'no_critical_detected');
  assert.equal(summary.findings.some((finding) => finding.detectorId === 'failsafe_state'), false);
  assert.equal(summary.detectorResults.find((item) => item.id === 'failsafe_state')?.status, 'not_triggered');
});

test('V2 anomaly summary reports large adaptive battery voltage drops', () => {
  const summary = buildAnomalySummary({
    signals: {
      'log.timeS': makeSignal('log.timeS', [
        [0, 0],
        [30, 30],
      ]),
      'battery.voltage': makeSignal('battery.voltage', [
        [0, 24],
        [10, 23],
        [20, 15],
      ]),
    },
    analysisCapability: baseCapability,
    dataQuality: { level: 'complete' },
  });

  const finding = summary.findings.find((item) => item.detectorId === 'battery_voltage_drop');
  assert.ok(finding);
  assert.equal(finding.startTimeS, 0);
  assert.equal(finding.endTimeS, 20);
  assert.deepEqual(finding.evidenceSignals, ['battery.voltage']);
  assert.equal(finding.thresholds[0].source, 'adaptive');
});

test('V2 anomaly summary reports conservative airborne log end risk', () => {
  const summary = buildAnomalySummary({
    signals: {
      'log.timeS': makeSignal('log.timeS', [
        [0, 0],
        [30, 30],
      ]),
      'vehicle.landed': makeSignal('vehicle.landed', [
        [0, 0],
        [30, 0],
      ]),
      'vehicle.armed': makeSignal('vehicle.armed', [
        [0, 1],
        [30, 1],
      ]),
      'position.altitudeRelative': makeSignal('position.altitudeRelative', [
        [0, 8],
        [30, 12],
      ]),
    },
    analysisCapability: baseCapability,
    dataQuality: { level: 'complete' },
  });

  const finding = summary.findings.find((item) => item.detectorId === 'airborne_log_end');
  assert.ok(finding);
  assert.equal(finding.startTimeS, 30);
  assert.equal(finding.endTimeS, 30);
  assert.ok(finding.evidenceSignals.includes('vehicle.landed'));
  assert.ok(finding.evidenceSignals.includes('position.altitudeRelative'));
  assert.match(finding.limitations.join(' '), /not an accident-cause conclusion/);
});
