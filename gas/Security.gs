var SENSITIVE_SETTING_KEYS = {
  WORKER_TOKEN: true,
  WORKER_SIGNING_SECRET: true,
  INTERNAL_API_TOKEN: true,
  OPENAI_API_KEY: true,
  GEMINI_API_KEY: true,
  CLAUDE_API_KEY: true,
  WEBHOOK_TOKEN: true,
  WEBHOOK_SECRET: true
};

function getScriptProps_() {
  return PropertiesService.getScriptProperties();
}

function getScriptConfig_(key, fallback) {
  var v = getScriptProps_().getProperty(key);
  if (v === null || v === undefined || v === '') return fallback;
  return v;
}

function setScriptConfig_(key, value) {
  if (value === undefined || value === null) return;
  getScriptProps_().setProperty(key, String(value));
}

function getActiveEmailSafe_() {
  try {
    return (Session.getActiveUser().getEmail() || '').toLowerCase();
  } catch (err) {
    return '';
  }
}

function getAllowedDomain_() {
  return String(getScriptConfig_('APP_ALLOWED_DOMAIN', '') || '').toLowerCase();
}

function assertAuthorizedUser_() {
  var email = getActiveEmailSafe_();
  var domain = getAllowedDomain_();
  if (!email) throw new Error('Unauthorized: user email not available');
  if (domain && email.split('@')[1] !== domain) {
    throw new Error('Forbidden: user outside allowed domain');
  }
  return email;
}

function getAdminEmails_() {
  var raw = String(getScriptConfig_('ADMIN_EMAILS', '') || '');
  return raw
    .split(',')
    .map(function (x) { return x.trim().toLowerCase(); })
    .filter(function (x) { return !!x; });
}

function assertAdminUser_() {
  var email = assertAuthorizedUser_();
  var admins = getAdminEmails_();
  if (!admins.length) {
    throw new Error('Forbidden: ADMIN_EMAILS not configured');
  }
  if (admins.indexOf(email) < 0) {
    throw new Error('Forbidden: admin access required');
  }
  return email;
}

function sanitizeSettingsForClient_(rows) {
  return (rows || []).filter(function (r) {
    return !SENSITIVE_SETTING_KEYS[r.key_name];
  });
}

function isSensitiveSettingKey_(key) {
  return !!SENSITIVE_SETTING_KEYS[String(key || '')];
}

function requireInternalApiToken_(token) {
  var expected = String(getScriptConfig_('INTERNAL_API_TOKEN', '') || '');
  if (!expected) {
    // secure-by-default: do not allow action endpoints before token is configured
    throw new Error('Forbidden: INTERNAL_API_TOKEN not configured');
  }
  if (!token || String(token) !== expected) {
    throw new Error('Unauthorized: invalid internal token');
  }
}

function enforceUserRateLimit_(key, limit, windowSec) {
  var user = assertAuthorizedUser_();
  var cache = CacheService.getUserCache();
  var k = 'rl:' + key + ':' + user;
  var current = Number(cache.get(k) || '0');
  if (current >= limit) {
    throw new Error('Rate limit exceeded. Please retry later.');
  }
  cache.put(k, String(current + 1), windowSec);
}

function maskSecretStatus_(value) {
  var s = String(value || '');
  if (!s) return '';
  if (s.length <= 8) return '********';
  return s.slice(0, 3) + '********' + s.slice(-3);
}
