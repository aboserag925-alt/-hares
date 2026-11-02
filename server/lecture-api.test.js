'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAdminApi, validateLecture } = require('./lecture-api');

const valid = {
  title: 'شرح صحيح الإمام مسلم',
  category: 'محاضرة',
  description: 'شرح علمي',
  starts_at: '2026-11-02T19:00:00.000Z',
  stream_url: 'https://example.com/live',
  recording_url: 'https://example.com/recording',
  status: 'published'
};

test('accepts a complete lecture with HTTPS media links', () => {
  assert.equal(validateLecture(valid, false), null);
});

test('rejects an empty or oversized title', () => {
  assert.match(validateLecture({ ...valid, title: ' ' }, false), /عنوان المحاضرة/);
  assert.match(validateLecture({ ...valid, title: 'x'.repeat(181) }, false), /عنوان المحاضرة/);
});

test('rejects insecure broadcast and recording URLs', () => {
  assert.match(validateLecture({ ...valid, stream_url: 'http://example.com/live' }, false), /HTTPS/);
  assert.match(validateLecture({ ...valid, recording_url: 'javascript:alert(1)' }, false), /HTTPS/);
});

test('rejects invalid publication states and unknown fields', () => {
  assert.match(validateLecture({ ...valid, status: 'public' }, false), /حالة النشر/);
  assert.match(validateLecture({ ...valid, is_admin: true }, false), /حقول غير معروفة/);
});

test('supports partial updates without requiring a title', () => {
  assert.equal(validateLecture({ status: 'archived' }, true), null);
});

test('rejects empty partial updates', () => {
  assert.match(validateLecture({}, true), /حقل واحد/);
});

test('POST to a specific lecture returns 405 and the supported item methods', async () => {
  const api = createAdminApi({
    env: {
      SUPABASE_URL: 'https://project.example',
      SUPABASE_ANON_KEY: 'anon',
      SUPABASE_SERVICE_ROLE_KEY: 'service'
    },
    fetch: async () => { throw new Error('POST to an item must not call Supabase'); }
  });
  const request = {
    method: 'POST',
    headers: {},
    [Symbol.asyncIterator]: async function* () {}
  };
  const response = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers || {}); },
    end(body) { this.body = body; }
  };
  const handled = await api(request, response, '/api/lectures/123e4567-e89b-42d3-a456-426614174000');
  assert.equal(handled, true);
  assert.equal(response.status, 405);
  assert.equal(response.headers.Allow, 'GET, PATCH, DELETE');
});
