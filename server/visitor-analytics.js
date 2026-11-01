'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const RETENTION_DAYS = 90;

function dateKey(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return values.year + '-' + values.month + '-' + values.day;
}

function createVisitorAnalytics(options) {
  options = options || {};
  const storageDirectory = options.storageDirectory || path.resolve(__dirname, '..', 'storage');
  const filePath = options.filePath || path.join(storageDirectory, 'visitor-analytics.json');
  const timeZone = options.timeZone || 'Africa/Cairo';
  const now = options.now || (() => new Date());
  let queue = Promise.resolve();

  async function readStore() {
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || !parsed.days || typeof parsed.days !== 'object') {
        throw new Error('Invalid visitor analytics store');
      }
      return parsed;
    } catch (error) {
      if (error.code === 'ENOENT') return { version: 1, days: {} };
      throw error;
    }
  }

  async function writeStore(store) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = filePath + '.' + process.pid + '.tmp';
    await fs.writeFile(temporaryPath, JSON.stringify(store), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporaryPath, filePath);
  }

  function serialize(operation) {
    const result = queue.then(operation, operation);
    queue = result.catch(() => {});
    return result;
  }

  function prune(store, today) {
    const cutoff = new Date(today + 'T00:00:00.000Z');
    cutoff.setUTCDate(cutoff.getUTCDate() - (RETENTION_DAYS - 1));
    const minimum = cutoff.toISOString().slice(0, 10);
    Object.keys(store.days).forEach((key) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || key < minimum || !Array.isArray(store.days[key])) {
        delete store.days[key];
      }
    });
  }

  async function recordVisit(visitorId) {
    if (typeof visitorId !== 'string') throw new TypeError('معرّف الزائر غير صالح.');
    const normalized = visitorId.replace(/-/g, '').toLowerCase();
    if (!/^[a-f0-9]{32,64}$/.test(normalized)) throw new TypeError('معرّف الزائر غير صالح.');
    const visitorHash = crypto.createHash('sha256').update(normalized).digest('hex');
    return serialize(async function () {
      const today = dateKey(now(), timeZone);
      const store = await readStore();
      prune(store, today);
      if (!Array.isArray(store.days[today])) store.days[today] = [];
      const visitors = store.days[today];
      const recorded = !visitors.includes(visitorHash);
      if (recorded) visitors.push(visitorHash);
      await writeStore(store);
      return { recorded: recorded, todayCount: visitors.length, date: today };
    });
  }

  async function getSummary(days) {
    const requestedDays = Number.isInteger(days) ? Math.min(30, Math.max(1, days)) : 7;
    return serialize(async function () {
      const today = dateKey(now(), timeZone);
      const store = await readStore();
      prune(store, today);
      const daily = [];
      const cursor = new Date(today + 'T00:00:00.000Z');
      for (let index = 0; index < requestedDays; index += 1) {
        const key = cursor.toISOString().slice(0, 10);
        daily.push({ date: key, visitors: Array.isArray(store.days[key]) ? store.days[key].length : 0 });
        cursor.setUTCDate(cursor.getUTCDate() - 1);
      }
      const total = Object.values(store.days).reduce((sum, visitors) =>
        sum + (Array.isArray(visitors) ? visitors.length : 0), 0);
      return { today: daily[0].visitors, total90Days: total, daily: daily };
    });
  }

  return { recordVisit: recordVisit, getSummary: getSummary };
}

module.exports = { createVisitorAnalytics: createVisitorAnalytics };
