'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTelegramAssistant } = require('./telegram-assistant');

function fixture(sharedPreferences) {
  const calls = [];
  const preferences = sharedPreferences || new Map();
  const env = {
    TELEGRAM_BOT_TOKEN: 'test-token',
    TELEGRAM_CHAT_ID: '-100123',
    SITE_URL: 'https://example.test/',
    SUPABASE_URL: 'https://project.example',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role'
  };
  const fetch = async function (url, options) {
    if (url.startsWith('https://project.example/rest/v1/telegram_user_preferences')) {
      const method = options.method || 'GET';
      const id = Number((url.match(/telegram_user_id=eq\.([^&]+)/) || [])[1] || JSON.parse(options.body || '{}').telegram_user_id);
      if (method === 'GET') {
        return {
          ok: true,
          json: async function () {
            return preferences.has(id) ? [{ opted_out: preferences.get(id) }] : [];
          }
        };
      }
      if (method === 'POST') {
        preferences.set(id, Boolean(JSON.parse(options.body).opted_out));
        return { ok: true, json: async function () { return []; } };
      }
    }
    calls.push({ url: url, body: JSON.parse(options.body) });
    return { ok: true, json: async function () { return { ok: true, result: { message_id: 7 } }; } };
  };
  return {
    assistant: createTelegramAssistant({ env: env, fetch: fetch }),
    restart: function () { return createTelegramAssistant({ env: env, fetch: fetch }); },
    calls: calls,
    preferences: preferences
  };
}

test('greets a private user with the platform menu after saving the opt-in preference', async function () {
  const f = fixture();
  await f.assistant.processUpdate({ message: { chat: { id: 42, type: 'private' }, from: { id: 42, first_name: 'Ali' }, text: '/start' } });
  assert.equal(f.preferences.get(42), false);
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

test('persists stop across assistant restarts until the user starts again', async function () {
  const f = fixture();
  const message = { chat: { id: 42, type: 'private' }, from: { id: 42 }, text: '/stop' };
  await f.assistant.processUpdate({ message: message });
  assert.equal(f.preferences.get(42), true);
  await f.assistant.processUpdate({ message: { ...message, text: 'سؤال جديد ومهم' } });
  assert.equal(f.calls.length, 1);

  const restarted = f.restart();
  await restarted.processUpdate({ message: { ...message, text: 'سؤال بعد إعادة التشغيل' } });
  assert.equal(f.calls.length, 1);

  await restarted.processUpdate({ message: { ...message, text: '/start' } });
  assert.equal(f.preferences.get(42), false);
  await restarted.processUpdate({ message: { ...message, text: 'سؤال جديد ومهم' } });
  assert.equal(f.calls.length, 4);
});

test('fails closed when privacy preference storage is unavailable', async function () {
  const calls = [];
  const assistant = createTelegramAssistant({
    env: {
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_CHAT_ID: '-100123',
      SUPABASE_URL: 'https://project.example',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role'
    },
    fetch: async function (url, options) {
      if (url.includes('/rest/v1/telegram_user_preferences')) return { ok: false, json: async function () { return []; } };
      calls.push(JSON.parse(options.body));
      return { ok: true, json: async function () { return { ok: true, result: {} }; } };
    }
  });
  await assistant.processUpdate({ message: { chat: { id: 42, type: 'private' }, from: { id: 42 }, text: 'سؤال مهم يحتاج مراجعة' } });
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /حماية خصوصيتك/);
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
