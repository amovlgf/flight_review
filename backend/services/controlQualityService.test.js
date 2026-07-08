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

function buildStepPoints() {
  return [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
    [5, 10],
    [6, 10],
    [7, 10],
    [8, 10],
    [9, 10],
    [10, 10],
  ];
}

function buildNormalControlTopics() {
  const points = buildStepPoints();
  const neutralActuator = points.map(([time]) => [time, 0.5]);

  return [
    {
      topic: 'actuator_motors',
      title: 'actuator_motors',
      series: [buildSeries('control[0]', neutralActuator)],
    },
    {
      topic: 'vehicle_rates_setpoint',
      title: 'vehicle_rates_setpoint',
      series: [
        buildSeries('roll', points),
        buildSeries('pitch', points),
        buildSeries('yaw', points),
      ],
    },
    {
      topic: 'vehicle_angular_velocity',
      title: 'vehicle_angular_velocity',
      series: [
        buildSeries('xyz[0]', points),
        buildSeries('xyz[1]', points),
        buildSeries('xyz[2]', points),
      ],
    },
    {
      topic: 'vehicle_attitude_setpoint',
      title: 'vehicle_attitude_setpoint',
      series: [
        buildSeries('roll_sp', points),
        buildSeries('pitch_sp', points),
        buildSeries('yaw_sp', points),
      ],
    },
    {
      topic: 'vehicle_attitude',
      title: 'vehicle_attitude',
      series: [
        buildSeries('roll', points),
        buildSeries('pitch', points),
        buildSeries('yaw', points),
      ],
    },
    {
      topic: 'vehicle_local_position_setpoint',
      title: 'vehicle_local_position_setpoint',
      series: [
        buildSeries('vx', points),
        buildSeries('vy', points),
        buildSeries('vz', points),
        buildSeries('x', points),
        buildSeries('y', points),
        buildSeries('z', points),
      ],
    },
    {
      topic: 'vehicle_local_position',
      title: 'vehicle_local_position',
      series: [
        buildSeries('vx', points),
        buildSeries('vy', points),
        buildSeries('vz', points),
        buildSeries('x', points),
        buildSeries('y', points),
        buildSeries('z', points),
      ],
    },
  ];
}

function buildControlParameterProfile(overrides = {}) {
  return {
    initialParameters: {
      MC_ROLLRATE_P: 0.15,
      MC_ROLLRATE_I: 0.2,
      MC_ROLLRATE_D: 0.003,
      MC_PITCHRATE_P: 0.15,
      MC_PITCHRATE_I: 0.2,
      MC_PITCHRATE_D: 0.003,
      MC_YAWRATE_D: 0.003,
      MC_ROLL_P: 6,
      MPC_XY_VEL_P_ACC: 2,
      MPC_XY_P: 1,
      ...overrides.initialParameters,
    },
    changedParameters: overrides.changedParameters || [],
  };
}

function getTuningLoop(report, loopName) {
  return report.parameterTuning.loops[loopName];
}

function blockerText(tuningLoop) {
  return (tuningLoop.blockers || []).join(' ');
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
    [6, 6],
    [7, 7],
    [8, 8],
    [9, 9],
    [10, 10],
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
      endS: 10,
      source: 'manual',
    },
  });

  assert.equal(report.loops.position.status, 'available');
  assert.equal(report.loops.position.axis.x.metrics.max_error, 1);
  assert.deepEqual(Object.keys(report.loops.position.axis), ['x', 'y', 'z']);
});

test('buildControlQualityReport accepts suffixed PX4 topics and local position setpoints', () => {
  const points = [
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
    [5, 5],
    [6, 6],
    [7, 7],
    [8, 8],
    [9, 9],
    [10, 10],
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
      endS: 10,
      source: 'manual',
    },
  });

  assert.equal(report.loops.actuator.status, 'available');
  assert.deepEqual(report.loops.actuator.chart, [
    {
      name: 'control_00',
      points: actuatorPoints,
    },
  ]);
  assert.equal(report.loops.rate.status, 'available');
  assert.equal(report.loops.velocity.status, 'available');
  assert.equal(report.loops.position.status, 'available');
  assert.equal(report.loops.rate.axis.roll.status, 'available');
  assert.equal(report.loops.velocity.axis.vx.status, 'available');
  assert.equal(report.loops.position.axis.x.status, 'available');
  assert.deepEqual(Object.keys(report.loops.position.axis), ['x', 'y', 'z']);
});

