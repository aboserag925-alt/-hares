'use strict';

const MAX_TITLE = 180;
const MAX_DESCRIPTION = 4000;

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(JSON.stringify(body));
}

function validUrl(value) {
  if (value === null || value === undefined || value === '') return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validateLecture(body, partial) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'بيانات المحاضرة غير صالحة.';
  const fields = ['title', 'description', 'starts_at', 'category', 'stream_url', 'recording_url', 'status'];
  if (Object.keys(body).some((key) => !fields.includes(key))) return 'توجد حقول غير معروفة.';
  if (!partial || Object.hasOwn(body, 'title')) {
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > MAX_TITLE) return 'عنوان المحاضرة مطلوب وبحد أقصى 180 حرفًا.';
  }
  if (Object.hasOwn(body, 'description') &&
      (typeof body.description !== 'string' || body.description.length > MAX_DESCRIPTION)) return 'الوصف أطول من المسموح.';
  if (Object.hasOwn(body, 'starts_at') && body.starts_at !== null &&
      (typeof body.starts_at !== 'string' || !Number.isFinite(Date.parse(body.starts_at)))) return 'موعد المحاضرة غير صالح.';
  if (Object.hasOwn(body, 'category') &&
      (typeof body.category !== 'string' || body.category.length > 80)) return 'تصنيف المحاضرة غير صالح.';
  if (Object.hasOwn(body, 'stream_url') && !validUrl(body.stream_url)) return 'رابط البث يجب أن يكون HTTPS صحيحًا.';
  if (Object.hasOwn(body, 'recording_url') && !validUrl(body.recording_url)) return 'رابط التسجيل يجب أن يكون HTTPS صحيحًا.';
  if (Object.hasOwn(body, 'status') && !['draft', 'published', 'archived'].includes(body.status)) return 'حالة النشر غير صالحة.';
  return null;
}

