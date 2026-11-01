'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { createServer } = require('./index');

const configuredEnv = {
  GEMINI_API_KEY: 'test-gemini-key',
  TELEGRAM_BOT_TOKEN: 'test-telegram-token',
  TELEGRAM_CHAT_ID: '-1002660217755'
};

async function withServer(options, run) {
  const server = createServer(options);
  await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  try {
    await run('http://127.0.0.1:' + address.port);
  } finally {
    await new Promise(function (resolve, reject) {
      server.close(function (error) { if (error) reject(error); else resolve(); });
    });
  }
}

function mockFetch() {
  const calls = [];
  function jsonResponse(payload, status) {
    return {
      ok: status === undefined || (status >= 200 && status < 300),
      status: status === undefined ? 200 : status,
      arrayBuffer: async function () {
        return Buffer.from(JSON.stringify(payload), 'utf8');
      }
    };
  }
  return {
    calls: calls,
    fetch: async function (url, options) {
      calls.push({ url: url, options: options });
      if (url.includes('generativelanguage.googleapis.com')) {
        return jsonResponse({
          candidates: [{ content: { parts: [{ text: 'هذه مسودة للمراجعة.' }] } }]
        });
      }
      return jsonResponse({ ok: true });
    }
  };
}

test('serves the app and health status without exposing environment values', async function () {
  await withServer({ env: configuredEnv, fetch: mockFetch().fetch }, async function (baseUrl) {
    const health = await fetch(baseUrl + '/api/health');
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true });

    const app = await fetch(baseUrl + '/app/');
    assert.equal(app.status, 200);
    assert.match(await app.text(), /استراحة أهل الأثر/);

    const envFile = await fetch(baseUrl + '/.env');
    assert.equal(envFile.status, 404);
  });
});

test('publishes only approved library items and serves their files safely', async function () {
  const fileId = '123e4567-e89b-42d3-a456-426614174000';
  let approved = false;
  const mediaLibrary = {
    listApproved: async function () {
      return approved ? [{
        id: fileId,
        title: 'درس عربي',
        category: 'audio',
        categoryName: 'صوتيات',
        kind: 'audio',
        mimeType: 'audio/mpeg',
        fileName: 'lesson.mp3',
        uploadedAt: '2026-10-31T12:00:00.000Z',
        url: '/api/library/files/' + fileId
      }] : [];
    },
    getApprovedFile: async function (id) {
      return approved && id === fileId
        ? { item: { kind: 'audio', mimeType: 'audio/mpeg', fileName: 'lesson.mp3' }, data: Buffer.from('audio') }
        : null;
    }
  };
  await withServer({ env: configuredEnv, fetch: mockFetch().fetch, mediaLibrary: mediaLibrary }, async function (baseUrl) {
    const list = await fetch(baseUrl + '/api/library');
    assert.equal(list.status, 200);
    assert.deepEqual(await list.json(), { items: [] });
    assert.equal((await fetch(baseUrl + '/api/library/files/' + fileId)).status, 404);

    approved = true;
    const published = await fetch(baseUrl + '/api/library');
    assert.equal((await published.json()).items[0].title, 'درس عربي');
    const file = await fetch(baseUrl + '/api/library/files/' + fileId);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), 'audio/mpeg');
    assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(await file.text(), 'audio');
    const rangedFile = await fetch(baseUrl + '/api/library/files/' + fileId, {
      headers: { Range: 'bytes=1-3' }
    });
    assert.equal(rangedFile.status, 206);
    assert.equal(rangedFile.headers.get('content-range'), 'bytes 1-3/5');
    assert.equal(await rangedFile.text(), 'udi');
  });
});

test('rejects cross-origin question requests before calling providers', async function () {
  const provider = mockFetch();
  await withServer({ env: configuredEnv, fetch: provider.fetch }, async function (baseUrl) {
    const response = await fetch(baseUrl + '/api/questions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://attacker.example'
      },
      body: JSON.stringify({ question: 'ما حكم هذا الأمر؟' })
    });
    assert.equal(response.status, 403);
    assert.equal(provider.calls.length, 0);
  });
});

test('rejects question bodies that are not valid UTF-8', async function () {
  const provider = mockFetch();
  await withServer({ env: configuredEnv, fetch: provider.fetch }, async function (baseUrl) {
    const response = await fetch(baseUrl + '/api/questions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Origin: baseUrl
      },
      body: new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d])
    });
    assert.equal(response.status, 400);
    assert.equal(provider.calls.length, 0);
  });
});

