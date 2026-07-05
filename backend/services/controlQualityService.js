const LOOP_ORDER = ['actuator', 'rate', 'attitude', 'velocity', 'position'];
const MIN_ALIGNED_POINTS = 5;
const EPS = 1e-9;
const DEFAULT_TUNING_STEP_PERCENT = 5;
const WEAK_TUNING_STEP_PERCENT = 2.5;
const DEFAULT_PARAMETER_BOUND = Object.freeze({
  min: 0,
  max: null,
  maxStepPercent: DEFAULT_TUNING_STEP_PERCENT,
});
const ACTUATOR_SATURATION_BLOCK_THRESHOLD = 0.05;
const ACTUATOR_SATURATION_SEVERE_THRESHOLD = 0.15;
const MIN_TUNING_SAMPLE_COUNT = 10;
const MIN_TUNING_DURATION_S = 2;
const HIGH_OSCILLATION_RATE = 1.0;
const HIGH_OSCILLATION_COUNT = 8;
const SEVERE_OSCILLATION_RATE = 2.0;
const SEVERE_OSCILLATION_COUNT = 16;
const HIGH_OVERSHOOT_RATIO = 0.3;
const HIGH_TRACKING_ERROR_NRMSE = 0.25;
const HIGH_DELAY_S = 0.15;
const ACTUATOR_HIGH_FREQUENCY_DIFF_STD = 0.08;
const SENSOR_MILD_DIFF_STD = 0.35;
const SENSOR_SEVERE_DIFF_STD = 3.0;

const REQUIRED_TOPICS = [
  'vehicle_angular_velocity',
  'vehicle_rates_setpoint',
  'vehicle_attitude',
  'vehicle_attitude_setpoint',
  'vehicle_local_position',
  'vehicle_local_position_setpoint',
  'actuator_motors',
];

const FIELD_CANDIDATES = {
  rate: {
    roll: {
      sp: ['roll'],
      fb: ['xyz[0]', 'xyz.00', 'xyz_0', 'roll', 'rollspeed'],
      unit: 'rad/s',
    },
    pitch: {
      sp: ['pitch'],
      fb: ['xyz[1]', 'xyz.01', 'xyz_1', 'pitch', 'pitchspeed'],
      unit: 'rad/s',
    },
    yaw: {
      sp: ['yaw'],
      fb: ['xyz[2]', 'xyz.02', 'xyz_2', 'yaw', 'yawspeed'],
      unit: 'rad/s',
    },
  },
  attitude: {
    roll: { sp: ['roll_sp'], fb: ['roll'], unit: 'deg' },
    pitch: { sp: ['pitch_sp'], fb: ['pitch'], unit: 'deg' },
    yaw: { sp: ['yaw_sp'], fb: ['yaw'], unit: 'deg', wrap: true },
  },
  velocity: {
    vx: { sp: ['vx', 'velocity[0]', 'velocity.00', 'velocity_0'], fb: ['vx'], unit: 'm/s' },
    vy: { sp: ['vy', 'velocity[1]', 'velocity.01', 'velocity_1'], fb: ['vy'], unit: 'm/s' },
    vz: { sp: ['vz', 'velocity[2]', 'velocity.02', 'velocity_2'], fb: ['vz'], unit: 'm/s' },
  },
  position: {
    x: { sp: ['x', 'position[0]', 'position.00', 'position_0'], fb: ['x'], unit: 'm' },
    y: { sp: ['y', 'position[1]', 'position.01', 'position_1'], fb: ['y'], unit: 'm' },
    z: { sp: ['z', 'position[2]', 'position.02', 'position_2'], fb: ['z'], unit: 'm' },
  },
};

const LOOP_TOPIC_MAP = {
  rate: {
    sp: ['vehicle_rates_setpoint'],
    fb: ['vehicle_angular_velocity'],
    maxDelayS: 0.3,
  },
  attitude: {
    sp: ['vehicle_attitude_setpoint'],
    fb: ['vehicle_attitude'],
    maxDelayS: 0.5,
  },
  velocity: {
    sp: ['vehicle_local_position_setpoint'],
    fb: ['vehicle_local_position'],
    maxDelayS: 1.0,
  },
  position: {
    sp: ['vehicle_local_position_setpoint'],
    fb: ['vehicle_local_position'],
    maxDelayS: 2.0,
  },
};

const UPSTREAM_LOOP_REQUIREMENTS = {
  attitude: ['rate'],
  velocity: ['rate', 'attitude'],
  position: ['rate', 'attitude', 'velocity'],
};

const PARAMETER_TUNING_MAP = {
  rate: [
    {
      axes: ['roll'],
      label: 'roll',
      parameters: [
        { gain: 'P', parameter: 'MC_ROLLRATE_P' },
        { gain: 'I', parameter: 'MC_ROLLRATE_I' },
        { gain: 'D', parameter: 'MC_ROLLRATE_D' },
        {
          gain: 'INT_LIM',
          parameter: 'MC_RR_INT_LIM',
          role: 'integrator_limit',
          targetable: false,
        },
        {
          gain: 'FF',
          parameter: 'MC_ROLLRATE_FF',
          role: 'feed_forward',
          targetable: false,
        },
        {
          gain: 'K',
          parameter: 'MC_ROLLRATE_K',
          role: 'rate_gain_scale',
          targetable: false,
        },
      ],
    },
    {
      axes: ['pitch'],
      label: 'pitch',
      parameters: [
        { gain: 'P', parameter: 'MC_PITCHRATE_P' },
        { gain: 'I', parameter: 'MC_PITCHRATE_I' },
        { gain: 'D', parameter: 'MC_PITCHRATE_D' },
        {
          gain: 'INT_LIM',
          parameter: 'MC_PR_INT_LIM',
          role: 'integrator_limit',
          targetable: false,
        },
        {
          gain: 'FF',
          parameter: 'MC_PITCHRATE_FF',
          role: 'feed_forward',
          targetable: false,
        },
        {
          gain: 'K',
          parameter: 'MC_PITCHRATE_K',
          role: 'rate_gain_scale',
          targetable: false,
        },
      ],
    },
    {
      axes: ['yaw'],
      label: 'yaw',
      parameters: [
        { gain: 'P', parameter: 'MC_YAWRATE_P' },
        { gain: 'I', parameter: 'MC_YAWRATE_I' },
        { gain: 'D', parameter: 'MC_YAWRATE_D' },
        {
          gain: 'INT_LIM',
          parameter: 'MC_YR_INT_LIM',
          role: 'integrator_limit',
          targetable: false,
        },
        {
          gain: 'FF',
          parameter: 'MC_YAWRATE_FF',
          role: 'feed_forward',
          targetable: false,
        },
        {
          gain: 'K',
          parameter: 'MC_YAWRATE_K',
          role: 'rate_gain_scale',
          targetable: false,
        },
      ],
    },
  ],
  attitude: [
    {
      axes: ['roll'],
      label: 'roll',
      parameters: [
        { gain: 'P', parameter: 'MC_ROLL_P' },
        {
          gain: 'RATE_MAX',
          parameter: 'MC_ROLLRATE_MAX',
          role: 'output_limit',
          targetable: false,
        },
      ],
    },
    {
      axes: ['pitch'],
      label: 'pitch',
      parameters: [
        { gain: 'P', parameter: 'MC_PITCH_P' },
        {
          gain: 'RATE_MAX',
          parameter: 'MC_PITCHRATE_MAX',
          role: 'output_limit',
          targetable: false,
        },
      ],
    },
    {
      axes: ['yaw'],
      label: 'yaw',
      parameters: [
        { gain: 'P', parameter: 'MC_YAW_P' },
        {
          gain: 'YAW_WEIGHT',
          parameter: 'MC_YAW_WEIGHT',
          role: 'axis_weight',
          targetable: false,
        },
        {
          gain: 'RATE_MAX',
          parameter: 'MC_YAWRATE_MAX',
          role: 'output_limit',
          targetable: false,
        },
      ],
    },
    {
      axes: ['roll', 'pitch', 'yaw'],
      label: 'reference model',
      parameters: [
        {
          gain: 'REF_W_N',
          parameter: 'MC_REF_W_N',
          role: 'reference_model',
          targetable: false,
        },
        {
          gain: 'REF_FF',
          parameter: 'MC_REF_FF',
          role: 'reference_model',
          targetable: false,
        },
        {
          gain: 'REF_FF_MAX',
          parameter: 'MC_REF_FF_MAX',
          role: 'reference_model',
          targetable: false,
        },
      ],
    },
  ],
  velocity: [
    {
      axes: ['vx', 'vy'],
      label: 'vx/vy',
      parameters: [
        { gain: 'P', parameter: 'MPC_XY_VEL_P_ACC' },
        { gain: 'I', parameter: 'MPC_XY_VEL_I_ACC' },
        { gain: 'D', parameter: 'MPC_XY_VEL_D_ACC' },
      ],
    },
    {
      axes: ['vz'],
      label: 'vz',
      parameters: [
        { gain: 'P', parameter: 'MPC_Z_VEL_P_ACC' },
        { gain: 'I', parameter: 'MPC_Z_VEL_I_ACC' },
        { gain: 'D', parameter: 'MPC_Z_VEL_D_ACC' },
      ],
    },
  ],
  position: [
    {
      axes: ['x', 'y'],
      label: 'x/y',
      parameters: [{ gain: 'P', parameter: 'MPC_XY_P' }],
    },
    {
      axes: ['z'],
      label: 'z',
      parameters: [{ gain: 'P', parameter: 'MPC_Z_P' }],
    },
  ],
};

const PARAMETER_DESCRIPTIONS = {
  MC_ROLLRATE_P: '横滚角速度比例增益，影响角速度误差响应强度。',
  MC_ROLLRATE_I: '横滚角速度积分增益，用于补偿稳态误差和陀螺/力矩偏置。',
  MC_ROLLRATE_D: '横滚角速度微分增益，用于增加阻尼并抑制快速振荡。',
  MC_PITCHRATE_P: '俯仰角速度比例增益，影响角速度误差响应强度。',
  MC_PITCHRATE_I: '俯仰角速度积分增益，用于补偿稳态误差和陀螺/力矩偏置。',
  MC_PITCHRATE_D: '俯仰角速度微分增益，用于增加阻尼并抑制快速振荡。',
  MC_YAWRATE_P: '偏航角速度比例增益，影响偏航角速度误差响应强度。',
  MC_YAWRATE_I: '偏航角速度积分增益，用于补偿偏航稳态误差和偏置。',
  MC_YAWRATE_D: '偏航角速度微分增益，用于增加偏航阻尼。',
  MC_ROLL_P: '横滚姿态比例增益，将横滚姿态误差转换为角速度期望。',
  MC_PITCH_P: '俯仰姿态比例增益，将俯仰姿态误差转换为角速度期望。',
  MC_YAW_P: '偏航姿态比例增益，将偏航姿态误差转换为角速度期望。',
  MPC_XY_VEL_P_ACC: '水平速度比例增益，将水平速度误差转换为加速度修正。',
  MPC_XY_VEL_I_ACC: '水平速度积分增益，用于补偿水平速度稳态误差。',
  MPC_XY_VEL_D_ACC: '水平速度微分增益，用于增加水平速度环阻尼。',
  MPC_Z_VEL_P_ACC: '垂直速度比例增益，将垂直速度误差转换为加速度修正。',
  MPC_Z_VEL_I_ACC: '垂直速度积分增益，用于补偿垂直速度稳态误差。',
  MPC_Z_VEL_D_ACC: '垂直速度微分增益，用于增加垂直速度环阻尼。',
  MPC_XY_P: '水平位置比例增益，将水平位置误差转换为水平速度期望。',
  MPC_Z_P: '垂直位置比例增益，将高度误差转换为垂直速度期望。',
};

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function roundMetric(value, digits = 6) {
  if (!isFiniteNumber(value)) return null;
  return Number(value.toFixed(digits));
}

function parseBoundValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseParameterBound(parameterBounds, parameter) {
  const bound =
    parameterBounds && typeof parameterBounds === 'object'
      ? parameterBounds[parameter]
      : null;
  if (!bound || typeof bound !== 'object') {
    return {
      status: 'valid',
      source: 'default',
      value: { ...DEFAULT_PARAMETER_BOUND },
    };
  }

  const min = parseBoundValue(bound.min);
  const max = parseBoundValue(bound.max);
  const maxStepPercent = parseBoundValue(bound.maxStepPercent);
  if (min === null && max === null && maxStepPercent === null) {
    return {
      status: 'valid',
      source: 'default',
      value: { ...DEFAULT_PARAMETER_BOUND },
    };
  }
  if (
    min === null ||
    max === null ||
    maxStepPercent === null ||
    max < min ||
    maxStepPercent < 0
  ) {
    return { status: 'invalid', value: null };
  }

  return {
    status: 'valid',
    source: 'provided',
    value: { min, max, maxStepPercent },
  };
}

function getCurrentParameterValue(parameterProfile, parameter, endS) {
  const initialParameters =
    parameterProfile?.initialParameters &&
    typeof parameterProfile.initialParameters === 'object'
      ? parameterProfile.initialParameters
      : {};
  const changedParameters = Array.isArray(parameterProfile?.changedParameters)
    ? parameterProfile.changedParameters
    : [];

  let current = null;
  const initialValue = Number(initialParameters[parameter]);
  if (Number.isFinite(initialValue)) {
    current = {
      value: initialValue,
      source: 'initial',
      timeS: null,
    };
  }

  const effectiveEndS = isFiniteNumber(endS) ? endS : Infinity;
  for (const item of changedParameters) {
    if (item?.name !== parameter) continue;
    const value = Number(item.value);
    const timeS = Number(item.timeS);
    if (!Number.isFinite(value) || !Number.isFinite(timeS)) continue;
    if (timeS - effectiveEndS > EPS) continue;
    current = {
      value,
      source: 'changed',
      timeS: roundMetric(timeS, 6),
    };
  }

  return current;
}

function maxMetricValue(axisItems, key, absolute = false) {
  const values = axisItems
    .map((axis) => axis?.metrics?.[key])
    .filter(isFiniteNumber)
    .map((value) => (absolute ? Math.abs(value) : value));
  if (!values.length) return null;
  return Math.max(...values);
}

function minMetricValue(axisItems, key) {
  const values = axisItems
    .map((axis) => axis?.metrics?.[key])
    .filter(isFiniteNumber);
  if (!values.length) return null;
  return Math.min(...values);
}

function weakestExcitationLevel(axisItems) {
  const rank = {
    low: 0,
    medium: 1,
    high: 2,
  };
  const levels = axisItems
    .map((axis) => axis?.metrics?.excitation_level)
    .filter((value) => typeof value === 'string' && value in rank);
  if (!levels.length) return null;
  return levels.reduce((weakest, level) =>
    rank[level] < rank[weakest] ? level : weakest,
  );
}

function firstNonOkStatus(axisItems, key) {
  const statuses = axisItems
    .map((axis) => axis?.metrics?.[key])
    .filter((value) => typeof value === 'string');
  return statuses.find((status) => status !== 'ok') || statuses[0] || null;
}

