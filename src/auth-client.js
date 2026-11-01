import { createClient } from '@supabase/supabase-js';

const config = window.AHL_SUPABASE_CONFIG || {};
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
  signIn: function (email, password) {
    return requireClient().auth.signInWithPassword({ email: email, password: password });
  },
  signUp: function (email, password) {
    return requireClient().auth.signUp({ email: email, password: password });
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
  },
  isSiteAdmin: function (user) {
    return Boolean(user && user.app_metadata && user.app_metadata.role === 'site_admin');
  },
  listPublishedSiteContent: async function (contentType) {
    let query = requireClient()
      .from('site_content')
      .select('content_key, content_type, title, data, published, updated_at')
      .eq('published', true)
      .order('updated_at', { ascending: false });
    if (contentType) query = query.eq('content_type', contentType);
    const result = await query;
    if (result.error) throw result.error;
    return result.data || [];
  },
  listManageableSiteContent: async function () {
    const result = await requireClient()
      .from('site_content')
      .select('content_key, content_type, title, data, published, updated_at')
      .order('updated_at', { ascending: false });
    if (result.error) throw result.error;
    return result.data || [];
  },
  saveSiteContent: async function (item) {
    const result = await requireClient()
      .from('site_content')
      .upsert({
        content_key: item.content_key,
        content_type: item.content_type,
        title: item.title,
        data: item.data || {},
        published: Boolean(item.published),
        updated_at: new Date().toISOString()
      }, { onConflict: 'content_key' });
    if (result.error) throw result.error;
  },
  deleteSiteContent: async function (contentKey) {
    const result = await requireClient()
      .from('site_content')
      .delete()
      .eq('content_key', contentKey);
    if (result.error) throw result.error;
  }
};
