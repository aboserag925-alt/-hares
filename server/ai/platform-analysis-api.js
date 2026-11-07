'use strict';
const MAX_PATH_ID = /^\/api\/admin\/suggestions\/([0-9a-f-]{36})\/analyze$/i;
function send(res, status, payload) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(payload));
}
function createPlatformAnalysisApi({ env, fetch: fetchImpl = global.fetch, suggestionService, taskService, analyze, rateLimit = () => true }) {
  async function authenticate(req) {
    const match = (req.headers.authorization || '').match(/^Bearer\s+([A-Za-z0-9._~-]+)$/i);
    if (!match || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
    const base = env.SUPABASE_URL.replace(/\/$/, '');
    const auth = await fetchImpl(base + '/auth/v1/user', {
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + match[1] },
      signal: AbortSignal.timeout(10000)
    });
    if (!auth.ok) return null;
    const user = await auth.json();
    if (!user || !user.id) return null;
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    const admin = await fetchImpl(base + '/rest/v1/admin_users?select=user_id&user_id=eq.' + encodeURIComponent(user.id) + '&limit=1', {
      headers: { apikey: key, Authorization: 'Bearer ' + key },
      signal: AbortSignal.timeout(10000)
    });
    if (!admin.ok) return null;
    const rows = await admin.json();
    return rows.length ? user : null;
  }
  return async function handle(req, res, pathname) {
    const match = pathname.match(MAX_PATH_ID);
    if (!match) return false;
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      send(res, 405, { error: 'طريقة الطلب غير مدعومة.' });
      return true;
    }
    if (!rateLimit(req)) {
      send(res, 429, { error: 'تجاوزت حد التحليل. حاول لاحقًا.' });
      return true;
    }
    try {
      const user = await authenticate(req);
      if (!user) {
        send(res, 403, { error: 'تحليل الاقتراحات متاح للمشرفين المصرح لهم فقط.' });
        return true;
      }
      const suggestion = await suggestionService.get(match[1]);
      if (!suggestion) {
        send(res, 404, { error: 'الاقتراح غير موجود.' });
        return true;
      }
      const result = await analyze(suggestion, { env, fetch: fetchImpl });
      const modelNames = Object.keys(result.models || {});
      if (!modelNames.length) {
        send(res, 503, { error: 'لم تتوفر استجابة من نماذج التحليل. لم يتم تغيير حالة الاقتراح.', modelStatus: result.modelStatus });
        return true;
      }
      const task = await taskService.create({
        suggestionId: suggestion.id,
        source: 'suggestion',
        trustedSource: false,
        affectedAreas: []
      });
      await taskService.recordAnalysis(task.id, {
        task: { status: 'ANALYZED' },
        reports: [],
        models: result.models
      });
      const persisted = {
        taskId: task.id,
        tainted: true,
        requiresHumanReview: true,
        modelStatus: result.modelStatus,
        models: Object.fromEntries(modelNames.map(name => [name, result.models[name].analysis]))
      };
      const item = await suggestionService.recordAnalysis(suggestion.id, persisted, task.risk || 'low');
      send(res, 200, {
        item,
        taskId: task.id,
        tainted: true,
        requiresHumanReview: true,
        modelStatus: result.modelStatus,
        models: persisted.models
      });
    } catch (error) {
      send(res, error.statusCode || 502, { error: error.statusCode ? error.message : 'تعذر تحليل الاقتراح أو حفظ التقرير.' });
    }
    return true;
  };
}
module.exports = { createPlatformAnalysisApi };
