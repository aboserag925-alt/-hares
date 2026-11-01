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
  signInWithGoogle: function () {
    const redirectTo = window.location.origin + window.location.pathname;
    return requireClient().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirectTo, queryParams: { prompt: 'select_account' } }
    });
  },
  signOut: function () {
    return requireClient().auth.signOut();
  },
  saveMemberProfile: async function (user) {
    const metadata = user.user_metadata || {};
    const result = await requireClient().from('member_profiles').upsert({
      user_id: user.id,
      email: user.email || null,
      display_name: metadata.full_name || metadata.name || null,
      avatar_url: metadata.avatar_url || metadata.picture || null,
      last_seen_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
    if (result.error) throw result.error;
  },
  logActivity: async function (userId, eventType, metadata) {
    const result = await requireClient().from('member_activity').insert({
      user_id: userId,
      event_type: eventType,
      metadata: metadata || {}
    });
    if (result.error) throw result.error;
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
