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

test('rate abnormalities block attitude, velocity, and position recommendations', () => {
  const topics = buildNormalControlTopics();
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

  assert.match(blockerText(getTuningLoop(report, 'attitude')), /rate/i);
  assert.match(blockerText(getTuningLoop(report, 'velocity')), /rate/i);
  assert.match(blockerText(getTuningLoop(report, 'position')), /rate/i);
  assert.deepEqual(getTuningLoop(report, 'attitude').parameters, []);
  assert.deepEqual(getTuningLoop(report, 'velocity').parameters, []);
  assert.deepEqual(getTuningLoop(report, 'position').parameters, []);
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
  assert.match(blockerText(getTuningLoop(report, 'rate')), /severe actuator saturation/i);
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
});
