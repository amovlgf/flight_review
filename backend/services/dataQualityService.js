const QUALITY_ORDER = ['complete', 'partial', 'insufficient', 'invalid'];

function isSignalAvailable(signals, id) {
  return Array.isArray(signals?.[id]?.points) && signals[id].points.length > 0;
}

function makeRule(code, level, message) {
  return { code, level, message };
}

function pickWorstLevel(ruleResults) {
  for (const level of QUALITY_ORDER.slice().reverse()) {
    if (ruleResults.some((item) => item.level === level)) {
      return level;
    }
  }
  return 'complete';
}

function buildAnalysisCapability(signals, dataQualityLevel) {
  const reasons = [];
  const timeline = dataQualityLevel !== 'invalid' && isSignalAvailable(signals, 'log.timeS');
  const phaseDetection =
    timeline &&
    isSignalAvailable(signals, 'vehicle.armed') &&
    isSignalAvailable(signals, 'vehicle.landed');
  const eventExtraction =
    timeline &&
    (isSignalAvailable(signals, 'vehicle.navState') ||
      isSignalAvailable(signals, 'vehicle.failsafe'));

  const capabilityChecks = [
    ['phaseDetection', phaseDetection, 'vehicle.armed or vehicle.landed missing'],
    ['eventExtraction', eventExtraction, 'vehicle.navState or vehicle.failsafe missing'],
    ['batteryAnalysis', isSignalAvailable(signals, 'battery.voltage'), 'battery.voltage missing'],
    ['estimatorAnalysis', isSignalAvailable(signals, 'estimator.flags'), 'estimator.flags missing'],
  ];

  for (const [, available, reason] of capabilityChecks) {
    if (!available) reasons.push(reason);
  }

  return {
    timeline,
    phaseDetection,
    eventExtraction,
    attitudeAnalysis: false,
    rateAnalysis: false,
    actuatorAnalysis: false,
    batteryAnalysis: isSignalAvailable(signals, 'battery.voltage'),
    estimatorAnalysis: isSignalAvailable(signals, 'estimator.flags'),
    reasons,
  };
}

function evaluateDataQuality({ signals, parserFailed = false, parseError = null }) {
  const ruleResults = [];

  if (parserFailed) {
    ruleResults.push(makeRule('DQ_PARSE_FAILED', 'invalid', 'ULog parsing failed.'));
  }

  if (!isSignalAvailable(signals, 'log.timeS')) {
    ruleResults.push(makeRule('DQ_MISSING_TIME_AXIS', 'invalid', 'Log has no usable time axis.'));
  }

  if (!isSignalAvailable(signals, 'vehicle.armed')) {
    ruleResults.push(makeRule('DQ_MISSING_ARM_STATE', 'insufficient', 'Cannot determine armed state.'));
  }

  if (!isSignalAvailable(signals, 'vehicle.landed')) {
    ruleResults.push(
      makeRule('DQ_MISSING_LANDED_STATE', 'insufficient', 'Cannot determine basic flight phases.'),
    );
  }

  const timePoints = signals?.['log.timeS']?.points || [];
  if (timePoints.length >= 2) {
    const durationS = timePoints[timePoints.length - 1][0] - timePoints[0][0];
    if (durationS < 5) {
      ruleResults.push(makeRule('DQ_SHORT_LOG', 'insufficient', 'Log duration is shorter than 5 seconds.'));
    }
  }

  if (!isSignalAvailable(signals, 'vehicle.navState')) {
    ruleResults.push(makeRule('DQ_MISSING_NAV_STATE', 'partial', 'Navigation mode timeline is unavailable.'));
  }

  if (!isSignalAvailable(signals, 'battery.voltage')) {
    ruleResults.push(
      makeRule('DQ_MISSING_OPTIONAL_BATTERY', 'partial', 'Battery voltage data is unavailable.'),
    );
  }

  if (!isSignalAvailable(signals, 'estimator.flags')) {
    ruleResults.push(
      makeRule('DQ_MISSING_OPTIONAL_ESTIMATOR', 'partial', 'Estimator status data is unavailable.'),
    );
  }

  const level = pickWorstLevel(ruleResults);
  const dataQuality = {
    level,
    rules: ruleResults,
    parser: {
      success: !parserFailed,
      error: parseError ? String(parseError.message || parseError) : null,
    },
  };

  return {
    dataQuality,
    analysisCapability: buildAnalysisCapability(signals, level),
  };
}

module.exports = {
  evaluateDataQuality,
};