function summarizeAxisMetrics(loop, axes) {
  const axisItems = axes
    .map((axisName) => loop?.axis?.[axisName])
    .filter((axis) => axis?.status === 'available');

  if (!axisItems.length) {
    return {
      status: 'unavailable',
      nrmse: null,
      overshootRatio: null,
      effectiveZeroCrossingRate: null,
      effectiveZeroCrossingCount: null,
      delayAbsS: null,
      sampleCount: null,
      durationS: null,
      excitationLevel: null,
      delayStatus: null,
      overshootStatus: null,
      feedbackDiffStd: null,
      setpointDiffStd: null,
      errorDiffStd: null,
      signalScale: null,
    };
  }

  return {
    status: 'available',
    nrmse: maxMetricValue(axisItems, 'nrmse'),
    overshootRatio: maxMetricValue(axisItems, 'overshoot_ratio'),
    effectiveZeroCrossingRate: maxMetricValue(axisItems, 'effective_zero_crossing_rate'),
    effectiveZeroCrossingCount: maxMetricValue(axisItems, 'effective_zero_crossing_count'),
    delayAbsS: maxMetricValue(axisItems, 'delay_s', true),
    sampleCount: minMetricValue(axisItems, 'sample_count'),
    durationS: minMetricValue(axisItems, 'duration_s'),
    excitationLevel: weakestExcitationLevel(axisItems),
    delayStatus: firstNonOkStatus(axisItems, 'delay_status'),
    overshootStatus: firstNonOkStatus(axisItems, 'overshoot_status'),
    feedbackDiffStd: maxMetricValue(axisItems, 'feedback_diff_std'),
    setpointDiffStd: maxMetricValue(axisItems, 'setpoint_diff_std'),
    errorDiffStd: maxMetricValue(axisItems, 'error_diff_std'),
    signalScale: maxMetricValue(axisItems, 'signal_scale'),
  };
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function buildMetricEvidence(metricSummary) {
  const evidence = [];
  if (isFiniteNumber(metricSummary.nrmse)) {
    evidence.push(`nrmse=${roundMetric(metricSummary.nrmse, 6)}`);
  }
  if (isFiniteNumber(metricSummary.overshootRatio)) {
    evidence.push(`overshoot_ratio=${roundMetric(metricSummary.overshootRatio, 6)}`);
  }
  if (isFiniteNumber(metricSummary.delayAbsS)) {
    evidence.push(`abs_delay_s=${roundMetric(metricSummary.delayAbsS, 4)}`);
  }
  if (isFiniteNumber(metricSummary.effectiveZeroCrossingRate)) {
    evidence.push(
      `effective_zero_crossing_rate=${roundMetric(metricSummary.effectiveZeroCrossingRate, 6)}`,
    );
  }
  if (isFiniteNumber(metricSummary.effectiveZeroCrossingCount)) {
    evidence.push(
      `effective_zero_crossing_count=${roundMetric(metricSummary.effectiveZeroCrossingCount, 6)}`,
    );
  }
  if (metricSummary.excitationLevel) {
    evidence.push(`excitation_level=${metricSummary.excitationLevel}`);
  }
  if (isFiniteNumber(metricSummary.sampleCount)) {
    evidence.push(`sample_count=${metricSummary.sampleCount}`);
  }
  if (isFiniteNumber(metricSummary.durationS)) {
    evidence.push(`duration_s=${roundMetric(metricSummary.durationS, 3)}`);
  }
  return evidence;
}

function getTargetBlockerMetadata(reason) {
  const value = String(reason || '');
  if (/mechanical or IMU noise/i.test(value)) {
    return {
      phenomenon: 'mechanical_imu_noise',
      nextAction:
        'Diagnostic first: inspect propellers, motors, frame stiffness, flight-controller mount, vibration isolation, sensors, and filter settings.',
    };
  }
  if (/severe vibration|severe oscillation/i.test(value)) {
    return {
      phenomenon: 'severe_vibration',
      nextAction:
        'Diagnostic first: inspect mechanical vibration, sensors, estimator health, and filter settings before changing PID gains.',
    };
  }
  if (/estimator or feedback signal anomalies/i.test(value)) {
    return {
      phenomenon: 'estimator_anomaly',
      nextAction:
        'Resolve estimator or feedback signal anomalies before generating PID targets.',
    };
  }
  return {
    phenomenon: 'blocked',
    nextAction: getDeferredNextAction(reason),
  };
}

function getMetricGateBlockers(loopName, axisLabel, metricSummary) {
  const prefix = `${loopName} ${axisLabel}`;
  if (metricSummary.status !== 'available') {
    return [`${prefix}: no available loop metrics for this parameter group.`];
  }
  if (
    !isFiniteNumber(metricSummary.sampleCount) ||
    metricSummary.sampleCount < MIN_TUNING_SAMPLE_COUNT
  ) {
    return [`${prefix}: not enough data samples for conservative tuning.`];
  }
  if (
    !isFiniteNumber(metricSummary.durationS) ||
    metricSummary.durationS < MIN_TUNING_DURATION_S
  ) {
    return [`${prefix}: analysis window is too short for conservative tuning.`];
  }
  if (metricSummary.excitationLevel === 'low') {
    return [`${prefix}: setpoint excitation is too low for PID recommendation.`];
  }
  if (
    metricSummary.delayStatus &&
    metricSummary.delayStatus !== 'ok' &&
    metricSummary.delayStatus !== 'not_enough_excitation'
  ) {
    return [`${prefix}: delay estimate is ${metricSummary.delayStatus}.`];
  }
  return [];
}

function getOscillationSeverity(metricSummary) {
  const zeroCrossingRate = metricSummary.effectiveZeroCrossingRate ?? 0;
  const zeroCrossingCount = metricSummary.effectiveZeroCrossingCount ?? 0;
  if (
    zeroCrossingRate >= SEVERE_OSCILLATION_RATE ||
    zeroCrossingCount >= SEVERE_OSCILLATION_COUNT
  ) {
    return 'severe';
  }
  if (
    zeroCrossingRate >= HIGH_OSCILLATION_RATE ||
    zeroCrossingCount >= HIGH_OSCILLATION_COUNT
  ) {
    return 'high';
  }
  return 'none';
}

function hasHighOvershoot(metricSummary) {
  return (
    isFiniteNumber(metricSummary.overshootRatio) &&
    metricSummary.overshootRatio >= HIGH_OVERSHOOT_RATIO
  );
}

function hasHighTrackingError(metricSummary) {
  return (
    isFiniteNumber(metricSummary.nrmse) &&
    metricSummary.nrmse >= HIGH_TRACKING_ERROR_NRMSE
  );
}

function hasHighDelay(metricSummary) {
  return (
    isFiniteNumber(metricSummary.delayAbsS) &&
    metricSummary.delayAbsS >= HIGH_DELAY_S
  );
}

function hasLowNoiseEvidence(metricSummary) {
  const feedbackDiffStd = metricSummary.feedbackDiffStd;
  if (!isFiniteNumber(feedbackDiffStd)) return false;
  const signalScale = Math.max(metricSummary.signalScale ?? 0, EPS);
  const setpointDiffStd = metricSummary.setpointDiffStd ?? 0;
  const threshold = Math.max(signalScale * 0.25, setpointDiffStd * 1.5, EPS);
  return feedbackDiffStd <= threshold;
}

function hasHighNoiseEvidence(metricSummary) {
  const feedbackDiffStd = metricSummary.feedbackDiffStd;
  if (!isFiniteNumber(feedbackDiffStd)) return false;
  const signalScale = Math.max(metricSummary.signalScale ?? 0, EPS);
  const setpointDiffStd = metricSummary.setpointDiffStd ?? 0;
  const threshold = Math.max(signalScale * 0.35, setpointDiffStd * 3, EPS);
  return feedbackDiffStd >= threshold;
}

function getPrimaryPhenomenon(metricSummary) {
  const oscillationSeverity = getOscillationSeverity(metricSummary);
  if (oscillationSeverity === 'severe') return 'severe_oscillation';
  if (oscillationSeverity === 'high') return 'oscillation';
  if (hasHighOvershoot(metricSummary)) return 'overshoot';
  if (hasHighTrackingError(metricSummary) && hasHighDelay(metricSummary)) {
    return 'delay';
  }
  if (hasHighTrackingError(metricSummary)) return 'steady_error';
  return 'none';
}

function chooseParameterStep({
  loopName,
  axisLabel,
  gain,
  metricSummary,
  groupContext,
}) {
  const evidence = buildMetricEvidence(metricSummary);
  const primaryPhenomenon = getPrimaryPhenomenon(metricSummary);
  const tuningSafety = groupContext?.tuningSafety || {};

  if (
    tuningSafety.pidRecommendationPolicy === 'blocked' ||
    tuningSafety.pidRecommendationPolicy === 'diagnostic_only'
  ) {
    const mechanical = tuningSafety.vibrationCategory === 'mechanical_imu_noise';
    const estimator = tuningSafety.vibrationCategory === 'estimator_anomaly';
    return {
      status: 'blocked',
      percent: 0,
      phenomenon: estimator
        ? 'estimator_anomaly'
        : mechanical
          ? 'mechanical_imu_noise'
          : 'severe_vibration',
      confidence: 'high',
      recommendationLevel: 'deferred',
      nextAction: estimator
        ? 'Resolve estimator or feedback signal anomalies before generating PID targets.'
        : mechanical
          ? 'Diagnostic first: inspect propellers, motors, frame stiffness, flight-controller mount, vibration isolation, sensors, and filter settings.'
          : 'Diagnostic first: inspect mechanical vibration, sensors, estimator health, and filter settings before changing PID gains.',
      reason: estimator
        ? 'Estimator anomaly is present; PID recommendations are blocked.'
        : mechanical
          ? 'Mechanical or IMU noise is present without control-oscillation evidence; PID recommendations are blocked.'
          : 'Severe vibration or severe oscillation is present; PID recommendations are blocked.',
      evidence: uniqueStrings([...(tuningSafety.evidence || []), ...evidence]),
    };
  }

  if (
    loopName === 'rate' &&
    tuningSafety.vibrationCategory === 'd_term_noise'
  ) {
    if (gain === 'D') {
      return {
        percent: -DEFAULT_TUNING_STEP_PERCENT,
        phenomenon: 'd_term_noise',
        confidence: 'medium',
        reason:
          'D-term or actuator high-frequency noise is present; reduce RATE_D conservatively.',
        evidence: uniqueStrings([...(tuningSafety.evidence || []), ...evidence]),
      };
    }
    return {
      percent: 0,
      phenomenon: 'd_term_noise',
      confidence: 'medium',
      reason:
        'D-term or actuator high-frequency noise is present; do not adjust this gain first.',
      evidence: uniqueStrings([...(tuningSafety.evidence || []), ...evidence]),
    };
  }

  if (primaryPhenomenon === 'severe_oscillation') {
    return {
      status: 'blocked',
      percent: 0,
      phenomenon: 'severe_vibration',
      confidence: 'high',
      recommendationLevel: 'deferred',
      nextAction:
        'Diagnostic first: inspect mechanical vibration, sensors, estimator health, and filter settings before changing PID gains.',
      reason:
        'Severe vibration or severe oscillation is present; PID recommendations are blocked.',
      evidence,
    };
  }

  if (primaryPhenomenon === 'oscillation') {
    if (loopName === 'rate' && gain === 'P') {
      return {
        percent: -DEFAULT_TUNING_STEP_PERCENT,
        phenomenon: 'oscillation',
        confidence: 'high',
        reason: 'Rate loop oscillation is high; reduce P conservatively.',
        evidence,
      };
    }
    if (loopName === 'rate' && gain === 'D' && hasHighNoiseEvidence(metricSummary)) {
      return {
        percent: -DEFAULT_TUNING_STEP_PERCENT,
        phenomenon: 'noise',
        confidence: 'medium',
        reason: 'Rate loop oscillation has high noise evidence; reduce D conservatively.',
        evidence,
      };
    }
    if (loopName === 'attitude' && gain === 'P') {
      return {
        percent: -DEFAULT_TUNING_STEP_PERCENT,
        phenomenon: 'oscillation',
        confidence: 'medium',
        reason: 'Attitude loop oscillation is high while inner loops are usable; reduce P.',
        evidence,
      };
    }
    if ((loopName === 'velocity' || loopName === 'position') && gain === 'P') {
      return {
        percent: -WEAK_TUNING_STEP_PERCENT,
        phenomenon: 'oscillation',
        confidence: 'medium',
        reason: `${loopName} loop oscillation is high; reduce P with a small step.`,
        evidence,
      };
    }
  }

  if (primaryPhenomenon === 'overshoot') {
    if (
      loopName === 'rate' &&
      gain === 'D' &&
      groupContext.canIncreaseDForOvershoot
    ) {
      return {
        percent: WEAK_TUNING_STEP_PERCENT,
        phenomenon: 'overshoot',
        confidence: 'medium',
        reason:
          'Rate overshoot is high with low noise evidence; increase D with a small step.',
        evidence,
      };
    }
    if (
      loopName === 'rate' &&
      gain === 'P' &&
      !groupContext.canIncreaseDForOvershoot
    ) {
      return {
        percent: -WEAK_TUNING_STEP_PERCENT,
        phenomenon: 'overshoot',
        confidence: 'low',
        reason:
          'Rate overshoot is high but D is not usable for an automatic increase; reduce P weakly.',
        evidence,
      };
    }
    if (loopName === 'attitude' && gain === 'P') {
      return {
        percent: -WEAK_TUNING_STEP_PERCENT,
        phenomenon: 'overshoot',
        confidence: 'medium',
        reason: 'Attitude overshoot is high while rate is usable; reduce P weakly.',
        evidence,
      };
    }
    if (loopName === 'velocity') {
      if (gain === 'P') {
        return {
          percent: -WEAK_TUNING_STEP_PERCENT,
          phenomenon: 'overshoot',
          confidence: 'medium',
          reason: 'Velocity overshoot is high; reduce P weakly.',
          evidence,
        };
      }
      if (gain === 'D' && groupContext.canIncreaseDForOvershoot) {
        return {
          percent: WEAK_TUNING_STEP_PERCENT,
          phenomenon: 'overshoot',
          confidence: 'low',
          reason:
            'Velocity overshoot is high with low noise evidence; increase D with a small step.',
          evidence,
        };
      }
    }
    if (loopName === 'position' && gain === 'P') {
      return {
        percent: -WEAK_TUNING_STEP_PERCENT,
        phenomenon: 'overshoot',
        confidence: 'medium',
        reason: 'Position overshoot is high; reduce P weakly.',
        evidence,
      };
    }
  }

  if (primaryPhenomenon === 'delay') {
    if (loopName === 'rate' && gain === 'P') {
      return {
        percent: DEFAULT_TUNING_STEP_PERCENT,
        phenomenon: 'delay',
        confidence: 'high',
        reason: 'Rate tracking error and delay are high while oscillation is controlled.',
        evidence,
      };
    }
    if (
      (loopName === 'attitude' || loopName === 'velocity' || loopName === 'position') &&
      gain === 'P'
    ) {
      return {
        percent: WEAK_TUNING_STEP_PERCENT,
        phenomenon: 'delay',
        confidence: 'medium',
        reason: `${loopName} response is slow while upstream loops are usable; increase P weakly.`,
        evidence,
      };
    }
  }

  if (primaryPhenomenon === 'steady_error') {
    if ((loopName === 'rate' || loopName === 'velocity') && gain === 'I') {
      return {
        percent: WEAK_TUNING_STEP_PERCENT,
        phenomenon: 'steady_error',
        confidence: 'low',
        reason: `${loopName} tracking error persists without higher-priority phenomena; increase I weakly.`,
        evidence,
      };
    }
  }

  if (loopName === 'rate' && axisLabel === 'yaw' && gain === 'D') {
    return {
      percent: 0,
      phenomenon: 'yaw_d_guard',
      confidence: 'high',
      reason: 'Yaw rate D is not increased automatically by the conservative rule set.',
      evidence,
      blocker: 'Yaw rate D automatic increases are disabled.',
    };
  }

  return {
    percent: 0,
    phenomenon: primaryPhenomenon,
    confidence: 'low',
    reason: 'No strong metric evidence for changing this parameter.',
    evidence,
  };
}

function applyBoundedStep(currentValue, bound, requestedPercent) {
  if (!Number.isFinite(currentValue) || !bound) return null;
  const min = Number.isFinite(bound.min) ? bound.min : -Infinity;
  const max = Number.isFinite(bound.max) ? bound.max : Infinity;
  const maxStepPercent = Number.isFinite(bound.maxStepPercent)
    ? bound.maxStepPercent
    : DEFAULT_TUNING_STEP_PERCENT;
  const cappedPercentMagnitude = Math.min(
    Math.abs(requestedPercent),
    Math.abs(maxStepPercent),
  );
  if (cappedPercentMagnitude <= EPS) return null;
  if (Math.abs(currentValue) <= EPS) return null;

  const effectivePercent = Math.sign(requestedPercent) * cappedPercentMagnitude;
  const requestedTarget = currentValue * (1 + effectivePercent / 100);
  const target = Math.min(max, Math.max(min, requestedTarget));
  const changePercent = ((target - currentValue) / currentValue) * 100;
  if (!Number.isFinite(changePercent) || Math.abs(changePercent) <= EPS) {
    return null;
  }

  return {
    target,
    changePercent,
  };
}

function getDeferredNextAction(reason) {
  const value = String(reason || '');
  if (/setpoint excitation is too low/i.test(value)) {
    return 'Select an analysis range with clear setpoint movement before generating PID targets.';
  }
  if (/not enough data samples/i.test(value)) {
    return 'Select a longer analysis range with enough samples before generating PID targets.';
  }
  if (/analysis window is too short/i.test(value)) {
    return 'Select a longer analysis range before generating PID targets.';
  }
  if (/delay estimate is/i.test(value)) {
    return 'Select a range with a reliable delay estimate before generating PID targets.';
  }
  if (/current parameter value was not found/i.test(value)) {
    return 'Import or include current PX4 parameters before generating PID targets.';
  }
  if (/fill min, max, and max step percent/i.test(value)) {
    return 'Fill safety bounds before generating PID targets.';
  }
  if (/safety bounds are invalid/i.test(value)) {
    return 'Fix safety bounds before generating PID targets.';
  }
  if (/changed inside the analysis window/i.test(value)) {
    return 'Select a range where the parameter stays unchanged before generating PID targets.';
  }
  if (/actuator saturation/i.test(value)) {
    return 'Resolve actuator saturation or review control authority before changing PID gains.';
  }
  if (/not healthy enough|not available/i.test(value)) {
    return 'Handle upstream loop recommendations before tuning this downstream loop.';
  }
  if (/estimator or feedback signal anomalies/i.test(value)) {
    return 'Resolve estimator or feedback signal anomalies before generating PID targets.';
  }
  return 'Review the blocking condition before generating PID targets.';
}

function buildUpstreamNextAction(upstreamReference) {
  if (!upstreamReference) return null;
  const parameters = upstreamReference.parameters || [];
  const suffix = parameters.length ? `: ${parameters.join(', ')}` : '';
  return `Handle upstream ${upstreamReference.loop} loop recommendation first${suffix}.`;
}

function buildParameterTarget({
  current,
  boundResult,
  metricSummary,
  loopName,
  axisLabel,
  gain,
  actuatorSaturation,
  blockers,
  groupContext,
}) {
  if (blockers.length) {
    const reason = blockers[0];
    const blockerMetadata = getTargetBlockerMetadata(reason);
    return {
      status: 'blocked',
      targetValue: null,
      changePercent: null,
      reason,
      blockers,
      phenomenon: blockerMetadata.phenomenon,
      confidence: 'high',
      evidence: buildMetricEvidence(metricSummary),
      recommendationLevel: 'deferred',
      nextAction: blockerMetadata.nextAction,
    };
  }

  if (!current) {
    return {
      status: 'missing_current',
      targetValue: null,
      changePercent: null,
      reason: 'Current parameter value was not found in the log.',
      blockers: ['Current parameter value was not found in the log.'],
      phenomenon: 'missing_current',
      confidence: 'high',
      evidence: buildMetricEvidence(metricSummary),
      recommendationLevel: 'deferred',
      nextAction: getDeferredNextAction('Current parameter value was not found in the log.'),
    };
  }

  if (boundResult.status === 'missing') {
    return {
      status: 'bounds_required',
      targetValue: null,
      changePercent: null,
      reason: 'Fill min, max, and max step percent to generate a target value.',
      blockers: ['Fill min, max, and max step percent to generate a target value.'],
      phenomenon: 'bounds_required',
      confidence: 'high',
      evidence: buildMetricEvidence(metricSummary),
      recommendationLevel: 'deferred',
      nextAction: getDeferredNextAction('Fill min, max, and max step percent to generate a target value.'),
    };
  }

  if (boundResult.status === 'invalid') {
    return {
      status: 'invalid_bounds',
      targetValue: null,
      changePercent: null,
      reason: 'Safety bounds are invalid.',
      blockers: ['Safety bounds are invalid.'],
      phenomenon: 'invalid_bounds',
      confidence: 'high',
      evidence: buildMetricEvidence(metricSummary),
      recommendationLevel: 'deferred',
      nextAction: getDeferredNextAction('Safety bounds are invalid.'),
    };
  }

  const step = chooseParameterStep({
    loopName,
    axisLabel,
    gain,
    metricSummary,
    groupContext,
  });

  if (step.status === 'blocked') {
    return {
      status: 'blocked',
      targetValue: null,
      changePercent: null,
      reason: step.reason,
      blockers: [step.reason],
      phenomenon: step.phenomenon,
      confidence: step.confidence,
      evidence: step.evidence,
      recommendationLevel: step.recommendationLevel || 'deferred',
      nextAction: step.nextAction || getDeferredNextAction(step.reason),
    };
  }

  if (step.percent > 0 && actuatorSaturation.level !== 'none') {
    return {
      status: 'blocked',
      targetValue: null,
      changePercent: null,
      reason: 'Actuator saturation is high, so gain increases are blocked.',
      blockers: ['Actuator saturation is high, so gain increases are blocked.'],
      phenomenon: 'actuator_saturation',
      confidence: 'high',
      evidence: step.evidence,
      recommendationLevel: 'deferred',
      nextAction: getDeferredNextAction('Actuator saturation is high, so gain increases are blocked.'),
    };
  }

  if (
    step.percent > 0 &&
    groupContext?.tuningSafety?.pidRecommendationPolicy === 'decrease_only'
  ) {
    return {
      status: 'blocked',
      targetValue: null,
      changePercent: null,
      reason: 'Moderate vibration is present, so gain increases are blocked.',
      blockers: ['Moderate vibration is present, so gain increases are blocked.'],
      phenomenon: groupContext.tuningSafety.vibrationCategory || 'mechanical_imu_noise',
      confidence: 'high',
      evidence: uniqueStrings([
        ...(groupContext.tuningSafety.evidence || []),
        ...(step.evidence || []),
      ]),
      recommendationLevel: 'deferred',
      nextAction:
        'Resolve vibration evidence before increasing PID gains; only conservative decreases are allowed.',
    };
  }

  if (Math.abs(step.percent) <= EPS) {
    return {
      status: 'unchanged',
      targetValue: roundMetric(current.value, 12),
      changePercent: 0,
      reason: step.reason,
      blockers: step.blocker ? [step.blocker] : [],
      phenomenon: step.phenomenon,
      confidence: step.confidence,
      evidence: step.evidence,
      recommendationLevel: 'unchanged',
      nextAction: 'Keep the current value unless follow-up analysis shows stronger evidence.',
    };
  }

  const boundedStep = applyBoundedStep(
    current.value,
    boundResult.value,
    groupContext?.tuningSafety?.pidRecommendationPolicy === 'weak_only'
      ? Math.sign(step.percent) *
          Math.min(Math.abs(step.percent), WEAK_TUNING_STEP_PERCENT)
      : step.percent,
  );
  if (!boundedStep) {
    return {
      status: 'unchanged',
      targetValue: roundMetric(current.value, 12),
      changePercent: 0,
      reason: 'Requested change is constrained by the current value or safety bounds.',
      blockers: ['Requested change is constrained by the current value or safety bounds.'],
      phenomenon: step.phenomenon,
      confidence: step.confidence,
      evidence: step.evidence,
      recommendationLevel: 'unchanged',
      nextAction: 'Keep the current value or relax safety bounds after manual review.',
    };
  }

  return {
    status: 'target_generated',
    targetValue: roundMetric(boundedStep.target, 12),
    changePercent: roundMetric(boundedStep.changePercent, 6),
    reason: step.reason,
    blockers: [],
    phenomenon: step.phenomenon,
    confidence: step.confidence,
    evidence: step.evidence,
    recommendationLevel: step.recommendationLevel || 'actionable',
    nextAction: step.nextAction || 'Review the generated target before applying it.',
  };
}

function buildDisplayOnlyParameterTarget(current) {
  if (!current) {
    return {
      status: 'missing_current',
      targetValue: null,
      changePercent: null,
      reason: 'Current parameter value was not found in the log.',
    };
  }

  return {
    status: 'display_only',
    targetValue: null,
    changePercent: null,
    reason:
      'Displayed for loop context only; no offline target is generated for this parameter.',
  };
}

function normalizeName(name) {
  return String(name || '').trim().toLowerCase();
}

function toArray(value) {
  return Array.isArray(value) ? value : [value];
}

function findTopic(topicCharts, topicNames) {
  return findTopics(topicCharts, topicNames)[0] || null;
}

function findTopics(topicCharts, topicNames) {
  const candidates = toArray(topicNames).filter(Boolean);
  return (topicCharts || []).filter((chart) =>
    candidates.some(
      (topicName) =>
        chart &&
        (chart.topic === topicName || String(chart.topic || '').startsWith(`${topicName}_`)),
    ),
  );
}

function findSeries(topic, candidates) {
  if (!topic || !Array.isArray(topic.series)) return null;
  const normalizedCandidates = candidates.map(normalizeName);
  return (
    topic.series.find((series) =>
      normalizedCandidates.includes(normalizeName(series?.name)),
    ) || null
  );
}

function findSeriesInTopics(topics, candidates) {
  for (const topic of topics) {
    const series = findSeries(topic, candidates);
    if (series) return { topic, series };
  }
  return null;
}

function normalizePoints(points) {
  if (!Array.isArray(points)) return [];
  return points
    .filter(
      (point) =>
        Array.isArray(point) &&
        point.length >= 2 &&
        isFiniteNumber(point[0]) &&
        isFiniteNumber(point[1]),
    )
    .map((point) => [Number(point[0]), Number(point[1])])
    .sort((a, b) => a[0] - b[0]);
}

function interpolate(points, targetTime) {
  if (!points.length) return null;
  if (targetTime < points[0][0] || targetTime > points[points.length - 1][0]) {
    return null;
  }

  let left = 0;
  let right = points.length - 1;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    if (points[mid][0] === targetTime) return points[mid][1];
    if (points[mid][0] < targetTime) left = mid + 1;
    else right = mid - 1;
  }

  const hi = left;
  const lo = left - 1;
  if (lo < 0 || hi >= points.length) return null;
  const t0 = points[lo][0];
  const t1 = points[hi][0];
  if (Math.abs(t1 - t0) < EPS) return points[lo][1];
  const ratio = (targetTime - t0) / (t1 - t0);
  return points[lo][1] + (points[hi][1] - points[lo][1]) * ratio;
}

