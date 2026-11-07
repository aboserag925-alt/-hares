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
          steps: [{ type: 'model_output', content: [{ type: 'text', text: 'هذه مسودة للمراجعة.' }] }]
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
    const appHtml = await app.text();
    assert.match(appHtml, /استراحة أهل الأثر/);
    assert.match(appHtml, /id="questionTurnstile"/);
    assert.match(appHtml, /turnstile-config\.js/);
    const turnstileConfig = await fetch(baseUrl + '/app/turnstile-config.js');
    assert.equal(turnstileConfig.status, 200);
    assert.match(await turnstileConfig.text(), /AHL_TURNSTILE_SITE_KEY/);

    const envFile = await fetch(baseUrl + '/.env');
    assert.equal(envFile.status, 404);
  });
});

test('HTTP suggestions API accepts public suggestions and exposes admin listing only to verified admins', async function () {
  const suggestion = {
    id: '123e4567-e89b-42d3-a456-426614174000',
    category: 'feature',
    title: 'تحسين البحث',
    description: 'إضافة بحث أسرع إلى مكتبة الدروس'
  };
  const submitted = [];
  const env = {
    ...configuredEnv,
    SUPABASE_URL: 'https://project.example',
    SUPABASE_ANON_KEY: 'public-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key'
  };
  const provider = mockFetch();
  provider.fetch = async function (url, options) {
    provider.calls.push({ url: url, options: options });
    if (url.endsWith('/auth/v1/user')) {
      return {
        ok: true,
        status: 200,
        json: async function () { return { id: 'verified-admin' }; }
      };
    }
    if (url.includes('/rest/v1/admin_users?')) {
      return {
        ok: true,
        status: 200,
        json: async function () { return [{ user_id: 'verified-admin' }]; }
      };
    }
    throw new Error('Unexpected upstream request');
  };
  const suggestionService = {
    submit: async function (input, userId) {
      submitted.push({ input: input, userId: userId });
      return suggestion;
    },
    list: async function () { return [suggestion]; }
  };

  await withServer({
    env: env,
    fetch: provider.fetch,
    suggestionService: suggestionService,
    taskService: { recordHumanApproval: async function () { throw new Error('Unexpected approval'); } }
  }, async function (baseUrl) {
    const createResponse = await fetch(baseUrl + '/api/suggestions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: baseUrl },
      body: JSON.stringify({
        category: 'feature',
        title: 'تحسين البحث',
        description: 'إضافة بحث أسرع إلى مكتبة الدروس'
      })
    });
    assert.equal(createResponse.status, 201);
    assert.deepEqual((await createResponse.json()).item, suggestion);
    assert.deepEqual(submitted, [{
      input: {
        category: 'feature',
        title: 'تحسين البحث',
        description: 'إضافة بحث أسرع إلى مكتبة الدروس'
      },
      userId: null
    }]);

    const unauthorized = await fetch(baseUrl + '/api/admin/suggestions', {
      headers: { Origin: baseUrl }
    });
    assert.equal(unauthorized.status, 403);

    const adminList = await fetch(baseUrl + '/api/admin/suggestions', {
      headers: { Origin: baseUrl, Authorization: 'Bearer valid-admin-token' }
    });
    assert.equal(adminList.status, 200);
    assert.deepEqual((await adminList.json()).items, [suggestion]);
    assert.equal(provider.calls.length, 2);
  });
});

test('HTTP AI approval API verifies admin identity and records decisions through TaskService', async function () {
  const env = {
    ...configuredEnv,
    SUPABASE_URL: 'https://project.example',
    SUPABASE_ANON_KEY: 'public-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key'
  };
  const provider = mockFetch();
  provider.fetch = async function (url, options) {
    provider.calls.push({ url: url, options: options });
    if (url.endsWith('/auth/v1/user')) {
      return {
        ok: true,
        status: 200,
        json: async function () { return { id: 'verified-admin' }; }
      };
    }
    if (url.includes('/rest/v1/admin_users?')) {
      return {
        ok: true,
        status: 200,
        json: async function () { return [{ user_id: 'verified-admin' }]; }
      };
    }
    throw new Error('Unexpected upstream request');
  };
  const approvals = [];
  const taskService = {
    recordHumanApproval: async function (input) {
      approvals.push(input);
      return 'approval-record-id';
    }
  };
  const taskId = '123e4567-e89b-42d3-a456-426614174000';

  await withServer({
    env: env,
    fetch: provider.fetch,
    suggestionService: { submit: async function () {}, list: async function () {} },
    taskService: taskService
  }, async function (baseUrl) {
    const unauthorized = await fetch(baseUrl + '/api/admin/ai/tasks/' + taskId + '/approval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: baseUrl },
      body: JSON.stringify({ action: 'IMPLEMENT', decision: 'APPROVED' })
    });
    assert.equal(unauthorized.status, 403);
    assert.deepEqual(approvals, []);

    const response = await fetch(baseUrl + '/api/admin/ai/tasks/' + taskId + '/approval', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
        Authorization: 'Bearer valid-admin-token'
      },
      body: JSON.stringify({
        action: 'IMPLEMENT',
        decision: 'APPROVED',
        reason: 'راجع المشرف المهمة'
      })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { approvalId: 'approval-record-id' });
    assert.deepEqual(approvals, [{
      taskId: taskId,
      actorUserId: 'verified-admin',
      action: 'IMPLEMENT',
      decision: 'APPROVED',
      reason: 'راجع المشرف المهمة'
    }]);
  });
});

