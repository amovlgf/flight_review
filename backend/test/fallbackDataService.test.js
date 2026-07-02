const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildFallbackSeed,
  generateFallbackTimeSeries,
  buildFallbackTopicCharts,
} = require('../services/fallbackDataService');
const { buildParsedLog } = require('../services/logParserService');

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

test('buildParsedLog fallback data is stable for the same file metadata', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flight-review-fallback-'));
  const filePath = path.join(tempDir, 'stable-fallback.ulg');
  const header = Buffer.alloc(32);
  Buffer.from([0x55, 0x4c, 0x6f, 0x67, 0x01, 0x12, 0x35]).copy(header, 0);
  header.writeUInt8(1, 7);
  header.writeBigUInt64LE(123456789n, 8);
  header.write('not a complete ulog payload', 16, 'utf8');
  fs.writeFileSync(filePath, header);

  try {
    const first = buildParsedLog(filePath, 'stable-fallback.ulg');
    const second = buildParsedLog(filePath, 'stable-fallback.ulg');

    assert.equal(first.dataSource, 'header-derived-simulated-series');
    assert.equal(second.dataSource, 'header-derived-simulated-series');
    assert.deepEqual(second.topicCharts, first.topicCharts);
    assert.deepEqual(second.diagnostics, first.diagnostics);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
