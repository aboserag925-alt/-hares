'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createVisitorAnalytics } = require('./visitor-analytics');

async function withTemporaryDirectory(callback) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ahl-visitors-'));
  try {
    await callback(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test('counts each anonymous browser once per Cairo calendar day', async function () {
  await withTemporaryDirectory(async function (directory) {
    let current = new Date('2026-11-01T12:00:00.000Z');
    const analytics = createVisitorAnalytics({
      storageDirectory: directory,
      now: function () { return current; }
    });
    const visitor = '0123456789abcdef0123456789abcdef';

    const first = await analytics.recordVisit(visitor);
    const repeat = await analytics.recordVisit(visitor.toUpperCase());
    const second = await analytics.recordVisit('abcdef0123456789abcdef0123456789');

    assert.equal(first.recorded, true);
    assert.equal(first.todayCount, 1);
    assert.equal(repeat.recorded, false);
    assert.equal(repeat.todayCount, 1);
    assert.equal(second.recorded, true);
    assert.equal(second.todayCount, 2);

    current = new Date('2026-11-02T12:00:00.000Z');
    const nextDay = await analytics.recordVisit(visitor);
    assert.equal(nextDay.recorded, true);
    assert.equal(nextDay.todayCount, 1);

    const summary = await analytics.getSummary(2);
    assert.equal(summary.today, 1);
    assert.equal(summary.total90Days, 3);
    assert.deepEqual(summary.daily, [
      { date: '2026-11-02', visitors: 1 },
      { date: '2026-11-01', visitors: 2 }
    ]);
  });
});

test('rejects malformed visitor identifiers', async function () {
  await withTemporaryDirectory(async function (directory) {
    const analytics = createVisitorAnalytics({ storageDirectory: directory });
    await assert.rejects(analytics.recordVisit('not-a-visitor-id'), TypeError);
  });
});

test('serializes simultaneous visits so the same browser is counted once', async function () {
  await withTemporaryDirectory(async function (directory) {
    const analytics = createVisitorAnalytics({ storageDirectory: directory });
    const visitor = '0123456789abcdef0123456789abcdef';
    const results = await Promise.all([
      analytics.recordVisit(visitor),
      analytics.recordVisit(visitor),
      analytics.recordVisit(visitor)
    ]);
    assert.equal(results.filter((result) => result.recorded).length, 1);
    assert.equal((await analytics.getSummary(1)).today, 1);
  });
});