test('CORS preflight allows only required admin methods and headers', async function () {
  await withServer({ env: configuredEnv, fetch: mockFetch().fetch }, async function (baseUrl) {
    const response = await fetch(baseUrl + '/api/admin/suggestions/123e4567-e89b-42d3-a456-426614174000', {
      method: 'OPTIONS',
      headers: {
        Origin: baseUrl,
        'Access-Control-Request-Method': 'PATCH',
        'Access-Control-Request-Headers': 'authorization,content-type'
      }
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-methods'), 'GET, HEAD, POST, PATCH, DELETE, OPTIONS');
    assert.equal(response.headers.get('access-control-allow-headers'), 'Content-Type, Range, Authorization');
    assert.doesNotMatch(response.headers.get('access-control-allow-methods'), /\*/);
    assert.doesNotMatch(response.headers.get('access-control-allow-headers'), /\*/);

    const deletePreflight = await fetch(baseUrl + '/api/lectures/123e4567-e89b-42d3-a456-426614174000', {
      method: 'OPTIONS',
      headers: {
        Origin: baseUrl,
        'Access-Control-Request-Method': 'DELETE',
        'Access-Control-Request-Headers': 'authorization'
      }
    });
    assert.equal(deletePreflight.status, 204);
    assert.match(deletePreflight.headers.get('access-control-allow-methods'), /\bDELETE\b/);
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

test('fails closed when Turnstile is enabled and the question has no token', async function () {
  const provider = mockFetch();
  const env = { ...configuredEnv, TURNSTILE_ENABLED: 'true', TURNSTILE_SECRET_KEY: 'test-turnstile-secret' };
  await withServer({ env: env, fetch: provider.fetch }, async function (baseUrl) {
    const response = await fetch(baseUrl + '/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: baseUrl },
      body: JSON.stringify({ question: 'ما حكم هذا السؤال؟' })
    });
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /التحقق الأمني/);
    assert.equal(provider.calls.length, 0);
  });
});

test('fails closed when Turnstile rejects the submitted token', async function () {
  const calls = [];
  const provider = async function (url, options) {
    calls.push({ url: url, options: options });
    return {
      ok: true,
      arrayBuffer: async function () { return Buffer.from(JSON.stringify({ success: false }), 'utf8'); }
    };
  };
  const env = { ...configuredEnv, TURNSTILE_ENABLED: 'true', TURNSTILE_SECRET_KEY: 'test-turnstile-secret' };
  await withServer({ env: env, fetch: provider }, async function (baseUrl) {
    const response = await fetch(baseUrl + '/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: baseUrl },
      body: JSON.stringify({ question: 'ما حكم هذا السؤال؟', turnstileToken: 'invalid-token' })
    });
    assert.equal(response.status, 403);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /challenges\.cloudflare\.com\/turnstile\/v0\/siteverify/);
  });
});

test('fails closed when Turnstile verification service is unavailable', async function () {
  let calls = 0;
  const provider = async function () {
    calls += 1;
    throw new Error('network unavailable');
  };
  const env = { ...configuredEnv, TURNSTILE_ENABLED: 'true', TURNSTILE_SECRET_KEY: 'test-turnstile-secret' };
  await withServer({ env: env, fetch: provider }, async function (baseUrl) {
    const response = await fetch(baseUrl + '/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: baseUrl },
      body: JSON.stringify({ question: 'ما حكم هذا السؤال؟', turnstileToken: 'some-token' })
    });
    assert.equal(response.status, 503);
    assert.equal(calls, 1);
  });
});

test('fails closed when Turnstile is enabled without a server secret', async function () {
  const provider = mockFetch();
  const env = { ...configuredEnv, TURNSTILE_ENABLED: 'true' };
  await withServer({ env: env, fetch: provider.fetch }, async function (baseUrl) {
    const response = await fetch(baseUrl + '/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: baseUrl },
      body: JSON.stringify({ question: 'ما حكم هذا السؤال؟', turnstileToken: 'some-token' })
    });
    assert.equal(response.status, 503);
    assert.equal(provider.calls.length, 0);
  });
});

