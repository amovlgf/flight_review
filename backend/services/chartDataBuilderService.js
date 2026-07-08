function pointsFor(signals, id) {
  return Array.isArray(signals?.[id]?.points) ? signals[id].points : [];
}

function filterPoints(points, startS = null, endS = null) {
  if (!Array.isArray(points)) return [];
  return points.filter(([timeS]) => {
    if (typeof timeS !== 'number' || !Number.isFinite(timeS)) return false;
    if (typeof startS === 'number' && timeS < startS) return false;
    if (typeof endS === 'number' && timeS > endS) return false;
    return true;
  });
}

function buildEmbeddedChart({ id, title, signalIds, signals, startS = null, endS = null }) {
  const series = signalIds
    .map((signalId) => {
      const signal = signals?.[signalId];
      const points = filterPoints(pointsFor(signals, signalId), startS, endS);
      if (points.length === 0) return null;
      return {
        name: signalId,
        unit: signal?.unit || '',
        points,
        source: signal
          ? {
              topic: signal.topic || '',
              instance: Number.isInteger(signal.instance) ? signal.instance : 0,
              field: signal.field || '',
            }
          : null,
      };
    })
    .filter(Boolean);

  return {
    id,
    title,
    series,
  };
}

function attachChartsToPhases(phases, signals) {
  return phases.map((phase) => ({
    ...phase,
    charts: [
      buildEmbeddedChart({
        id: `${phase.id}_state`,
        title: '飞行状态曲线',
        signalIds: [
          'vehicle.armingState',
          'vehicle.navState',
          'vehicle.landed',
          'vehicle.maybeLanded',
          'vehicle.groundContact',
          'vehicle.localPositionValid',
          'vehicle.globalPositionValid',
        ],
        signals,
        startS: phase.startS,
        endS: phase.endS,
      }),
      buildEmbeddedChart({
        id: `${phase.id}_motion`,
        title: '高度与垂直速度',
        signalIds: ['position.altitudeRelative', 'position.verticalVelocity'],
        signals,
        startS: phase.startS,
        endS: phase.endS,
      }),
    ].filter((chart) => chart.series.length > 0),
  }));
}

function attachChartsToFlightStatus(flightStatus, signals) {
  if (!flightStatus) return flightStatus;
  return {
    ...flightStatus,
    failsafe: {
      ...flightStatus.failsafe,
      charts: [
        buildEmbeddedChart({
          id: 'failsafe_state',
          title: '故障保护状态曲线',
          signalIds: [
            'vehicle.failsafe',
            'vehicle.navState',
            'vehicle.armingState',
            'vehicle.localPositionValid',
            'vehicle.globalPositionValid',
            'failsafeFlag.localPosition',
            'failsafeFlag.globalPosition',
            'failsafeFlag.manualControlSignalLost',
            'failsafeFlag.gcsConnectionLost',
            'failsafeFlag.batteryWarning',
            'failsafeFlag.geofenceBreached',
          ],
          signals,
        }),
        buildEmbeddedChart({
          id: 'failsafe_gps',
          title: 'GPS / 定位辅助曲线',
          signalIds: ['gps.fixType', 'gps.eph', 'gps.epv', 'gps.satellitesUsed'],
          signals,
        }),
      ].filter((chart) => chart.series.length > 0),
    },
    estimator: {
      ...flightStatus.estimator,
      charts: [
        buildEmbeddedChart({
          id: 'estimator_position',
          title: '传感器融合状态曲线',
          signalIds: [
            'estimator.flags',
            'vehicle.localPositionValid',
            'vehicle.globalPositionValid',
            'gps.fixType',
            'gps.satellitesUsed',
            'gps.eph',
            'gps.epv',
            'estimator.csGnssPos',
            'estimator.csBaroHgt',
            'estimator.csRngHgt',
            'estimator.csGpsHgt',
            'estimator.csEvHgt',
            'estimator.innovationTestRatio',
          ],
          signals,
        }),
      ].filter((chart) => chart.series.length > 0),
    },
  };
}

module.exports = {
  attachChartsToFlightStatus,
  attachChartsToPhases,
  buildEmbeddedChart,
};
