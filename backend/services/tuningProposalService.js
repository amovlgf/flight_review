const {
  VALID_TUNING_AXES,
  VALID_TUNING_LOOPS,
} = require('./tuningMetricsService');

const GAIN_KEYS = ['p', 'i', 'd'];
const EPSILON = 1e-9;
const DEFAULT_STEP_PERCENT = 5;
const ACTUATOR_SATURATION_REJECTION_THRESHOLD = 0.05;

const PARAMETER_NAME_MAP = {
  rate: {
    roll: {
      p: 'MC_ROLLRATE_P',
      i: 'MC_ROLLRATE_I',
      d: 'MC_ROLLRATE_D',
    },
    pitch: {
      p: 'MC_PITCHRATE_P',
      i: 'MC_PITCHRATE_I',
      d: 'MC_PITCHRATE_D',
    },
    yaw: {
      p: 'MC_YAWRATE_P',
      i: 'MC_YAWRATE_I',
      d: 'MC_YAWRATE_D',
    },
  },
  attitude: {
    roll: {
      p: 'MC_ROLL_P',
      i: null,
      d: null,
    },
    pitch: {
      p: 'MC_PITCH_P',
      i: null,
      d: null,
    },
    yaw: {
      p: 'MC_YAW_P',
      i: null,
      d: null,
    },
  },
};

function toFiniteNumber(value, fallback = null) {
  return Number.isFinite(value) ? value : fallback;
}

function roundFiniteNumber(value) {
  if (!Number.isFinite(value)) return null;
  return Number.parseFloat(value.toFixed(12));
}

function pushWarning(warnings, message) {
  if (!warnings.includes(message)) {
    warnings.push(message);
  }
}

function getParameterNames(axis, loop) {
  return PARAMETER_NAME_MAP?.[loop]?.[axis] ?? PARAMETER_NAME_MAP.rate.roll;
}

function parseNumericValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCurrentParams(currentParams) {
  const normalized = {};

  for (const key of GAIN_KEYS) {
    const parsedValue = parseNumericValue(currentParams?.[key]);
    if (parsedValue === null) {
      return null;
    }
    normalized[key] = parsedValue;
  }

  return normalized;
}

function parseBounds(bounds) {
  const normalized = {};

  for (const key of GAIN_KEYS) {
    const bound = bounds?.[key];
    const min = parseNumericValue(bound?.min);
    const max = parseNumericValue(bound?.max);
    const maxStepPercent = parseNumericValue(bound?.maxStepPercent);

    if (
      min === null ||
      max === null ||
      maxStepPercent === null ||
      max < min ||
      maxStepPercent < 0
    ) {
      return null;
    }

    normalized[key] = {
      min,
      max,
      maxStepPercent,
    };
  }

  return normalized;
}

function sanitizeMetrics(metrics) {
  return {
    trackingErrorRms: toFiniteNumber(metrics?.trackingErrorRms, null),
    trackingErrorPeak: toFiniteNumber(metrics?.trackingErrorPeak, null),
    overshootPercent: toFiniteNumber(metrics?.overshootPercent, null),
    settlingTimeS: toFiniteNumber(metrics?.settlingTimeS, null),
    phaseDelayMs: toFiniteNumber(metrics?.phaseDelayMs, null),
    dominantOscillationHz: toFiniteNumber(metrics?.dominantOscillationHz, null),
    oscillationScore: toFiniteNumber(metrics?.oscillationScore, null),
    actuatorSaturationRatio: toFiniteNumber(metrics?.actuatorSaturationRatio, null),
    motorClippingDurationS: toFiniteNumber(metrics?.motorClippingDurationS, null),
  };
}

function buildBaseResponse(axis, loop) {
  return {
    status: 'no_change',
    axis,
    loop,
    parameterNames: getParameterNames(axis, loop),
    changes: [],
    unchanged: [],
    warnings: [],
  };
}

function buildUnchangedEntry(key, parameter, value, reason) {
  return {
    key,
    parameter,
    value: roundFiniteNumber(value),
    reason,
  };
}

function buildChangeEntry({
  key,
  parameter,
  from,
  to,
  changePercent,
  reasonCode,
  reason,
}) {
  return {
    key,
    parameter,
    from: roundFiniteNumber(from),
    to: roundFiniteNumber(to),
    changePercent: roundFiniteNumber(changePercent),
    reasonCode,
    reason,
  };
}

function buildUnchangedForAllKeys(parameterNames, currentParams, reasonsByKey) {
  return GAIN_KEYS.filter((key) => parameterNames[key]).map((key) =>
    buildUnchangedEntry(
      key,
      parameterNames[key],
      currentParams[key],
      reasonsByKey[key],
    ),
  );
}

function applyBoundedPercentChange(currentValue, bound, requestedPercent) {
  if (!Number.isFinite(currentValue) || !bound) {
    return null;
  }

  const cappedPercentMagnitude = Math.min(
    Math.abs(requestedPercent),
    Math.abs(bound.maxStepPercent),
  );
  const effectivePercent = Math.sign(requestedPercent) * cappedPercentMagnitude;
  const requestedTarget = currentValue * (1 + effectivePercent / 100);
  const boundedTarget = Math.min(bound.max, Math.max(bound.min, requestedTarget));
  const actualChange = boundedTarget - currentValue;

  if (Math.abs(actualChange) <= EPSILON) {
    return null;
  }

  const actualChangePercent =
    Math.abs(currentValue) <= EPSILON
      ? 0
      : (actualChange / currentValue) * 100;

  if (!Number.isFinite(actualChangePercent)) {
    return null;
  }

  if (Math.abs(actualChangePercent) - bound.maxStepPercent > 1e-6) {
    return null;
  }

  return {
    to: boundedTarget,
    changePercent: actualChangePercent,
  };
}

