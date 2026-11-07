'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appDirectory = __dirname;
const html = fs.readFileSync(path.join(appDirectory, 'index.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(appDirectory, 'manifest.json'), 'utf8'));

test('provides an iOS home-screen icon and supported PWA metadata', function () {
  assert.match(html, /name="viewport" content="[^"]*viewport-fit=cover/);
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /rel="apple-touch-icon" sizes="180x180" href="apple-touch-icon\.png"/);

  const icon = fs.readFileSync(path.join(appDirectory, 'apple-touch-icon.png'));
  assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(icon.readUInt32BE(16), 180);
  assert.equal(icon.readUInt32BE(20), 180);
  assert.ok(manifest.icons.some(function (entry) {
    return entry.src === 'apple-touch-icon.png' &&
      entry.sizes === '180x180' &&
      entry.type === 'image/png';
  }));
});

test('all PWA manifest and offline-cache files exist within the app', function () {
  assert.equal(manifest.start_url, './index.html');
  assert.equal(manifest.scope, './');
  for (const entry of manifest.icons) {
    assert.ok(fs.existsSync(path.join(appDirectory, entry.src)), entry.src);
  }

  const worker = fs.readFileSync(path.join(appDirectory, 'sw.js'), 'utf8');
  for (const asset of ['./index.html', './manifest.json', './icon.svg']) {
    assert.ok(worker.includes("'" + asset + "'"), asset);
    assert.ok(fs.existsSync(path.join(appDirectory, asset.replace(/^\.\//, ''))), asset);
  }
});


test('shield PWA icons use the approved Arabic shield identity', function () {
  for (const name of ['icon.svg', 'icon-192.svg', 'icon-512.svg']) {
    const svg = fs.readFileSync(path.join(appDirectory, name), 'utf8');
    assert.match(svg, /حرس/);
    assert.match(svg, /الحدود/);
  }
  assert.ok(manifest.icons.some(function (entry) { return entry.src === 'icon-192.svg'; }));
  assert.ok(manifest.icons.some(function (entry) { return entry.src === 'icon-512.svg'; }));
});

test('service worker caches local static assets only and excludes private traffic', function () {
  const worker = fs.readFileSync(path.join(appDirectory, 'sw.js'), 'utf8');
  assert.ok(worker.includes("request.method !== 'GET'"));
  assert.ok(worker.includes("request.headers.has('authorization')"));
  assert.ok(worker.includes('url.origin !== self.location.origin'));
  assert.ok(worker.includes("url.pathname.indexOf('/api/') !== -1"));
  assert.ok(worker.includes('!STATIC_FILE.test(url.pathname) || url.search'));
  assert.ok(worker.includes('var STATIC_FILE = /\\.(?:css|js'));
  const start = worker.indexOf('var APP_FILES = [');
  const end = worker.indexOf('];', start);
  assert.ok(start >= 0 && end > start);
  const files = [...worker.slice(start, end).matchAll(/'([^']+)'/g)].map(function (match) { return match[1]; });
  for (const file of files) assert.ok(fs.existsSync(path.join(appDirectory, file)), 'missing app-shell file: ' + file);
});
