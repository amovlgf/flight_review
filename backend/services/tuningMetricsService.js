const VALID_TUNING_AXES = ['roll', 'pitch', 'yaw'];
const VALID_TUNING_LOOPS = ['rate', 'attitude'];

const EPSILON = 1e-9;
const MAX_UNIFORM_SAMPLES = 256;

const SERIES_LOOKUP = {
  attitude: {
    setpointTopicCandidates: ['vehicle_attitude_setpoint'],
    actualTopicCandidates: ['vehicle_attitude'],
    setpointSeriesByAxis: {
      roll: ['roll_sp'],
      pitch: ['pitch_sp'],
      yaw: ['yaw_sp'],
    },
    actualSeriesByAxis: {
      roll: ['roll'],
      pitch: ['pitch'],
      yaw: ['yaw'],
    },
  },
  rate: {
    setpointTopicCandidates: ['vehicle_rates_setpoint'],
    actualTopicCandidates: ['vehicle_angular_velocity'],
    setpointSeriesByAxis: {
      roll: ['roll', 'xyz[0]', 'roll_rate', 'rollspeed'],
      pitch: ['pitch', 'xyz[1]', 'pitch_rate', 'pitchspeed'],
      yaw: ['yaw', 'xyz[2]', 'yaw_rate', 'yawspeed'],
    },
    actualSeriesByAxis: {
      roll: ['xyz[0]', 'roll', 'roll_rate', 'rollspeed'],
      pitch: ['xyz[1]', 'pitch', 'pitch_rate', 'pitchspeed'],
      yaw: ['xyz[2]', 'yaw', 'yaw_rate', 'yawspeed'],
    },
  },
};

function createEmptyMetrics() {
  return {
    trackingErrorRms: 0,
    trackingErrorPeak: 0,
    overshootPercent: null,
    settlingTimeS: null,
    phaseDelayMs: null,
    dominantOscillationHz: null,
    oscillationScore: 0,
    actuatorSaturationRatio: null,
    motorClippingDurationS: null,
  };
}

function pushWarning(warnings, message) {
  if (!warnings.includes(message)) {
    warnings.push(message);
  }
}

function toFiniteNumber(value, fallback = null) {
  return Number.isFinite(value) ? value : fallback;
}

function normalizePoint(point) {
  if (!Array.isArray(point) || point.length !== 2) {
    return null;
  }

  const time = Number(point[0]);
  const value = Number(point[1]);
  if (!Number.isFinite(time) || !Number.isFinite(value)) {
    return null;
  }

  return [time, value];
}

function normalizePoints(points) {
  if (!Array.isArray(points)) return [];

  return points
    .map(normalizePoint)
    .filter(Boolean)
    .sort((a, b) => a[0] - b[0]);
}

function findSeriesPoints(topicCharts, topicCandidates, seriesCandidates) {
  const normalizedTopicCharts = Array.isArray(topicCharts) ? topicCharts : [];

  for (const topicCandidate of topicCandidates) {
    const topicMatch = normalizedTopicCharts.find(
      (topicChart) =>
        typeof topicChart?.topic === 'string' &&
        (topicChart.topic === topicCandidate ||
          topicChart.topic.startsWith(`${topicCandidate}_`)),
    );

    if (!topicMatch || !Array.isArray(topicMatch.series)) continue;

    for (const seriesCandidate of seriesCandidates) {
      const seriesMatch = topicMatch.series.find(
        (series) => series?.name === seriesCandidate,
      );
      if (seriesMatch) {
        return normalizePoints(seriesMatch.points);
      }
    }
  }

  for (const seriesCandidate of seriesCandidates) {
    for (const topicChart of normalizedTopicCharts) {
      if (!Array.isArray(topicChart?.series)) continue;
      const seriesMatch = topicChart.series.find(
        (series) => series?.name === seriesCandidate,
      );
      if (seriesMatch) {
        return normalizePoints(seriesMatch.points);
      }
    }
  }

  return [];
}

