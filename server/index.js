'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { createMediaLibrary } = require('./media-library');
const { createAdminApi } = require('./lecture-api');

const PUBLIC_ROOT = path.resolve(__dirname, '..');
const MAX_BODY_BYTES = 16 * 1024;
const MAX_QUESTION_LENGTH = 1600;
const MAX_DRAFT_LENGTH = 1800;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT = 5;
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8'
};

function loadEnvFile(filePath) {
  let contents;
  try {
    contents = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }

  contents.split(/\r?\n/).forEach(function (line, index) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || Object.prototype.hasOwnProperty.call(process.env, match[1])) return;

    let value = match[2];
    if (value.startsWith('"') || value.startsWith("'")) {
      const quote = value[0];
      if (value.length < 2 || value[value.length - 1] !== quote) {
        throw new Error('Unclosed quote in .env line ' + (index + 1));
      }
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }

    process.env[match[1]] = value;
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(JSON.stringify(payload));
}

function isAllowedOrigin(request, env) {
  const origin = request.headers.origin;
  if (!origin || !request.headers.host) return false;

  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return false;
  }
  if (parsedOrigin.protocol !== 'http:' && parsedOrigin.protocol !== 'https:') return false;

  const configuredOrigins = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(function (value) { return value.trim(); })
    .filter(Boolean);
  if (configuredOrigins.length > 0) return configuredOrigins.includes(parsedOrigin.origin);
  return parsedOrigin.host.toLowerCase() === request.headers.host.toLowerCase();
}

function applyCorsHeaders(request, response, env) {
  const origin = request.headers.origin;
  if (!origin) return true;
  if (!isAllowedOrigin(request, env)) return false;

  response.setHeader('Access-Control-Allow-Origin', new URL(origin).origin);
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PATCH, DELETE, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range');
  response.setHeader('Access-Control-Expose-Headers',
    'Accept-Ranges, Content-Range, Content-Length, Content-Disposition');
  return true;
}

function readJsonBody(request, response) {
  return new Promise(function (resolve, reject) {
    const declaredLength = Number(request.headers['content-length'] || 0);
    if (declaredLength > MAX_BODY_BYTES) {
      request.resume();
      sendJson(response, 413, { error: 'حجم الطلب أكبر من المسموح.' });
      resolve(null);
      return;
    }

    const chunks = [];
    let bytes = 0;
    let exceededLimit = false;
    request.on('data', function (chunk) {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        exceededLimit = true;
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on('error', reject);
    request.on('end', function () {
      if (exceededLimit) {
        sendJson(response, 413, { error: 'حجم الطلب أكبر من المسموح.' });
        resolve(null);
        return;
      }
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
        resolve(JSON.parse(text));
      } catch {
        sendJson(response, 400, { error: 'صيغة الطلب غير صالحة.' });
        resolve(null);
      }
    });
  });
}

async function readUtf8Json(response) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(await response.arrayBuffer());
  return JSON.parse(text);
}

function clientAddress(request) {
  return request.socket.remoteAddress || 'unknown';
}

function consumeRateLimit(limits, address, now, maximum) {
  if (limits.size > 10000) {
    limits.forEach(function (entry, key) {
      if (entry.resetAt <= now) limits.delete(key);
    });
  }

  let entry = limits.get(address);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + RATE_WINDOW_MS };
    limits.set(address, entry);
  }
  if (entry.count >= (maximum || RATE_LIMIT)) return false;
  entry.count += 1;
  return true;
}

function cairoDateKey(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date || new Date());
  const values = {};
  parts.forEach(function (part) { values[part.type] = part.value; });
  return values.year + '-' + values.month + '-' + values.day;
}

function staticFilePath(requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl, 'http://localhost').pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\\') || pathname.includes('\0')) return null;
  let segments = pathname.split('/').filter(Boolean);
  if (segments.length === 1 && (segments[0] === 'app' || segments[0] === 'screens')) {
    segments.push('index.html');
  }
  if (segments.some(function (segment) { return segment === '.' || segment === '..' || segment.startsWith('.'); })) {
    return null;
  }
  if (segments.length === 0) segments = ['index.html'];
  if (segments[0] !== 'index.html' &&
      segments[0] !== 'app' && segments[0] !== 'assets' && segments[0] !== 'screens') {
    return null;
  }
  if (segments[0] === 'index.html' && segments.length !== 1) return null;

  const filePath = path.resolve(PUBLIC_ROOT, ...segments);
  return filePath.startsWith(PUBLIC_ROOT + path.sep) || filePath === path.join(PUBLIC_ROOT, 'index.html')
    ? filePath
    : null;
}

