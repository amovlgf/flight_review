const NAV_STATE_NAMES = {
  0: 'MANUAL',
  1: 'ALTCTL',
  2: 'POSCTL',
  3: 'AUTO_MISSION',
  4: 'AUTO_LOITER',
  5: 'AUTO_RTL',
  6: 'ACRO',
  7: 'OFFBOARD',
  8: 'STABILIZED',
  9: 'AUTO_TAKEOFF',
  10: 'AUTO_LAND',
  11: 'AUTO_FOLLOW_TARGET',
  12: 'AUTO_PRECLAND',
  13: 'ORBIT',
  14: 'AUTO_VTOL_TAKEOFF',
  15: 'EXTERNAL1',
  16: 'EXTERNAL2',
  17: 'EXTERNAL3',
  18: 'EXTERNAL4',
  19: 'EXTERNAL5',
  20: 'EXTERNAL6',
  21: 'EXTERNAL7',
  22: 'EXTERNAL8',
  23: 'MAX',
  24: 'TERMINATION',
};

const PHASE_NAMES = {
  ground_standby: '地面待机',
  takeoff: '起飞',
  normal_flight: '正常飞行',
  landing: '降落',
  landed_complete: '落地完成',
};

function roundTime(value) {
  return Number(Number(value).toFixed(3));
}

function pointsFor(signals, id) {
  return Array.isArray(signals?.[id]?.points) ? signals[id].points : [];
}

function valueAtOrBefore(points, timeS) {
  if (!Array.isArray(points) || points.length === 0) return null;
  let selected = points[0][1];
  for (const point of points) {
    if (point[0] > timeS) break;
    selected = point[1];
  }
  return selected;
}

function firstTransition(points, predicate, fromValue, toValue) {
  if (!Array.isArray(points) || points.length < 2) return null;
  let previous = predicate(points[0][1]);
  for (let index = 1; index < points.length; index += 1) {
    const current = predicate(points[index][1]);
    if (previous === fromValue && current === toValue) {
      return points[index][0];
    }
    previous = current;
  }
  return null;
}

function firstTimeMatching(points, predicate, afterS = null) {
  if (!Array.isArray(points)) return null;
  for (const [timeS, value] of points) {
    if (afterS !== null && timeS < afterS) continue;
    if (predicate(value)) return timeS;
  }
  return null;
}

function lastTime(points) {
  if (!Array.isArray(points) || points.length === 0) return null;
  return points[points.length - 1][0];
}

function formatNavState(value) {
  const code = Math.round(Number(value));
  return NAV_STATE_NAMES[code] || `UNKNOWN_${code}`;
}

