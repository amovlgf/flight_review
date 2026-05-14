/**
 * Builds a deterministic numeric seed for fallback chart data.
 */
function buildFallbackSeed(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) % 1000003;
  }
  return hash;
}

/**
 * Generates demo time series when detailed ULog topic parsing is unavailable.
 */
function generateFallbackTimeSeries(metadata, seed) {
  const points = 180;
  const base = (metadata.fileSizeBytes + seed) % 97;
  const altitude = [];
  const speed = [];
  const voltage = [];

  for (let i = 0; i < points; i += 1) {
    const t = i;
    const climbProfile = Math.sin(i / 22) * 8 + i * 0.06;
    const turbulence = Math.sin((i + base) / 7) * 0.9;
    const alt = Math.max(0, 42 + climbProfile + turbulence);
    const spd = Math.max(0, 9 + Math.sin(i / 10) * 3 + Math.cos(i / 17) * 1.2);
    const voltDrop = i * 0.018;
    const voltNoise = Math.sin((i + base) / 13) * 0.07;
    const volt = Math.max(13.6, 16.8 - voltDrop + voltNoise);

    altitude.push([t, Number(alt.toFixed(2))]);
    speed.push([t, Number(spd.toFixed(2))]);
    voltage.push([t, Number(volt.toFixed(2))]);
  }

  return { altitude, speed, voltage };
}

/**
 * Wraps fallback series in the same topicCharts shape used by parsed topics.
 */
function buildFallbackTopicCharts(fallbackSeriesMap) {
  return [
    {
      topic: 'vehicle_local_position',
      title: 'vehicle_local_position',
      series: [
        { name: 'altitude', unit: 'm', points: fallbackSeriesMap.altitude },
        { name: 'speed', unit: 'm/s', points: fallbackSeriesMap.speed },
      ],
    },
    {
      topic: 'battery_status',
      title: 'battery_status',
      series: [{ name: 'voltage_v', unit: 'V', points: fallbackSeriesMap.voltage }],
    },
  ];
}

module.exports = {
  buildFallbackSeed,
  generateFallbackTimeSeries,
  buildFallbackTopicCharts,
};