test('control quality charts keep full curves while metrics use the selected segment', () => {
  const points = [
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
    [5, 5],
  ];
  const shifted = points.map(([time, value]) => [time, value + 1]);
  const actuatorPoints = points.map(([time]) => [time, 0.5]);
  const report = buildControlQualityReport({
    fileName: 'segment.ulg',
    usedTopics: [
      'actuator_motors',
      'vehicle_rates_setpoint',
      'vehicle_angular_velocity',
    ],
    topicCharts: [
      {
        topic: 'actuator_motors',
        title: 'actuator_motors',
        series: [buildSeries('control_00', actuatorPoints)],
      },
      {
        topic: 'vehicle_rates_setpoint',
        title: 'vehicle_rates_setpoint',
        series: [buildSeries('roll', shifted)],
      },
      {
        topic: 'vehicle_angular_velocity',
        title: 'vehicle_angular_velocity',
        series: [buildSeries('xyz[0]', points)],
      },
    ],
  }, {
    segment: {
      startS: 1,
      endS: 5,
      source: 'manual',
    },
  });

  assert.equal(report.loops.rate.axis.roll.metrics.sample_count, 5);
  assert.equal(report.loops.rate.charts[0].setpointFeedback.length, 6);
  assert.deepEqual(report.loops.actuator.chart[0].points, actuatorPoints);
  assert.equal(report.loops.actuator.channels[0].sample_count, 5);
});

test('control quality report generates default-bounded recommendations and omits display-only parameters', () => {
  const points = [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
    [5, 10],
    [6, 10],
    [7, 10],
    [8, 10],
    [9, 10],
    [10, 10],
  ];
  const feedback = points.map(([time, value]) => [
    time,
    time >= 5 ? value + 2 : value,
  ]);
  const report = buildControlQualityReport({
    fileName: 'params.ulg',
    usedTopics: [
      'vehicle_rates_setpoint',
      'vehicle_angular_velocity',
    ],
    parameterProfile: {
      initialParameters: {
        MC_ROLLRATE_P: 0.15,
        MC_ROLLRATE_FF: 0.01,
      },
      changedParameters: [],
    },
    topicCharts: [
      {
        topic: 'vehicle_rates_setpoint',
        title: 'vehicle_rates_setpoint',
        series: [buildSeries('roll', points)],
      },
      {
        topic: 'vehicle_angular_velocity',
        title: 'vehicle_angular_velocity',
        series: [buildSeries('xyz[0]', feedback)],
      },
    ],
  }, {
    segment: {
      startS: 0,
      endS: 10,
      source: 'manual',
    },
  });

  const rollP = report.parameterTuning.loops.rate.parameters.find(
    (item) => item.parameter === 'MC_ROLLRATE_P',
  );

  assert.equal(rollP.currentValue, 0.15);
  assert.equal(rollP.currentSource, 'initial');
  assert.equal(rollP.status, 'target_generated');
  assert.equal(rollP.targetValue, 0.14625);
  assert.equal(rollP.changePercent, -2.5);
  assert.match(rollP.description, /横滚角速度比例增益/);

  const rollFf = report.parameterTuning.loops.rate.parameters.find(
    (item) => item.parameter === 'MC_ROLLRATE_FF',
  );

  assert.equal(rollFf, undefined);

  const displayRollP = report.parameterTuning.loops.rate.displayParameters.find(
    (item) => item.parameter === 'MC_ROLLRATE_P',
  );

  assert.equal(displayRollP.currentValue, 0.15);
  assert.equal(displayRollP.status, 'target_generated');
  assert.equal(displayRollP.targetValue, 0.14625);
});

test('control quality report uses latest stable parameter change before analysis start', () => {
  const points = [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
    [5, 10],
    [6, 10],
    [7, 10],
    [8, 10],
    [9, 10],
    [10, 10],
  ];
  const feedback = points.map(([time, value]) => [
    time,
    time >= 5 ? value + 2 : value,
  ]);
  const report = buildControlQualityReport({
    fileName: 'changed-param.ulg',
    usedTopics: [
      'vehicle_rates_setpoint',
      'vehicle_angular_velocity',
    ],
    parameterProfile: {
      initialParameters: {
        MC_ROLLRATE_P: 0.15,
      },
      changedParameters: [
        { name: 'MC_ROLLRATE_P', value: 0.16, timeS: -1 },
        { name: 'MC_ROLLRATE_P', value: 0.18, timeS: 12 },
      ],
    },
    topicCharts: [
      {
        topic: 'vehicle_rates_setpoint',
        title: 'vehicle_rates_setpoint',
        series: [buildSeries('roll', points)],
      },
      {
        topic: 'vehicle_angular_velocity',
        title: 'vehicle_angular_velocity',
        series: [buildSeries('xyz[0]', feedback)],
      },
    ],
  }, {
    segment: {
      startS: 0,
      endS: 10,
      source: 'manual',
    },
  });

  const rollP = report.parameterTuning.loops.rate.parameters.find(
    (item) => item.parameter === 'MC_ROLLRATE_P',
  );

  assert.equal(rollP.currentValue, 0.16);
  assert.equal(rollP.currentSource, 'changed');
  assert.equal(rollP.currentTimeS, -1);
  assert.equal(rollP.targetValue, 0.156);
});

test('control quality report omits display-only attitude context parameters', () => {
  const report = buildControlQualityReport({
    fileName: 'attitude-context.ulg',
    usedTopics: [],
    parameterProfile: {
      initialParameters: {
        MC_YAW_WEIGHT: 0.4,
        MC_REF_FF: 0.5,
        MC_ROLLRATE_MAX: 220,
      },
      changedParameters: [],
    },
    topicCharts: [],
  }, {
    segment: {
      startS: 0,
      endS: 5,
      source: 'manual',
    },
    parameterBounds: {
      MC_YAW_WEIGHT: {
        min: 0,
        max: 1,
        maxStepPercent: 5,
      },
    },
  });

  assert.equal(report.parameterTuning.loops.attitude.status, 'no_recommendation');
  assert.deepEqual(report.parameterTuning.loops.attitude.parameters, []);
});

