const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeTuningMetricsFromTopicCharts,
} = require('./tuningMetricsService');

function buildTopicChart(topic, series) {
  return {
    topic,
    title: topic,
    series,
  };
}

function buildSeries(name, points, unit = 'deg') {
  return {
    name,
    unit,
    points,
  };
}

test('computes tracking RMS and peak error for aligned attitude curves', () => {
  const topicCharts = [
    buildTopicChart('vehicle_attitude_setpoint', [
      buildSeries('roll_sp', [
        [0, 0],
        [1, 1],
        [2, 1],
      ]),
    ]),
    buildTopicChart('vehicle_attitude', [
      buildSeries('roll', [
        [0, 0],
        [1, 0.8],
        [2, 1.1],
      ]),
    ]),
  ];

  const result = computeTuningMetricsFromTopicCharts(topicCharts, {
    axis: 'roll',
    loop: 'attitude',
  });

  assert.ok(Math.abs(result.metrics.trackingErrorRms - 0.12909944487358058) < 1e-9);
  assert.ok(Math.abs(result.metrics.trackingErrorPeak - 0.2) < 1e-9);
  assert.equal(result.axis, 'roll');
  assert.equal(result.loop, 'attitude');
});

test('returns a warning when setpoint series is missing', () => {
  const topicCharts = [
    buildTopicChart('vehicle_attitude', [
      buildSeries('roll', [
        [0, 0],
        [1, 0.5],
      ]),
    ]),
  ];

  const result = computeTuningMetricsFromTopicCharts(topicCharts, {
    axis: 'roll',
    loop: 'attitude',
  });

  assert.equal(result.metrics.trackingErrorRms, 0);
  assert.match(result.warnings.join(' '), /Setpoint series/);
});

test('returns a warning when actual series is missing', () => {
  const topicCharts = [
    buildTopicChart('vehicle_attitude_setpoint', [
      buildSeries('roll_sp', [
        [0, 0],
        [1, 0.5],
      ]),
    ]),
  ];

  const result = computeTuningMetricsFromTopicCharts(topicCharts, {
    axis: 'roll',
    loop: 'attitude',
  });

  assert.equal(result.metrics.trackingErrorPeak, 0);
  assert.match(result.warnings.join(' '), /Actual series/);
});

test('handles empty data without crashing', () => {
  const result = computeTuningMetricsFromTopicCharts([], {
    axis: 'yaw',
    loop: 'rate',
  });

  assert.equal(result.metrics.trackingErrorRms, 0);
  assert.equal(result.metrics.trackingErrorPeak, 0);
  assert.equal(result.metrics.oscillationScore, 0);
  assert.ok(Array.isArray(result.warnings));
  assert.ok(result.warnings.length > 0);
});

test('dominant oscillation metrics stay finite for oscillatory error signals', () => {
  const sampleCount = 64;
  const dt = 0.05;
  const setpointPoints = [];
  const actualPoints = [];

  for (let index = 0; index < sampleCount; index += 1) {
    const timeS = index * dt;
    setpointPoints.push([timeS, Math.sin(2 * Math.PI * 1.5 * timeS)]);
    actualPoints.push([timeS, 0.7 * Math.sin(2 * Math.PI * 1.5 * timeS - 0.4)]);
  }

  const topicCharts = [
    buildTopicChart('vehicle_rates_setpoint', [buildSeries('roll', setpointPoints, 'rad/s')]),
    buildTopicChart('vehicle_angular_velocity', [buildSeries('xyz[0]', actualPoints, 'rad/s')]),
  ];

  const result = computeTuningMetricsFromTopicCharts(topicCharts, {
    axis: 'roll',
    loop: 'rate',
  });

  assert.ok(
    result.metrics.dominantOscillationHz === null ||
      Number.isFinite(result.metrics.dominantOscillationHz),
  );
  assert.ok(Number.isFinite(result.metrics.oscillationScore));
  assert.ok(result.metrics.oscillationScore >= 0);
});

test('clips out-of-range segments and still computes metrics', () => {
  const topicCharts = [
    buildTopicChart('vehicle_attitude_setpoint', [
      buildSeries('pitch_sp', [
        [10, 0],
        [11, 1],
        [12, 1],
        [13, 1],
      ]),
    ]),
    buildTopicChart('vehicle_attitude', [
      buildSeries('pitch', [
        [10, 0],
        [11, 0.6],
        [12, 0.9],
        [13, 1.0],
      ]),
    ]),
  ];

  const result = computeTuningMetricsFromTopicCharts(topicCharts, {
    axis: 'pitch',
    loop: 'attitude',
    segment: {
      startS: 8,
      endS: 20,
    },
  });

  assert.ok(result.metrics.trackingErrorRms > 0);
  assert.match(result.warnings.join(' '), /clipped/);
});