function collectActuatorSeries(topicCharts) {
  if (!Array.isArray(topicCharts)) return [];

  return topicCharts
    .filter(
      (topicChart) =>
        typeof topicChart?.topic === 'string' &&
        topicChart.topic.startsWith('actuator_outputs'),
    )
    .flatMap((topicChart) =>
      Array.isArray(topicChart.series)
        ? topicChart.series
            .filter((series) => typeof series?.name === 'string')
            .filter((series) => series.name.startsWith('output['))
            .map((series) => ({
              name: series.name,
              points: normalizePoints(series.points),
            }))
        : [],
    );
}

function mean(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function median(values) {
  if (!Array.isArray(values) || values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function getTimeRange(points) {
  if (!points.length) return null;
  return {
    start: points[0][0],
    end: points[points.length - 1][0],
  };
}

function resolveAnalysisWindow(setpointPoints, actualPoints, segment, warnings) {
  const setpointRange = getTimeRange(setpointPoints);
  const actualRange = getTimeRange(actualPoints);
  if (!setpointRange || !actualRange) {
    return null;
  }

  const overlapStart = Math.max(setpointRange.start, actualRange.start);
  const overlapEnd = Math.min(setpointRange.end, actualRange.end);
  if (!(overlapEnd > overlapStart)) {
    pushWarning(warnings, 'Setpoint and actual series do not overlap in time.');
    return null;
  }

  let requestedStart = overlapStart;
  let requestedEnd = overlapEnd;

  if (segment && typeof segment === 'object') {
    const rawStart = Number(segment.startS);
    const rawEnd = Number(segment.endS);

    if (Number.isFinite(rawStart)) requestedStart = rawStart;
    if (Number.isFinite(rawEnd)) requestedEnd = rawEnd;

    if (
      (segment.startS !== undefined && !Number.isFinite(rawStart)) ||
      (segment.endS !== undefined && !Number.isFinite(rawEnd))
    ) {
      pushWarning(warnings, 'Segment bounds are invalid; falling back to available range.');
      requestedStart = overlapStart;
      requestedEnd = overlapEnd;
    }
  }

  if (requestedEnd < requestedStart) {
    pushWarning(warnings, 'Segment start/end were reversed and have been normalized.');
    [requestedStart, requestedEnd] = [requestedEnd, requestedStart];
  }

  const clippedStart = Math.max(overlapStart, requestedStart);
  const clippedEnd = Math.min(overlapEnd, requestedEnd);

  if (clippedStart !== requestedStart || clippedEnd !== requestedEnd) {
    pushWarning(warnings, 'Requested segment was clipped to the available data range.');
  }

  if (!(clippedEnd > clippedStart)) {
    pushWarning(warnings, 'Requested segment does not contain usable overlapping samples.');
    return null;
  }

  return {
    start: clippedStart,
    end: clippedEnd,
  };
}

function interpolateSeriesValue(points, timeS) {
  if (!points.length) return null;
  if (timeS < points[0][0] || timeS > points[points.length - 1][0]) return null;

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];

    if (timeS === current[0]) return current[1];
    if (timeS === next[0]) return next[1];
    if (timeS > current[0] && timeS < next[0]) {
      const span = next[0] - current[0];
      if (span <= EPSILON) return current[1];
      const alpha = (timeS - current[0]) / span;
      return current[1] + (next[1] - current[1]) * alpha;
    }
  }

  return points[points.length - 1][1];
}

function alignSeriesToSetpoint(setpointPoints, actualPoints, startS, endS) {
  const times = [];
  const setpointValues = [];
  const actualValues = [];

  for (const [timeS, setpointValue] of setpointPoints) {
    if (timeS < startS || timeS > endS) continue;
    const actualValue = interpolateSeriesValue(actualPoints, timeS);
    if (!Number.isFinite(actualValue)) continue;

    times.push(timeS);
    setpointValues.push(setpointValue);
    actualValues.push(actualValue);
  }

  return {
    times,
    setpointValues,
    actualValues,
  };
}

function buildUniformSamples(setpointPoints, actualPoints, startS, endS, warnings) {
  const combinedTimes = [...setpointPoints, ...actualPoints]
    .map((point) => point[0])
    .filter((timeS) => timeS >= startS && timeS <= endS);

  const uniqueTimes = [...new Set(combinedTimes)].sort((a, b) => a - b);
  const diffs = [];
  for (let index = 1; index < uniqueTimes.length; index += 1) {
    const diff = uniqueTimes[index] - uniqueTimes[index - 1];
    if (diff > EPSILON) diffs.push(diff);
  }

  let dt = median(diffs);
  const duration = endS - startS;
  if (!Number.isFinite(dt) || dt <= EPSILON || duration <= EPSILON) {
    pushWarning(warnings, 'Insufficient sample spacing for frequency-domain analysis.');
    return null;
  }

  let sampleCount = Math.floor(duration / dt) + 1;
  if (sampleCount > MAX_UNIFORM_SAMPLES) {
    dt = duration / (MAX_UNIFORM_SAMPLES - 1);
    sampleCount = MAX_UNIFORM_SAMPLES;
  }

  if (sampleCount < 8) {
    pushWarning(warnings, 'Not enough samples for phase or oscillation analysis.');
    return null;
  }

  const times = [];
  const setpointValues = [];
  const actualValues = [];

  for (let index = 0; index < sampleCount; index += 1) {
    const timeS = index === sampleCount - 1 ? endS : startS + dt * index;
    const setpointValue = interpolateSeriesValue(setpointPoints, timeS);
    const actualValue = interpolateSeriesValue(actualPoints, timeS);
    if (!Number.isFinite(setpointValue) || !Number.isFinite(actualValue)) {
      continue;
    }

    times.push(timeS);
    setpointValues.push(setpointValue);
    actualValues.push(actualValue);
  }

  if (times.length < 8) {
    pushWarning(warnings, 'Not enough interpolated samples for phase or oscillation analysis.');
    return null;
  }

  return {
    times,
    setpointValues,
    actualValues,
    dt,
  };
}

function computeTrackingMetrics(setpointValues, actualValues) {
  if (!setpointValues.length || setpointValues.length !== actualValues.length) {
    return {
      trackingErrorRms: 0,
      trackingErrorPeak: 0,
      errorValues: [],
    };
  }

  const errorValues = setpointValues.map(
    (setpointValue, index) => setpointValue - actualValues[index],
  );
  const squaredErrorMean =
    errorValues.reduce((sum, value) => sum + value ** 2, 0) / errorValues.length;
  const peakError = errorValues.reduce(
    (peak, value) => Math.max(peak, Math.abs(value)),
    0,
  );

  return {
    trackingErrorRms: Math.sqrt(squaredErrorMean),
    trackingErrorPeak: peakError,
    errorValues,
  };
}

function estimateStepResponseMetrics(times, setpointValues, actualValues, warnings) {
  if (times.length < 8) {
    pushWarning(warnings, 'Not enough samples for step-response metrics.');
    return {
      overshootPercent: null,
      settlingTimeS: null,
    };
  }

  const headCount = Math.max(2, Math.floor(setpointValues.length * 0.1));
  const tailCount = Math.max(2, Math.floor(setpointValues.length * 0.1));
  const startValue = mean(setpointValues.slice(0, headCount));
  const finalValue = mean(setpointValues.slice(-tailCount));
  const amplitude = (finalValue ?? 0) - (startValue ?? 0);
  const setpointRange =
    Math.max(...setpointValues) - Math.min(...setpointValues);
  const finalSpread =
    Math.max(...setpointValues.slice(-tailCount)) -
    Math.min(...setpointValues.slice(-tailCount));

  if (
    !Number.isFinite(amplitude) ||
    Math.abs(amplitude) <= 1e-6 ||
    Math.abs(amplitude) < Math.max(1e-6, setpointRange * 0.3) ||
    finalSpread > Math.abs(amplitude) * 0.2
  ) {
    pushWarning(warnings, 'Segment is not step-like enough to estimate overshoot or settling time.');
    return {
      overshootPercent: null,
      settlingTimeS: null,
    };
  }

  let onsetIndex = setpointValues.findIndex(
    (value) => Math.abs(value - startValue) >= Math.abs(amplitude) * 0.1,
  );
  if (onsetIndex < 0) onsetIndex = 0;

  let overshootPercent = 0;
  if (amplitude > 0) {
    const peakActual = Math.max(...actualValues.slice(onsetIndex));
    overshootPercent = ((peakActual - finalValue) / Math.abs(amplitude)) * 100;
  } else {
    const minActual = Math.min(...actualValues.slice(onsetIndex));
    overshootPercent = ((finalValue - minActual) / Math.abs(amplitude)) * 100;
  }
  overshootPercent = Math.max(0, overshootPercent);

  const tolerance = Math.max(Math.abs(amplitude) * 0.05, 1e-3);
  let settlingTimeS = null;
  for (let index = onsetIndex; index < actualValues.length; index += 1) {
    const remainsSettled = actualValues
      .slice(index)
      .every((value) => Math.abs(value - finalValue) <= tolerance);
    if (remainsSettled) {
      settlingTimeS = times[index] - times[onsetIndex];
      break;
    }
  }

  if (settlingTimeS === null) {
    pushWarning(warnings, 'Settling time could not be determined within the selected segment.');
  }

  return {
    overshootPercent,
    settlingTimeS,
  };
}

function estimatePhaseDelayMs(setpointValues, actualValues, dt, warnings) {
  if (setpointValues.length < 8 || actualValues.length < 8) {
    pushWarning(warnings, 'Not enough samples to estimate phase delay.');
    return null;
  }

  const setpointMean = mean(setpointValues) ?? 0;
  const actualMean = mean(actualValues) ?? 0;
  const normalizedSetpoint = setpointValues.map((value) => value - setpointMean);
  const normalizedActual = actualValues.map((value) => value - actualMean);

  const setpointEnergy = normalizedSetpoint.reduce(
    (sum, value) => sum + value ** 2,
    0,
  );
  const actualEnergy = normalizedActual.reduce((sum, value) => sum + value ** 2, 0);
  if (setpointEnergy <= EPSILON || actualEnergy <= EPSILON) {
    pushWarning(warnings, 'Signals do not vary enough to estimate phase delay.');
    return null;
  }

  const maxLag = Math.min(50, Math.floor(setpointValues.length / 4));
  let bestLag = 0;
  let bestCorrelation = -Infinity;

  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    let cross = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;
    let sampleCount = 0;

    for (let index = 0; index < normalizedSetpoint.length; index += 1) {
      const actualIndex = index + lag;
      if (actualIndex < 0 || actualIndex >= normalizedActual.length) continue;

      const left = normalizedSetpoint[index];
      const right = normalizedActual[actualIndex];
      cross += left * right;
      leftEnergy += left ** 2;
      rightEnergy += right ** 2;
      sampleCount += 1;
    }

    if (sampleCount < 4 || leftEnergy <= EPSILON || rightEnergy <= EPSILON) {
      continue;
    }

    const correlation = cross / Math.sqrt(leftEnergy * rightEnergy);
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }

  if (!Number.isFinite(bestCorrelation)) {
    pushWarning(warnings, 'Phase delay estimate is unavailable for the selected data.');
    return null;
  }

  return bestLag * dt * 1000;
}