test('control quality report generates bounded target values from metrics', () => {
  const points = [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
    [5, 10],
    [6, 10],
    [7, 10],
    [8, 10],
    [9, 10],
    [10, 10],
  ];
  const feedback = points.map(([time, value]) => [
    time,
    time >= 5 ? value + 2 : value,
  ]);
  const report = buildControlQualityReport({
    fileName: 'target.ulg',
    usedTopics: [
      'vehicle_rates_setpoint',
      'vehicle_angular_velocity',
    ],
    parameterProfile: {
      initialParameters: {
        MC_ROLLRATE_P: 0.15,
      },
      changedParameters: [],
    },
    topicCharts: [
      {
        topic: 'vehicle_rates_setpoint',
        title: 'vehicle_rates_setpoint',
        series: [buildSeries('roll', points)],
      },
      {
        topic: 'vehicle_angular_velocity',
        title: 'vehicle_angular_velocity',
        series: [buildSeries('xyz[0]', feedback)],
      },
    ],
  }, {
    segment: {
      startS: 0,
      endS: 10,
      source: 'manual',
    },
    parameterBounds: {
      MC_ROLLRATE_P: {
        min: 0.05,
        max: 0.3,
        maxStepPercent: 5,
      },
    },
  });

  const rollP = report.parameterTuning.loops.rate.parameters.find(
    (item) => item.parameter === 'MC_ROLLRATE_P',
  );

  assert.equal(rollP.status, 'target_generated');
  assert.equal(rollP.targetValue, 0.14625);
  assert.equal(rollP.changePercent, -2.5);
});

test('control quality target generation blocks increases when actuator is saturated', () => {
  const points = [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
    [5, 10],
    [6, 10],
    [7, 10],
    [8, 10],
    [9, 10],
    [10, 10],
  ];
  const feedback = points.map(([time, value]) => [
    time,
    time >= 5 ? value + 2 : value,
  ]);
  const report = buildControlQualityReport({
    fileName: 'saturated.ulg',
    usedTopics: [
      'actuator_motors',
      'vehicle_rates_setpoint',
      'vehicle_angular_velocity',
    ],
    parameterProfile: {
      initialParameters: {
        MC_ROLLRATE_D: 0.003,
      },
      changedParameters: [],
    },
    topicCharts: [
      {
        topic: 'actuator_motors',
        title: 'actuator_motors',
        series: [buildSeries('control[0]', points.map(([time]) => [time, 1]))],
      },
      {
        topic: 'vehicle_rates_setpoint',
        title: 'vehicle_rates_setpoint',
        series: [buildSeries('roll', points)],
      },
      {
        topic: 'vehicle_angular_velocity',
        title: 'vehicle_angular_velocity',
        series: [buildSeries('xyz[0]', feedback)],
      },
    ],
  }, {
    segment: {
      startS: 0,
      endS: 10,
      source: 'manual',
    },
    parameterBounds: {
      MC_ROLLRATE_D: {
        min: 0.0005,
        max: 0.01,
        maxStepPercent: 8,
      },
    },
  });

  const rollD = report.parameterTuning.loops.rate.parameters.find(
    (item) => item.parameter === 'MC_ROLLRATE_D',
  );

  assert.equal(report.parameterTuning.actuatorBlocksIncrease, true);
  assert.equal(rollD, undefined);
  assert.equal(report.parameterTuning.loops.rate.status, 'no_recommendation');
});

test('control quality report keeps shared xy parameters unique and validates bounds', () => {
  const points = [
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
    [5, 5],
  ];
  const report = buildControlQualityReport({
    fileName: 'position.ulg',
    usedTopics: [
      'vehicle_local_position',
      'vehicle_local_position_setpoint',
    ],
    parameterProfile: {
      initialParameters: {
        MPC_XY_P: 0.95,
      },
      changedParameters: [],
    },
    topicCharts: [
      {
        topic: 'vehicle_local_position',
        title: 'vehicle_local_position',
        series: [
          buildSeries('x', points),
          buildSeries('y', points),
        ],
      },
      {
        topic: 'vehicle_local_position_setpoint',
        title: 'vehicle_local_position_setpoint',
        series: [
          buildSeries('x', points),
          buildSeries('y', points),
        ],
      },
    ],
  }, {
    segment: {
      startS: 0,
      endS: 5,
      source: 'manual',
    },
    parameterBounds: {
      MPC_XY_P: {
        min: 2,
        max: 1,
        maxStepPercent: 5,
      },
    },
  });

  const xyParameters = report.parameterTuning.loops.position.parameters.filter(
    (item) => item.parameter === 'MPC_XY_P',
  );

  assert.equal(xyParameters.length, 0);
  assert.equal(report.parameterTuning.loops.position.status, 'no_recommendation');
});