function wrapAngleDeg(value) {
  let wrapped = value;
  while (wrapped > 180) wrapped -= 360;
  while (wrapped < -180) wrapped += 360;
  return wrapped;
}

function alignSeries({ setpointSeries, feedbackSeries, segment, wrapError = false }) {
  const setpointPoints = normalizePoints(setpointSeries?.points);
  const feedbackPoints = normalizePoints(feedbackSeries?.points);
  if (setpointPoints.length < MIN_ALIGNED_POINTS || feedbackPoints.length < MIN_ALIGNED_POINTS) {
    return {
      status: 'not_enough_data',
      t: [],
      sp: [],
      fb: [],
      err: [],
      points: [],
      errorPoints: [],
    };
  }

  const startS = isFiniteNumber(segment?.startS) ? segment.startS : -Infinity;
  const endS = isFiniteNumber(segment?.endS) ? segment.endS : Infinity;
  const t = [];
  const sp = [];
  const fb = [];
  const err = [];

  for (const feedbackPoint of feedbackPoints) {
    const time = feedbackPoint[0];
    if (time < startS || time > endS) continue;
    const setpointValue = interpolate(setpointPoints, time);
    if (!isFiniteNumber(setpointValue)) continue;
    const feedbackValue = feedbackPoint[1];
    if (!isFiniteNumber(feedbackValue)) continue;
    const error = wrapError
      ? wrapAngleDeg(setpointValue - feedbackValue)
      : setpointValue - feedbackValue;
    t.push(time);
    sp.push(setpointValue);
    fb.push(feedbackValue);
    err.push(error);
  }

  return {
    status: t.length >= MIN_ALIGNED_POINTS ? 'available' : 'not_enough_data',
    t,
    sp,
    fb,
    err,
    points: t.map((time, index) => [
      roundMetric(time, 3),
      roundMetric(sp[index], 6),
      roundMetric(fb[index], 6),
    ]),
    errorPoints: t.map((time, index) => [roundMetric(time, 3), roundMetric(err[index], 6)]),
  };
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function std(values) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = mean(values.map((value) => (value - avg) ** 2));
  return Math.sqrt(variance);
}