test('rejects successful Turnstile responses with the wrong action or hostname', async function () {
  const env = { ...configuredEnv, TURNSTILE_ENABLED: 'true', TURNSTILE_SECRET_KEY: 'test-turnstile-secret' };
  for (const invalidPayload of [
    { success: true, action: 'other_action', hostname: '127.0.0.1' },
    { success: true, action: 'submit_question', hostname: 'attacker.example' }
  ]) {
    let providerCalls = 0;
    const provider = async function () {
      providerCalls += 1;
      return {
        ok: true,
        arrayBuffer: async function () {
          return Buffer.from(JSON.stringify(invalidPayload), 'utf8');
        }
      };
    };
    await withServer({ env: env, fetch: provider }, async function (baseUrl) {
      const response = await fetch(baseUrl + '/api/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: baseUrl },
        body: JSON.stringify({ question: 'ما حكم هذا السؤال؟', turnstileToken: 'valid-looking-token' })
      });
      assert.equal(response.status, 403);
      assert.equal(providerCalls, 1);
    });
  }
});

test('verifies Turnstile before contacting Gemini or Telegram and checks action and hostname', async function () {
  const calls = [];
  const provider = async function (url, options) {
    calls.push({ url: url, options: options });
    if (url.includes('challenges.cloudflare.com')) {
      return {
        ok: true,
        arrayBuffer: async function () {
          return Buffer.from(JSON.stringify({
            success: true,
            action: 'submit_question',
            hostname: '127.0.0.1'
          }), 'utf8');
        }
      };
    }
    if (url.includes('generativelanguage.googleapis.com')) {
      return {
        ok: true,
        arrayBuffer: async function () {
          return Buffer.from(JSON.stringify({
            candidates: [{ content: { parts: [{ text: 'هذه مسودة للمراجعة.' }] } }]
          }), 'utf8');
        }
      };
    }
    return {
      ok: true,
      arrayBuffer: async function () { return Buffer.from(JSON.stringify({ ok: true }), 'utf8'); }
    };
  };
  const env = { ...configuredEnv, TURNSTILE_ENABLED: 'true', TURNSTILE_SECRET_KEY: 'test-turnstile-secret' };
  await withServer({ env: env, fetch: provider }, async function (baseUrl) {
    const response = await fetch(baseUrl + '/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: baseUrl },
      body: JSON.stringify({ question: 'ما حكم هذا السؤال؟', turnstileToken: 'valid-test-token' })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { draft: 'هذه مسودة للمراجعة.', telegramSent: true });
    assert.equal(calls.length, 3);
    assert.match(calls[0].url, /siteverify/);
    assert.match(calls[1].url, /generativelanguage\.googleapis\.com/);
    assert.match(calls[2].url, /api\.telegram\.org/);
    const verifyBody = new URLSearchParams(calls[0].options.body);
    assert.equal(verifyBody.get('secret'), 'test-turnstile-secret');
    assert.equal(verifyBody.get('response'), 'valid-test-token');
    assert.equal(verifyBody.get('remoteip'), '127.0.0.1');
    assert.equal(calls[1].options.body.includes('valid-test-token'), false);
    assert.equal(calls[2].options.body.includes('valid-test-token'), false);
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
            steps: [{ type: 'model_output', content: [{ type: 'text', text: 'مسودة صالحة للمراجعة.' }] }]
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

test('uses the validated Cloudflare client IP for rate limiting only when TRUST_PROXY is enabled', async function () {
  const provider = mockFetch();
  const env = { ...configuredEnv, TRUST_PROXY: 'true' };
  await withServer({ env: env, fetch: provider.fetch }, async function (baseUrl) {
    const statuses = [];
    for (let index = 0; index < 6; index += 1) {
      const response = await fetch(baseUrl + '/api/questions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: baseUrl,
          'CF-Connecting-IP': '203.0.113.10'
        },
        body: JSON.stringify({ question: 'سؤال من العميل خلف الوكيل رقم ' + index })
      });
      statuses.push(response.status);
    }
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
    const otherClient = await fetch(baseUrl + '/api/questions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
        'CF-Connecting-IP': '203.0.113.11'
      },
      body: JSON.stringify({ question: 'سؤال من عميل آخر خلف الوكيل' })
    });
    assert.equal(otherClient.status, 200);
  });
});

test('ignores spoofed Cloudflare client-IP headers unless TRUST_PROXY is enabled', async function () {
  const provider = mockFetch();
  await withServer({ env: configuredEnv, fetch: provider.fetch }, async function (baseUrl) {
    const statuses = [];
    for (let index = 0; index < 6; index += 1) {
      const response = await fetch(baseUrl + '/api/questions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: baseUrl,
          'CF-Connecting-IP': '198.51.100.' + (index + 1)
        },
        body: JSON.stringify({ question: 'سؤال مباشر رقم ' + index })
      });
      statuses.push(response.status);
    }
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
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
    assert.equal(response.headers.get('access-control-allow-methods'), 'GET, HEAD, POST, PATCH, DELETE, OPTIONS');
    assert.match(response.headers.get('access-control-allow-headers'), /Content-Type/i);
    assert.match(response.headers.get('access-control-allow-headers'), /Authorization/i);
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
