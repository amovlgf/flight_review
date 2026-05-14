const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildFallbackSeed,
  generateFallbackTimeSeries,
  buildFallbackTopicCharts,
} = require('../services/fallbackDataService');

function assertChartSeries(series) {
  assert.equal(typeof series.name, 'string');
  assert.equal(typeof series.unit, 'string');
  assert.ok(Array.isArray(series.points));
  assert.ok(series.points.length > 0);

  for (const point of series.points) {
    assert.ok(Array.isArray(point));
    assert.equal(point.length, 2);
    assert.equal(typeof point[0], 'number');
    assert.equal(typeof point[1], 'number');
    assert.ok(Number.isFinite(point[0]));
    assert.ok(Number.isFinite(point[1]));
  }
}

test('fallback topicCharts match chart data contract shape', () => {
  const metadata = {
    fileSizeBytes: 1024,
    version: 1,
    logStartTimestampUs: 123456,
  };
  const seed = buildFallbackSeed('fallback-contract-test');
  const fallbackSeriesMap = generateFallbackTimeSeries(metadata, seed);
  const topicCharts = buildFallbackTopicCharts(fallbackSeriesMap);
  const series = topicCharts.flatMap((topic) => topic.series);

  assert.ok(Array.isArray(topicCharts));
  assert.ok(topicCharts.length > 0);
  assert.ok(Array.isArray(series));
  assert.ok(series.length > 0);

  for (const topicChart of topicCharts) {
    assert.equal(typeof topicChart.topic, 'string');
    assert.equal(typeof topicChart.title, 'string');
    assert.ok(Array.isArray(topicChart.series));
    assert.ok(topicChart.series.length > 0);
    topicChart.series.forEach(assertChartSeries);
  }
});
