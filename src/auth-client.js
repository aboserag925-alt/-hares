import { createClient } from '@supabase/supabase-js';

const config = window.AHL_SUPABASE_CONFIG || {};
const captchaSiteKey = typeof config.captchaSiteKey === 'string' ? config.captchaSiteKey.trim() : '';
let projectUrl = null;
try {
  projectUrl = new URL(config.url);
} catch {
  projectUrl = null;
}
const isLocalUrl = projectUrl &&
  projectUrl.protocol === 'http:' &&
  ['localhost', '127.0.0.1'].includes(projectUrl.hostname);
const isSecureUrl = projectUrl &&
  (projectUrl.protocol === 'https:' || isLocalUrl);
const configured = Boolean(isSecureUrl && config.anonKey);
const client = configured
  ? createClient(config.url, config.anonKey, {
    global: {
      headers: { 'Accept-Charset': 'utf-8' }
    },
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'ahl-athar-auth'
      }
    })
  : null;

function requireClient() {
  if (!client) {
    throw new Error('إعداد Supabase غير مكتمل. أضف رابط المشروع والمفتاح العام.');
  }
  return client;
}


let turnstileLoadPromise = null;
let turnstileWidgetId = null;
let turnstileToken = null;

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve();
  if (turnstileLoadPromise) return turnstileLoadPromise;

  turnstileLoadPromise = new Promise(function (resolve, reject) {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.onload = function () {
      if (window.turnstile) resolve();
      else {
        turnstileLoadPromise = null;
        reject(new Error('تعذر تهيئة خدمة التحقق الأمني.'));
      }
    };
    script.onerror = function () {
      turnstileLoadPromise = null;
      reject(new Error('تعذر تحميل خدمة التحقق الأمني. تحقق من اتصال الإنترنت.'));
    };
    document.head.appendChild(script);
  });

  return turnstileLoadPromise;
}

window.ahlCaptcha = {
  enabled: Boolean(captchaSiteKey),
  render: async function (containerId) {
    if (!captchaSiteKey) return false;
    const container = typeof containerId === 'string'
      ? document.getElementById(containerId)
      : containerId;
    if (!container) throw new Error('مكان عرض التحقق الأمني غير موجود.');

    await loadTurnstile();
    if (turnstileWidgetId !== null) {
      window.turnstile.remove(turnstileWidgetId);
      turnstileWidgetId = null;
    }
    turnstileToken = null;
    turnstileWidgetId = window.turnstile.render(container, {
      sitekey: captchaSiteKey,
      theme: 'dark',
      callback: function (token) { turnstileToken = token; },
      'expired-callback': function () { turnstileToken = null; },
      'error-callback': function () { turnstileToken = null; }
    });
    return true;
  },
  getToken: function () {
    if (!captchaSiteKey) return null;
    if (typeof turnstileToken !== 'string' || !turnstileToken) {
      throw new Error('أكمل اختبار التحقق الأمني قبل المتابعة.');
    }
    return turnstileToken;
  },
  reset: function () {
    turnstileToken = null;
    if (window.turnstile && turnstileWidgetId !== null) {
      window.turnstile.reset(turnstileWidgetId);
    }
  }
};

window.ahlAuth = {
  configured,
  init: function (onStateChange) {
    if (!client) {
      onStateChange({ configured: false, user: null, event: 'UNCONFIGURED' });
      return;
    }
    client.auth.onAuthStateChange(function (event, session) {
      onStateChange({
        configured: true,
        user: session ? session.user : null,
        event: event
      });
    });
  },
  signIn: function (email, password, captchaToken) {
    const credentials = { email: email, password: password };
    if (captchaSiteKey) {
      if (typeof captchaToken !== 'string' || !captchaToken.trim()) throw new Error('أكمل اختبار التحقق الأمني قبل المتابعة.');
      credentials.options = { captchaToken: captchaToken };
    }
    return requireClient().auth.signInWithPassword(credentials);
  },
  signUp: function (email, password, captchaToken) {
    const credentials = { email: email, password: password };
    if (captchaSiteKey) {
      if (typeof captchaToken !== 'string' || !captchaToken.trim()) throw new Error('أكمل اختبار التحقق الأمني قبل المتابعة.');
      credentials.options = { captchaToken: captchaToken };
    }
    return requireClient().auth.signUp(credentials);
  },
  getAccessToken: async function () {
    const result = await requireClient().auth.getSession();
    if (result.error) throw result.error;
    return result.data.session ? result.data.session.access_token : null;
  },
  requestPasswordReset: function (email, redirectTo, captchaToken) {
    const options = { redirectTo: redirectTo };
    if (captchaSiteKey) {
      if (typeof captchaToken !== 'string' || !captchaToken.trim()) throw new Error('أكمل اختبار التحقق الأمني قبل المتابعة.');
      options.captchaToken = captchaToken;
    }
    return requireClient().auth.resetPasswordForEmail(email, options);
  },
  updatePassword: function (password) {
    return requireClient().auth.updateUser({ password: password });
  },
  signOut: function () {
    return requireClient().auth.signOut();
  },
  loadUserData: async function (userId) {
    const result = await requireClient()
      .from('user_data')
      .select('data, updated_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (result.error) throw result.error;
    return result.data;
  },
  saveUserData: async function (userId, data) {
    const result = await requireClient()
      .from('user_data')
      .upsert(
        { user_id: userId, data: data, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
    if (result.error) throw result.error;
  }
};
