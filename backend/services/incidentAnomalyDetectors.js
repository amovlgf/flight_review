const MIN_FLAG_DURATION_S = 0.5;
const AIRBORNE_END_ALTITUDE_M = 1;
const BATTERY_VOLTAGE_DROP_RATIO = 0.7;

function roundTime(value) {
  return Number(Number(value).toFixed(3));
}

function pointsFor(signals, id) {
  return Array.isArray(signals?.[id]?.points) ? signals[id].points : [];
}

function hasSignal(signals, id) {
  return pointsFor(signals, id).length > 0;
}

function signalSource(signals, id) {
  const signal = signals?.[id];
  if (!signal) return null;
  return {
    topic: signal.topic,
    instance: signal.instance,
    field: signal.field,
  };
}

function valueAtOrBefore(points, timeS) {
  if (!Array.isArray(points) || points.length === 0) return null;
  let value = null;
  for (const point of points) {
    if (Number(point[0]) > timeS) break;
    value = point[1];
  }
  return value;
}

function lastPoint(points) {
  return Array.isArray(points) && points.length > 0 ? points[points.length - 1] : null;
}

function activeIntervals(points, minDurationS = MIN_FLAG_DURATION_S) {
  if (!Array.isArray(points) || points.length === 0) return [];

  const intervals = [];
  let active = Number(points[0][1]) > 0.5;
  let startS = active ? Number(points[0][0]) : null;

  for (let index = 1; index < points.length; index += 1) {
    const timeS = Number(points[index][0]);
    const current = Number(points[index][1]) > 0.5;
    if (!Number.isFinite(timeS) || current === active) continue;

    if (current) {
      startS = timeS;
    } else if (startS !== null) {
      const durationS = timeS - startS;
      if (durationS >= minDurationS) {
        intervals.push({ startS: roundTime(startS), endS: roundTime(timeS) });
      }
      startS = null;
    }
    active = current;
  }

  if (active && startS !== null) {
    const lastTimeS = Number(points[points.length - 1][0]);
    if (Number.isFinite(lastTimeS) && lastTimeS - startS >= minDurationS) {
      intervals.push({ startS: roundTime(startS), endS: roundTime(lastTimeS) });
    }
  }

  return intervals;
}

function makeThreshold(id, source, comparator, value) {
  return { id, source, comparator, value };
}

function makeFinding({
  detectorId,
  category,
  severity = 'warning',
  title,
  summary,
  startTimeS,
  endTimeS,
  evidenceSignals,
  sourceSignal,
  thresholds,
  missingSignals = [],
  limitations = [],
}) {
  const safeStartS = roundTime(startTimeS);
  const safeEndS = endTimeS === null ? null : roundTime(endTimeS);

  return {
    id: `${detectorId}_${safeStartS}`,
    detectorId,
    category,
    severity,
    title,
    summary,
    startTimeS: safeStartS,
    endTimeS: safeEndS,
    confidence: 'confirmed',
    evidenceSignals,
    missingSignals,
    source: sourceSignal ? signalSource(sourceSignal.signals, sourceSignal.id) : null,
    thresholds,
    evidenceLinks: [],
    limitations: [
      ...limitations,
      'This is an anomaly-phenomenon finding only, not a root-cause or hardware-fault conclusion.',
    ],
  };
}

function makeDetectorResult({
  id,
  category,
  version,
  status,
  severity = 'info',
  title,
  summary,
  evidenceSignals = [],
  missingSignals = [],
  thresholds = [],
  findings = [],
  limitations = [],
}) {
  return {
    id,
    category,
    version,
    status,
    severity,
    title,
    summary,
    evidenceSignals,
    missingSignals,
    thresholds,
    findings,
    limitations,
  };
}

function detectRequiredSignalsOnly({
  id,
  category,
  version,
  title,
  requiredSignals,
  signals,
  unavailableSummary,
}) {
  const missingSignals = requiredSignals.filter((signalId) => !hasSignal(signals, signalId));

  return makeDetectorResult({
    id,
    category,
    version,
    status: missingSignals.length > 0 ? 'unavailable' : 'not_triggered',
    title,
    summary:
      missingSignals.length > 0
        ? unavailableSummary
        : 'Required signals are mapped; no confirmed anomaly rule is enabled for this detector yet.',
    evidenceSignals: requiredSignals.filter((signalId) => !missingSignals.includes(signalId)),
    missingSignals,
    limitations:
      missingSignals.length > 0
        ? ['No anomaly is inferred from missing standard signals.']
        : ['Detector is wired for V2 but still conservative until validated with annotated samples.'],
  });
}