test('sends an Arabic question to Gemini and the draft to the configured Telegram chat', async function () {
  const provider = mockFetch();
  await withServer({ env: configuredEnv, fetch: provider.fetch }, async function (baseUrl) {
    const response = await fetch(baseUrl + '/api/questions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl
      },
      body: JSON.stringify({ question: 'ما حكم هذا السؤال؟' })
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      draft: 'هذه مسودة للمراجعة.',
      telegramSent: true
    });
    assert.equal(provider.calls.length, 2);
    assert.equal(provider.calls[0].options.headers['x-goog-api-key'], configuredEnv.GEMINI_API_KEY);
    assert.equal(provider.calls[0].options.headers.Accept, 'application/json; charset=utf-8');
    assert.equal(provider.calls[1].options.headers.Accept, 'application/json; charset=utf-8');
    const telegramBody = JSON.parse(provider.calls[1].options.body);
    assert.equal(telegramBody.chat_id, configuredEnv.TELEGRAM_CHAT_ID);
    assert.match(telegramBody.text, /ما حكم هذا السؤال؟/);
    assert.match(telegramBody.text, /هذه مسودة للمراجعة/);
  });
});

test('rejects provider responses that are not valid UTF-8', async function () {
  const provider = mockFetch();
  provider.fetch = async function () {
    return {
      ok: true,
      arrayBuffer: async function () {
        return new Uint8Array([0x7b, 0xff, 0x7d]).buffer;
      }
    };
  };

  await withServer({ env: configuredEnv, fetch: provider.fetch }, async function (baseUrl) {
    const response = await fetch(baseUrl + '/api/questions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Origin: baseUrl
      },
      body: JSON.stringify({ question: 'ما حكم هذا السؤال؟' })
    });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      error: 'تعذر معالجة السؤال الآن. حاول لاحقًا.'
    });
  });
});

test('reports Telegram delivery failure while preserving the generated draft', async function () {
  const provider = mockFetch();
  provider.fetch = async function (url) {
    if (url.includes('generativelanguage.googleapis.com')) {
      return {
        ok: true,
        arrayBuffer: async function () {
          return Buffer.from(JSON.stringify({
            candidates: [{ content: { parts: [{ text: 'مسودة صالحة للمراجعة.' }] } }]
          }), 'utf8');
        }
      };
    }
    return { ok: false, status: 503 };
  };

  await withServer({ env: configuredEnv, fetch: provider.fetch }, async function (baseUrl) {
    const response = await fetch(baseUrl + '/api/questions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl
      },
      body: JSON.stringify({ question: 'ما حكم هذا السؤال؟' })
    });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      error: 'تعذر تأكيد إرسال السؤال إلى Telegram.',
      draft: 'مسودة صالحة للمراجعة.',
      telegramSent: false
    });
  });
});

test('requires a question within the configured length limits', async function () {
  const provider = mockFetch();
  await withServer({ env: configuredEnv, fetch: provider.fetch }, async function (baseUrl) {
    const response = await fetch(baseUrl + '/api/questions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl
      },
      body: JSON.stringify({ question: 'قصير' })
    });
    assert.equal(response.status, 400);
    assert.equal(provider.calls.length, 0);
  });
});

test('limits each client to five question requests per fifteen-minute window', async function () {
  const provider = mockFetch();
  await withServer({ env: configuredEnv, fetch: provider.fetch }, async function (baseUrl) {
    const statuses = [];
    for (let index = 0; index < 6; index += 1) {
      const response = await fetch(baseUrl + '/api/questions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: baseUrl
        },
        body: JSON.stringify({ question: 'ما حكم هذا السؤال رقم ' + index + '؟' })
      });
      statuses.push(response.status);
    }

    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
    assert.equal(provider.calls.length, 10);
  });
});

test('does not contact providers when server credentials are missing', async function () {
  const provider = mockFetch();
  await withServer({ env: {}, fetch: provider.fetch }, async function (baseUrl) {
    const response = await fetch(baseUrl + '/api/questions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl
      },
      body: JSON.stringify({ question: 'ما حكم هذا السؤال؟' })
    });

    assert.equal(response.status, 503);
    assert.equal(provider.calls.length, 0);
  });
});


