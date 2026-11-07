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


test('account recovery and optional CAPTCHA are wired on user and admin screens', function () {
  const accountHtml = html;
  const accountScript = fs.readFileSync(path.join(appDirectory, 'app.js'), 'utf8');
  const adminHtml = fs.readFileSync(path.join(appDirectory, 'admin.html'), 'utf8');
  const authSource = fs.readFileSync(path.join(appDirectory, '../src/auth-client.js'), 'utf8');
  const buildScript = fs.readFileSync(path.join(appDirectory, '../scripts/build-auth.mjs'), 'utf8');
  const pagesWorkflow = fs.readFileSync(path.join(appDirectory, '../.github/workflows/pages.yml'), 'utf8');
  assert.ok(accountHtml.includes('id="authCaptcha"'));
  assert.ok(accountHtml.includes('id="passwordRecoveryPanel"'));
  assert.ok(accountHtml.includes('id="resetPasswordBtn"'));
  assert.ok(accountScript.includes("state.event === 'PASSWORD_RECOVERY'"));
  assert.ok(accountScript.includes('requestPasswordReset'));
  assert.ok(accountScript.includes('updatePassword'));
  assert.ok(authSource.includes('resetPasswordForEmail'));
  assert.ok(authSource.includes('window.ahlCaptcha'));
  assert.ok(adminHtml.includes('id="adminCaptcha"'));
  assert.ok(adminHtml.includes('window.ahlAuth.signIn'));
  assert.ok(buildScript.includes('TURNSTILE_SITE_KEY'));
  assert.ok(pagesWorkflow.includes('TURNSTILE_SITE_KEY'));
});

test('app sections support stacked overlays and outside-tap dismissal', function () {
  const appScript = fs.readFileSync(path.join(appDirectory, 'app.js'), 'utf8');
  assert.ok(appScript.includes("var sectionStack = ['sched'];"));
  assert.ok(appScript.includes('function renderSectionStack()'));
  assert.ok(appScript.includes('function closeTopSection()'));
  assert.ok(appScript.includes('event.target.closest(contentSelector)'));
  assert.ok(appScript.includes("event.key === 'Escape'"));
  assert.ok(html.includes('Context-preserving section overlays'));
});

test('Google OAuth and member activity use own-row RLS tables', function () {
  const auth = fs.readFileSync(path.join(appDirectory, '../src/auth-client.js'), 'utf8');
  const appScript = fs.readFileSync(path.join(appDirectory, 'app.js'), 'utf8');
  const migration = fs.readFileSync(path.join(appDirectory, '../supabase/migrations/202611070002_member_accounts.sql'), 'utf8');
  assert.ok(html.includes('id="googleSignInBtn"'));
  assert.ok(appScript.includes('signInWithGoogle'));
  assert.ok(auth.includes('signInWithOAuth'));
  assert.ok(auth.includes('saveMemberProfile'));
  assert.ok(auth.includes('logActivity'));
  assert.ok(migration.includes('alter table public.member_profiles enable row level security'));
  assert.ok(migration.includes('alter table public.member_activity enable row level security'));
  assert.ok(migration.includes('(select auth.uid()) = user_id'));
});

test('forum and debates require moderation before public publication', function () {
  const appScript = fs.readFileSync(path.join(appDirectory, 'app.js'), 'utf8');
  const community = fs.readFileSync(path.join(appDirectory, 'community.js'), 'utf8');
  const moderation = fs.readFileSync(path.join(appDirectory, 'community-admin.js'), 'utf8');
  const migration = fs.readFileSync(path.join(appDirectory, '../supabase/migrations/202611070003_community_moderation.sql'), 'utf8');
  const adminHtml = fs.readFileSync(path.join(appDirectory, 'admin.html'), 'utf8');
  assert.ok(html.includes('id="debates"'));
  assert.ok(html.includes('id="forum"'));
  assert.ok(appScript.includes("'debates', 'forum'"));
  assert.ok(community.includes("status: 'pending'"));
  assert.ok(community.includes("status:'pending'"));
  assert.ok(moderation.includes('getAccessToken'));
  assert.ok(moderation.includes("status: 'published'"));
  assert.ok(adminHtml.includes('communityModerationPanel'));
  assert.ok(migration.includes("status text not null default 'pending'"));
  assert.ok(migration.includes('alter table public.community_topics enable row level security'));
  assert.ok(migration.includes('alter table public.community_posts enable row level security'));
  assert.ok(migration.includes('set search_path ='));
  assert.ok(migration.includes("status = 'pending'"));
  assert.ok(migration.includes('community_topics_rate_limit'));
  assert.ok(migration.includes('community_posts_rate_limit'));
});

test('daily visitor counter respects Do Not Track and uses no raw visitor data in the UI', function () {
  const counter = fs.readFileSync(path.join(appDirectory, 'visitor-counter.js'), 'utf8');
  assert.ok(counter.includes("navigator.doNotTrack === '1'"));
  assert.ok(counter.includes('ahl_daily_visitor_id'));
  assert.ok(counter.includes('/api/analytics/visit'));
  assert.ok(counter.includes("value.textContent"));
  assert.ok(counter.includes('data.visitors'));
  assert.ok(!counter.includes('navigator.geolocation'));
  assert.ok(html.includes('data-daily-visitors'));
  assert.ok(fs.readFileSync(path.join(appDirectory, '../index.html'), 'utf8').includes('data-daily-visitors'));
});

test('support dialogs close by backdrop or mobile back without navigating away', function () {
  const vm = require('node:vm');
  const appScript = fs.readFileSync(path.join(appDirectory, 'app.js'), 'utf8');
  const rootHtml = fs.readFileSync(path.join(appDirectory, '../index.html'), 'utf8');
  assert.ok(appScript.includes('function openAppSupportDialog()'));
  assert.ok(appScript.includes('event.target === appSupportDialog'));
  assert.ok(appScript.includes("window.addEventListener('popstate'"));
  assert.ok(rootHtml.includes('function openSiteSupportDialog()'));
  assert.ok(rootHtml.includes('event.target===siteSupportDialog'));
  for (const documentText of [html, rootHtml]) {
    for (const match of documentText.matchAll(/<script(?:\\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
      if (match[1].trim()) new vm.Script(match[1]);
    }
  }
});