test('ordinary rate abnormalities do not block downstream recommendations', () => {
  const topics = buildNormalControlTopics().filter(
    (topic) => !topic.topic.startsWith('vehicle_local_position'),
  );
  const stepPoints = buildStepPoints();
  const rateFeedback = stepPoints.map(([time, value]) => [
    time,
    time >= 5 ? value + 2 : value,
  ]);
  topics.find((topic) => topic.topic === 'vehicle_angular_velocity').series[0] =
    buildSeries('xyz[0]', rateFeedback);

  const report = buildControlQualityReport({
    fileName: 'inner-loop-first.ulg',
    usedTopics: topics.map((topic) => topic.topic),
    parameterProfile: buildControlParameterProfile(),
    topicCharts: topics,
  }, {
    segment: {
      startS: 0,
      endS: 10,
      source: 'manual',
    },
  });

  assert.doesNotMatch(blockerText(getTuningLoop(report, 'attitude')), /rate/i);
  assert.doesNotMatch(blockerText(getTuningLoop(report, 'velocity')), /rate/i);
  assert.doesNotMatch(blockerText(getTuningLoop(report, 'position')), /rate/i);

  const attitudeRollP = getTuningLoop(report, 'attitude').displayParameters.find(
    (item) => item.parameter === 'MC_ROLL_P',
  );

  assert.equal(attitudeRollP.currentValue, 6);
  assert.notEqual(attitudeRollP.status, 'blocked');
  assert.equal(attitudeRollP.upstreamReference, undefined);
  assert.doesNotMatch((attitudeRollP.blockers || []).join(' '), /rate loop/i);
});

test('parameter changes inside the analysis window block recommendations', () => {
  const points = buildStepPoints();
  const feedback = points.map(([time, value]) => [
    time,
    time >= 5 ? value + 2 : value,
  ]);

  const report = buildControlQualityReport({
    fileName: 'changed-in-window.ulg',
    usedTopics: [
      'vehicle_rates_setpoint',
      'vehicle_angular_velocity',
    ],
    parameterProfile: buildControlParameterProfile({
      changedParameters: [
        { name: 'MC_ROLLRATE_P', value: 0.16, timeS: 2 },
      ],
    }),
    topicCharts: [
      {
        topic: 'vehicle_rates_setpoint',
        title: 'vehicle_rates_setpoint',
        series: [buildSeries('roll', points)],
      },
      {
        topic: 'vehicle_angular_velocity',
        title: 'vehicle_angular_velocity',
        series: [buildSeries('xyz[0]', feedback)],
      },
    ],
  }, {
    segment: {
      startS: 0,
      endS: 10,
      source: 'manual',
    },
  });

  assert.equal(
    getTuningLoop(report, 'rate').parameters.some(
      (item) => item.parameter === 'MC_ROLLRATE_P',
    ),
    false,
  );
  assert.match(blockerText(getTuningLoop(report, 'rate')), /changed.*window/i);
});

test('severe actuator saturation suppresses ordinary PID target generation', () => {
  const points = buildStepPoints();
  const slowFeedback = points.map(([time, value], index) => [
    time,
    index === 0 ? value : points[index - 1][1],
  ]);

  const report = buildControlQualityReport({
    fileName: 'severe-saturation.ulg',
    usedTopics: [
      'actuator_motors',
      'vehicle_rates_setpoint',
      'vehicle_angular_velocity',
    ],
    parameterProfile: buildControlParameterProfile(),
    topicCharts: [
      {
        topic: 'actuator_motors',
        title: 'actuator_motors',
        series: [buildSeries('control[0]', points.map(([time]) => [time, 1]))],
      },
      {
        topic: 'vehicle_rates_setpoint',
        title: 'vehicle_rates_setpoint',
        series: [buildSeries('roll', points)],
      },
      {
        topic: 'vehicle_angular_velocity',
        title: 'vehicle_angular_velocity',
        series: [buildSeries('xyz[0]', slowFeedback)],
      },
    ],
  }, {
    segment: {
      startS: 0,
      endS: 10,
      source: 'manual',
    },
  });

  assert.equal(report.parameterTuning.actuatorSaturationLevel, 'severe');
  assert.deepEqual(getTuningLoop(report, 'rate').parameters, []);
  assert.equal(
    getTuningLoop(report, 'rate').displayParameters.some(
      (item) => item.status === 'manual_candidate',
    ),
    false,
  );
  assert.match(blockerText(getTuningLoop(report, 'rate')), /severe actuator saturation/i);
});

