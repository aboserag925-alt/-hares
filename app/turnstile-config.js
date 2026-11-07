// Public Cloudflare Turnstile site key. Its matching secret belongs in Supabase Auth/server settings only.
var authConfig = window.AHL_SUPABASE_CONFIG || {};
window.AHL_TURNSTILE_SITE_KEY = typeof authConfig.captchaSiteKey === 'string'
  ? authConfig.captchaSiteKey.trim()
  : '';