function estimateOscillationMetrics(errorValues, dt, warnings) {
  if (errorValues.length < 8 || !Number.isFinite(dt) || dt <= EPSILON) {
    pushWarning(warnings, 'Not enough samples to estimate dominant oscillation frequency.');
    return {
      dominantOscillationHz: null,
      oscillationScore: 0,
    };
  }

  const meanError = mean(errorValues) ?? 0;
  const centered = errorValues.map((value) => value - meanError);
  const halfSpectrum = Math.floor(centered.length / 2);

  let dominantFrequencyHz = null;
  let dominantEnergy = 0;
  let totalEnergy = 0;

  for (let harmonic = 1; harmonic <= halfSpectrum; harmonic += 1) {
    let real = 0;
    let imaginary = 0;

    for (let index = 0; index < centered.length; index += 1) {
      const angle = (2 * Math.PI * harmonic * index) / centered.length;
      real += centered[index] * Math.cos(angle);
      imaginary -= centered[index] * Math.sin(angle);
    }

    const energy = real ** 2 + imaginary ** 2;
    if (!Number.isFinite(energy)) continue;

    totalEnergy += energy;
    if (energy > dominantEnergy) {
      dominantEnergy = energy;
      dominantFrequencyHz = harmonic / (centered.length * dt);
    }
  }

  if (totalEnergy <= EPSILON || !Number.isFinite(dominantEnergy)) {
    return {
      dominantOscillationHz: null,
      oscillationScore: 0,
    };
  }

  return {
    dominantOscillationHz: dominantFrequencyHz,
    oscillationScore: dominantEnergy / totalEnergy,
  };
}