test('severe rate oscillation exposes manual P candidate without executable targets', () => {
  const setpoint = Array.from({ length: 81 }, (_, index) => {
    const time = index * 0.1;
    return [time, time < 1 ? 0 : 10];
  });
  const feedback = setpoint.map(([time, value], index) => [
    time,
    value - (time < 1 ? 0 : Math.sin(index * Math.PI / 2)),
  ]);

  const report = buildControlQualityReport({
    fileName: 'severe-rate-oscillation.ulg',
    usedTopics: [
      'vehicle_rates_setpoint',
      'vehicle_angular_velocity',
    ],
    parameterProfile: buildControlParameterProfile(),
    topicCharts: [
      {
        topic: 'vehicle_rates_setpoint',
        title: 'vehicle_rates_setpoint',
        series: [buildSeries('roll', setpoint)],
      },
      {
        topic: 'vehicle_angular_velocity',
        title: 'vehicle_angular_velocity',
        series: [buildSeries('xyz[0]', feedback)],
      },
    ],
  }, {
    segment: {
      startS: 0,
      endS: 10,
      source: 'manual',
    },
  });

  const rateLoop = getTuningLoop(report, 'rate');
  const rollP = rateLoop.displayParameters.find(
    (item) => item.parameter === 'MC_ROLLRATE_P',
  );
  const rollD = rateLoop.displayParameters.find(
    (item) => item.parameter === 'MC_ROLLRATE_D',
  );

  assert.equal(rollP.status, 'manual_candidate');
  assert.equal(rollP.recommendationLevel, 'manual_review');
  assert.equal(rollP.targetValue, 0.14625);
  assert.equal(rollP.changePercent, -2.5);
  assert.equal(rollP.phenomenon, 'control_oscillation');
  assert.equal(rollP.allowedDirection, 'decrease');
  assert.equal(rollP.stepLimitPercent, 2.5);
  assert.match(rollP.nextAction, /manual review/i);
  assert.equal(rollD.status, 'unchanged');
  assert.equal(rollD.targetValue, 0.003);
  assert.notEqual(rollD.recommendationLevel, 'manual_review');
  assert.deepEqual(rateLoop.parameters, []);
  assert.match(blockerText(rateLoop), /severe.*oscillation|oscillation.*severe/i);
  assert.equal(report.parameterTuning.tuningSafety.vibrationLevel, 'severe');
  assert.equal(
    report.parameterTuning.tuningSafety.pidRecommendationPolicy,
    'diagnostic_only',
  );
});

test('severe rate oscillation with high-frequency noise exposes manual D candidate', () => {
  const setpoint = Array.from({ length: 81 }, (_, index) => {
    const time = index * 0.1;
    return [time, time < 1 ? 0 : 10];
  });
  const errorPattern = [20, 0, -20, 0];
  const feedback = setpoint.map(([time, value], index) => [
    time,
    value - (time < 1 ? 0 : errorPattern[index % errorPattern.length]),
  ]);

  const report = buildControlQualityReport({
    fileName: 'severe-rate-oscillation-noisy.ulg',
    usedTopics: [
      'vehicle_rates_setpoint',
      'vehicle_angular_velocity',
    ],
    parameterProfile: buildControlParameterProfile(),
    topicCharts: [
      {
        topic: 'vehicle_rates_setpoint',
        title: 'vehicle_rates_setpoint',
        series: [buildSeries('roll', setpoint)],
      },
      {
        topic: 'vehicle_angular_velocity',
        title: 'vehicle_angular_velocity',
        series: [buildSeries('xyz[0]', feedback)],
      },
    ],
  }, {
    segment: {
      startS: 0,
      endS: 10,
      source: 'manual',
    },
  });

  const rateLoop = getTuningLoop(report, 'rate');
  const rollD = rateLoop.displayParameters.find(
    (item) => item.parameter === 'MC_ROLLRATE_D',
  );

  assert.equal(rollD.status, 'manual_candidate');
  assert.equal(rollD.recommendationLevel, 'manual_review');
  assert.equal(rollD.targetValue, 0.002925);
  assert.equal(rollD.changePercent, -2.5);
  assert.equal(rollD.phenomenon, 'control_oscillation');
  assert.equal(rollD.allowedDirection, 'decrease');
  assert.equal(rollD.stepLimitPercent, 2.5);
  assert.match(rollD.reason, /high-frequency noise|noise evidence/i);
  assert.deepEqual(rateLoop.parameters, []);
});

