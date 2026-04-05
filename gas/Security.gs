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
    // simple mode: if token is not configured, allow gateway requests
    return;
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

// ─────────────────────────────────────────────────────────────────────────────
// ROLE-BASED ACCESS CONTROL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract user from auth token in request
 * @param {Object} payload - Request payload containing auth_token
 * @returns {Object|null} User object or null if invalid
 */
function extractAuthUser_(payload) {
  var token = payload && payload.auth_token;
  if (!token) return null;
  
  var result = validateAuthToken_(token);
  if (!result.valid) return null;
  
  return result.user;
}

/**
 * Assert that request has valid auth token
 * @throws Error if no valid token
 */
function assertAuthToken_(payload) {
  var user = extractAuthUser_(payload);
  if (!user) {
    throw new Error('Unauthorized: Login diperlukan');
  }
  return user;
}

/**
 * Assert that user has admin role
 * @throws Error if not admin
 */
function assertAdminRole_(payload) {
  var user = assertAuthToken_(payload);
  if (user.role !== 'admin') {
    throw new Error('Forbidden: Hanya admin yang dapat mengakses');
  }
  return user;
}

/**
 * Assert that user has paid status (LUNAS) or is admin
 * @throws Error if not paid and not admin
 */
function assertPaidUser_(payload) {
  var user = assertAuthToken_(payload);
  if (user.role === 'admin') return user; // Admin always has access
  if (user.payment_status !== 'LUNAS') {
    throw new Error('Forbidden: Fitur ini hanya untuk user dengan status LUNAS');
  }
  return user;
}

/**
 * Assert that user can access protected features
 * Same as assertPaidUser_ but with clearer naming
 */
function assertProtectedAccess_(payload) {
  return assertPaidUser_(payload);
}

/**
 * Check access level for a user
 * Returns: 'admin' | 'full' | 'limited' | 'none'
 */
function getUserAccessLevel_(user) {
  if (!user) return 'none';
  if (user.role === 'admin') return 'admin';
  if (user.payment_status === 'LUNAS') return 'full';
  return 'limited';
}

/**
 * Check if user can perform specific action
 */
var ACCESS_RULES = {
  // Admin only
  'manage_users': ['admin'],
  'save_settings': ['admin'],
  'reset_data': ['admin'],
  'import_csv': ['admin'],
  'save_thresholds': ['admin'],
  
  // Paid users (LUNAS) and admin
  'ask_ai': ['admin', 'full'],
  'compare_periods': ['admin', 'full'],
  'view_analytics': ['admin', 'full'],
  'generate_brief': ['admin', 'full'],
  
  // All logged in users
  'view_dashboard': ['admin', 'full', 'limited'],
  'view_snapshot': ['admin', 'full', 'limited'],
  'save_note': ['admin', 'full', 'limited'],
  'save_ai_config': ['admin', 'full', 'limited']
};

function canUserPerform_(user, action) {
  if (!user) return false;
  var level = getUserAccessLevel_(user);
  var allowed = ACCESS_RULES[action] || [];
  return allowed.indexOf(level) >= 0;
}

function assertCanPerform_(payload, action) {
  var user = assertAuthToken_(payload);
  if (!canUserPerform_(user, action)) {
    var level = getUserAccessLevel_(user);
    if (level === 'limited') {
      throw new Error('Forbidden: Fitur ini memerlukan status LUNAS');
    }
    throw new Error('Forbidden: Anda tidak memiliki akses ke fitur ini');
  }
  return user;
}

// ─────────────────────────────────────────────────────────────────────────────
// BACKWARD COMPATIBILITY WITH EXISTING AUTH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hybrid auth check - supports both token-based and Google session-based auth
 * Used during migration period
 */
function assertAuthorizedUserHybrid_(payload) {
  // First try token-based auth
  var tokenUser = extractAuthUser_(payload);
  if (tokenUser) {
    return {
      email: tokenUser.email,
      role: tokenUser.role,
      payment_status: tokenUser.payment_status,
      source: 'token'
    };
  }
  
  // Fallback to Google session (for embedded App.html)
  try {
    var email = assertAuthorizedUser_();
    var admins = getAdminEmails_();
    var isAdmin = admins.indexOf(email.toLowerCase()) >= 0;
    return {
      email: email,
      role: isAdmin ? 'admin' : 'user',
      payment_status: isAdmin ? 'LUNAS' : 'NONE',
      source: 'google'
    };
  } catch (e) {
    throw new Error('Unauthorized: Login diperlukan');
  }
}

function assertAdminHybrid_(payload) {
  var user = assertAuthorizedUserHybrid_(payload);
  if (user.role !== 'admin') {
    throw new Error('Forbidden: Hanya admin yang dapat mengakses');
  }
  return user;
}