function normalizeModeSegment(segment) {
  const start = Number(segment?.start);
  const end = Number(segment?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const modeCode = Number(segment?.mode_code);
  return {
    startS: roundTime(start),
    endS: roundTime(end),
    mode: typeof segment?.mode === 'string' ? segment.mode : formatNavState(modeCode),
    modeCode: Number.isFinite(modeCode) ? modeCode : -1,
  };
}

function modeChangesForRange(modeSegments, startS, endS) {
  const changes = Array.isArray(modeSegments) ? modeSegments : [];
  return changes
    .map(normalizeModeSegment)
    .filter(Boolean)
    .filter((segment) => segment.endS >= startS && segment.startS <= endS)
    .map((segment) => ({
      ...segment,
      startS: Math.max(segment.startS, roundTime(startS)),
      endS: Math.min(segment.endS, roundTime(endS)),
    }));
}

function createPhase(id, startS, endS, modeSegments, sourceSignals) {
  const safeStart = roundTime(Math.max(0, Number(startS)));
  const safeEnd = roundTime(Math.max(safeStart, Number(endS)));
  return {
    id,
    name: PHASE_NAMES[id] || id,
    startS: safeStart,
    endS: safeEnd,
    durationS: roundTime(safeEnd - safeStart),
    modeChanges: modeChangesForRange(modeSegments, safeStart, safeEnd),
    sourceSignals,
    charts: [],
  };
}

function analyzeFlightPhases({ signals, modeSegments }) {
  const timePoints = pointsFor(signals, 'log.timeS');
  const landedPoints = pointsFor(signals, 'vehicle.landed');
  const armedPoints = pointsFor(signals, 'vehicle.armed');
  if (timePoints.length === 0 || landedPoints.length === 0) return [];

  const startS = timePoints[0][0];
  const endS = lastTime(timePoints);
  const armedAtS = firstTransition(armedPoints, (value) => Number(value) > 0.5, false, true);
  const takeoffAtS = firstTransition(landedPoints, (value) => Number(value) > 0.5, true, false);
  const landingAtS =
    takeoffAtS === null
      ? null
      : firstTransition(
          landedPoints.filter(([timeS]) => timeS >= takeoffAtS),
          (value) => Number(value) > 0.5,
          false,
          true,
        );
  const navPoints = pointsFor(signals, 'vehicle.navState');
  const takeoffModeS = firstTimeMatching(
    navPoints,
    (value) => formatNavState(value) === 'AUTO_TAKEOFF',
    armedAtS,
  );
  const normalFlightModeS = firstTimeMatching(
    navPoints,
    (value) =>
      !['MANUAL', 'AUTO_TAKEOFF', 'AUTO_LAND', 'AUTO_PRECLAND'].includes(formatNavState(value)),
    takeoffAtS,
  );
  const landingModeS = firstTimeMatching(
    navPoints,
    (value) => ['AUTO_LAND', 'AUTO_PRECLAND'].includes(formatNavState(value)),
    takeoffAtS,
  );
  const takeoffEndS =
    takeoffAtS === null
      ? null
      : Math.min(
          ...[takeoffAtS + 5, normalFlightModeS, landingModeS, landingAtS, endS].filter(
            (value) => typeof value === 'number' && Number.isFinite(value) && value >= takeoffAtS,
          ),
        );
  const landingStartS =
    landingModeS !== null
      ? landingModeS
      : landingAtS !== null
        ? Math.max(takeoffEndS ?? takeoffAtS ?? startS, landingAtS - 5)
        : null;

  const phases = [];
  const groundEndS = armedAtS ?? takeoffAtS ?? endS;
  phases.push(
    createPhase('ground_standby', startS, groundEndS, modeSegments, [
      'vehicle.armed',
      'vehicle.landed',
      'vehicle.navState',
    ]),
  );

  if (takeoffAtS !== null) {
    phases.push(
      createPhase('takeoff', armedAtS ?? takeoffModeS ?? takeoffAtS, takeoffEndS ?? takeoffAtS, modeSegments, [
        'vehicle.armed',
        'vehicle.landed',
        'vehicle.navState',
        'position.altitudeRelative',
      ]),
    );
  }

  if (takeoffEndS !== null && landingStartS !== null && landingStartS > takeoffEndS) {
    phases.push(
      createPhase('normal_flight', takeoffEndS, landingStartS, modeSegments, [
        'vehicle.landed',
        'vehicle.navState',
        'position.altitudeRelative',
      ]),
    );
  } else if (takeoffAtS !== null && landingAtS === null && endS > (takeoffEndS ?? takeoffAtS)) {
    phases.push(
      createPhase('normal_flight', takeoffEndS ?? takeoffAtS, endS, modeSegments, [
        'vehicle.landed',
        'vehicle.navState',
      ]),
    );
  }

  if (landingStartS !== null && landingAtS !== null && landingAtS >= landingStartS) {
    phases.push(
      createPhase('landing', landingStartS, landingAtS, modeSegments, [
        'vehicle.landed',
        'vehicle.groundContact',
        'vehicle.maybeLanded',
        'vehicle.navState',
      ]),
    );
  }

  if (landingAtS !== null && endS >= landingAtS) {
    phases.push(
      createPhase('landed_complete', landingAtS, endS, modeSegments, [
        'vehicle.landed',
        'vehicle.groundContact',
        'vehicle.maybeLanded',
      ]),
    );
  }

  return phases.filter((phase) => phase.endS >= phase.startS);
}

module.exports = {
  NAV_STATE_NAMES,
  analyzeFlightPhases,
  formatNavState,
  valueAtOrBefore,
};