function percentile(values, percentileValue) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rawIndex = (sorted.length - 1) * percentileValue;
  const lo = Math.floor(rawIndex);
  const hi = Math.ceil(rawIndex);
  if (lo === hi) return sorted[lo];
  const ratio = rawIndex - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * ratio;
}

function diff(values) {
  const result = [];
  for (let i = 1; i < values.length; i += 1) {
    result.push(values[i] - values[i - 1]);
  }
  return result;
}

function countZeroCrossings(values, threshold = 0) {
  let count = 0;
  let previousSign = 0;
  for (const value of values) {
    if (Math.abs(value) <= threshold) continue;
    const sign = value > 0 ? 1 : -1;
    if (previousSign !== 0 && sign !== previousSign) count += 1;
    previousSign = sign;
  }
  return count;
}

function estimateDelay(t, sp, fb, maxDelayS) {
  if (t.length < MIN_ALIGNED_POINTS * 2) {
    return { delay_s: null, delay_status: 'not_enough_data' };
  }
  if (std(sp) < EPS || std(fb) < EPS) {
    return { delay_s: null, delay_status: 'not_enough_excitation' };
  }

  const sampleIntervals = diff(t).filter((item) => item > EPS);
  const dt = mean(sampleIntervals);
  if (!isFiniteNumber(dt) || dt <= 0) {
    return { delay_s: null, delay_status: 'invalid' };
  }

  const maxLag = Math.max(1, Math.floor(maxDelayS / dt));
  const spMean = mean(sp);
  const fbMean = mean(fb);
  const spStd = std(sp);
  const fbStd = std(fb);
  let bestLag = 0;
  let bestScore = -Infinity;

  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    let score = 0;
    let count = 0;
    for (let i = 0; i < sp.length; i += 1) {
      const fbIndex = i + lag;
      if (fbIndex < 0 || fbIndex >= fb.length) continue;
      score += ((sp[i] - spMean) / spStd) * ((fb[fbIndex] - fbMean) / fbStd);
      count += 1;
    }
    if (count < MIN_ALIGNED_POINTS) continue;
    const normalizedScore = score / count;
    if (normalizedScore > bestScore) {
      bestScore = normalizedScore;
      bestLag = lag;
    }
  }

  if (!Number.isFinite(bestScore)) {
    return { delay_s: null, delay_status: 'invalid' };
  }
  return { delay_s: roundMetric(bestLag * dt, 4), delay_status: 'ok' };
}

function estimateOvershoot(sp, fb) {
  if (sp.length < MIN_ALIGNED_POINTS * 2) {
    return { overshoot_ratio: null, overshoot_status: 'not_enough_data' };
  }
  const spRange = Math.max(...sp) - Math.min(...sp);
  if (spRange < EPS || std(sp) < EPS) {
    return { overshoot_ratio: null, overshoot_status: 'not_enough_excitation' };
  }
  const threshold = spRange * 0.2;
  let total = 0;
  let overshoot = 0;
  for (let i = 1; i < sp.length; i += 1) {
    const step = sp[i] - sp[i - 1];
    if (Math.abs(step) < threshold) continue;
    total += 1;
    if (step > 0 && fb[i] > sp[i]) overshoot += 1;
    if (step < 0 && fb[i] < sp[i]) overshoot += 1;
  }
  if (total === 0) {
    return { overshoot_ratio: null, overshoot_status: 'not_enough_excitation' };
  }
  return { overshoot_ratio: roundMetric(overshoot / total, 6), overshoot_status: 'ok' };
}

function computeTrackingMetrics(aligned, maxDelayS) {
  if (aligned.status !== 'available') {
    return {
      status: aligned.status,
      metrics: {
        delay_s: null,
        delay_status: aligned.status,
        overshoot_ratio: null,
        overshoot_status: aligned.status,
      },
    };
  }

  const absError = aligned.err.map(Math.abs);
  const durationS = aligned.t[aligned.t.length - 1] - aligned.t[0];
  const rmse = Math.sqrt(mean(aligned.err.map((value) => value ** 2)));
  const maxError = Math.max(...absError);
  const spRange = Math.max(...aligned.sp) - Math.min(...aligned.sp);
  const fbRange = Math.max(...aligned.fb) - Math.min(...aligned.fb);
  const signalScale = Math.max(spRange, fbRange, EPS);
  const errorThreshold = Math.max(percentile(absError, 0.5) || 0, maxError * 0.05);
  const zeroCrossingCount = countZeroCrossings(aligned.err);
  const effectiveZeroCrossingCount = countZeroCrossings(aligned.err, errorThreshold);
  const delay = estimateDelay(aligned.t, aligned.sp, aligned.fb, maxDelayS);
  const overshoot = estimateOvershoot(aligned.sp, aligned.fb);
  const errorDiff = diff(aligned.err);
  const feedbackDiff = diff(aligned.fb);
  const setpointDiff = diff(aligned.sp);
  const peakThreshold = Math.max(percentile(absError, 0.95) || 0, errorThreshold);
  const peaks = absError.filter((value) => value >= peakThreshold);

  return {
    status: 'available',
    metrics: {
      mae: roundMetric(mean(absError)),
      rmse: roundMetric(rmse),
      max_error: roundMetric(maxError),
      std_error: roundMetric(std(aligned.err)),
      p50_error: roundMetric(percentile(absError, 0.5)),
      p95_error: roundMetric(percentile(absError, 0.95)),
      p99_error: roundMetric(percentile(absError, 0.99)),
      signal_scale: roundMetric(signalScale),
      nrmse: roundMetric(rmse / signalScale),
      nmax_error: roundMetric(maxError / signalScale),
      ...delay,
      zero_crossing_count: zeroCrossingCount,
      zero_crossing_rate: roundMetric(durationS > EPS ? zeroCrossingCount / durationS : 0),
      effective_zero_crossing_count: effectiveZeroCrossingCount,
      effective_zero_crossing_rate: roundMetric(
        durationS > EPS ? effectiveZeroCrossingCount / durationS : 0,
      ),
      error_peak_count: peaks.length,
      error_peak_mean: roundMetric(mean(peaks) || 0),
      error_peak_max: roundMetric(peaks.length ? Math.max(...peaks) : 0),
      error_diff_std: roundMetric(std(errorDiff)),
      feedback_diff_std: roundMetric(std(feedbackDiff)),
      setpoint_diff_std: roundMetric(std(setpointDiff)),
      setpoint_std: roundMetric(std(aligned.sp)),
      setpoint_range: roundMetric(spRange),
      excitation_level: spRange < EPS ? 'low' : spRange < signalScale * 0.35 ? 'medium' : 'high',
      ...overshoot,
      sample_count: aligned.t.length,
      duration_s: roundMetric(durationS, 3),
    },
  };
}

function computeLoop(topicCharts, loopName, segment, missingFields) {
  const topicNames = LOOP_TOPIC_MAP[loopName];
  const setpointTopics = findTopics(topicCharts, topicNames.sp);
  const feedbackTopics = findTopics(topicCharts, topicNames.fb);
  if (!setpointTopics.length || !feedbackTopics.length) {
    const missingTopic = !setpointTopics.length ? toArray(topicNames.sp).join(' 或 ') : toArray(topicNames.fb).join(' 或 ');
    return {
      status: 'topic_missing',
      axis: {},
      charts: [],
      notes: [`缺少 ${missingTopic}。`],
    };
  }

  const axis = {};
  const charts = [];
  const notes = [];
  for (const [axisName, mapping] of Object.entries(FIELD_CANDIDATES[loopName])) {
    const spMatch = findSeriesInTopics(setpointTopics, mapping.sp);
    const fbMatch = findSeriesInTopics(feedbackTopics, mapping.fb);
    if (!spMatch || !fbMatch) {
      missingFields.push({
        loop: loopName,
        axis: axisName,
        topic: !spMatch ? setpointTopics.map((topic) => topic.topic).join(' 或 ') : feedbackTopics.map((topic) => topic.topic).join(' 或 '),
        fields: !spMatch ? mapping.sp : mapping.fb,
      });
      axis[axisName] = {
        status: 'field_missing',
        unit: mapping.unit,
        metrics: {},
      };
      continue;
    }

    const aligned = alignSeries({
      setpointSeries: spMatch.series,
      feedbackSeries: fbMatch.series,
      segment,
      wrapError: mapping.wrap === true,
    });
    const chartAligned = alignSeries({
      setpointSeries: spMatch.series,
      feedbackSeries: fbMatch.series,
      wrapError: mapping.wrap === true,
    });
    const result = computeTrackingMetrics(aligned, topicNames.maxDelayS);
    axis[axisName] = {
      status: result.status,
      unit: mapping.unit,
      metrics: result.metrics,
    };
    if (chartAligned.status === 'available') {
      charts.push({
        axis: axisName,
        unit: mapping.unit,
        setpointFeedback: chartAligned.points,
        error: chartAligned.errorPoints,
      });
    }
  }

  const availableAxes = Object.values(axis).filter((item) => item.status === 'available');
  return {
    status: availableAxes.length > 0 ? 'available' : 'unavailable',
    axis,
    charts,
    notes,
  };
}

