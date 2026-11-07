'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('./index');

async function withServer(options, callback) {
  const server = createServer(options);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await callback('http://127.0.0.1:' + server.address().port);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('daily visitor endpoint stores only a per-day SHA-256 hash and returns an exact count', async function () {
  const calls = [];
  const serviceKey = 'server-only-test-key';
  const fetchImpl = async function (url, options) {
    calls.push({ url: String(url), options: options || {} });
    if (String(url).includes('select=visitor_hash')) {
      return { ok: true, headers: { get: function (name) { return name.toLowerCase() === 'content-range' ? '0-0/7' : null; } } };
    }
    return { ok: true, headers: { get: function () { return null; } } };
  };
  await withServer({
    env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SERVICE_ROLE_KEY: serviceKey },
    fetch: fetchImpl
  }, async function (base) {
    const visitorId = '01234567-89ab-4cde-8fab-0123456789ab';
    const response = await fetch(base + '/api/analytics/visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorId: visitorId })
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.visitors, 7);
    assert.equal(typeof payload.date, 'string');
    const insert = calls.find(function (call) { return call.options.method === 'POST'; });
    assert.ok(insert);
    const body = JSON.parse(insert.options.body);
    assert.match(body.visitor_hash, /^[a-f0-9]{64}$/);
    assert.notEqual(body.visitor_hash, visitorId);
    assert.equal(insert.options.headers.apikey, serviceKey);
    assert.ok(!JSON.stringify(payload).includes(serviceKey));
  });
});

test('daily visitor endpoint rejects malformed ids before contacting Supabase', async function () {
  const calls = [];
  await withServer({
    env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'server-only-test-key' },
    fetch: async function (url) { calls.push(url); return { ok: true, headers: { get: function () { return '0-0/0'; } } }; }
  }, async function (base) {
    const response = await fetch(base + '/api/analytics/visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorId: 'not-a-uuid' })
    });
    assert.equal(response.status, 400);
    assert.equal(calls.length, 0);
  });
});

test('daily visitor endpoint remains disabled without server Supabase credentials', async function () {
  await withServer({ env: {}, fetch: async function () { throw new Error('must not call fetch'); } }, async function (base) {
    const response = await fetch(base + '/api/analytics/visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorId: '01234567-89ab-4cde-8fab-0123456789ab' })
    });
    assert.equal(response.status, 503);
  });
});