async function createQuestionDraft(question, env, fetchImpl) {
  const model = env.GEMINI_MODEL || 'gemini-3.8-flash';
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(model)) throw new Error('Invalid Gemini model configuration');

  const result = await fetchImpl(
    'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Accept: 'application/json; charset=utf-8',
        'x-goog-api-key': env.GEMINI_API_KEY
      },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        contents: [{ parts: [{ text: question }] }],
        systemInstruction: {
          parts: [{
            text: 'أنت مساعد يصوغ مسودة أولية باللغة العربية لعرضها على عالم شرعي للمراجعة. لا تقدّم المسودة كفتوى أو حكم معتمد، ولا تدّع أنك عالم. إذا احتاج السؤال إلى فتوى خاصة أو كان الدليل غير متحقق، فصرّح بذلك وأحل السائل إلى الدكتور خالد للمراجعة. لا تختلق آيات أو أحاديث أو مراجع. اجعل الرد موجزًا ومحترمًا، واختم بالتنبيه أن المسودة غير معتمدة حتى يراجعها الدكتور خالد.'
          }]
        },
        generationConfig: { maxOutputTokens: 700, temperature: 0.2 }
      })
    }
  );
  if (!result.ok) {
    console.error('Gemini request failed with status ' + result.status);
    throw new Error('تعذر إنشاء مسودة الآن. حاول لاحقًا.');
  }

  const payload = await readUtf8Json(result);
  const draft = payload.candidates && payload.candidates[0] &&
    payload.candidates[0].content && payload.candidates[0].content.parts
      ? payload.candidates[0].content.parts
        .map(function (part) { return typeof part.text === 'string' ? part.text : ''; })
        .join('')
        .trim()
      : '';
  if (!draft) throw new Error('لم تُنتج الخدمة مسودة صالحة. حاول لاحقًا.');
  if (draft.length <= MAX_DRAFT_LENGTH) return draft;
  return draft.slice(0, MAX_DRAFT_LENGTH).trimEnd() + '\n[اختُصر الرد لطوله.]';
}

async function sendToTelegram(question, draft, env, fetchImpl) {
  const message = 'سؤال للمراجعة من التطبيق:\n\n' + question +
    '\n\nمسودة Gemini غير معتمدة:\n' + draft;
  let result;
  try {
    result = await fetchImpl(
      'https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/sendMessage',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Accept: 'application/json; charset=utf-8'
        },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: message })
      }
    );
  } catch {
    console.error('Telegram request could not be completed');
    throw new Error('تعذر تأكيد إرسال السؤال إلى Telegram.');
  }
  if (!result.ok) {
    console.error('Telegram request failed with status ' + result.status);
    throw new Error('تعذر تأكيد إرسال السؤال إلى Telegram.');
  }
  let payload;
  try {
    payload = await readUtf8Json(result);
  } catch {
    console.error('Telegram returned an invalid response');
    throw new Error('تعذر تأكيد إرسال السؤال إلى Telegram.');
  }
  if (!payload.ok) {
    console.error('Telegram rejected a question message');
    throw new Error('تعذر تأكيد إرسال السؤال إلى Telegram.');
  }
}

