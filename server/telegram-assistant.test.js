'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTelegramAssistant } = require('./telegram-assistant');

function fixture() {
  const calls = [];
  const assistant = createTelegramAssistant({
    env: { TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_CHAT_ID: '-100123', SITE_URL: 'https://example.test/' },
    fetch: async function (url, options) {
      calls.push({ url: url, body: JSON.parse(options.body) });
      return { ok: true, json: async function () { return { ok: true, result: { message_id: 7 } }; } };
    }
  });
  return { assistant: assistant, calls: calls };
}

test('greets a private user with the platform menu', async function () {
  const f = fixture();
  await f.assistant.processUpdate({ message: { chat: { id: 42, type: 'private' }, from: { id: 42, first_name: 'Ali' }, text: '/start' } });
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0].body.text, /استراحة أهل الأثر/);
  assert.equal(f.calls[0].body.reply_markup.inline_keyboard.length, 5);
});

test('does not answer group messages', async function () {
  const f = fixture();
  await f.assistant.processUpdate({ message: { chat: { id: -100, type: 'group' }, from: { id: 42 }, text: 'مرحبا' } });
  assert.equal(f.calls.length, 0);
});

test('forwards private questions for human review and acknowledges receipt', async function () {
  const f = fixture();
  await f.assistant.processUpdate({ message: { chat: { id: 42, type: 'private' }, from: { id: 42, first_name: 'Ali' }, text: 'ما حكم المسألة الفلانية؟' } });
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].body.chat_id, '-100123');
  assert.match(f.calls[0].body.text, /ما حكم المسألة الفلانية/);
  assert.match(f.calls[1].body.text, /المراجعة/);
});

test('honors stop until the user starts again', async function () {
  const f = fixture();
  const message = { chat: { id: 42, type: 'private' }, from: { id: 42 }, text: '/stop' };
  await f.assistant.processUpdate({ message });
  await f.assistant.processUpdate({ message: { ...message, text: 'سؤال جديد ومهم' } });
  assert.equal(f.calls.length, 1);
  await f.assistant.processUpdate({ message: { ...message, text: '/start' } });
  await f.assistant.processUpdate({ message: { ...message, text: 'سؤال جديد ومهم' } });
  assert.equal(f.calls.length, 4);
});

test('answers assistant callbacks without treating them as media approvals', async function () {
  const f = fixture();
  await f.assistant.processUpdate({ callback_query: { id: 'cb1', data: 'haress:help', message: { chat: { id: 42, type: 'private' } } } });
  assert.equal(f.calls.length, 2);
  assert.match(f.calls[1].body.text, /معلومات خاصة/);
});

test('rejects messages longer than the supported limit', async function () {
  const f = fixture();
  await f.assistant.processUpdate({ message: { chat: { id: 42, type: 'private' }, from: { id: 42 }, text: 'س'.repeat(1201) } });
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0].body.text, /1200/);
});