function detectLoggedFlags({
  id,
  category,
  version,
  title,
  signalSpecs,
  signals,
  unavailableSummary,
}) {
  const findings = [];
  const evidenceSignals = [];
  const missingSignals = [];

  signalSpecs.forEach((spec) => {
    const points = pointsFor(signals, spec.signalId);
    if (points.length === 0) {
      missingSignals.push(spec.signalId);
      return;
    }

    evidenceSignals.push(spec.signalId);
    activeIntervals(points, spec.minDurationS ?? MIN_FLAG_DURATION_S).forEach((interval) => {
      findings.push(
        makeFinding({
          detectorId: id,
          category,
          severity: spec.severity || 'warning',
          title: spec.title,
          summary: spec.summary,
          startTimeS: interval.startS,
          endTimeS: interval.endS,
          evidenceSignals: [spec.signalId],
          sourceSignal: { signals, id: spec.signalId },
          thresholds: [makeThreshold(`${spec.signalId}.active`, 'logged_flag', '> 0.5', 0.5)],
          missingSignals,
          limitations: spec.limitations || [],
        }),
      );
    });
  });

  if (evidenceSignals.length === 0) {
    return makeDetectorResult({
      id,
      category,
      version,
      status: 'unavailable',
      title,
      summary: unavailableSummary,
      missingSignals,
      limitations: ['No anomaly is inferred from missing optional signals.'],
    });
  }

  return makeDetectorResult({
    id,
    category,
    version,
    status: findings.length > 0 ? 'triggered' : 'not_triggered',
    severity: findings.length > 0 ? 'warning' : 'info',
    title,
    summary:
      findings.length > 0
        ? `${findings.length} confirmed logged flag window(s) recorded.`
        : 'Mapped logged flags did not remain active beyond the suppression window.',
    evidenceSignals,
    missingSignals,
    thresholds: evidenceSignals.map((signalId) =>
      makeThreshold(`${signalId}.active`, 'logged_flag', '> 0.5', 0.5),
    ),
    findings,
    limitations: ['Logged flags identify anomaly phenomena only. They do not identify a failed component.'],
  });
}

function detectEstimatorAndGps(signals) {
  return detectLoggedFlags({
    signals,
    id: 'estimator_gps_logged_flags',
    category: 'estimator',
    version: 'v2.3',
    title: 'EKF/GPS explicit anomaly flags',
    unavailableSummary: 'Estimator/GPS explicit anomaly flags are not mapped in this log.',
    signalSpecs: [
      {
        signalId: 'estimator.csMagFault',
        title: 'Estimator magnetic fault flag recorded',
        summary: 'PX4 estimator status reported the magnetic-fault control flag as active.',
      },
      {
        signalId: 'failsafeFlag.localPosition',
        title: 'Local-position failsafe flag recorded',
        summary: 'PX4 failsafe flags reported local-position invalid or low-accuracy state.',
      },
      {
        signalId: 'failsafeFlag.globalPosition',
        title: 'Global-position failsafe flag recorded',
        summary: 'PX4 failsafe flags reported global-position invalid state.',
      },
    ],
  });
}