test('rate D-term noise lowers D without lowering P', () => {
  const setpoint = Array.from({ length: 81 }, (_, index) => {
    const time = index * 0.1;
    return [time, time < 1 ? 0 : 10];
  });
  const feedback = setpoint.map(([time, value], index) => [
    time,
    value + (time < 1 ? 0 : index % 2 === 0 ? 0.8 : -0.8),
  ]);
  const actuator = setpoint.map(([time], index) => [
    time,
    0.5 + (time < 1 ? 0 : index % 2 === 0 ? 0.12 : -0.12),
  ]);

  const report = buildControlQualityReport({
    fileName: 'rate-d-term-noise.ulg',
    usedTopics: [
      'actuator_motors',
      'vehicle_rates_setpoint',
      'vehicle_angular_velocity',
    ],
    parameterProfile: buildControlParameterProfile(),
    topicCharts: [
      {
        topic: 'actuator_motors',
        title: 'actuator_motors',
        series: [buildSeries('control[0]', actuator)],
      },
      {
        topic: 'vehicle_rates_setpoint',
        title: 'vehicle_rates_setpoint',
        series: [buildSeries('roll', setpoint)],
      },
      {
        topic: 'vehicle_angular_velocity',
        title: 'vehicle_angular_velocity',
        series: [buildSeries('xyz[0]', feedback)],
      },
    ],
  }, {
    segment: {
      startS: 0,
      endS: 10,
      source: 'manual',
    },
  });

  const rateLoop = getTuningLoop(report, 'rate');
  const rollP = rateLoop.displayParameters.find(
    (item) => item.parameter === 'MC_ROLLRATE_P',
  );
  const rollD = rateLoop.parameters.find(
    (item) => item.parameter === 'MC_ROLLRATE_D',
  );

  assert.equal(rollP.status, 'unchanged');
  assert.equal(rollP.targetValue, 0.15);
  assert.equal(rollD.status, 'target_generated');
  assert.equal(rollD.phenomenon, 'd_term_noise');
  assert.equal(rollD.recommendationLevel, 'risk_limited');
  assert.equal(rollD.allowedDirection, 'decrease');
  assert.equal(rollD.stepLimitPercent, 2.5);
  assert.equal(rollD.changePercent, -2.5);
  assert.equal(report.parameterTuning.tuningSafety.vibrationCategory, 'd_term_noise');
  assert.equal(
    report.parameterTuning.tuningSafety.pidRecommendationPolicy,
    'risk_limited',
  );
});

test('mechanical IMU noise without control oscillation lowers rate D and keeps P/I limited', () => {
  const setpoint = buildStepPoints();
  const gyroNoise = Array.from({ length: 81 }, (_, index) => {
    const time = index * 0.1;
    return [time, index % 2 === 0 ? 0.6 : -0.6];
  });
  const accelNoise = gyroNoise.map(([time, value]) => [time, value * 1.5]);

  const report = buildControlQualityReport({
    fileName: 'mechanical-imu-noise.ulg',
    usedTopics: [
      'actuator_motors',
      'vehicle_rates_setpoint',
      'vehicle_angular_velocity',
      'sensor_gyro',
      'sensor_accel',
    ],
    parameterProfile: buildControlParameterProfile(),
    topicCharts: [
      ...buildNormalControlTopics().filter((topic) =>
        ['actuator_motors', 'vehicle_rates_setpoint', 'vehicle_angular_velocity'].includes(topic.topic),
      ),
      {
        topic: 'sensor_gyro',
        title: 'sensor_gyro',
        series: [buildSeries('x', gyroNoise)],
      },
      {
        topic: 'sensor_accel',
        title: 'sensor_accel',
        series: [buildSeries('x', accelNoise)],
      },
    ],
  }, {
    segment: {
      startS: 0,
      endS: 10,
      source: 'manual',
    },
  });

  const rateLoop = getTuningLoop(report, 'rate');
  const rollP = rateLoop.displayParameters.find(
    (item) => item.parameter === 'MC_ROLLRATE_P',
  );
  const rollI = rateLoop.displayParameters.find(
    (item) => item.parameter === 'MC_ROLLRATE_I',
  );
  const rollD = rateLoop.parameters.find(
    (item) => item.parameter === 'MC_ROLLRATE_D',
  );
  const pitchD = rateLoop.parameters.find(
    (item) => item.parameter === 'MC_PITCHRATE_D',
  );

  assert.equal(rollD.status, 'target_generated');
  assert.equal(rollD.recommendationLevel, 'risk_limited');
  assert.equal(rollD.allowedDirection, 'decrease');
  assert.equal(rollD.stepLimitPercent, 2.5);
  assert.equal(rollD.changePercent, -2.5);
  assert.equal(pitchD.status, 'target_generated');
  assert.equal(pitchD.changePercent, -2.5);
  assert.equal(rollP.status, 'unchanged');
  assert.equal(rollP.allowedDirection, 'decrease');
  assert.equal(rollP.recommendationLevel, 'unchanged');
  assert.equal(rollI.status, 'unchanged');
  assert.equal(rollI.allowedDirection, 'hold');
  assert.equal(rollP.phenomenon, 'mechanical_imu_noise');
  assert.match(rollD.riskReason, /mechanical|IMU|noise/i);
  assert.equal(report.parameterTuning.tuningSafety.vibrationLevel, 'moderate');
  assert.equal(
    report.parameterTuning.tuningSafety.pidRecommendationPolicy,
    'risk_limited',
  );
});

