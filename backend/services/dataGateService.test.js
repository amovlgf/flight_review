const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateFlightSummaryDataGate } = require('./dataGateService');

function rawTopic(topic, fields = {}, timeS = [0, 1]) {
  return {
    topic,
    instance: 0,
    timeS,
    fields,
  };
}

test('flight-summary data gate blocks logs missing required state and position topics', () => {
  const result = evaluateFlightSummaryDataGate({
    rawTopics: [rawTopic('vehicle_status', { nav_state: [0, 2] })],
  });

  assert.equal(result.canAnalyze, false);
  assert.deepEqual(result.missingRequired, [
    'vehicle_land_detected',
    'vehicle_local_position|vehicle_global_position',
  ]);
  assert.ok(result.blockingReasons.some((item) => item.includes('minimum analysis')));
});

test('flight-summary data gate allows required data and reports optional limitations', () => {
  const result = evaluateFlightSummaryDataGate({
    rawTopics: [
      rawTopic('vehicle_status', { nav_state: [0, 2], arming_state: [1, 2] }),
      rawTopic('vehicle_land_detected', { landed: [1, 0] }),
      rawTopic('vehicle_local_position', { x: [0, 1], y: [0, 1], z: [0, -1] }),
    ],
  });

  assert.equal(result.canAnalyze, true);
  assert.deepEqual(result.missingRequired, []);
  assert.ok(result.missingOptional.includes('battery_status'));
  assert.ok(result.limitations.some((item) => item.includes('battery_status')));
});

test('flight-summary data gate reports missing timestamp when raw topics have no usable time axis', () => {
  const result = evaluateFlightSummaryDataGate({
    rawTopics: [
      rawTopic('vehicle_status', { nav_state: [0] }, []),
      rawTopic('vehicle_land_detected', { landed: [1] }, []),
      rawTopic('vehicle_global_position', { lat: [1], lon: [2], alt: [3] }, []),
    ],
  });

  assert.equal(result.canAnalyze, false);
  assert.ok(result.missingRequired.includes('timestamp'));
});
