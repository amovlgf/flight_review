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
          current_a: [4.2, 5.1, 3.8],
          remaining: [0.92, 0.9, 0.88],
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
  assert.deepEqual(normalized.signals['battery.current'].points, [
    [0, 4.2],
    [5, 5.1],
    [10, 3.8],
  ]);
  assert.deepEqual(normalized.signals['battery.remaining'].points, [
    [0, 92],
    [5, 90],
    [10, 88],
  ]);
  assert.ok(!normalized.missingSignals.some((item) => item.id.startsWith('modeCompleted.')));

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

test('PX4TopicAdapter maps current PX4 array-style position and GNSS fields', () => {
  const normalized = mapStandardSignals({
    timeRange: { startS: 0, endS: 1 },
    rawTopics: [
      {
        topic: 'estimator_status_flags',
        instance: 0,
        timeS: [0, 1],
        fields: {
          cs_gps: [0, 1],
        },
      },
      {
        topic: 'trajectory_setpoint',
        instance: 0,
        timeS: [0, 1],
        fields: {
          'position[0]': [1, 2],
          'position[1]': [3, 4],
          'position[2]': [-1, -2],
        },
      },
      {
        topic: 'vehicle_visual_odometry',
        instance: 0,
        timeS: [0, 1],
        fields: {
          'position[0]': [5, 6],
          'position[1]': [7, 8],
          'position[2]': [-3, -4],
        },
      },
    ],
  });

  assert.deepEqual(normalized.signals['estimator.csGnssPos'].points, [
    [0, 0],
    [1, 1],
  ]);
  assert.equal(normalized.signals['estimator.csGnssPos'].field, 'cs_gps');
  assert.deepEqual(normalized.signals['position.setpoint.x'].points, [
    [0, 1],
    [1, 2],
  ]);
  assert.equal(normalized.signals['position.setpoint.x'].field, 'position[0]');
  assert.deepEqual(normalized.signals['position.vision.z'].points, [
    [0, -3],
    [1, -4],
  ]);
  assert.equal(normalized.signals['position.vision.z'].field, 'position[2]');
});

test('battery analysis is available when current or capacity is mapped', () => {
  const normalized = mapStandardSignals({
    timeRange: { startS: 0, endS: 10 },
    rawTopics: [
      {
        topic: 'vehicle_status',
        instance: 0,
        timeS: [0, 10],
        fields: {
          arming_state: [1, 2],
          nav_state: [0, 2],
          failsafe: [0, 0],
        },
      },
      {
        topic: 'vehicle_land_detected',
        instance: 0,
        timeS: [0, 10],
        fields: {
          landed: [1, 0],
        },
      },
      {
        topic: 'battery_status',
        instance: 0,
        timeS: [0, 10],
        fields: {
          current_a: [1.2, 1.4],
        },
      },
    ],
  });
  const { dataQuality, analysisCapability } = evaluateDataQuality({
    signals: normalized.signals,
  });

  assert.equal(analysisCapability.batteryAnalysis, true);
  assert.ok(!analysisCapability.reasons.includes('battery information missing'));
  assert.ok(!dataQuality.rules.some((item) => item.code === 'DQ_MISSING_OPTIONAL_BATTERY'));
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