function findActuatorTopic(topicCharts) {
  return (
    findTopic(topicCharts, 'actuator_motors') ||
    findTopic(topicCharts, 'actuator_outputs') ||
    findTopic(topicCharts, 'actuator_controls_0')
  );
}

function isActuatorSeries(series) {
  const name = normalizeName(series?.name);
  return (
    name.startsWith('control[') ||
    name.startsWith('control.') ||
    name.startsWith('control_') ||
    name.startsWith('output[') ||
    name.startsWith('output.') ||
    name.startsWith('output_')
  );
}

function computeActuator(topicCharts, segment) {
  const topic = findActuatorTopic(topicCharts);
  if (!topic) {
    return {
      status: 'topic_missing',
      metrics: {},
      channels: [],
      chart: [],
      notes: ['缺少 actuator_motors、actuator_outputs 或 actuator_controls_0。'],
    };
  }

  const startS = isFiniteNumber(segment?.startS) ? segment.startS : -Infinity;
  const endS = isFiniteNumber(segment?.endS) ? segment.endS : Infinity;
  const chart = (topic.series || [])
    .filter(isActuatorSeries)
    .map((series) => ({
      name: series.name,
      points: normalizePoints(series.points),
    }))
    .filter((series) => series.points.length > 0);
  const channels = (topic.series || [])
    .filter(isActuatorSeries)
    .map((series) => {
      const values = normalizePoints(series.points)
        .filter((point) => point[0] >= startS && point[0] <= endS)
        .map((point) => point[1]);
      const valueDiff = diff(values);
      return {
        name: series.name,
        sample_count: values.length,
        mean_output: roundMetric(mean(values)),
        max_output: values.length ? roundMetric(Math.max(...values)) : null,
        min_output: values.length ? roundMetric(Math.min(...values)) : null,
        output_std: roundMetric(std(values)),
        output_diff_std: roundMetric(std(valueDiff)),
        sat_high_ratio: values.length
          ? roundMetric(values.filter((value) => value > 0.95).length / values.length)
          : null,
        sat_low_ratio: values.length
          ? roundMetric(values.filter((value) => value < 0.05).length / values.length)
          : null,
      };
    })
    .filter((channel) => channel.sample_count >= MIN_ALIGNED_POINTS);

  if (!channels.length) {
    return {
      status: 'not_enough_data',
      metrics: {},
      channels: [],
      chart,
      notes: ['执行器 topic 存在，但当前区间没有可用输出通道。'],
    };
  }

  const channelMeans = channels
    .map((channel) => channel.mean_output)
    .filter(isFiniteNumber);
  const meanOutput = mean(channelMeans);
  const motorMeanSpread =
    channelMeans.length > 0 ? Math.max(...channelMeans) - Math.min(...channelMeans) : null;
  const metrics = {
    sat_high_ratio: roundMetric(mean(channels.map((item) => item.sat_high_ratio).filter(isFiniteNumber))),
    sat_low_ratio: roundMetric(mean(channels.map((item) => item.sat_low_ratio).filter(isFiniteNumber))),
    mean_output: roundMetric(meanOutput),
    max_output: roundMetric(Math.max(...channels.map((item) => item.max_output).filter(isFiniteNumber))),
    min_output: roundMetric(Math.min(...channels.map((item) => item.min_output).filter(isFiniteNumber))),
    output_std: roundMetric(mean(channels.map((item) => item.output_std).filter(isFiniteNumber))),
    output_diff_std: roundMetric(mean(channels.map((item) => item.output_diff_std).filter(isFiniteNumber))),
    motor_mean_spread: roundMetric(motorMeanSpread),
    motor_mean_spread_ratio: roundMetric(
      isFiniteNumber(motorMeanSpread) && isFiniteNumber(meanOutput)
        ? motorMeanSpread / Math.max(Math.abs(meanOutput), EPS)
        : null,
    ),
  };

  return {
    status: 'available',
    metrics,
    channels,
    chart,
    notes: [],
  };
}

function computeEstimatorQuality(topicCharts, segment) {
  const positionTopic = findTopic(topicCharts, 'vehicle_local_position');
  const setpointTopic = findTopic(topicCharts, 'vehicle_local_position_setpoint');
  const startS = isFiniteNumber(segment?.startS) ? segment.startS : -Infinity;
  const endS = isFiniteNumber(segment?.endS) ? segment.endS : Infinity;

  function maxJump(topic, fields, hint) {
    let count = 0;
    let maxValue = 0;
    for (const field of fields) {
      const series = findSeries(topic, [field]);
      const values = normalizePoints(series?.points)
        .filter((point) => point[0] >= startS && point[0] <= endS)
        .map((point) => point[1]);
      for (const value of diff(values).map(Math.abs)) {
        if (value > hint) count += 1;
        if (value > maxValue) maxValue = value;
      }
    }
    return { count, max: roundMetric(maxValue) };
  }

  const positionJump = maxJump(positionTopic, ['x', 'y', 'z'], 1.0);
  const velocitySpike = maxJump(positionTopic, ['vx', 'vy', 'vz'], 2.0);
  const setpointJump = maxJump(
    setpointTopic,
    ['x', 'y', 'z', 'vx', 'vy', 'vz'],
    1.0,
  );

  return {
    status: positionTopic || setpointTopic ? 'available' : 'topic_missing',
    position_jump_count: positionJump.count,
    position_jump_max: positionJump.max,
    velocity_spike_count: velocitySpike.count,
    velocity_spike_max: velocitySpike.max,
    setpoint_jump_count: setpointJump.count,
    setpoint_jump_max: setpointJump.max,
  };
}

function getAllTimeBounds(topicCharts) {
  let minTime = Infinity;
  let maxTime = -Infinity;
  for (const topic of topicCharts || []) {
    for (const series of topic.series || []) {
      for (const point of normalizePoints(series.points)) {
        if (point[0] < minTime) minTime = point[0];
        if (point[0] > maxTime) maxTime = point[0];
      }
    }
  }
  if (!Number.isFinite(minTime) || !Number.isFinite(maxTime)) {
    return { startS: null, endS: null };
  }
  const span = maxTime - minTime;
  if (span <= 0) return { startS: roundMetric(minTime, 3), endS: roundMetric(maxTime, 3) };
  return {
    startS: roundMetric(minTime + span * 0.05, 3),
    endS: roundMetric(maxTime - span * 0.05, 3),
  };
}

function resolveSegment(topicCharts, segment) {
  const fallback = getAllTimeBounds(topicCharts);
  const startS = isFiniteNumber(segment?.startS) ? segment.startS : fallback.startS;
  const endS = isFiniteNumber(segment?.endS) ? segment.endS : fallback.endS;
  if (isFiniteNumber(startS) && isFiniteNumber(endS) && endS > startS) {
    return { startS, endS, source: segment?.source || 'auto_trim_5_percent' };
  }
  return { startS: null, endS: null, source: 'all_available_data' };
}

function buildHints(report) {
  const hints = [];
  const positionAxes = ['x', 'y'].map((axis) => report.loops.position?.axis?.[axis]?.metrics);
  const positionNrmseValues = positionAxes
    .map((metrics) => metrics?.nrmse)
    .filter(isFiniteNumber);
  const positionNrmse = mean(positionNrmseValues);
  const velocityAxes = ['vx', 'vy'].map((axis) => report.loops.velocity?.axis?.[axis]?.metrics);
  const velocityNrmseValues = velocityAxes
    .map((metrics) => metrics?.nrmse)
    .filter(isFiniteNumber);
  const velocityNrmse = mean(velocityNrmseValues);

  if (
    isFiniteNumber(positionNrmse) &&
    isFiniteNumber(velocityNrmse) &&
    positionNrmse > velocityNrmse * 1.5
  ) {
    hints.push(
      '位置跟踪误差相对更明显，建议检查位置期望值是否平滑，以及本地位置反馈是否存在跳变。',
    );
  }

  const actuator = report.loops.actuator?.metrics || {};
  if (
    (isFiniteNumber(actuator.sat_high_ratio) && actuator.sat_high_ratio > 0) ||
    (isFiniteNumber(actuator.sat_low_ratio) && actuator.sat_low_ratio > 0)
  ) {
    hints.push(
      '执行器输出触及参考饱和区间，内环结论需要降低可信度。',
    );
  }

  const estimator = report.estimator_quality || {};
  if (
    (estimator.position_jump_count || 0) > 0 ||
    (estimator.velocity_spike_count || 0) > 0
  ) {
    hints.push(
      '反馈数据存在跳变或尖峰，控制环指标可能受到估计器或传感器数据质量影响。',
    );
  }

  if (!hints.length) {
    hints.push('当前可用指标未生成跨环路现象提示。');
  }

  return hints;
}

function getActuatorSaturationState(loops) {
  const metrics = loops?.actuator?.metrics || {};
  const satHighRatio = isFiniteNumber(metrics.sat_high_ratio) ? metrics.sat_high_ratio : 0;
  const satLowRatio = isFiniteNumber(metrics.sat_low_ratio) ? metrics.sat_low_ratio : 0;
  const ratio = Math.max(satHighRatio, satLowRatio);
  const level =
    ratio >= ACTUATOR_SATURATION_SEVERE_THRESHOLD
      ? 'severe'
      : ratio >= ACTUATOR_SATURATION_BLOCK_THRESHOLD
        ? 'high'
        : 'none';
  return {
    level,
    ratio: roundMetric(ratio, 6),
    blocksIncrease: level !== 'none',
  };
}

function getEstimatorBlockers(estimatorQuality) {
  if (!estimatorQuality || typeof estimatorQuality !== 'object') return [];
  const positionJumpCount = Number(estimatorQuality.position_jump_count || 0);
  const velocitySpikeCount = Number(estimatorQuality.velocity_spike_count || 0);
  if (positionJumpCount > 0 || velocitySpikeCount > 0) {
    return [
      'Estimator or feedback signal anomalies were detected; PID recommendations are suppressed.',
    ];
  }
  return [];
}

