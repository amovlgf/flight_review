const test = require('node:test');
const assert = require('node:assert/strict');
const {
  alignSeries,
  buildControlQualityReport,
  computeTrackingMetrics,
  wrapAngleDeg,
} = require('./controlQualityService');

function buildSeries(name, points) {
  return {
    name,
    unit: '',
    points,
  };
}

test('wrapAngleDeg keeps yaw error across the +/-180 boundary small', () => {
  assert.equal(wrapAngleDeg(358), -2);
  assert.equal(wrapAngleDeg(-358), 2);
});

test('alignSeries interpolates setpoint on feedback timestamps', () => {
  const aligned = alignSeries({
    setpointSeries: buildSeries('sp', [
      [0, 0],
      [1, 10],
      [2, 20],
      [3, 30],
      [4, 40],
    ]),
    feedbackSeries: buildSeries('fb', [
      [0.5, 2],
      [1.5, 12],
      [2.5, 22],
      [3.0, 28],
      [3.5, 34],
    ]),
    segment: { startS: 0, endS: 4 },
  });

  assert.equal(aligned.status, 'available');
  assert.deepEqual(aligned.sp.map((value) => Number(value.toFixed(1))), [
    5, 15, 25, 30, 35,
  ]);
  assert.deepEqual(aligned.err.map((value) => Number(value.toFixed(1))), [
    3, 3, 3, 2, 1,
  ]);
});

test('computeTrackingMetrics returns core error metrics and NRMSE', () => {
  const aligned = {
    status: 'available',
    t: [0, 1, 2, 3, 4, 5],
    sp: [0, 1, 2, 3, 4, 5],
    fb: [0, 1, 1, 3, 3, 5],
    err: [0, 0, 1, 0, 1, 0],
  };
  const result = computeTrackingMetrics(aligned, 0.3);

  assert.equal(result.status, 'available');
  assert.equal(result.metrics.max_error, 1);
  assert.equal(result.metrics.p95_error, 1);
  assert.ok(result.metrics.rmse > 0);
  assert.ok(result.metrics.nrmse > 0);
});

test('buildControlQualityReport marks missing topics without throwing', () => {
  const report = buildControlQualityReport({
    fileName: 'sample.ulg',
    usedTopics: [],
    topicCharts: [],
  });

  assert.equal(report.loops.rate.status, 'topic_missing');
  assert.equal(report.loops.position.status, 'topic_missing');
  assert.ok(report.missing_topics.includes('vehicle_rates_setpoint'));
  assert.ok(report.summary.unavailable_loops.includes('rate'));
});

test('buildControlQualityReport produces position metrics for available fields', () => {
  const points = [
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
    [5, 5],
  ];
  const report = buildControlQualityReport({
    fileName: 'sample.ulg',
    usedTopics: ['vehicle_local_position', 'vehicle_local_position_setpoint'],
    topicCharts: [
      {
        topic: 'vehicle_local_position',
        title: 'vehicle_local_position',
        series: [
          buildSeries('x', points),
          buildSeries('y', points),
          buildSeries('z', points),
        ],
      },
      {
        topic: 'vehicle_local_position_setpoint',
        title: 'vehicle_local_position_setpoint',
        series: [
          buildSeries(
            'x',
            points.map(([time, value]) => [time, value + 1]),
          ),
          buildSeries(
            'y',
            points.map(([time, value]) => [time, value + 1]),
          ),
          buildSeries(
            'z',
            points.map(([time, value]) => [time, value + 1]),
          ),
        ],
      },
    ],
  }, {
    segment: {
      startS: 0,
      endS: 5,
      source: 'manual',
    },
  });

  assert.equal(report.loops.position.status, 'available');
  assert.equal(report.loops.position.axis.x.metrics.max_error, 1);
  assert.equal(report.loops.position.axis.xy.status, 'available');
});

test('buildControlQualityReport accepts suffixed PX4 topics and local position setpoints', () => {
  const points = [
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
    [5, 5],
  ];
  const shifted = points.map(([time, value]) => [time, value + 0.2]);
  const actuatorPoints = points.map(([time]) => [time, 0.5]);
  const report = buildControlQualityReport({
    fileName: 'suffixed.ulg',
    usedTopics: [
      'actuator_motors_0',
      'vehicle_rates_setpoint_0',
      'vehicle_angular_velocity_0',
      'vehicle_local_position',
      'vehicle_local_position_setpoint_0',
    ],
    topicCharts: [
      {
        topic: 'actuator_motors_0',
        title: 'actuator_motors_0',
        series: [buildSeries('control_00', actuatorPoints)],
      },
      {
        topic: 'vehicle_rates_setpoint_0',
        title: 'vehicle_rates_setpoint_0',
        series: [
          buildSeries('roll', shifted),
          buildSeries('pitch', shifted),
          buildSeries('yaw', shifted),
        ],
      },
      {
        topic: 'vehicle_angular_velocity_0',
        title: 'vehicle_angular_velocity_0',
        series: [
          buildSeries('xyz[0]', points),
          buildSeries('xyz[1]', points),
          buildSeries('xyz[2]', points),
        ],
      },
      {
        topic: 'vehicle_local_position',
        title: 'vehicle_local_position',
        series: [
          buildSeries('x', points),
          buildSeries('y', points),
          buildSeries('z', points),
          buildSeries('vx', points),
          buildSeries('vy', points),
          buildSeries('vz', points),
        ],
      },
      {
        topic: 'vehicle_local_position_setpoint_0',
        title: 'vehicle_local_position_setpoint_0',
        series: [
          buildSeries('x', shifted),
          buildSeries('y', shifted),
          buildSeries('z', shifted),
          buildSeries('vx', shifted),
          buildSeries('vy', shifted),
          buildSeries('vz', shifted),
        ],
      },
    ],
  }, {
    segment: {
      startS: 0,
      endS: 5,
      source: 'manual',
    },
  });

  assert.equal(report.loops.actuator.status, 'available');
  assert.equal(report.loops.rate.status, 'available');
  assert.equal(report.loops.velocity.status, 'available');
  assert.equal(report.loops.position.status, 'available');
  assert.equal(report.loops.rate.axis.roll.status, 'available');
  assert.equal(report.loops.velocity.axis.vx.status, 'available');
  assert.equal(report.loops.position.axis.x.status, 'available');
  assert.equal(report.loops.position.axis.xy.status, 'available');
});
