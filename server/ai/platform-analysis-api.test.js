'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createPlatformAnalysisApi } = require('./platform-analysis-api');

function response() {
  return {
    status: null, headers: {}, body: '',
    setHeader(key, value) { this.headers[key] = value; },
    writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers || {}); },
    end(body) { this.body = body || ''; }
  };
}
function request(method, headers = {}) {
  const req = Readable.from([]);
  req.method = method;
  req.headers = headers;
  return req;
}
const id = '123e4567-e89b-42d3-a456-426614174000';
const env = { SUPABASE_URL: 'https://project.example', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'server-only' };
function authenticatedFetch(url) {
  return url.endsWith('/auth/v1/user')
    ? { ok: true, json: async () => ({ id: 'admin-1' }) }
    : { ok: true, json: async () => [{ user_id: 'admin-1' }] };
}

test('platform analysis endpoint rejects unauthenticated and non-admin callers', async () => {
  const api = createPlatformAnalysisApi({
    env, fetch: async () => ({ ok: false }),
    suggestionService: { get: async () => { throw Error('must not read suggestion'); } },
    taskService: {}, analyze: async () => { throw Error('must not analyze'); }
  });
  const res = response();
  await api(request('POST'), res, '/api/admin/suggestions/' + id + '/analyze');
  assert.equal(res.status, 403);
});

test('platform analysis endpoint creates tainted task and stores structured model reports for admin', async () => {
  const calls = [];
  const api = createPlatformAnalysisApi({
    env, fetch: authenticatedFetch,
    suggestionService: {
      get: async () => ({ id, category: 'feature', title: 'سجل مراجعة', description: 'إضافة سجل تدقيق للمشرفين' }),
      recordAnalysis: async (suggestionId, analysis, risk) => {
        calls.push({ type: 'suggestion', suggestionId, analysis, risk });
        return { id: suggestionId, status: 'ANALYZED', ai_analysis: analysis };
      }
    },
    taskService: {
      create: async input => { calls.push({ type: 'task-create', input }); return { id: 'task-1', risk: 'low', tainted: true }; },
      recordAnalysis: async (taskId, analysis) => { calls.push({ type: 'task-analysis', taskId, analysis }); return { status: 'ANALYZED' }; }
    },
    analyze: async () => ({
      modelStatus: { gemini: 'ready', grok: 'failed' },
      models: { gemini: { text: 'raw response', analysis: { summary: 'ملخص', risks: ['مراجعة الصلاحيات'] } } }
    })
  });
  const res = response();
  await api(request('POST', { authorization: 'Bearer valid.token.value' }), res, '/api/admin/suggestions/' + id + '/analyze');
  assert.equal(res.status, 200);
  const payload = JSON.parse(res.body);
  assert.equal(payload.taskId, 'task-1');
  assert.equal(payload.tainted, true);
  assert.equal(payload.requiresHumanReview, true);
  assert.equal(calls[0].input.trustedSource, false);
  assert.equal(calls[1].taskId, 'task-1');
  assert.equal(calls[2].analysis.ai_analysis, undefined);
  assert.equal(calls[2].analysis.models.gemini.summary, 'ملخص');
});

test('platform analysis endpoint leaves suggestion unchanged when all providers fail', async () => {
  let taskCreated = false;
  let suggestionUpdated = false;
  const api = createPlatformAnalysisApi({
    env, fetch: authenticatedFetch,
    suggestionService: { get: async () => ({ id }) , recordAnalysis: async () => { suggestionUpdated = true; } },
    taskService: { create: async () => { taskCreated = true; } },
    analyze: async () => ({ modelStatus: { gemini: 'failed', grok: 'failed' }, models: {} })
  });
  const res = response();
  await api(request('POST', { authorization: 'Bearer valid.token.value' }), res, '/api/admin/suggestions/' + id + '/analyze');
  assert.equal(res.status, 503);
  assert.equal(taskCreated, false);
  assert.equal(suggestionUpdated, false);
});

test('platform analysis endpoint rate-limits before external calls', async () => {
  let authenticated = false;
  const api = createPlatformAnalysisApi({
    env, fetch: async () => { authenticated = true; return { ok: false }; },
    suggestionService: {}, taskService: {}, analyze: async () => ({}), rateLimit: () => false
  });
  const res = response();
  await api(request('POST'), res, '/api/admin/suggestions/' + id + '/analyze');
  assert.equal(res.status, 429);
  assert.equal(authenticated, false);
});