function getSegmentSeriesDiffStd(topicCharts, topicNames, segment) {
  const startS = isFiniteNumber(segment?.startS) ? segment.startS : -Infinity;
  const endS = isFiniteNumber(segment?.endS) ? segment.endS : Infinity;
  let maxDiffStd = 0;
  let sampleCount = 0;

  for (const topic of findTopics(topicCharts, topicNames)) {
    for (const series of topic.series || []) {
      const values = normalizePoints(series.points)
        .filter((point) => point[0] >= startS && point[0] <= endS)
        .map((point) => point[1]);
      if (values.length < MIN_ALIGNED_POINTS) continue;
      sampleCount += values.length;
      maxDiffStd = Math.max(maxDiffStd, std(diff(values)));
    }
  }

  return {
    maxDiffStd: roundMetric(maxDiffStd),
    sampleCount,
  };
}

function computeTuningSafety({ topicCharts, loops, estimatorQuality, segment }) {
  const evidence = [];
  const estimatorBlockers = getEstimatorBlockers(estimatorQuality);
  if (estimatorBlockers.length) {
    return {
      vibrationLevel: 'severe',
      vibrationCategory: 'estimator_anomaly',
      pidRecommendationPolicy: 'blocked',
      evidence: estimatorBlockers,
    };
  }

  const rateSummaries = getLoopMetricSummaries('rate', loops?.rate);
  const rateHasSevereOscillation = rateSummaries.some(
    (summary) => getOscillationSeverity(summary) === 'severe',
  );
  const rateHasHighOscillation = rateSummaries.some(
    (summary) => getOscillationSeverity(summary) === 'high',
  );
  const rateHasHighNoise = rateSummaries.some(hasHighNoiseEvidence);
  const rateHasRelativeHighFrequencyNoise = rateSummaries.some((summary) => {
    if (!isFiniteNumber(summary.feedbackDiffStd)) return false;
    const setpointDiffStd = summary.setpointDiffStd ?? 0;
    return summary.feedbackDiffStd >= Math.max(setpointDiffStd * 1.2, EPS);
  });
  const maxZeroCrossingRate = maxMetricValue(
    Object.values(loops?.rate?.axis || {}),
    'effective_zero_crossing_rate',
  );
  const actuatorDiffStd = loops?.actuator?.metrics?.output_diff_std;
  const actuatorHighFrequency =
    isFiniteNumber(actuatorDiffStd) &&
    actuatorDiffStd >= ACTUATOR_HIGH_FREQUENCY_DIFF_STD;
  const sensorNoise = getSegmentSeriesDiffStd(
    topicCharts,
    ['sensor_gyro', 'sensor_accel', 'vehicle_acceleration'],
    segment,
  );

  if (isFiniteNumber(maxZeroCrossingRate)) {
    evidence.push(`rate_zero_crossing_rate=${roundMetric(maxZeroCrossingRate, 6)}`);
  }
  if (isFiniteNumber(actuatorDiffStd)) {
    evidence.push(`actuator_output_diff_std=${roundMetric(actuatorDiffStd, 6)}`);
  }
  if (sensorNoise.sampleCount > 0) {
    evidence.push(`sensor_diff_std=${roundMetric(sensorNoise.maxDiffStd, 6)}`);
  }

  if ((rateHasHighNoise || rateHasRelativeHighFrequencyNoise) && actuatorHighFrequency) {
    return {
      vibrationLevel: 'moderate',
      vibrationCategory: 'd_term_noise',
      pidRecommendationPolicy: 'decrease_only',
      evidence: uniqueStrings([
        'rate feedback noise and actuator high-frequency output are elevated',
        ...evidence,
      ]),
    };
  }

  if (
    sensorNoise.sampleCount > 0 &&
    sensorNoise.maxDiffStd >= SENSOR_SEVERE_DIFF_STD &&
    !actuatorHighFrequency
  ) {
    return {
      vibrationLevel: 'severe',
      vibrationCategory: 'mechanical_imu_noise',
      pidRecommendationPolicy: 'diagnostic_only',
      evidence: uniqueStrings([
        'sensor gyro/accel high-frequency noise is elevated without matching actuator evidence',
        ...evidence,
      ]),
    };
  }

  if (rateHasSevereOscillation) {
    return {
      vibrationLevel: 'severe',
      vibrationCategory: 'control_oscillation',
      pidRecommendationPolicy: 'diagnostic_only',
      evidence: uniqueStrings([
        'rate error zero-crossing evidence is severe',
        ...evidence,
      ]),
    };
  }

  if (sensorNoise.sampleCount > 0 && sensorNoise.maxDiffStd >= SENSOR_SEVERE_DIFF_STD) {
    return {
      vibrationLevel: 'severe',
      vibrationCategory: 'mechanical_imu_noise',
      pidRecommendationPolicy: 'diagnostic_only',
      evidence: uniqueStrings([
        'sensor gyro/accel high-frequency noise is severe',
        ...evidence,
      ]),
    };
  }

  if (rateHasHighOscillation) {
    return {
      vibrationLevel: 'moderate',
      vibrationCategory: 'control_oscillation',
      pidRecommendationPolicy: 'decrease_only',
      evidence: uniqueStrings([
        'rate error zero-crossing evidence is high',
        ...evidence,
      ]),
    };
  }

  if (sensorNoise.sampleCount > 0 && sensorNoise.maxDiffStd >= SENSOR_MILD_DIFF_STD) {
    return {
      vibrationLevel: 'mild',
      vibrationCategory: 'mechanical_imu_noise',
      pidRecommendationPolicy: 'weak_only',
      evidence: uniqueStrings([
        'sensor gyro/accel high-frequency noise is mildly elevated',
        ...evidence,
      ]),
    };
  }

  return {
    vibrationLevel: 'none',
    vibrationCategory: 'none',
    pidRecommendationPolicy: 'normal',
    evidence: uniqueStrings(evidence),
  };
}

function parameterChangedInSegment(parameterProfile, parameter, segment) {
  if (!isFiniteNumber(segment?.startS) || !isFiniteNumber(segment?.endS)) {
    return false;
  }
  const changedParameters = Array.isArray(parameterProfile?.changedParameters)
    ? parameterProfile.changedParameters
    : [];
  return changedParameters.some((item) => {
    if (item?.name !== parameter) return false;
    const timeS = Number(item.timeS);
    return (
      Number.isFinite(timeS) &&
      timeS >= segment.startS - EPS &&
      timeS <= segment.endS + EPS
    );
  });
}

function getCurrentParameterValueBeforeSegment(parameterProfile, parameter, segment) {
  const initialParameters =
    parameterProfile?.initialParameters &&
    typeof parameterProfile.initialParameters === 'object'
      ? parameterProfile.initialParameters
      : {};
  const changedParameters = Array.isArray(parameterProfile?.changedParameters)
    ? parameterProfile.changedParameters
    : [];

  let current = null;
  const initialValue = Number(initialParameters[parameter]);
  if (Number.isFinite(initialValue)) {
    current = {
      value: initialValue,
      source: 'initial',
      timeS: null,
    };
  }

  const effectiveStartS = isFiniteNumber(segment?.startS) ? segment.startS : Infinity;
  for (const item of changedParameters) {
    if (item?.name !== parameter) continue;
    const value = Number(item.value);
    const timeS = Number(item.timeS);
    if (!Number.isFinite(value) || !Number.isFinite(timeS)) continue;
    if (timeS - effectiveStartS > EPS) continue;
    current = {
      value,
      source: 'changed',
      timeS: roundMetric(timeS, 6),
    };
  }

  return current;
}

function getLoopMetricSummaries(loopName, loop) {
  return (PARAMETER_TUNING_MAP[loopName] || []).map((group) =>
    summarizeAxisMetrics(loop, group.axes),
  );
}

function hasLoopPhenomenonForDownstream(metricSummary) {
  if (metricSummary.status !== 'available') return true;
  if (getMetricGateBlockers('loop', 'readiness', metricSummary).length) return true;
  return getPrimaryPhenomenon(metricSummary) !== 'none';
}

function assessLoopReadiness(loopName, loop) {
  if (loopName === 'actuator') {
    return { healthy: true, reason: null };
  }
  if (!loop || loop.status !== 'available') {
    return {
      healthy: false,
      reason: `${loopName} loop is not available for downstream tuning.`,
    };
  }
  const summaries = getLoopMetricSummaries(loopName, loop);
  if (!summaries.length || summaries.some(hasLoopPhenomenonForDownstream)) {
    return {
      healthy: false,
      reason: `${loopName} loop is not healthy enough for downstream tuning.`,
    };
  }
  return { healthy: true, reason: null };
}

function getUpstreamBlockers(loopName, loopReadiness) {
  const requiredUpstream = UPSTREAM_LOOP_REQUIREMENTS[loopName] || [];

  return requiredUpstream
    .map((upstreamLoop) => loopReadiness[upstreamLoop])
    .filter((state) => state && !state.healthy)
    .map((state) => state.reason);
}

function buildUpstreamReference(loopName, loopReadiness, loopResults) {
  const requiredUpstream = UPSTREAM_LOOP_REQUIREMENTS[loopName] || [];
  for (const upstreamLoop of requiredUpstream) {
    const readiness = loopReadiness[upstreamLoop];
    if (!readiness || readiness.healthy) continue;
    const tuningLoop = loopResults[upstreamLoop];
    const candidateItems = [
      ...(tuningLoop?.parameters || []),
      ...(tuningLoop?.displayParameters || []),
    ];
    const parameters = uniqueStrings(
      candidateItems
        .filter(
          (item) =>
            item?.status === 'target_generated' &&
            isFiniteNumber(item.targetValue),
        )
        .map((item) => item.parameter),
    );
    return {
      loop: upstreamLoop,
      parameters,
    };
  }
  return null;
}

function buildGroupContext({
  loopName,
  group,
  metricSummary,
  currentByParameter,
  actuatorSaturation,
  tuningSafety,
}) {
  const dParameter = group.parameters.find((item) => item.gain === 'D');
  const hasCurrentD = dParameter
    ? Boolean(currentByParameter.get(dParameter.parameter))
    : false;
  const lowNoise = hasLowNoiseEvidence(metricSummary);
  const canIncreaseDForOvershoot =
    hasCurrentD &&
    lowNoise &&
    actuatorSaturation.level === 'none' &&
    !(loopName === 'rate' && group.label === 'yaw');

  return {
    canIncreaseDForOvershoot,
    lowNoise,
    tuningSafety,
  };
}