test('severe mechanical IMU noise without control oscillation still lowers rate D conservatively', () => {
  const setpoint = buildStepPoints();
  const gyroNoise = Array.from({ length: 81 }, (_, index) => {
    const time = index * 0.1;
    return [time, index % 2 === 0 ? 4 : -4];
  });
  const accelNoise = gyroNoise.map(([time, value]) => [time, value * 1.5]);

  const report = buildControlQualityReport({
    fileName: 'severe-mechanical-imu-noise.ulg',
    usedTopics: [
      'actuator_motors',
      'vehicle_rates_setpoint',
      'vehicle_angular_velocity',
      'sensor_gyro',
      'sensor_accel',
    ],
    parameterProfile: buildControlParameterProfile(),
    topicCharts: [
      ...buildNormalControlTopics().filter((topic) =>
        ['actuator_motors', 'vehicle_rates_setpoint', 'vehicle_angular_velocity'].includes(topic.topic),
      ),
      {
        topic: 'sensor_gyro',
        title: 'sensor_gyro',
        series: [buildSeries('x', gyroNoise)],
      },
      {
        topic: 'sensor_accel',
        title: 'sensor_accel',
        series: [buildSeries('x', accelNoise)],
      },
    ],
  }, {
    segment: {
      startS: 0,
      endS: 10,
      source: 'manual',
    },
  });

  const rateLoop = getTuningLoop(report, 'rate');
  const rollP = rateLoop.displayParameters.find(
    (item) => item.parameter === 'MC_ROLLRATE_P',
  );
  const rollI = rateLoop.displayParameters.find(
    (item) => item.parameter === 'MC_ROLLRATE_I',
  );
  const rollD = rateLoop.parameters.find(
    (item) => item.parameter === 'MC_ROLLRATE_D',
  );
  const pitchD = rateLoop.parameters.find(
    (item) => item.parameter === 'MC_PITCHRATE_D',
  );

  assert.equal(rollD?.status, 'target_generated');
  assert.equal(rollD?.recommendationLevel, 'risk_limited');
  assert.equal(rollD?.allowedDirection, 'decrease');
  assert.equal(rollD?.stepLimitPercent, 2.5);
  assert.equal(rollD?.changePercent, -2.5);
  assert.equal(pitchD?.status, 'target_generated');
  assert.equal(pitchD?.changePercent, -2.5);
  assert.equal(rollP.status, 'unchanged');
  assert.equal(rollP.allowedDirection, 'decrease');
  assert.equal(rollI.status, 'unchanged');
  assert.equal(rollI.allowedDirection, 'hold');
  assert.equal(rollP.phenomenon, 'mechanical_imu_noise');
  assert.doesNotMatch(blockerText(rateLoop), /PID recommendations are blocked/i);
  assert.equal(report.parameterTuning.tuningSafety.vibrationLevel, 'severe');
  assert.equal(
    report.parameterTuning.tuningSafety.pidRecommendationPolicy,
    'risk_limited',
  );
});

test('mild vibration limits ordinary increases to a weak step', () => {
  const setpoint = buildStepPoints();
  const delayedFeedback = setpoint.map(([time, value]) => [
    time,
    time >= 5 ? value - 4 : value,
  ]);
  const mildGyroNoise = Array.from({ length: 81 }, (_, index) => {
    const time = index * 0.1;
    return [time, index % 2 === 0 ? 0.25 : -0.25];
  });

  const report = buildControlQualityReport({
    fileName: 'mild-vibration.ulg',
    usedTopics: [
      'vehicle_rates_setpoint',
      'vehicle_angular_velocity',
      'sensor_gyro',
    ],
    parameterProfile: buildControlParameterProfile(),
    topicCharts: [
      {
        topic: 'vehicle_rates_setpoint',
        title: 'vehicle_rates_setpoint',
        series: [buildSeries('roll', setpoint)],
      },
      {
        topic: 'vehicle_angular_velocity',
        title: 'vehicle_angular_velocity',
        series: [buildSeries('xyz[0]', delayedFeedback)],
      },
      {
        topic: 'sensor_gyro',
        title: 'sensor_gyro',
        series: [buildSeries('x', mildGyroNoise)],
      },
    ],
  }, {
    segment: {
      startS: 0,
      endS: 10,
      source: 'manual',
    },
  });

  const rollI = getTuningLoop(report, 'rate').parameters.find(
    (item) => item.parameter === 'MC_ROLLRATE_I',
  );

  assert.equal(rollI.status, 'target_generated');
  assert.equal(rollI.changePercent, 2.5);
  assert.equal(rollI.recommendationLevel, 'risk_limited');
  assert.equal(rollI.stepLimitPercent, 2.5);
  assert.equal(report.parameterTuning.tuningSafety.vibrationLevel, 'mild');
  assert.equal(
    report.parameterTuning.tuningSafety.pidRecommendationPolicy,
    'risk_limited',
  );
});

test('rate overshoot prefers a small D increase only when D is usable', () => {
  const points = buildStepPoints();
  const feedback = points.map(([time, value]) => [
    time,
    time >= 5 ? value + 2 : value,
  ]);

  const report = buildControlQualityReport({
    fileName: 'rate-overshoot.ulg',
    usedTopics: [
      'vehicle_rates_setpoint',
      'vehicle_angular_velocity',
    ],
    parameterProfile: buildControlParameterProfile(),
    topicCharts: [
      {
        topic: 'vehicle_rates_setpoint',
        title: 'vehicle_rates_setpoint',
        series: [buildSeries('roll', points)],
      },
      {
        topic: 'vehicle_angular_velocity',
        title: 'vehicle_angular_velocity',
        series: [buildSeries('xyz[0]', feedback)],
      },
    ],
  }, {
    segment: {
      startS: 0,
      endS: 10,
      source: 'manual',
    },
  });

  const rollP = getTuningLoop(report, 'rate').parameters.find(
    (item) => item.parameter === 'MC_ROLLRATE_P',
  );
  const rollD = getTuningLoop(report, 'rate').parameters.find(
    (item) => item.parameter === 'MC_ROLLRATE_D',
  );

  assert.equal(rollP, undefined);
  assert.equal(rollD.status, 'target_generated');
  assert.equal(rollD.phenomenon, 'overshoot');
  assert.equal(rollD.confidence, 'medium');
  assert.equal(rollD.changePercent, 2.5);
});

