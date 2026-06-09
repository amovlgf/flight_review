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
