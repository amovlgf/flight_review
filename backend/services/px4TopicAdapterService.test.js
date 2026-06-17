const test = require('node:test');
const assert = require('node:assert/strict');
const { mapStandardSignals } = require('./px4TopicAdapterService');
const { evaluateDataQuality } = require('./dataQualityService');

test('PX4TopicAdapter maps V1.1 standard signals with source traceability', () => {
  const normalized = mapStandardSignals({
    timeRange: { startS: 0, endS: 10 },
    rawTopics: [
      {
        topic: 'vehicle_status',
        instance: 0,
        timeS: [0, 5, 10],
        fields: {
          arming_state: [1, 2, 1],
          nav_state: [0, 2, 2],
          failsafe: [0, 0, 1],
        },
      },
      {
        topic: 'vehicle_land_detected',
        instance: 0,
        timeS: [0, 5, 10],
        fields: {
          landed: [1, 0, 0],
        },
      },
      {
        topic: 'battery_status',
        instance: 0,
        timeS: [0, 5, 10],
        fields: {
          voltage_v: [16.1, 15.9, 15.8],
        },
      },
      {
        topic: 'estimator_status',
        instance: 0,
        timeS: [0, 5, 10],
        fields: {
          innovation_check_flags: [0, 0, 1],
        },
      },
    ],
  });

  assert.deepEqual(normalized.signals['vehicle.armed'].points, [
    [0, 0],
    [5, 1],
    [10, 0],
  ]);
  assert.deepEqual(normalized.signals['vehicle.failsafe'].points, [
    [0, 0],
    [5, 0],
    [10, 1],
  ]);
  assert.deepEqual(normalized.signals['log.timeS'].points, [
    [0, 0],
    [5, 5],
    [10, 10],
  ]);

  const mapping = normalized.signalMappingReport.find(
    (item) => item.standardSignal === 'vehicle.armed',
  );
  assert.equal(mapping.status, 'mapped');
  assert.deepEqual(mapping.source, {
    topic: 'vehicle_status',
    instance: 0,
    field: 'arming_state',
    source: 'raw',
  });
  assert.ok(normalized.missingSignals.some((item) => item.id === 'position.altitudeRelative'));
  assert.ok(normalized.missingSignals.some((item) => item.id === 'takeoff.state'));
});

test('PX4TopicAdapter builds log.timeS from all raw topic timestamps', () => {
  const normalized = mapStandardSignals({
    timeRange: { startS: 0, endS: 10 },
    rawTopics: [
      {
        topic: 'actuator_armed',
        instance: 0,
        timeS: [2, 10],
        fields: {
          armed: [0, 1],
        },
      },
      {
        topic: 'vehicle_land_detected',
        instance: 0,
        timeS: [0, 5],
        fields: {
          landed: [1, 0],
        },
      },
    ],
  });

  assert.deepEqual(normalized.signals['log.timeS'].points, [
    [0, 0],
    [2, 2],
    [5, 5],
    [10, 10],
  ]);
  assert.equal(normalized.signalMappingReport[0].source.topic, 'ulog');
});

test('data quality is insufficient when required V1.1 signals are missing', () => {
  const normalized = mapStandardSignals({
    timeRange: { startS: 0, endS: 10 },
    rawTopics: [
      {
        topic: 'vehicle_status',
        instance: 0,
        timeS: [0, 10],
        fields: {
          nav_state: [0, 0],
        },
      },
    ],
  });
  const { dataQuality, analysisCapability } = evaluateDataQuality({
    signals: normalized.signals,
  });

  assert.equal(dataQuality.level, 'insufficient');
  assert.ok(dataQuality.rules.some((item) => item.code === 'DQ_MISSING_ARM_STATE'));
  assert.ok(dataQuality.rules.some((item) => item.code === 'DQ_MISSING_LANDED_STATE'));
  assert.equal(analysisCapability.phaseDetection, false);
  assert.equal(analysisCapability.timeline, true);
});
