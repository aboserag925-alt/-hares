'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeSuggestion, parseAnalysis, SYSTEM_PROMPT } = require('./platform-analysis');

function jsonResponse(payload, status = 200) {
  const bytes = Buffer.from(JSON.stringify(payload));
  return { ok: status >= 200 && status < 300, status, arrayBuffer: async () => bytes };
}
const suggestion = {
  category: 'feature',
  title: 'إضافة سجل مراجعة',
  description: 'إظهار سجل مراجعة التعديلات للمشرفين فقط'
};
const report = {
  summary: 'اقتراح مفيد مع ضرورة ضبط الصلاحيات.',
  gaps: ['لا يوجد سجل تغييرات واضح'],
  risks: ['تسرب بيانات إدارية'],
  implementationPlan: ['إضافة سجل تدقيق'],
  tests: ['اختبار صلاحيات المشرف'],
  securityNotes: ['عدم كشف مفاتيح الخدمة']
};

test('parseAnalysis bounds and normalizes structured model output', () => {
  const parsed = parseAnalysis(JSON.stringify({
    ...report,
    gaps: Array.from({ length: 15 }, (_, i) => 'gap-' + i),
    ignored: 'field'
  }));
  assert.equal(parsed.summary, report.summary);
  assert.equal(parsed.gaps.length, 10);
  assert.equal(parsed.ignored, undefined);
});

test('parseAnalysis falls back safely for malformed JSON', () => {
  const parsed = parseAnalysis('not-json');
  assert.equal(parsed.summary, 'not-json');
  assert.deepEqual(parsed.gaps, []);
  assert.ok(parsed.securityNotes.length > 0);
});

test('analysis calls both providers statelessly and returns normalized reports', async () => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('generativelanguage.googleapis.com')) {
      return jsonResponse({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(report) }] }] });
    }
    return jsonResponse({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(report) }] }] });
  };
  const result = await analyzeSuggestion(suggestion, {
    env: { GEMINI_API_KEY: 'gemini-test-secret', GROK_API_KEY: 'grok-test-secret' },
    fetch
  });
  assert.equal(calls.length, 2);
  assert.equal(result.modelStatus.gemini, 'ready');
  assert.equal(result.modelStatus.grok, 'ready');
  assert.equal(result.models.gemini.analysis.summary, report.summary);
  assert.equal(result.models.grok.analysis.summary, report.summary);
  for (const call of calls) {
    const body = JSON.parse(call.options.body);
    assert.equal(body.store, false);
    assert.match(body.system_instruction || body.input[0].content, /غير موثوقة/);
    assert.doesNotMatch(JSON.stringify(body), /gemini-test-secret|grok-test-secret/);
  }
});

test('one provider failure does not discard the other provider result', async () => {
  const fetch = async (url) => {
    if (url.includes('generativelanguage.googleapis.com')) return jsonResponse({ steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(report) }] }] });
    return jsonResponse({ error: 'unavailable' }, 503);
  };
  const result = await analyzeSuggestion(suggestion, {
    env: { GEMINI_API_KEY: 'gemini-test-secret', GROK_API_KEY: 'grok-test-secret' },
    fetch
  });
  assert.equal(result.modelStatus.gemini, 'ready');
  assert.equal(result.modelStatus.grok, 'failed');
  assert.equal(result.models.grok, undefined);
});

test('analysis reports unconfigured providers without making network calls', async () => {
  let called = false;
  const result = await analyzeSuggestion(suggestion, { env: {}, fetch: async () => { called = true; } });
  assert.equal(called, false);
  assert.deepEqual(result.modelStatus, { gemini: 'not_configured', grok: 'disabled' });
  assert.deepEqual(result.models, {});
});

test('system prompt explicitly treats submitted suggestion text as untrusted', () => {
  assert.match(SYSTEM_PROMPT, /غير موثوقة/);
  assert.match(SYSTEM_PROMPT, /لا تنفذ/);
});
