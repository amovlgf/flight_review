const LOOP_ORDER = ['actuator', 'rate', 'attitude', 'velocity', 'position'];
const MIN_ALIGNED_POINTS = 5;
const EPS = 1e-9;
const DEFAULT_TUNING_STEP_PERCENT = 5;
const DEFAULT_PARAMETER_BOUND = Object.freeze({
  min: 0,
  max: null,
  maxStepPercent: DEFAULT_TUNING_STEP_PERCENT,
});
const ACTUATOR_SATURATION_BLOCK_THRESHOLD = 0.05;

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
    };
  }

  return {
    status: 'available',
    nrmse: maxMetricValue(axisItems, 'nrmse'),
    overshootRatio: maxMetricValue(axisItems, 'overshoot_ratio'),
    effectiveZeroCrossingRate: maxMetricValue(axisItems, 'effective_zero_crossing_rate'),
    effectiveZeroCrossingCount: maxMetricValue(axisItems, 'effective_zero_crossing_count'),
    delayAbsS: maxMetricValue(axisItems, 'delay_s', true),
  };
}

function chooseParameterStep(gain, metricSummary) {
  if (metricSummary.status !== 'available') {
    return {
      percent: 0,
      reason: 'No available loop metrics for this parameter group.',
    };
  }

  const nrmse = metricSummary.nrmse ?? 0;
  const overshootRatio = metricSummary.overshootRatio ?? 0;
  const zeroCrossingRate = metricSummary.effectiveZeroCrossingRate ?? 0;
  const zeroCrossingCount = metricSummary.effectiveZeroCrossingCount ?? 0;
  const delayAbsS = metricSummary.delayAbsS ?? 0;
  const highOscillation = zeroCrossingRate >= 1.0 || zeroCrossingCount >= 8;
  const highOvershoot = overshootRatio >= 0.3;
  const highTrackingError = nrmse >= 0.25;
  const highDelay = delayAbsS >= 0.15;

  if (highOscillation) {
    return {
      percent: -DEFAULT_TUNING_STEP_PERCENT,
      reason: 'Effective zero-crossing is high, reduce gain conservatively.',
    };
  }

  if (highOvershoot) {
    if (gain === 'D') {
      return {
        percent: DEFAULT_TUNING_STEP_PERCENT,
        reason: 'Overshoot is high without strong oscillation, add damping conservatively.',
      };
    }
    return {
      percent: -DEFAULT_TUNING_STEP_PERCENT,
      reason: 'Overshoot is high, reduce gain conservatively.',
    };
  }

  if (highTrackingError && highDelay) {
    if (gain === 'P') {
      return {
        percent: DEFAULT_TUNING_STEP_PERCENT,
        reason: 'Tracking error and delay are high while oscillation is controlled.',
      };
    }
    if (gain === 'I') {
      return {
        percent: DEFAULT_TUNING_STEP_PERCENT / 2,
        reason: 'Tracking error is high; increase integral gain with a smaller step.',
      };
    }
  }

  return {
    percent: 0,
    reason: 'No strong metric evidence for changing this parameter.',
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

function buildParameterTarget({
  current,
  boundResult,
  metricSummary,
  gain,
  actuatorBlocksIncrease,
}) {
  if (!current) {
    return {
      status: 'missing_current',
      targetValue: null,
      changePercent: null,
      reason: 'Current parameter value was not found in the log.',
    };
  }

  if (boundResult.status === 'missing') {
    return {
      status: 'bounds_required',
      targetValue: null,
      changePercent: null,
      reason: 'Fill min, max, and max step percent to generate a target value.',
    };
  }

  if (boundResult.status === 'invalid') {
    return {
      status: 'invalid_bounds',
      targetValue: null,
      changePercent: null,
      reason: 'Safety bounds are invalid.',
    };
  }

  const step = chooseParameterStep(gain, metricSummary);
  if (step.percent > 0 && actuatorBlocksIncrease) {
    return {
      status: 'blocked',
      targetValue: null,
      changePercent: null,
      reason: 'Actuator saturation is high, so gain increases are blocked.',
    };
  }

  if (Math.abs(step.percent) <= EPS) {
    return {
      status: 'unchanged',
      targetValue: roundMetric(current.value, 12),
      changePercent: 0,
      reason: step.reason,
    };
  }

  const boundedStep = applyBoundedStep(
    current.value,
    boundResult.value,
    step.percent,
  );
  if (!boundedStep) {
    return {
      status: 'unchanged',
      targetValue: roundMetric(current.value, 12),
      changePercent: 0,
      reason: 'Requested change is constrained by the current value or safety bounds.',
    };
  }

  return {
    status: 'target_generated',
    targetValue: roundMetric(boundedStep.target, 12),
    changePercent: roundMetric(boundedStep.changePercent, 6),
    reason: step.reason,
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

function hasHighActuatorSaturation(loops) {
  const metrics = loops?.actuator?.metrics || {};
  const satHighRatio = isFiniteNumber(metrics.sat_high_ratio) ? metrics.sat_high_ratio : 0;
  const satLowRatio = isFiniteNumber(metrics.sat_low_ratio) ? metrics.sat_low_ratio : 0;
  return Math.max(satHighRatio, satLowRatio) >= ACTUATOR_SATURATION_BLOCK_THRESHOLD;
}

function buildLoopParameterTuning({
  loopName,
  loop,
  segment,
  parameterProfile,
  parameterBounds,
  actuatorBlocksIncrease,
}) {
  if (loopName === 'actuator') {
    return {
      status: 'not_applicable',
      parameters: [],
      notes: ['Actuator output has no direct PID parameter mapping.'],
    };
  }

  const groups = PARAMETER_TUNING_MAP[loopName] || [];
  const seenParameters = new Set();
  const parameters = [];

  for (const group of groups) {
    const metricSummary = summarizeAxisMetrics(loop, group.axes);

    for (const item of group.parameters) {
      if (seenParameters.has(item.parameter)) continue;
      seenParameters.add(item.parameter);

      const current = getCurrentParameterValue(
        parameterProfile,
        item.parameter,
        segment.endS,
      );
      const targetable = item.targetable !== false;
      const boundResult = targetable
        ? parseParameterBound(parameterBounds, item.parameter)
        : { status: 'not_applicable', value: null };
      const target = targetable
        ? buildParameterTarget({
            current,
            boundResult,
            metricSummary,
            gain: item.gain,
            actuatorBlocksIncrease,
          })
        : buildDisplayOnlyParameterTarget(current);
      const currentValue = current ? roundMetric(current.value, 12) : null;
      const shouldInclude =
        target.status === 'target_generated' &&
        isFiniteNumber(currentValue) &&
        isFiniteNumber(target.targetValue) &&
        Math.abs(target.targetValue - currentValue) > EPS;
      if (!shouldInclude) continue;

      parameters.push({
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
        ...target,
      });
    }
  }

  return {
    status: parameters.length ? 'available' : 'no_recommendation',
    parameters,
    notes: [],
  };
}

function buildParameterTuning({ loops, segment, parameterProfile, parameterBounds }) {
  const actuatorBlocksIncrease = hasHighActuatorSaturation(loops);
  const result = {
    actuatorBlocksIncrease,
    loops: {},
    warnings: [],
  };

  for (const loopName of LOOP_ORDER) {
    result.loops[loopName] = buildLoopParameterTuning({
      loopName,
      loop: loops[loopName],
      segment,
      parameterProfile,
      parameterBounds,
      actuatorBlocksIncrease,
    });
  }

  if (actuatorBlocksIncrease) {
    result.warnings.push(
      'Actuator saturation is high; target generation blocks gain increases.',
    );
  }

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
