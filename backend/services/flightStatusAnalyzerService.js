const { formatNavState, valueAtOrBefore } = require('./flightPhaseAnalyzerService');

const FAILSAFE_FLAG_SIGNALS = [
  ['local_position', 'failsafeFlag.localPosition'],
  ['global_position', 'failsafeFlag.globalPosition'],
  ['rc_loss', 'failsafeFlag.manualControlSignalLost'],
  ['data_link_loss', 'failsafeFlag.gcsConnectionLost'],
  ['offboard_loss', 'failsafeFlag.offboardControlSignalLost'],
  ['low_battery', 'failsafeFlag.batteryWarning'],
  ['geofence', 'failsafeFlag.geofenceBreached'],
  ['failure_detector', 'failsafeFlag.failureDetector'],
];

function roundTime(value) {
  return Number(Number(value).toFixed(3));
}

function pointsFor(signals, id) {
  return Array.isArray(signals?.[id]?.points) ? signals[id].points : [];
}

function boolAt(signals, id, timeS) {
  const value = valueAtOrBefore(pointsFor(signals, id), timeS);
  if (value === null) return null;
  return Number(value) > 0.5;
}

function phaseAt(phases, timeS) {
  if (!Array.isArray(phases)) return null;
  return phases.find((phase) => timeS >= phase.startS && timeS <= phase.endS) || null;
}

function buildBooleanWindows(points) {
  if (!Array.isArray(points) || points.length === 0) return [];
  const windows = [];
  let active = Number(points[0][1]) > 0.5;
  let startS = active ? points[0][0] : null;

  for (let index = 1; index < points.length; index += 1) {
    const current = Number(points[index][1]) > 0.5;
    if (current === active) continue;
    if (current) {
      startS = points[index][0];
    } else if (startS !== null) {
      windows.push({ startS: roundTime(startS), endS: roundTime(points[index][0]) });
      startS = null;
    }
    active = current;
  }

  if (active && startS !== null) {
    windows.push({ startS: roundTime(startS), endS: roundTime(points[points.length - 1][0]) });
  }
  return windows;
}

function activeFailsafeFlags(signals, timeS) {
  return FAILSAFE_FLAG_SIGNALS.filter(([, signalId]) => boolAt(signals, signalId, timeS) === true)
    .map(([id]) => id);
}

function signalChanges(signals, signalId) {
  const points = pointsFor(signals, signalId);
  if (points.length < 2) return [];
  const changes = [];
  let previous = Number(points[0][1]);
  for (let index = 1; index < points.length; index += 1) {
    const current = Number(points[index][1]);
    if (current === previous) continue;
    changes.push({
      signal: signalId,
      timeS: roundTime(points[index][0]),
      value: current,
    });
    previous = current;
  }
  return changes;
}

function hasAnyInvalid(points) {
  return Array.isArray(points) && points.some(([, value]) => Number(value) <= 0.5);
}

function formatGpsStatus(fixType) {
  const value = Math.round(Number(fixType));
  if (!Number.isFinite(value)) return 'unavailable';
  if (value >= 4) return '3D/DGPS fix';
  if (value === 3) return '3D fix';
  if (value === 2) return '2D fix';
  return 'no fix';
}

function resolveHeightSource(signals) {
  const sources = [
    ['baro', 'estimator.csBaroHgt'],
    ['range', 'estimator.csRngHgt'],
    ['gps', 'estimator.csGpsHgt'],
    ['vision', 'estimator.csEvHgt'],
  ];
  const lastTime = pointsFor(signals, 'log.timeS').at(-1)?.[0] ?? Infinity;
  const active = sources.find(([, signalId]) => boolAt(signals, signalId, lastTime) === true);
  return active?.[0] || 'unknown';
}

function analyzeFlightStatus({ signals, phases }) {
  const failsafePoints = pointsFor(signals, 'vehicle.failsafe');
  const failsafeWindows = buildBooleanWindows(failsafePoints);
  const failsafeEvents = failsafeWindows.map((window, index) => {
    const phase = phaseAt(phases, window.startS);
    const navState = valueAtOrBefore(pointsFor(signals, 'vehicle.navState'), window.startS);
    return {
      id: `failsafe_${index + 1}`,
      startS: window.startS,
      endS: window.endS,
      durationS: roundTime(window.endS - window.startS),
      phaseId: phase?.id || 'unknown',
      phaseName: phase?.name || 'unknown',
      mode: navState === null ? 'unknown' : formatNavState(navState),
      activeFlags: activeFailsafeFlags(signals, window.startS),
    };
  });

  const lastTime = pointsFor(signals, 'log.timeS').at(-1)?.[0] ?? Infinity;
  const localPositionValid = boolAt(signals, 'vehicle.localPositionValid', lastTime);
  const globalPositionValid = boolAt(signals, 'vehicle.globalPositionValid', lastTime);
  const gpsFixType = valueAtOrBefore(pointsFor(signals, 'gps.fixType'), lastTime);
  const estimatorChanges = [
    ...signalChanges(signals, 'vehicle.localPositionValid'),
    ...signalChanges(signals, 'vehicle.globalPositionValid'),
    ...signalChanges(signals, 'gps.fixType'),
    ...signalChanges(signals, 'estimator.flags'),
    ...signalChanges(signals, 'estimator.csGnssPos'),
    ...signalChanges(signals, 'estimator.csBaroHgt'),
    ...signalChanges(signals, 'estimator.csRngHgt'),
    ...signalChanges(signals, 'estimator.csGpsHgt'),
    ...signalChanges(signals, 'estimator.csEvHgt'),
  ].sort((left, right) => left.timeS - right.timeS || left.signal.localeCompare(right.signal));

  const positionValues = [localPositionValid, globalPositionValid].filter((value) => value !== null);
  const positionWasLimited =
    hasAnyInvalid(pointsFor(signals, 'vehicle.localPositionValid')) ||
    hasAnyInvalid(pointsFor(signals, 'vehicle.globalPositionValid'));
  const estimatorStatus =
    positionValues.length === 0
      ? 'unavailable'
      : positionValues.every(Boolean) && !positionWasLimited
        ? 'normal'
        : 'partial';

  return {
    failsafe: {
      triggered: failsafeEvents.length > 0,
      events: failsafeEvents,
      mainChanges: [
        ...signalChanges(signals, 'vehicle.failsafe').map(
          (item) => `vehicle.failsafe changed to ${item.value > 0.5 ? 'active' : 'inactive'} at ${item.timeS}s`,
        ),
      ],
      charts: [],
    },
    estimator: {
      status: estimatorStatus,
      localPositionValid,
      globalPositionValid,
      horizontalPositionValid: localPositionValid,
      verticalPositionValid: localPositionValid,
      gpsStatus: formatGpsStatus(gpsFixType),
      satellitesUsed: valueAtOrBefore(pointsFor(signals, 'gps.satellitesUsed'), lastTime),
      heightSource: resolveHeightSource(signals),
      changes: estimatorChanges,
      charts: [],
    },
  };
}

module.exports = {
  FAILSAFE_FLAG_SIGNALS,
  analyzeFlightStatus,
};
