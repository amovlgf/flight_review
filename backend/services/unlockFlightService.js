const PX4_ARMED_STATE_VALUES = new Set([2, 5]);

function toFiniteNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function hasTruthyPoint(points) {
  if (!Array.isArray(points)) return false;

  return points.some((point) => {
    const value = Array.isArray(point) ? point[1] : point;
    const numericValue = toFiniteNumber(value);
    return numericValue !== null && numericValue > 0.5;
  });
}

function hasArmedStatePoint(points) {
  if (!Array.isArray(points)) return false;

  return points.some((point) => {
    const value = Array.isArray(point) ? point[1] : point;
    const numericValue = toFiniteNumber(value);
    return numericValue !== null && PX4_ARMED_STATE_VALUES.has(Math.round(numericValue));
  });
}

function hasUnlockedFlightFromTopicCharts(topicCharts) {
  if (!Array.isArray(topicCharts)) return false;

  for (const topicChart of topicCharts) {
    const topic = typeof topicChart?.topic === 'string' ? topicChart.topic : '';
    const seriesList = Array.isArray(topicChart?.series) ? topicChart.series : [];

    for (const series of seriesList) {
      const name = typeof series?.name === 'string' ? series.name : '';

      // PX4 logs expose unlock state either as actuator_armed.armed or vehicle_status.arming_state.
      if (topic === 'actuator_armed' && name === 'armed' && hasTruthyPoint(series.points)) {
        return true;
      }
      if (
        topic === 'vehicle_status' &&
        name === 'arming_state' &&
        hasArmedStatePoint(series.points)
      ) {
        return true;
      }
    }
  }

  return false;
}

function hasUnlockedFlight(parsedLog) {
  if (parsedLog?.unlockSummary?.hasUnlockedFlight === true) {
    return true;
  }

  return hasUnlockedFlightFromTopicCharts(parsedLog?.topicCharts);
}

module.exports = {
  hasUnlockedFlight,
  hasUnlockedFlightFromTopicCharts,
};
