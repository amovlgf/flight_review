const LOOP_ORDER = ['actuator', 'rate', 'attitude', 'velocity', 'position'];
const MIN_ALIGNED_POINTS = 5;
const EPS = 1e-9;

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

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function roundMetric(value, digits = 6) {
  if (!isFiniteNumber(value)) return null;
  return Number(value.toFixed(digits));
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