function createServer(options) {
  options = options || {};
  const env = options.env || process.env;
  const fetchImpl = options.fetch || global.fetch;
  const limits = new Map();
  const analyticsLimits = new Map();
  const adminApi = createAdminApi({ env: env, fetch: fetchImpl });
  const mediaLibrary = options.mediaLibrary || createMediaLibrary({
    env: env,
    fetch: fetchImpl,
    storageDirectory: options.storageDirectory
  });

  return http.createServer(async function (request, response) {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('X-Frame-Options', 'DENY');

    const requestUrl = new URL(request.url, 'http://localhost');
    if (requestUrl.pathname.startsWith('/api/')) {
      if (!applyCorsHeaders(request, response, env)) {
        sendJson(response, 403, { error: 'مصدر الطلب غير مسموح.' });
        return;
      }
      if (request.method === 'OPTIONS') {
        response.writeHead(204, { 'Allow': 'GET, HEAD, POST, PATCH, DELETE, OPTIONS' });
        response.end();
        return;
      }
    }
    if (requestUrl.pathname === '/api/analytics/visit' && request.method === 'POST') {
      if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
        sendJson(response, 503, { error: 'إحصاء الزوار غير مهيأ بعد.' });
        return;
      }
      if (!consumeRateLimit(analyticsLimits, clientAddress(request), Date.now(), 30)) {
        sendJson(response, 429, { error: 'تم تجاوز عدد المحاولات. حاول لاحقًا.' });
        return;
      }
      const body = await readJsonBody(request, response);
      if (!body) return;
      if (typeof body.visitorId !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.visitorId)) {
        sendJson(response, 400, { error: 'معرّف الزائر غير صالح.' });
        return;
      }
      const visitDate = cairoDateKey(new Date());
      const visitorHash = crypto.createHash('sha256')
        .update(visitDate + ':' + body.visitorId)
        .digest('hex');
      const supabaseBase = env.SUPABASE_URL.replace(/\/$/, '');
      try {
        const insert = await fetchImpl(supabaseBase +
          '/rest/v1/daily_visitors?on_conflict=visit_date,visitor_hash', {
          method: 'POST',
          headers: {
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
            'Content-Type': 'application/json',
            Prefer: 'resolution=ignore-duplicates,return=minimal'
          },
          body: JSON.stringify({ visit_date: visitDate, visitor_hash: visitorHash }),
          signal: AbortSignal.timeout(10000)
        });
        if (!insert.ok) throw new Error('Analytics insert failed');
        const countResponse = await fetchImpl(supabaseBase +
          '/rest/v1/daily_visitors?select=visitor_hash&visit_date=eq.' + visitDate, {
          headers: {
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
            Prefer: 'count=exact',
            Range: '0-0'
          },
          signal: AbortSignal.timeout(10000)
        });
        if (!countResponse.ok) throw new Error('Analytics count failed');
        const contentRange = countResponse.headers && countResponse.headers.get('content-range');
        const countMatch = typeof contentRange === 'string' && contentRange.match(/\/(\d+)$/);
        sendJson(response, 200, { date: visitDate, visitors: countMatch ? Number(countMatch[1]) : null });
      } catch {
        sendJson(response, 502, { error: 'تعذر تحميل إحصاء الزوار الآن.' });
      }
      return;
    }
    if (await adminApi(request, response, requestUrl.pathname)) return;
    if (requestUrl.pathname === '/api/health' && request.method === 'GET') {
      sendJson(response, 200, { ok: true });
      return;
    }
    if (requestUrl.pathname === '/api/library' && request.method === 'GET') {
      try {
        sendJson(response, 200, { items: await mediaLibrary.listApproved() });
      } catch {
        console.error('Media library could not be loaded');
        sendJson(response, 500, { error: 'تعذر تحميل المكتبة الآن.' });
      }
      return;
    }
    const mediaFileMatch = requestUrl.pathname.match(/^\/api\/library\/files\/([0-9a-f-]{36})$/i);
    if (mediaFileMatch && (request.method === 'GET' || request.method === 'HEAD')) {
      try {
        const file = await mediaLibrary.getApprovedFile(mediaFileMatch[1]);
        if (!file) {
          sendJson(response, 404, { error: 'الملف غير موجود.' });
          return;
        }
        const inline = file.item.kind === 'audio' || file.item.kind === 'video' || file.item.kind === 'image';
        let content = file.data;
        let statusCode = 200;
        let contentRange;
        const rangeHeader = request.headers.range;
        if (rangeHeader && (file.item.kind === 'audio' || file.item.kind === 'video')) {
          const range = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
          if (!range || (!range[1] && !range[2])) {
            response.writeHead(416, { 'Content-Range': 'bytes */' + file.data.length });
            response.end();
            return;
          }
          const start = range[1] ? Number(range[1]) : Math.max(0, file.data.length - Number(range[2]));
          const end = range[2] && range[1]
            ? Math.min(Number(range[2]), file.data.length - 1)
            : file.data.length - 1;
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
              start > end || start >= file.data.length) {
            response.writeHead(416, { 'Content-Range': 'bytes */' + file.data.length });
            response.end();
            return;
          }
          content = file.data.subarray(start, end + 1);
          contentRange = 'bytes ' + start + '-' + end + '/' + file.data.length;
          statusCode = 206;
        }
        const encodedFileName = encodeURIComponent(file.item.fileName)
          .replace(/[!'()*]/g, function (character) {
            return '%' + character.charCodeAt(0).toString(16).toUpperCase();
          });
        const headers = {
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store',
          'Content-Disposition': (inline ? 'inline' : 'attachment') +
            "; filename*=UTF-8''" + encodedFileName,
          'Content-Length': content.length,
          'Content-Type': file.item.mimeType,
          'X-Content-Type-Options': 'nosniff'
        };
        if (contentRange) headers['Content-Range'] = contentRange;
        response.writeHead(statusCode, headers);
        response.end(request.method === 'HEAD' ? undefined : content);
      } catch {
        console.error('Media library file could not be loaded');
        sendJson(response, 500, { error: 'تعذر تحميل الملف الآن.' });
      }
      return;
    }
    if (requestUrl.pathname === '/api/questions') {
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        sendJson(response, 405, { error: 'طريقة الطلب غير مدعومة.' });
        return;
      }
      if (!isAllowedOrigin(request, env)) {
        sendJson(response, 403, { error: 'مصدر الطلب غير مسموح.' });
        return;
      }
      if (!env.GEMINI_API_KEY || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
        sendJson(response, 503, { error: 'إعدادات Gemini وTelegram غير مكتملة على الخادم.' });
        return;
      }
      if (!consumeRateLimit(limits, clientAddress(request), Date.now())) {
        sendJson(response, 429, { error: 'وصلت إلى حد الإرسال المؤقت. حاول لاحقًا.' });
        return;
      }
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) {
        request.resume();
        sendJson(response, 415, { error: 'يجب إرسال السؤال بصيغة JSON.' });
        return;
      }

      const body = await readJsonBody(request, response);
      if (body === null) return;
      if (!body || typeof body.question !== 'string') {
        sendJson(response, 400, { error: 'اكتب السؤال بصيغة صحيحة.' });
        return;
      }
      const question = body.question.trim();
      if (question.length < 5 || question.length > MAX_QUESTION_LENGTH) {
        sendJson(response, 400, { error: 'يجب أن يكون السؤال بين 5 و1600 حرف.' });
        return;
      }

      try {
        const draft = await createQuestionDraft(question, env, fetchImpl);
        try {
          await sendToTelegram(question, draft, env, fetchImpl);
        } catch (error) {
          sendJson(response, 502, {
            error: error.message,
            draft: draft,
            telegramSent: false
          });
          return;
        }
        sendJson(response, 200, { draft: draft, telegramSent: true });
      } catch (error) {
        if (error.name === 'TimeoutError' || error.name === 'AbortError') {
          sendJson(response, 504, { error: 'انتهت مهلة الاتصال بالخدمة. حاول لاحقًا.' });
          return;
        }
        if (error.message === 'تعذر إنشاء مسودة الآن. حاول لاحقًا.' ||
            error.message === 'لم تُنتج الخدمة مسودة صالحة. حاول لاحقًا.') {
          sendJson(response, 502, { error: error.message });
          return;
        }
        console.error('Question processing failed');
        sendJson(response, 502, { error: 'تعذر معالجة السؤال الآن. حاول لاحقًا.' });
      }
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendJson(response, 405, { error: 'طريقة الطلب غير مدعومة.' });
      return;
    }
    const filePath = staticFilePath(request.url);
    if (!filePath) {
      sendJson(response, 404, { error: 'الصفحة غير موجودة.' });
      return;
    }
    try {
      const file = await fs.promises.readFile(filePath);
      response.writeHead(200, {
        'Cache-Control': 'no-cache',
        'Content-Length': file.length,
        'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
      });
      response.end(request.method === 'HEAD' ? undefined : file);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EISDIR') {
        sendJson(response, 404, { error: 'الصفحة غير موجودة.' });
        return;
      }
      console.error('Static file request failed');
      sendJson(response, 500, { error: 'تعذر تحميل الصفحة.' });
    }
  });
}

if (require.main === module) {
  loadEnvFile(path.join(PUBLIC_ROOT, '.env'));
  const port = Number(process.env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be a valid TCP port.');
  }
  const host = process.env.HOST || '127.0.0.1';
  const mediaLibrary = createMediaLibrary({ env: process.env });
  const server = createServer({ mediaLibrary: mediaLibrary });
  server.listen(port, host, function () {
    console.log('Ahl Athar server listening on port ' + port);
    mediaLibrary.start().catch(function () {
      console.error('Telegram media intake could not be started.');
      server.close(function () {});
    });
  });
}

module.exports = { createServer: createServer, loadEnvFile: loadEnvFile };
