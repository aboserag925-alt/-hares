'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createMediaLibrary } = require('./media-library');

function jsonResponse(payload) {
  return { ok: true, arrayBuffer: async function () {
    return Buffer.from(JSON.stringify({ ok: true, result: payload }), 'utf8');
  }};
}

async function withLibrary(run, memberStatus) {
  const storageDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ahl-media-test-'));
  const calls = [];
  const fetch = async function (url, options) {
    calls.push({ url: url, options: options });
    if (url.includes('/getChatMember')) return jsonResponse({ status: memberStatus || 'administrator' });
    if (url.includes('/getFile')) return jsonResponse({ file_path: 'audio/lesson.mp3' });
    if (url.includes('/sendMessage')) return jsonResponse({ message_id: 101 });
    if (url.includes('/answerCallbackQuery')) return jsonResponse(true);
    if (url.includes('/editMessageText')) return jsonResponse({ message_id: 101 });
    if (url.includes('/file/bot')) return {
      ok: true, arrayBuffer: async function () { return Buffer.from('audio bytes'); }
    };
    throw new Error('Unexpected mocked Telegram request: ' + url);
  };
  const env = {
    TELEGRAM_BOT_TOKEN: 'test-token',
    TELEGRAM_MEDIA_ENABLED: 'true',
    TELEGRAM_BOT_ENABLED: 'true',
    TELEGRAM_MEDIA_GROUP_ID: '-100123'
  };
  const library = createMediaLibrary({ env: env, fetch: fetch, storageDirectory: storageDirectory });
  try {
    await run({ calls: calls, env: env, fetch: fetch, storageDirectory: storageDirectory, library: library });
  } finally {
    await library.stop();
    await fs.rm(storageDirectory, { recursive: true, force: true });
  }
}

function uploadUpdate(userId) {
  return {
    update_id: 1,
    message: {
      chat: { id: -100123 },
      from: { id: userId },
      date: 1793500000,
      caption: 'محاضرة الخميس #صوتيات',
      audio: {
        file_id: 'telegram-file-id-' + userId,
        file_unique_id: 'telegram-unique-id-' + userId,
        file_name: 'lecture.mp3',
        mime_type: 'audio/mpeg',
        file_size: 11
      }
    }
  };
}

test('publishes files immediately when posted by verified group administrators', async function () {
  await withLibrary(async function (context) {
    await context.library.processUpdate(uploadUpdate(7));
    const published = await context.library.listApproved();
    assert.equal(published.length, 1);
    assert.equal(published[0].title, 'محاضرة الخميس');
    assert.equal(published[0].category, 'audio');
    const stored = JSON.parse(await fs.readFile(path.join(context.storageDirectory, 'media-index.json'), 'utf8'));
    assert.equal(stored.items[0].status, 'approved');
    assert.equal(stored.items[0].approvedByTelegramId, '7');
    assert.ok(stored.items[0].approvedAt);
    const file = await context.library.getApprovedFile(published[0].id);
    assert.equal(file.data.toString('utf8'), 'audio bytes');
    assert.ok(context.calls.some(function (call) {
      return call.url.includes('/sendMessage') &&
        JSON.parse(call.options.body).text.includes('تم نشر المحتوى تلقائيًا');
    }));
    const restarted = createMediaLibrary({
      env: context.env, fetch: context.fetch, storageDirectory: context.storageDirectory
    });
    assert.equal((await restarted.listApproved()).length, 1);
    await restarted.stop();
  });
});

test('does not store or publish files posted by ordinary group members', async function () {
  await withLibrary(async function (context) {
    const library = createMediaLibrary({
      env: context.env,
      fetch: async function (url, options) {
        context.calls.push({ url: url, options: options });
        if (url.includes('/getChatMember')) return jsonResponse({ status: 'member' });
        if (url.includes('/sendMessage')) return jsonResponse({ message_id: 101 });
        throw new Error('Unexpected request: ' + url);
      },
      storageDirectory: context.storageDirectory
    });
    await library.processUpdate(uploadUpdate(9));
    assert.deepEqual(await library.listApproved(), []);
    const stored = JSON.parse(await fs.readFile(path.join(context.storageDirectory, 'media-index.json'), 'utf8'));
    assert.equal(stored.items.length, 0);
    assert.ok(context.calls.some(function (call) { return call.url.includes('/getChatMember'); }));
    await library.stop();
  }, 'member');
});

test('lets a group administrator remove an already published item', async function () {
  await withLibrary(async function (context) {
    await context.library.processUpdate(uploadUpdate(7));
    const item = (await context.library.listApproved())[0];
    await context.library.processUpdate({
      update_id: 2,
      message: { chat: { id: -100123 }, from: { id: 7 }, text: '/media-remove ' + item.id }
    });
    assert.deepEqual(await context.library.listApproved(), []);
    await assert.rejects(fs.access(path.join(context.storageDirectory, 'media', item.id + '.mp3')));
  });
});

test('does not contact Telegram when media intake is disabled', async function () {
  await withLibrary(async function (context) {
    const disabledEnv = { ...context.env, TELEGRAM_MEDIA_ENABLED: 'false', TELEGRAM_BOT_ENABLED: 'false' };
    const library = createMediaLibrary({
      env: disabledEnv,
      fetch: async function () { throw new Error('Telegram must remain disabled'); },
      storageDirectory: context.storageDirectory
    });
    await library.start();
    await library.stop();
  });
});