function proposeTuningChanges(request) {
  const axis = VALID_TUNING_AXES.includes(request?.axis) ? request.axis : 'roll';
  const loop = VALID_TUNING_LOOPS.includes(request?.loop) ? request.loop : 'rate';
  const response = buildBaseResponse(axis, loop);
  const currentParams = parseCurrentParams(request?.currentParams);
  const bounds = parseBounds(request?.bounds);
  const metrics = sanitizeMetrics(request?.metrics);

  if (!currentParams || !bounds) {
    response.status = 'rejected';
    pushWarning(
      response.warnings,
      'Current PID parameters or bounds are invalid; conservative proposal generation was skipped.',
    );
    return response;
  }

  if (loop === 'attitude') {
    response.status = 'no_change';
    pushWarning(
      response.warnings,
      'attitude loop 暂仅支持指标分析，不生成自动参数建议。',
    );
    response.unchanged = buildUnchangedForAllKeys(response.parameterNames, currentParams, {
      p: 'Attitude-loop proposals are disabled in the current version.',
      i: 'Attitude-loop proposals are disabled in the current version.',
      d: 'Attitude-loop proposals are disabled in the current version.',
    });
    return response;
  }

  if (
    metrics.actuatorSaturationRatio !== null &&
    metrics.actuatorSaturationRatio > ACTUATOR_SATURATION_REJECTION_THRESHOLD
  ) {
    response.status = 'rejected';
    pushWarning(
      response.warnings,
      'Actuator saturation ratio is high; conservative rules block PID gain increases.',
    );
    response.unchanged = buildUnchangedForAllKeys(response.parameterNames, currentParams, {
      p: 'Proposal rejected because actuator saturation is already elevated.',
      i: 'Proposal rejected because actuator saturation is already elevated.',
      d: 'Proposal rejected because actuator saturation is already elevated.',
    });
    return response;
  }

  const reasonsByKey = {
    p: 'No strong evidence for changing P.',
    i: 'No strong evidence for changing I.',
    d: 'No strong evidence for changing D.',
  };
  const proposedChanges = new Map();

  function maybeApplyChange(key, requestedPercent, reasonCode, reason) {
    const parameter = response.parameterNames[key];
    if (!parameter) return;

    const boundedChange = applyBoundedPercentChange(
      currentParams[key],
      bounds[key],
      requestedPercent,
    );

    if (!boundedChange) {
      reasonsByKey[key] = `No change applied because ${parameter} is already constrained by bounds.`;
      return;
    }

    proposedChanges.set(
      key,
      buildChangeEntry({
        key,
        parameter,
        from: currentParams[key],
        to: boundedChange.to,
        changePercent: boundedChange.changePercent,
        reasonCode,
        reason,
      }),
    );
  }

  if (metrics.oscillationScore !== null && metrics.oscillationScore > 0.6) {
    maybeApplyChange(
      'p',
      -DEFAULT_STEP_PERCENT,
      'HIGH_OSCILLATION',
      'Oscillation score is high, reduce P conservatively.',
    );
    maybeApplyChange(
      'd',
      -DEFAULT_STEP_PERCENT,
      'HIGH_OSCILLATION',
      'Oscillation score is high, reduce D conservatively.',
    );
  } else {
    if (metrics.overshootPercent !== null && metrics.overshootPercent > 20) {
      maybeApplyChange(
        'p',
        -DEFAULT_STEP_PERCENT,
        'HIGH_OVERSHOOT',
        'Overshoot is high, reduce P conservatively.',
      );

      if (
        metrics.oscillationScore !== null &&
        metrics.oscillationScore < 0.4
      ) {
        maybeApplyChange(
          'd',
          DEFAULT_STEP_PERCENT,
          'ADD_DAMPING_AFTER_OVERSHOOT',
          'Overshoot is high and oscillation is still controlled, increase D conservatively.',
        );
      }
    }

    if (
      metrics.trackingErrorRms !== null &&
      metrics.trackingErrorRms > 0.2 &&
      metrics.phaseDelayMs !== null &&
      metrics.phaseDelayMs > 100 &&
      metrics.oscillationScore !== null &&
      metrics.oscillationScore < 0.3 &&
      !proposedChanges.has('p')
    ) {
      maybeApplyChange(
        'p',
        DEFAULT_STEP_PERCENT,
        'HIGH_TRACKING_ERROR_PHASE_DELAY',
        'Tracking error and phase delay are high while oscillation remains low, increase P conservatively.',
      );
    }
  }

  response.changes = GAIN_KEYS.filter((key) => proposedChanges.has(key)).map((key) =>
    proposedChanges.get(key),
  );
  response.unchanged = GAIN_KEYS.filter((key) => !proposedChanges.has(key) && response.parameterNames[key])
    .map((key) =>
      buildUnchangedEntry(
        key,
        response.parameterNames[key],
        currentParams[key],
        reasonsByKey[key],
      ),
    );

  response.status = response.changes.length ? 'proposal_generated' : 'no_change';

  return response;
}

module.exports = {
  ACTUATOR_SATURATION_REJECTION_THRESHOLD,
  getParameterNames,
  proposeTuningChanges,
};