function detectBattery(signals) {
  const flagResult = detectLoggedFlags({
    signals,
    id: 'battery_logged_flags',
    category: 'battery',
    version: 'v2.4',
    title: 'Battery explicit warning flags',
    unavailableSummary: 'Battery warning flags are not mapped in this log.',
    signalSpecs: [
      {
        signalId: 'failsafeFlag.batteryWarning',
        title: 'Battery failsafe warning flag recorded',
        summary: 'PX4 failsafe flags reported a battery-warning state.',
      },
    ],
  });

  const voltagePoints = pointsFor(signals, 'battery.voltage');
  const voltageFindings = [];
  const thresholds = [
    makeThreshold('battery.voltage.dropRatio', 'adaptive', `<= ${BATTERY_VOLTAGE_DROP_RATIO}`, BATTERY_VOLTAGE_DROP_RATIO),
  ];

  if (voltagePoints.length >= 2) {
    let maxPoint = voltagePoints[0];
    let minAfterMax = null;

    voltagePoints.forEach((point) => {
      if (Number(point[1]) > Number(maxPoint[1])) {
        maxPoint = point;
        minAfterMax = null;
      } else if (Number(point[0]) >= Number(maxPoint[0])) {
        if (!minAfterMax || Number(point[1]) < Number(minAfterMax[1])) {
          minAfterMax = point;
        }
      }
    });

    if (
      minAfterMax &&
      Number(maxPoint[1]) > 5 &&
      Number(minAfterMax[1]) <= Number(maxPoint[1]) * BATTERY_VOLTAGE_DROP_RATIO
    ) {
      voltageFindings.push(
        makeFinding({
          detectorId: 'battery_voltage_drop',
          category: 'battery',
          title: 'Large battery voltage drop recorded',
          summary: `Battery voltage dropped from ${Number(maxPoint[1]).toFixed(2)} V to ${Number(minAfterMax[1]).toFixed(2)} V.`,
          startTimeS: Number(maxPoint[0]),
          endTimeS: Number(minAfterMax[0]),
          evidenceSignals: ['battery.voltage'],
          sourceSignal: { signals, id: 'battery.voltage' },
          thresholds,
          limitations: ['Adaptive voltage drop does not know battery cell count and must be reviewed with current/load context.'],
        }),
      );
    }
  }

  const voltageResult = makeDetectorResult({
    id: 'battery_voltage_drop',
    category: 'battery',
    version: 'v2.4',
    status: voltagePoints.length === 0 ? 'unavailable' : voltageFindings.length > 0 ? 'triggered' : 'not_triggered',
    severity: voltageFindings.length > 0 ? 'warning' : 'info',
    title: 'Battery voltage abnormal drop',
    summary:
      voltagePoints.length === 0
        ? 'Battery voltage is not mapped in this log.'
        : voltageFindings.length > 0
          ? 'A large adaptive voltage drop was recorded.'
          : 'No large adaptive voltage drop was recorded.',
    evidenceSignals: voltagePoints.length > 0 ? ['battery.voltage'] : [],
    missingSignals: voltagePoints.length > 0 ? [] : ['battery.voltage'],
    thresholds,
    findings: voltageFindings,
    limitations: ['This detector reports a voltage-drop phenomenon only and does not infer battery health.'],
  });

  return [flagResult, voltageResult];
}

