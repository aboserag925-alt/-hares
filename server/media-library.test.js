'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createMediaLibrary } = require('./media-library');

function telegramResponse(payload) {
  return {
    ok: true,
    arrayBuffer: async function () {
      return Buffer.from(JSON.stringify({ ok: true, result: payload }), 'utf8');
    }
  };
}

async function withLibrary(run, customFetch) {
  const storageDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ahl-media-test-'));
  const calls = [];
  const responder = customFetch || async function (url) {
    if (url.includes('/getFile')) return telegramResponse({ file_path: 'documents/lesson.mp3' });
    if (url.includes('/getChatMember')) return telegramResponse({ status: 'administrator' });
    if (url.includes('/sendMessage')) return telegramResponse({ message_id: 101 });
    if (url.includes('/answerCallbackQuery')) return telegramResponse(true);
    if (url.includes('/editMessageText')) return telegramResponse({ message_id: 101 });
    if (url.includes('/file/bot')) {
      return { ok: true, arrayBuffer: async function () { return Buffer.from('audio bytes'); } };
    }
    throw new Error('Unexpected mocked Telegram request');
  };
  const fetch = async function (url, options) {
    calls.push({ url: url, options: options });
    return responder(url, options);
  };
  const env = {
    TELEGRAM_BOT_TOKEN: 'test-token',
    TELEGRAM_MEDIA_ENABLED: 'false',
    TELEGRAM_MEDIA_GROUP_ID: '-100123'
  };
  try {
    await run({
      calls: calls,
      env: env,
      fetch: fetch,
      storageDirectory: storageDirectory,
      library: createMediaLibrary({
        env: env,
        fetch: fetch,
        storageDirectory: storageDirectory
      })
    });
  } finally {
    await fs.rm(storageDirectory, { recursive: true, force: true });
  }
}

test('stores group uploads privately until an administrator approves them', async function () {
  await withLibrary(async function (context) {
    await context.library.processUpdate({
      update_id: 1,
      message: {
        chat: { id: -100123 },
        date: 1793500000,
        caption: 'درس الخميس #كتب',
        document: {
          file_id: 'telegram-file-id',
          file_unique_id: 'telegram-unique-id',
          file_name: 'lesson.mp3',
          mime_type: 'audio/mpeg',
          file_size: 11
        }
      }
    });
    assert.deepEqual(await context.library.listApproved(), []);
    assert.deepEqual(await context.library.listApproved(), []);

    const storedIndex = JSON.parse(await fs.readFile(
      path.join(context.storageDirectory, 'media-index.json'),
      'utf8'
    ));
    const pending = storedIndex.items[0];
    assert.equal(pending.status, 'pending');
    assert.equal(pending.title, 'درس الخميس');
    assert.equal(pending.category, 'books');

    const approvalRequest = context.calls.find(function (call) {
      return call.url.includes('/sendMessage');
    });
    const approvalPayload = JSON.parse(approvalRequest.options.body);
    const approvalData = approvalPayload.reply_markup.inline_keyboard[0][0].callback_data;
    await context.library.processUpdate({
      update_id: 2,
      callback_query: {
        id: 'callback-id',
        data: approvalData,
        from: { id: 7 },
        message: { message_id: 101, chat: { id: -100123 } }
      }
    });

    const published = await context.library.listApproved();
    assert.equal(published.length, 1);
    assert.equal(published[0].title, 'درس الخميس');
    assert.equal(published[0].category, 'books');
    const file = await context.library.getApprovedFile(published[0].id);
    assert.equal(file.item.mimeType, 'audio/mpeg');
    assert.equal(file.data.toString('utf8'), 'audio bytes');

    const restarted = createMediaLibrary({
      env: context.env,
      fetch: context.fetch,
      storageDirectory: context.storageDirectory
    });
    assert.equal((await restarted.listApproved()).length, 1);
  });
});

test('rejects approval actions from non-administrators', async function () {
  await withLibrary(async function (context) {
    await context.library.processUpdate({
      update_id: 1,
      message: {
        chat: { id: -100123 },
        caption: 'درس جديد',
        document: {
          file_id: 'telegram-file-id',
          file_unique_id: 'telegram-unique-id',
          file_name: 'lesson.mp3',
          file_size: 11
        }
      }
    });
    const index = JSON.parse(await fs.readFile(
      path.join(context.storageDirectory, 'media-index.json'),
      'utf8'
    ));
    const message = context.calls.find(function (call) {
      return call.url.includes('/sendMessage');
    });
    const payload = JSON.parse(message.options.body);
    const callbackData = payload.reply_markup.inline_keyboard[0][0].callback_data;
    context.fetch = async function (url) {
      context.calls.push({ url: url });
      if (url.includes('/getChatMember')) return telegramResponse({ status: 'member' });
      if (url.includes('/answerCallbackQuery')) return telegramResponse(true);
      throw new Error('Unexpected mocked Telegram request');
    };
    const library = createMediaLibrary({
      env: context.env,
      fetch: context.fetch,
      storageDirectory: context.storageDirectory
    });
    await library.processUpdate({
      update_id: 2,
      callback_query: {
        id: 'callback-id',
        data: callbackData,
        from: { id: 8 },
        message: { message_id: 101, chat: { id: -100123 } }
      }
    });
    assert.equal(index.items[0].status, 'pending');
    assert.deepEqual(await library.listApproved(), []);
  });
});

test('allows an administrator to remove an approved file from the public library', async function () {
  await withLibrary(async function (context) {
    await context.library.processUpdate({
      update_id: 1,
      message: {
        chat: { id: -100123 },
        from: { id: 7 },
        caption: 'درس جديد',
        document: {
          file_id: 'telegram-file-id',
          file_unique_id: 'telegram-unique-id',
          file_name: 'lesson.mp3',
          file_size: 11
        }
      }
    });
    const approvalMessage = context.calls.find(function (call) {
      return call.url.includes('/sendMessage');
    });
    const approvalPayload = JSON.parse(approvalMessage.options.body);
    await context.library.processUpdate({
      update_id: 2,
      callback_query: {
        id: 'callback-id',
        data: approvalPayload.reply_markup.inline_keyboard[0][0].callback_data,
        from: { id: 7 },
        message: { message_id: 101, chat: { id: -100123 } }
      }
    });
    const item = (await context.library.listApproved())[0];

    await context.library.processUpdate({
      update_id: 3,
      message: {
        chat: { id: -100123 },
        from: { id: 7 },
        text: '/media-remove ' + item.id
      }
    });

    assert.deepEqual(await context.library.listApproved(), []);
    await assert.rejects(fs.access(path.join(context.storageDirectory, 'media', item.id + '.mp3')));
  });
});

test('does not contact Telegram when media intake is disabled', async function () {
  await withLibrary(async function (context) {
    await context.library.start();
    assert.equal(context.calls.length, 0);
  });
});
