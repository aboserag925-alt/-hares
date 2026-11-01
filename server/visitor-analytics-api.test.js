'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createServer } = require('./index');

test('visitor analytics API records a visit and returns the daily count', async function () {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ahl-analytics-api-'));
  const server = createServer({ storageDirectory: directory, env: {} });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = 'http://127.0.0.1:' + address.port;

  try {
    const visit = await fetch(baseUrl + '/api/analytics/visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorId: '0123456789abcdef0123456789abcdef' })
    });
    assert.equal(visit.status, 200);
    assert.equal((await visit.json()).todayCount, 1);

    const summary = await fetch(baseUrl + '/api/analytics/summary?days=1');
    assert.equal(summary.status, 200);
    const payload = await summary.json();
    assert.equal(payload.today, 1);
    assert.equal(payload.daily.length, 1);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('visitor analytics API rejects an invalid visitor id', async function () {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ahl-analytics-invalid-'));
  const server = createServer({ storageDirectory: directory, env: {} });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  try {
    const response = await fetch('http://127.0.0.1:' + address.port + '/api/analytics/visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorId: 'invalid' })
    });
    assert.equal(response.status, 400);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