function estimateActuatorMetrics(actuatorSeries, startS, endS, warnings) {
  if (!actuatorSeries.length) {
    pushWarning(warnings, 'Actuator output data is unavailable for saturation analysis.');
    return {
      actuatorSaturationRatio: null,
      motorClippingDurationS: null,
    };
  }

  let totalSampleCount = 0;
  let saturatedSampleCount = 0;

  for (const series of actuatorSeries) {
    const points = series.points.filter(
      ([timeS]) => timeS >= startS && timeS <= endS,
    );
    if (points.length < 3) continue;

    const values = points.map((point) => point[1]);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const span = maxValue - minValue;
    if (!Number.isFinite(span) || span <= EPSILON) continue;

    const threshold = span * 0.01;
    for (const value of values) {
      totalSampleCount += 1;
      if (value <= minValue + threshold || value >= maxValue - threshold) {
        saturatedSampleCount += 1;
      }
    }
  }

  if (!totalSampleCount) {
    pushWarning(warnings, 'Actuator output data is insufficient for saturation analysis.');
    return {
      actuatorSaturationRatio: null,
      motorClippingDurationS: null,
    };
  }

  const ratio = saturatedSampleCount / totalSampleCount;
  const durationS = ratio * Math.max(endS - startS, 0);

  return {
    actuatorSaturationRatio: ratio,
    motorClippingDurationS: durationS,
  };
}

