const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app } = require('../index');

test('GET /api/health returns backend status', async () => {
  const response = await request(app).get('/api/health').expect(200);

  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.message, 'Backend scaffold is running.');
});
