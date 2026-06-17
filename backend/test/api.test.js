const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app } = require('../index');

test('GET /api/health returns backend status', async () => {
  const response = await request(app).get('/api/health').expect(200);

  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.message, 'Backend scaffold is running.');
});

test('POST /api/logs/batch-analyze returns structured failure results', async () => {
  const response = await request(app)
    .post('/api/logs/batch-analyze')
    .attach('logFiles', Buffer.from('not a ulog'), 'bad-log.txt')
    .expect(200);

  assert.deepEqual(response.body.unlockedLogs, []);
  assert.deepEqual(response.body.unlockedLogDetails, []);
  assert.equal(response.body.total, 1);
  assert.equal(response.body.unlockedCount, 0);
  assert.equal(response.body.failedCount, 1);
  assert.deepEqual(response.body.failedLogs, [
    {
      fileName: 'bad-log.txt',
      reason: 'Only .ulg files are supported now.',
    },
  ]);
});

test('POST /api/logs/control-quality/batch returns structured failure results', async () => {
  const response = await request(app)
    .post('/api/logs/control-quality/batch')
    .attach('logFiles', Buffer.from('not a ulog'), 'bad-log.txt')
    .expect(200);

  assert.deepEqual(response.body.reports, []);
  assert.equal(response.body.total, 1);
  assert.equal(response.body.successCount, 0);
  assert.equal(response.body.failedCount, 1);
  assert.deepEqual(response.body.failedLogs, [
    {
      fileName: 'bad-log.txt',
      reason: 'Only .ulg files are supported now.',
    },
  ]);
});

test('GET /api/logs/chart-data returns stable v1.3 contract when logId is missing', async () => {
  const response = await request(app).get('/api/logs/chart-data').expect(400);

  assert.equal(response.body.contractVersion, 'chart-data.v1.3');
  assert.equal(response.body.code, 'LOG_ID_REQUIRED');
  assert.ok(response.body.availableRoles.includes(response.body.role));
  assert.deepEqual(response.body.series, []);
  assert.deepEqual(response.body.topicCharts, []);
  assert.deepEqual(response.body.diagnostics, []);
  assert.deepEqual(response.body.modeSegments, []);
  assert.ok(Array.isArray(response.body.availableRoles));
});

test('GET /api/logs/chart-data returns stable v1.3 contract when log is missing', async () => {
  const response = await request(app)
    .get('/api/logs/chart-data?logId=not-uploaded&role=engineer')
    .expect(404);

  assert.equal(response.body.contractVersion, 'chart-data.v1.3');
  assert.equal(response.body.code, 'LOG_NOT_FOUND');
  assert.equal(response.body.role, 'engineer');
  assert.equal(response.body.logId, 'not-uploaded');
  assert.deepEqual(response.body.series, []);
  assert.deepEqual(response.body.topicCharts, []);
  assert.deepEqual(response.body.diagnostics, []);
  assert.deepEqual(response.body.modeSegments, []);
});

test('POST /api/logs/:logId/incident-analysis reports missing uploaded log', async () => {
  const response = await request(app)
    .post('/api/logs/not-uploaded/incident-analysis')
    .send({})
    .expect(404);

  assert.equal(response.body.code, 'LOG_NOT_FOUND');
  assert.equal(response.body.logId, 'not-uploaded');
});