function buildLoopParameterTuning({
  loopName,
  loop,
  segment,
  parameterProfile,
  parameterBounds,
  actuatorSaturation,
  globalBlockers,
  upstreamBlockers,
  upstreamReference,
  tuningSafety,
}) {
  if (loopName === 'actuator') {
    return {
      status: 'not_applicable',
      parameters: [],
      displayParameters: [],
      blockers: [],
      notes: ['Actuator output has no direct PID parameter mapping.'],
    };
  }

  const groups = PARAMETER_TUNING_MAP[loopName] || [];
  const seenParameters = new Set();
  const parameters = [];
  const displayParameters = [];
  const loopBlockers = new Set([...globalBlockers, ...upstreamBlockers]);

  if (actuatorSaturation.level === 'severe') {
    loopBlockers.add(
      'Severe actuator saturation indicates demand may exceed available control authority; ordinary PID target generation is suppressed.',
    );
  }

  for (const group of groups) {
    const metricSummary = summarizeAxisMetrics(loop, group.axes);
    const metricBlockers = getMetricGateBlockers(loopName, group.label, metricSummary);
    metricBlockers.forEach((blocker) => loopBlockers.add(blocker));
    const currentByParameter = new Map();

    for (const item of group.parameters) {
      currentByParameter.set(
        item.parameter,
        getCurrentParameterValueBeforeSegment(
          parameterProfile,
          item.parameter,
          segment,
        ),
      );
    }

    const groupContext = buildGroupContext({
      loopName,
      group,
      metricSummary,
      currentByParameter,
      actuatorSaturation,
      tuningSafety,
    });

    for (const item of group.parameters) {
      if (seenParameters.has(item.parameter)) continue;
      seenParameters.add(item.parameter);

      const current = currentByParameter.get(item.parameter);
      const targetable = item.targetable !== false;
      const boundResult = targetable
        ? parseParameterBound(parameterBounds, item.parameter)
        : { status: 'not_applicable', value: null };
      const parameterBlockers = [
        ...globalBlockers,
        ...upstreamBlockers,
        ...(actuatorSaturation.level === 'severe'
          ? [
              'Severe actuator saturation indicates demand may exceed available control authority; ordinary PID target generation is suppressed.',
            ]
          : []),
        ...metricBlockers,
      ];
      if (parameterChangedInSegment(parameterProfile, item.parameter, segment)) {
        parameterBlockers.push(
          `${item.parameter} changed inside the analysis window; PID recommendation is suppressed.`,
        );
      }
      const target = targetable
        ? buildParameterTarget({
            current,
            boundResult,
            metricSummary,
            loopName,
            axisLabel: group.label,
            gain: item.gain,
            actuatorSaturation,
            blockers: uniqueStrings(parameterBlockers),
            groupContext,
          })
        : buildDisplayOnlyParameterTarget(current);
      const upstreamNextAction = buildUpstreamNextAction(upstreamReference);
      const contextualTarget =
        target.recommendationLevel === 'deferred' && upstreamReference
          ? {
              ...target,
              upstreamReference,
              nextAction: upstreamNextAction || target.nextAction,
            }
          : target;
      (contextualTarget.blockers || []).forEach((blocker) => loopBlockers.add(blocker));
      const currentValue = current ? roundMetric(current.value, 12) : null;
      const tuningItem = {
        loop: loopName,
        axis: group.label,
        axes: group.axes,
        gain: item.gain,
        role: item.role || 'pid_gain',
        targetable,
        parameter: item.parameter,
        description: item.description || PARAMETER_DESCRIPTIONS[item.parameter] || '',
        currentValue,
        currentSource: current?.source || 'missing',
        currentTimeS: current?.timeS ?? null,
        bounds:
          boundResult.status === 'valid' && boundResult.source === 'provided'
            ? boundResult.value
            : null,
        metricSummary,
        ...contextualTarget,
      };
      if (targetable) {
        displayParameters.push(tuningItem);
      }
      const shouldInclude =
        contextualTarget.status === 'target_generated' &&
        contextualTarget.recommendationLevel === 'actionable' &&
        isFiniteNumber(currentValue) &&
        isFiniteNumber(contextualTarget.targetValue) &&
        Math.abs(contextualTarget.targetValue - currentValue) > EPS;
      if (!shouldInclude) continue;

      parameters.push(tuningItem);
    }
  }

  const blockers = [...loopBlockers];
  return {
    status: parameters.length ? 'available' : 'no_recommendation',
    parameters,
    displayParameters,
    blockers,
    notes: [],
  };
}

function buildParameterTuning({
  loops,
  segment,
  parameterProfile,
  parameterBounds,
  estimatorQuality,
  tuningSafety,
}) {
  const actuatorSaturation = getActuatorSaturationState(loops);
  const globalBlockers = getEstimatorBlockers(estimatorQuality);
  if (tuningSafety?.pidRecommendationPolicy === 'blocked') {
    globalBlockers.push(
      'Estimator or feedback signal anomalies were detected; PID recommendations are suppressed.',
    );
  }
  if (tuningSafety?.pidRecommendationPolicy === 'diagnostic_only') {
    if (tuningSafety.vibrationCategory === 'mechanical_imu_noise') {
      globalBlockers.push(
        'Mechanical or IMU noise is present without control-oscillation evidence; PID recommendations are blocked.',
      );
    } else {
      globalBlockers.push(
        'Severe vibration or severe oscillation is present; PID recommendations are blocked.',
      );
    }
  }
  const result = {
    actuatorBlocksIncrease: actuatorSaturation.blocksIncrease,
    actuatorSaturationLevel: actuatorSaturation.level,
    tuningSafety: tuningSafety || {
      vibrationLevel: 'none',
      vibrationCategory: 'none',
      pidRecommendationPolicy: 'normal',
      evidence: [],
    },
    loops: {},
    warnings: [],
  };
  const loopReadiness = {};

  for (const loopName of LOOP_ORDER) {
    const upstreamBlockers = getUpstreamBlockers(loopName, loopReadiness);
    const upstreamReference = buildUpstreamReference(
      loopName,
      loopReadiness,
      result.loops,
    );
    result.loops[loopName] = buildLoopParameterTuning({
      loopName,
      loop: loops[loopName],
      segment,
      parameterProfile,
      parameterBounds,
      actuatorSaturation,
      globalBlockers,
      upstreamBlockers,
      upstreamReference,
      tuningSafety,
    });
    if (loopName !== 'actuator') {
      loopReadiness[loopName] = assessLoopReadiness(loopName, loops[loopName]);
    }
  }

  if (actuatorSaturation.blocksIncrease) {
    result.warnings.push(
      'Actuator saturation is high; target generation blocks gain increases.',
    );
  }
  result.warnings.push(...globalBlockers);

  return result;
}

function buildControlQualityReport(stored, options = {}) {
  const topicCharts = Array.isArray(stored?.topicCharts) ? stored.topicCharts : [];
  const usedTopics = (stored?.usedTopics || []).map(String);
  const hasTopic = (topicName) =>
    usedTopics.some((topic) => topic === topicName || topic.startsWith(`${topicName}_`)) ||
    topicCharts.some((topic) => topic?.topic === topicName || topic?.topic?.startsWith(`${topicName}_`));
  const missingTopics = REQUIRED_TOPICS.filter((topic) => {
    if (topic === 'actuator_motors') {
      return !hasTopic('actuator_motors') && !hasTopic('actuator_outputs') && !hasTopic('actuator_controls_0');
    }
    return !hasTopic(topic);
  });
  const missingFields = [];
  const segment = resolveSegment(topicCharts, options.segment);
  const loops = {
    actuator: computeActuator(topicCharts, segment),
    rate: computeLoop(topicCharts, 'rate', segment, missingFields),
    attitude: computeLoop(topicCharts, 'attitude', segment, missingFields),
    velocity: computeLoop(topicCharts, 'velocity', segment, missingFields),
    position: computeLoop(topicCharts, 'position', segment, missingFields),
  };

  const estimatorQuality = computeEstimatorQuality(topicCharts, segment);
  const tuningSafety = computeTuningSafety({
    topicCharts,
    loops,
    estimatorQuality,
    segment,
  });
  const availableLoops = LOOP_ORDER.filter((loopName) => loops[loopName]?.status === 'available');
  const unavailableLoops = LOOP_ORDER.filter((loopName) => loops[loopName]?.status !== 'available');
  const report = {
    log_file: stored?.fileName || '',
    analysis_time_range: {
      start_s: segment.startS,
      end_s: segment.endS,
      source: segment.source,
    },
    summary: {
      available_loops: availableLoops,
      unavailable_loops: unavailableLoops,
      main_hints: [],
    },
    loops,
    parameterTuning: buildParameterTuning({
      loops,
      segment,
      parameterProfile: stored?.parameterProfile,
      parameterBounds: options.parameterBounds,
      estimatorQuality,
      tuningSafety,
    }),
    estimator_quality: estimatorQuality,
    missing_topics: missingTopics,
    missing_fields: missingFields,
    warnings: [],
  };

  report.summary.main_hints = buildHints(report);
  return report;
}

function flattenControlQualityCsv(report) {
  const rows = [
    [
      'log_file',
      'time_start_s',
      'time_end_s',
      'loop',
      'axis',
      'unit',
      'mae',
      'rmse',
      'nrmse',
      'max_error',
      'p95_error',
      'p99_error',
      'delay_s',
      'delay_status',
      'zero_crossing_count',
      'zero_crossing_rate',
      'effective_zero_crossing_count',
      'effective_zero_crossing_rate',
      'error_peak_count',
      'error_diff_std',
      'feedback_diff_std',
      'setpoint_range',
      'setpoint_diff_std',
      'overshoot_ratio',
      'overshoot_status',
      'status',
      'note',
    ],
  ];

  for (const loopName of ['rate', 'attitude', 'velocity', 'position']) {
    const loop = report.loops?.[loopName];
    for (const [axisName, axis] of Object.entries(loop?.axis || {})) {
      const metrics = axis.metrics || {};
      rows.push([
        report.log_file,
        report.analysis_time_range?.start_s,
        report.analysis_time_range?.end_s,
        loopName,
        axisName,
        axis.unit || '',
        metrics.mae,
        metrics.rmse,
        metrics.nrmse,
        metrics.max_error,
        metrics.p95_error,
        metrics.p99_error,
        metrics.delay_s,
        metrics.delay_status,
        metrics.zero_crossing_count,
        metrics.zero_crossing_rate,
        metrics.effective_zero_crossing_count,
        metrics.effective_zero_crossing_rate,
        metrics.error_peak_count,
        metrics.error_diff_std,
        metrics.feedback_diff_std,
        metrics.setpoint_range,
        metrics.setpoint_diff_std,
        metrics.overshoot_ratio,
        metrics.overshoot_status,
        axis.status,
        '',
      ]);
    }
  }

  return rows
    .map((row) =>
      row
        .map((cell) => {
          if (cell === null || cell === undefined) return '';
          const value = String(cell);
          return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
        })
        .join(','),
    )
    .join('\n');
}

module.exports = {
  buildControlQualityReport,
  flattenControlQualityCsv,
  alignSeries,
  computeTrackingMetrics,
  wrapAngleDeg,
};