function createAdminApi(options) {
  const env = options.env || process.env;
  const fetchImpl = options.fetch || global.fetch;

  async function supabase(path, init) {
    const response = await fetchImpl(env.SUPABASE_URL.replace(/\/$/, '') + path, {
      ...init,
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
        ...(init && init.headers || {})
      },
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error('Supabase request failed: ' + response.status);
    if (response.status === 204) return null;
    return response.json();
  }

  async function authenticate(request) {
    const match = (request.headers.authorization || '').match(/^Bearer\s+([A-Za-z0-9._~-]+)$/i);
    if (!match || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
    const response = await fetchImpl(env.SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/user', {
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + match[1] },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return null;
    const user = await response.json();
    if (!user || !user.id) return null;
    const admins = await supabase('/rest/v1/admin_users?select=user_id&user_id=eq.' + encodeURIComponent(user.id) + '&limit=1');
    return admins.length ? user : null;
  }

  return async function handle(request, response, pathname) {
    const isLecturePath = pathname === '/api/lectures' ||
      (pathname.startsWith('/api/lectures/') &&
       /^[0-9a-f-]{36}$/i.test(pathname.slice('/api/lectures/'.length)));
    if (pathname !== '/api/admin/session' && pathname !== '/api/admin/lectures' && !isLecturePath) return false;
    if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(request.method)) {
      response.setHeader('Allow', 'GET, POST, PATCH, DELETE, OPTIONS');
      sendJson(response, 405, { error: 'طريقة الطلب غير مدعومة.' });
      return true;
    }
    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
      sendJson(response, 503, { error: 'خدمة المحاضرات غير مهيأة بعد.' });
      return true;
    }

    // Public lecture reads use the anon key and the database's published-only RLS policy.
    // The service-role key is reserved for authenticated administrator operations.
    if (pathname === '/api/lectures' && request.method === 'GET') {
      try {
        const responseFromSupabase = await fetchImpl(
          env.SUPABASE_URL.replace(/\\/$/, '') + '/rest/v1/lectures?select=id,title,description,starts_at,category,stream_url,recording_url,status,created_at,updated_at&status=eq.published&order=starts_at.asc.nullslast',
          {
            headers: {
              apikey: env.SUPABASE_ANON_KEY,
              Authorization: 'Bearer ' + env.SUPABASE_ANON_KEY,
              Accept: 'application/json'
            },
            signal: AbortSignal.timeout(12000)
          }
        );
        if (!responseFromSupabase.ok) throw new Error('Supabase request failed: ' + responseFromSupabase.status);
        sendJson(response, 200, { items: await responseFromSupabase.json() });
      } catch (error) {
        console.error('Public lecture request failed:', error.message);
        sendJson(response, 502, { error: 'تعذر تحميل المحاضرات الآن.' });
      }
      return true;
    }

    if (!env.SUPABASE_SERVICE_ROLE_KEY) {
      sendJson(response, 503, { error: 'خدمة إدارة المحاضرات غير مهيأة بعد.' });
      return true;
    }

    try {
      if (pathname === '/api/admin/session' || pathname === '/api/admin/lectures') {
        if (request.method !== 'GET') {
          response.setHeader('Allow', 'GET');
          sendJson(response, 405, { error: 'طريقة الطلب غير مدعومة.' });
          return true;
        }
        const admin = await authenticate(request);
        if (!admin) {
          sendJson(response, 403, { error: 'هذا الحساب غير مسجل كمشرف.' });
          return true;
        }
        if (pathname === '/api/admin/session') {
          sendJson(response, 200, { user: { id: admin.id, email: admin.email || null } });
          return true;
        }
        const allRows = await supabase('/rest/v1/lectures?select=id,title,description,starts_at,category,stream_url,recording_url,status,created_at,updated_at&order=starts_at.asc.nullslast');
        sendJson(response, 200, { items: allRows });
        return true;
      }
      const user = await authenticate(request);
      if (!user) {
        sendJson(response, 403, { error: 'هذه العملية متاحة للمشرفين المصرح لهم فقط.' });
        return true;
      }
      const id = pathname.match(/^\/api\/lectures\/([0-9a-f-]{36})$/i);
      if (request.method === 'POST') {
        if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
          sendJson(response, 415, { error: 'يجب إرسال البيانات بصيغة JSON.' });
          return true;
        }
        let body;
        try {
          body = await readBody(request);
        } catch {
          sendJson(response, 400, { error: 'بيانات الطلب غير صالحة.' });
          return true;
        }
        const error = validateLecture(body, false);
        if (error) { sendJson(response, 400, { error }); return true; }
        const rows = await supabase('/rest/v1/lectures?select=*', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(normalize(body, user.id))
        });
        sendJson(response, 201, { item: rows[0] });
        return true;
      }
      if (!id) { sendJson(response, 400, { error: 'معرّف المحاضرة غير صالح.' }); return true; }
      if (request.method === 'PATCH') {
        if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
          sendJson(response, 415, { error: 'يجب إرسال البيانات بصيغة JSON.' });
          return true;
        }
        let body;
        try {
          body = await readBody(request);
        } catch {
          sendJson(response, 400, { error: 'بيانات الطلب غير صالحة.' });
          return true;
        }
        const error = validateLecture(body, true);
        if (error) { sendJson(response, 400, { error }); return true; }
        const rows = await supabase('/rest/v1/lectures?id=eq.' + id[1] + '&select=*', {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ ...body, updated_at: new Date().toISOString() })
        });
        if (!rows.length) { sendJson(response, 404, { error: 'المحاضرة غير موجودة.' }); return true; }
        sendJson(response, 200, { item: rows[0] });
        return true;
      }
      await supabase('/rest/v1/lectures?id=eq.' + id[1], { method: 'DELETE' });
      sendJson(response, 200, { ok: true });
      return true;
    } catch (error) {
      console.error('Lecture API request failed:', error.message);
      sendJson(response, 502, { error: 'تعذر تنفيذ العملية الآن. تحقق من إعدادات Supabase.' });
      return true;
    }
  };
}

function normalize(body, userId) {
  return {
    title: body.title.trim(),
    description: body.description || '',
    starts_at: body.starts_at || null,
    category: body.category || 'محاضرة',
    stream_url: body.stream_url || null,
    recording_url: body.recording_url || null,
    status: body.status || 'draft',
    created_by: userId
  };
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16000) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

module.exports = { createAdminApi, validateLecture };