function detectFailsafeAndAirborneEnd(signals) {
  const failsafeResult = detectLoggedFlags({
    signals,
    id: 'failsafe_state',
    category: 'safety',
    version: 'v2.5',
    title: 'Failsafe state windows',
    unavailableSummary: 'Vehicle failsafe state is not mapped in this log.',
    signalSpecs: [
      {
        signalId: 'vehicle.failsafe',
        title: 'Failsafe state recorded',
        summary: 'PX4 vehicle_status.failsafe remained active beyond the suppression window.',
      },
    ],
  });

  const timePoints = pointsFor(signals, 'log.timeS');
  const lastTime = lastPoint(timePoints)?.[0];
  const landedPoints = pointsFor(signals, 'vehicle.landed');
  const armedPoints = pointsFor(signals, 'vehicle.armed');
  const altitudePoints = pointsFor(signals, 'position.altitudeRelative');
  const findings = [];
  const missingSignals = ['log.timeS', 'vehicle.landed', 'vehicle.armed'].filter((signalId) => !hasSignal(signals, signalId));

  if (Number.isFinite(Number(lastTime)) && landedPoints.length > 0) {
    const landed = Number(valueAtOrBefore(landedPoints, Number(lastTime))) > 0.5;
    const armed = armedPoints.length > 0 ? Number(valueAtOrBefore(armedPoints, Number(lastTime))) > 0.5 : false;
    const altitude = altitudePoints.length > 0 ? Number(valueAtOrBefore(altitudePoints, Number(lastTime))) : null;

    if (!landed && (armed || (Number.isFinite(altitude) && altitude > AIRBORNE_END_ALTITUDE_M))) {
      findings.push(
        makeFinding({
          detectorId: 'airborne_log_end',
          category: 'safety',
          title: 'Log ended while airborne suspected',
          summary: 'Final landed state is false and the log ended while armed or above the conservative altitude threshold.',
          startTimeS: Number(lastTime),
          endTimeS: Number(lastTime),
          evidenceSignals: [
            'vehicle.landed',
            ...(armedPoints.length > 0 ? ['vehicle.armed'] : []),
            ...(altitudePoints.length > 0 ? ['position.altitudeRelative'] : []),
          ],
          sourceSignal: { signals, id: 'vehicle.landed' },
          thresholds: [
            makeThreshold('vehicle.landed.final', 'logged_state', '<= 0.5', 0.5),
            makeThreshold('position.altitudeRelative.airborneEnd', 'static', '>', AIRBORNE_END_ALTITUDE_M),
          ],
          missingSignals,
          limitations: ['This is a suspected state at log end, not an accident-cause conclusion.'],
        }),
      );
    }
  }

  const airborneResult = makeDetectorResult({
    id: 'airborne_log_end',
    category: 'safety',
    version: 'v2.5',
    status: missingSignals.includes('log.timeS') || missingSignals.includes('vehicle.landed')
      ? 'unavailable'
      : findings.length > 0
        ? 'triggered'
        : 'not_triggered',
    severity: findings.length > 0 ? 'warning' : 'info',
    title: 'Airborne log-end risk',
    summary:
      findings.length > 0
        ? 'The log ended in a conservative suspected airborne state.'
        : 'The log end did not meet the conservative airborne-end rule.',
    evidenceSignals: ['vehicle.landed', 'vehicle.armed', 'position.altitudeRelative'].filter((signalId) =>
      hasSignal(signals, signalId),
    ),
    missingSignals,
    thresholds: [
      makeThreshold('vehicle.landed.final', 'logged_state', '<= 0.5', 0.5),
      makeThreshold('position.altitudeRelative.airborneEnd', 'static', '>', AIRBORNE_END_ALTITUDE_M),
    ],
    findings,
    limitations: ['This detector reports state at log end only. It does not infer why the log ended.'],
  });

  return [failsafeResult, airborneResult];
}

function getIncidentAnomalyDetectors() {
  return [
    {
      id: 'attitude_tracking_error',
      run: ({ signals }) =>
        detectRequiredSignalsOnly({
          id: 'attitude_tracking_error',
          category: 'attitude',
          version: 'v2.1',
          title: 'Attitude tracking error',
          requiredSignals: ['attitude.setpoint.roll/pitch/yaw', 'attitude.actual.roll/pitch/yaw'],
          signals,
          unavailableSummary: 'Attitude setpoint/actual standard signals are not mapped yet.',
        }),
    },
    {
      id: 'rate_tracking_error',
      run: ({ signals }) =>
        detectRequiredSignalsOnly({
          id: 'rate_tracking_error',
          category: 'rate',
          version: 'v2.1',
          title: 'Angular-rate tracking error',
          requiredSignals: ['rate.setpoint.roll/pitch/yaw', 'rate.actual.roll/pitch/yaw'],
          signals,
          unavailableSummary: 'Angular-rate setpoint/actual standard signals are not mapped yet.',
        }),
    },
    {
      id: 'actuator_output_saturation',
      run: ({ signals }) =>
        detectRequiredSignalsOnly({
          id: 'actuator_output_saturation',
          category: 'actuator',
          version: 'v2.2',
          title: 'Actuator output saturation',
          requiredSignals: ['actuator.output[]', 'actuator.role[]'],
          signals,
          unavailableSummary: 'Actuator output and role standard signals are not mapped yet.',
        }),
    },
    {
      id: 'estimator_gps_logged_flags',
      run: ({ signals }) => detectEstimatorAndGps(signals),
    },
    {
      id: 'battery',
      run: ({ signals }) => detectBattery(signals),
    },
    {
      id: 'failsafe_and_airborne_end',
      run: ({ signals }) => detectFailsafeAndAirborneEnd(signals),
    },
  ];
}

module.exports = {
  getIncidentAnomalyDetectors,
};