test('yaw rate overshoot does not automatically increase D', () => {
  const points = buildStepPoints();
  const feedback = points.map(([time, value]) => [
    time,
    time >= 5 ? value + 2 : value,
  ]);

  const report = buildControlQualityReport({
    fileName: 'yaw-overshoot.ulg',
    usedTopics: [
      'vehicle_rates_setpoint',
      'vehicle_angular_velocity',
    ],
    parameterProfile: buildControlParameterProfile(),
    topicCharts: [
      {
        topic: 'vehicle_rates_setpoint',
        title: 'vehicle_rates_setpoint',
        series: [buildSeries('yaw', points)],
      },
      {
        topic: 'vehicle_angular_velocity',
        title: 'vehicle_angular_velocity',
        series: [buildSeries('xyz[2]', feedback)],
      },
    ],
  }, {
    segment: {
      startS: 0,
      endS: 10,
      source: 'manual',
    },
  });

  assert.equal(
    getTuningLoop(report, 'rate').parameters.some(
      (item) =>
        item.parameter === 'MC_YAWRATE_D' &&
        item.changePercent > 0,
    ),
    false,
  );
  assert.match(blockerText(getTuningLoop(report, 'rate')), /yaw.*D/i);
});

test('estimator anomalies block PID recommendations', () => {
  const points = buildStepPoints();
  const feedback = points.map(([time, value]) => [
    time,
    time >= 5 ? value + 2 : value,
  ]);
  const positionWithJump = points.map(([time, value]) => [
    time,
    time === 6 ? value + 5 : value,
  ]);

  const report = buildControlQualityReport({
    fileName: 'estimator-jump.ulg',
    usedTopics: [
      'vehicle_rates_setpoint',
      'vehicle_angular_velocity',
      'vehicle_local_position',
      'vehicle_local_position_setpoint',
    ],
    parameterProfile: buildControlParameterProfile(),
    topicCharts: [
      {
        topic: 'vehicle_rates_setpoint',
        title: 'vehicle_rates_setpoint',
        series: [buildSeries('roll', points)],
      },
      {
        topic: 'vehicle_angular_velocity',
        title: 'vehicle_angular_velocity',
        series: [buildSeries('xyz[0]', feedback)],
      },
      {
        topic: 'vehicle_local_position',
        title: 'vehicle_local_position',
        series: [
          buildSeries('x', positionWithJump),
          buildSeries('vx', positionWithJump),
        ],
      },
      {
        topic: 'vehicle_local_position_setpoint',
        title: 'vehicle_local_position_setpoint',
        series: [
          buildSeries('x', points),
          buildSeries('vx', points),
        ],
      },
    ],
  }, {
    segment: {
      startS: 0,
      endS: 10,
      source: 'manual',
    },
  });

  assert.deepEqual(getTuningLoop(report, 'rate').parameters, []);
  assert.equal(
    getTuningLoop(report, 'rate').displayParameters.some(
      (item) => item.status === 'manual_candidate',
    ),
    false,
  );
  assert.match(blockerText(getTuningLoop(report, 'rate')), /estimator|feedback/i);
});

test('insufficient excitation reports blockers instead of parameter targets', () => {
  const points = buildStepPoints().map(([time]) => [time, 1]);

  const report = buildControlQualityReport({
    fileName: 'low-excitation.ulg',
    usedTopics: [
      'vehicle_rates_setpoint',
      'vehicle_angular_velocity',
    ],
    parameterProfile: buildControlParameterProfile(),
    topicCharts: [
      {
        topic: 'vehicle_rates_setpoint',
        title: 'vehicle_rates_setpoint',
        series: [buildSeries('roll', points)],
      },
      {
        topic: 'vehicle_angular_velocity',
        title: 'vehicle_angular_velocity',
        series: [buildSeries('xyz[0]', points)],
      },
    ],
  }, {
    segment: {
      startS: 0,
      endS: 10,
      source: 'manual',
    },
  });

  assert.deepEqual(getTuningLoop(report, 'rate').parameters, []);
  assert.match(blockerText(getTuningLoop(report, 'rate')), /excitation/i);

  const rollP = getTuningLoop(report, 'rate').displayParameters.find(
    (item) => item.parameter === 'MC_ROLLRATE_P',
  );

  assert.equal(rollP.currentValue, 0.15);
  assert.equal(rollP.targetValue, null);
  assert.equal(rollP.status, 'blocked');
  assert.equal(rollP.recommendationLevel, 'deferred');
  assert.match(rollP.nextAction, /setpoint|excitation|框选|指令/i);
  assert.match(rollP.reason, /excitation/i);
});