function sanitizeMetrics(metrics) {
  return {
    trackingErrorRms: toFiniteNumber(metrics.trackingErrorRms, 0),
    trackingErrorPeak: toFiniteNumber(metrics.trackingErrorPeak, 0),
    overshootPercent: toFiniteNumber(metrics.overshootPercent, null),
    settlingTimeS: toFiniteNumber(metrics.settlingTimeS, null),
    phaseDelayMs: toFiniteNumber(metrics.phaseDelayMs, null),
    dominantOscillationHz: toFiniteNumber(metrics.dominantOscillationHz, null),
    oscillationScore: toFiniteNumber(metrics.oscillationScore, 0),
    actuatorSaturationRatio: toFiniteNumber(metrics.actuatorSaturationRatio, null),
    motorClippingDurationS: toFiniteNumber(metrics.motorClippingDurationS, null),
  };
}

function computeTuningMetricsFromTopicCharts(topicCharts, request) {
  const axis = VALID_TUNING_AXES.includes(request?.axis) ? request.axis : 'roll';
  const loop = VALID_TUNING_LOOPS.includes(request?.loop) ? request.loop : 'rate';
  const warnings = [];
  const metrics = createEmptyMetrics();
  const config = SERIES_LOOKUP[loop];

  const setpointPoints = findSeriesPoints(
    topicCharts,
    config.setpointTopicCandidates,
    config.setpointSeriesByAxis[axis],
  );
  const actualPoints = findSeriesPoints(
    topicCharts,
    config.actualTopicCandidates,
    config.actualSeriesByAxis[axis],
  );

  if (!setpointPoints.length) {
    pushWarning(warnings, `Setpoint series for ${axis} ${loop} loop was not found.`);
  }
  if (!actualPoints.length) {
    pushWarning(warnings, `Actual series for ${axis} ${loop} loop was not found.`);
  }

  if (!setpointPoints.length || !actualPoints.length) {
    return {
      axis,
      loop,
      metrics: sanitizeMetrics(metrics),
      warnings,
    };
  }

  const window = resolveAnalysisWindow(
    setpointPoints,
    actualPoints,
    request?.segment,
    warnings,
  );
  if (!window) {
    return {
      axis,
      loop,
      metrics: sanitizeMetrics(metrics),
      warnings,
    };
  }

  const aligned = alignSeriesToSetpoint(
    setpointPoints,
    actualPoints,
    window.start,
    window.end,
  );

  if (aligned.times.length < 2) {
    pushWarning(warnings, 'Not enough aligned samples to compute tuning metrics.');
    return {
      axis,
      loop,
      metrics: sanitizeMetrics(metrics),
      warnings,
    };
  }

  const trackingMetrics = computeTrackingMetrics(
    aligned.setpointValues,
    aligned.actualValues,
  );
  metrics.trackingErrorRms = trackingMetrics.trackingErrorRms;
  metrics.trackingErrorPeak = trackingMetrics.trackingErrorPeak;

  const stepMetrics = estimateStepResponseMetrics(
    aligned.times,
    aligned.setpointValues,
    aligned.actualValues,
    warnings,
  );
  metrics.overshootPercent = stepMetrics.overshootPercent;
  metrics.settlingTimeS = stepMetrics.settlingTimeS;

  const uniformSamples = buildUniformSamples(
    setpointPoints,
    actualPoints,
    window.start,
    window.end,
    warnings,
  );

  if (uniformSamples) {
    metrics.phaseDelayMs = estimatePhaseDelayMs(
      uniformSamples.setpointValues,
      uniformSamples.actualValues,
      uniformSamples.dt,
      warnings,
    );

    const uniformErrors = uniformSamples.setpointValues.map(
      (value, index) => value - uniformSamples.actualValues[index],
    );
    const oscillationMetrics = estimateOscillationMetrics(
      uniformErrors,
      uniformSamples.dt,
      warnings,
    );
    metrics.dominantOscillationHz = oscillationMetrics.dominantOscillationHz;
    metrics.oscillationScore = oscillationMetrics.oscillationScore;
  }

  const actuatorMetrics = estimateActuatorMetrics(
    collectActuatorSeries(topicCharts),
    window.start,
    window.end,
    warnings,
  );
  metrics.actuatorSaturationRatio = actuatorMetrics.actuatorSaturationRatio;
  metrics.motorClippingDurationS = actuatorMetrics.motorClippingDurationS;

  return {
    axis,
    loop,
    metrics: sanitizeMetrics(metrics),
    warnings,
  };
}

function computeTuningMetrics(parsedLog, request) {
  return computeTuningMetricsFromTopicCharts(parsedLog?.topicCharts, request);
}

module.exports = {
  VALID_TUNING_AXES,
  VALID_TUNING_LOOPS,
  computeTuningMetrics,
  computeTuningMetricsFromTopicCharts,
};