test('handles allowlisted CORS preflight requests for API endpoints', async function () {
  const env = { ...configuredEnv, ALLOWED_ORIGINS: 'https://app.example' };
  await withServer({ env: env, fetch: mockFetch().fetch }, async function (baseUrl) {
    const response = await fetch(baseUrl + '/api/questions', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://app.example',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type'
      }
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://app.example');
    assert.equal(response.headers.get('access-control-allow-methods'), 'GET, HEAD, POST, OPTIONS');
    assert.match(response.headers.get('access-control-allow-headers'), /Content-Type/i);
    assert.equal(response.headers.get('vary'), 'Origin');
  });
});

test('rejects disallowed CORS preflight requests without reflecting their origin', async function () {
  const env = { ...configuredEnv, ALLOWED_ORIGINS: 'https://app.example' };
  await withServer({ env: env, fetch: mockFetch().fetch }, async function (baseUrl) {
    const response = await fetch(baseUrl + '/api/library', {
      method: 'OPTIONS',
      headers: { Origin: 'https://attacker.example' }
    });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  });
});

test('adds allowlisted CORS headers to library and media responses', async function () {
  const fileId = '123e4567-e89b-42d3-a456-426614174000';
  const env = { ...configuredEnv, ALLOWED_ORIGINS: 'https://app.example' };
  const mediaLibrary = {
    listApproved: async function () { return []; },
    getApprovedFile: async function () {
      return {
        item: { kind: 'audio', mimeType: 'audio/mpeg', fileName: 'lesson.mp3' },
        data: Buffer.from('audio')
      };
    }
  };
  await withServer({ env: env, fetch: mockFetch().fetch, mediaLibrary: mediaLibrary }, async function (baseUrl) {
    const list = await fetch(baseUrl + '/api/library', {
      headers: { Origin: 'https://app.example' }
    });
    assert.equal(list.status, 200);
    assert.equal(list.headers.get('access-control-allow-origin'), 'https://app.example');

    const file = await fetch(baseUrl + '/api/library/files/' + fileId, {
      headers: { Origin: 'https://app.example' }
    });
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('access-control-allow-origin'), 'https://app.example');
    assert.match(file.headers.get('access-control-expose-headers'), /Content-Range/i);
  });
});


test('lecture API returns published lectures through the server service role only', async function () {
  const calls = [];
  const env = {
    SUPABASE_URL: 'https://project.example',
    SUPABASE_ANON_KEY: 'public-test-key',
    SUPABASE_SERVICE_ROLE_KEY: 'server-only-test-key'
  };
  const fetchMock = async function (url, options) {
    calls.push({ url: url, options: options });
    return {
      ok: true,
      status: 200,
      json: async function () {
        return [{ id: '123e4567-e89b-42d3-a456-426614174000', title: 'درس منشور', status: 'published' }];
      }
    };
  };
  await withServer({ env: env, fetch: fetchMock }, async function (baseUrl) {
    const response = await fetch(baseUrl + '/api/lectures');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).items[0].title, 'درس منشور');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://project.example/rest/v1/lectures?select=id,title,description,starts_at,category,stream_url,recording_url,status,created_at,updated_at&status=eq.published&order=starts_at.asc.nullslast');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer server-only-test-key');
  });
});

test('lecture API rejects writes from visitors without a verified admin account', async function () {
  let restCalled = false;
  const env = {
    SUPABASE_URL: 'https://project.example',
    SUPABASE_ANON_KEY: 'public-test-key',
    SUPABASE_SERVICE_ROLE_KEY: 'server-only-test-key'
  };
  const fetchMock = async function () {
    restCalled = true;
    return { ok: false, status: 401, json: async function () { return {}; } };
  };
  await withServer({ env: env, fetch: fetchMock }, async function (baseUrl) {
    const response = await fetch(baseUrl + '/api/lectures', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'محاضرة تجريبية' })
    });
    assert.equal(response.status, 403);
    assert.equal(restCalled, false);
    assert.match((await response.json()).error, /المشرفين/);
  });
});

test('lecture API requires server-side Supabase credentials before serving admin features', async function () {
  await withServer({ env: {}, fetch: mockFetch().fetch }, async function (baseUrl) {
    const response = await fetch(baseUrl + '/api/lectures');
    assert.equal(response.status, 503);
  });
});
