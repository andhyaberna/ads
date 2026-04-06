export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const corsHeaders = {
      'access-control-allow-origin': env.ALLOWED_ORIGIN || 'https://ads.cepat.top',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type,x-internal-token,x-webhook-token,x-ts,x-nonce,x-signature,authorization'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method === 'GET' || request.method === 'HEAD') {
      const staticRes = await tryServeStaticAsset_(request, env, corsHeaders);
      if (staticRes) return staticRes;
    }

    if (path === '/app-main.js' && request.method === 'GET') {
      return serveFrontendScript_(env, corsHeaders);
    }

    if (path === '/health') {
      return json({ ok: true, worker: 'ads', ts: Date.now() }, 200, corsHeaders);
    }

    if (path === '/health/upstream' && request.method === 'GET') {
      const diag = await checkUpstreamHealth_(env);
      return json(diag, diag.ok ? 200 : 502, corsHeaders);
    }

    if (path === '/oauth/openai/start' && request.method === 'GET') {
      return startOpenAiOAuth(request, env);
    }

    if (path === '/oauth/openai/callback' && request.method === 'GET') {
      return finishOpenAiOAuth(request, env);
    }

    if (path === '/oauth/openai/status' && request.method === 'GET') {
      return getOpenAiOAuthStatus(request, env, corsHeaders);
    }

    if (path === '/oauth/openai/logout' && request.method === 'POST') {
      return logoutOpenAiOAuth(env, corsHeaders);
    }

    if ((path === '/' || path === '/index.html') && request.method === 'GET') {
      return serveFrontend_(env, corsHeaders);
    }

    if (!isAllowedOrigin(request, env)) {
      return json({ ok: false, error: 'Origin not allowed' }, 403, corsHeaders);
    }

    if (!(await checkRateLimit(request, env))) {
      return json({ ok: false, error: 'Rate limit exceeded' }, 429, corsHeaders);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // AUTH ENDPOINTS (public, no auth_token required)
    // ─────────────────────────────────────────────────────────────────────────
    
    if (path === '/auth/register' && request.method === 'POST') {
      return handleAuthAction(request, env, corsHeaders, 'register');
    }
    
    if (path === '/auth/login' && request.method === 'POST') {
      return handleAuthAction(request, env, corsHeaders, 'login');
    }
    
    if (path === '/auth/verify' && request.method === 'POST') {
      return handleAuthAction(request, env, corsHeaders, 'verify_token');
    }
    
    if (path === '/auth/logout' && request.method === 'POST') {
      return handleAuthAction(request, env, corsHeaders, 'logout');
    }
    
    if (path === '/auth/create-first-admin' && request.method === 'POST') {
      return handleAuthAction(request, env, corsHeaders, 'create_first_admin');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // USER PROFILE ENDPOINTS (requires auth_token)
    // ─────────────────────────────────────────────────────────────────────────
    
    if (path === '/user/profile' && request.method === 'GET') {
      return handleProtectedAction(request, env, corsHeaders, 'get_profile');
    }
    
    if (path === '/user/profile' && request.method === 'POST') {
      return handleProtectedAction(request, env, corsHeaders, 'update_profile');
    }
    
    if (path === '/user/change-password' && request.method === 'POST') {
      return handleProtectedAction(request, env, corsHeaders, 'change_password');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ADMIN ENDPOINTS (requires auth_token + admin role)
    // ─────────────────────────────────────────────────────────────────────────
    
    if (path === '/admin/users' && request.method === 'GET') {
      return handleProtectedAction(request, env, corsHeaders, 'list_users');
    }

    if (path === '/admin/users' && request.method === 'POST') {
      // Distinguish list vs create: if payload has 'password' field, it's a create
      const peek = request.clone();
      let body = {};
      try { body = await peek.json(); } catch (_) {}
      const action = body.password ? 'create_user' : 'list_users';
      return handleProtectedAction(request, env, corsHeaders, action);
    }
    
    if (path === '/admin/user' && request.method === 'GET') {
      return handleProtectedAction(request, env, corsHeaders, 'get_user');
    }
    
    if (path === '/admin/user' && request.method === 'POST') {
      return handleProtectedAction(request, env, corsHeaders, 'update_user');
    }
    
    if (path === '/admin/user/delete' && request.method === 'POST') {
      return handleProtectedAction(request, env, corsHeaders, 'delete_user');
    }
    
    if (path === '/admin/user/reset-password' && request.method === 'POST') {
      return handleProtectedAction(request, env, corsHeaders, 'reset_user_password');
    }
    
    if (path === '/admin/users/bulk-status' && request.method === 'POST') {
      return handleProtectedAction(request, env, corsHeaders, 'bulk_update_status');
    }
    
    if (path === '/admin/stats' && (request.method === 'GET' || request.method === 'POST')) {
      return handleProtectedAction(request, env, corsHeaders, 'get_user_stats');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // EXISTING APP ENDPOINTS
    // ─────────────────────────────────────────────────────────────────────────

    if (path === '/app/snapshot' && request.method === 'GET') {
      return handleAppSnapshot(env, corsHeaders);
    }

    if (path === '/app/import' && request.method === 'POST') {
      return handleAppImport(request, env, corsHeaders);
    }

    if (path === '/app/save-note' && request.method === 'POST') {
      return handleAppSaveNote(request, env, corsHeaders);
    }

    if (path === '/app/ai' && request.method === 'POST') {
      return handleAppAi(request, env, corsHeaders);
    }

    if (path === '/proxy/apps-script' && request.method === 'POST') {
      const rawBody = await request.text();
      const auth = await verifyInternalRequest(request, env, rawBody);
      if (!auth.ok) return json({ ok: false, error: auth.error }, 401, corsHeaders);
      return proxyAppsScript(rawBody, env);
    }

    if (path === '/ai/analyze' && request.method === 'POST') {
      const rawBody = await request.text();
      const auth = await verifyInternalRequest(request, env, rawBody);
      if (!auth.ok) return json({ ok: false, error: auth.error }, 401, corsHeaders);
      return proxyAi(rawBody, env, request);
    }

    if (path === '/webhook/meta' && request.method === 'POST') {
      return receiveWebhook(request, env);
    }

    return json({ ok: false, error: 'Not found' }, 404, corsHeaders);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// AUTH HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

async function handleAuthAction(request, env, corsHeaders, action) {
  const reqId = requestId_();
  let body = {};
  
  try {
    body = await request.json();
  } catch (err) {
    return json({ ok: false, error: 'Invalid JSON body', request_id: reqId }, 400, corsHeaders);
  }
  
  // Call GAS without internal token (public auth endpoints)
  const upstream = await callGasAuthAction_(action, body, env);
  return normalizeGasResponse_(upstream, corsHeaders, reqId);
}

async function handleProtectedAction(request, env, corsHeaders, action) {
  const reqId = requestId_();
  
  // Extract auth token from Authorization header or body
  const authHeader = request.headers.get('authorization') || '';
  let authToken = '';
  
  if (authHeader.startsWith('Bearer ')) {
    authToken = authHeader.slice(7);
  }
  
  let body = {};
  
  if (request.method === 'POST') {
    try {
      body = await request.json();
    } catch (err) {
      return json({ ok: false, error: 'Invalid JSON body', request_id: reqId }, 400, corsHeaders);
    }
  } else if (request.method === 'GET') {
    // For GET requests, parse query params as body
    const url = new URL(request.url);
    for (const [key, value] of url.searchParams) {
      body[key] = value;
    }
  }
  
  // Use token from body if not in header
  if (!authToken && body.auth_token) {
    authToken = body.auth_token;
  }
  
  if (!authToken) {
    return json({ ok: false, error: 'Unauthorized: Login diperlukan', request_id: reqId }, 401, corsHeaders);
  }
  
  // Add auth token to payload
  body.auth_token = authToken;
  
  // Call GAS with internal token
  const upstream = await callGasAction_(action, body, env);
  return normalizeGasResponse_(upstream, corsHeaders, reqId);
}

async function callGasAuthAction_(action, payload, env) {
  const urls = resolveGasUrls_(env);
  if (!urls.length) {
    return { ok: false, status: 500, error: 'Gateway not configured' };
  }

  const requestBody = withGatewaySheetId_(Object.assign({}, payload || {}, {
    action
  }), env);

  for (let i = 0; i < urls.length; i++) {
    let timer = null;
    try {
      const timeoutMs = Number(env.GAS_FETCH_TIMEOUT_MS || 25000);
      const ctrl = new AbortController();
      timer = setTimeout(() => ctrl.abort('upstream-timeout'), timeoutMs);
      const res = await fetch(urls[i], {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: ctrl.signal
      });
      const rawText = await res.text();
      let data = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch (err) {
        data = { ok: false, error: 'Invalid upstream JSON' };
      }
      return { ok: true, status: res.status, data };
    } catch (err) {
      // try next fallback URL
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return { ok: false, status: 502, error: 'Upstream unavailable' };
}

function isAllowedOrigin(request, env) {
  const allow = (env.ALLOWED_ORIGIN || 'https://ads.cepat.top').replace(/\/$/, '');
  const origin = (request.headers.get('origin') || '').replace(/\/$/, '');
  if (!origin) return true;
  return origin === allow;
}

function checkToken(request, env) {
  const token = request.headers.get('x-internal-token') || '';
  const expected = String(env.INTERNAL_TOKEN || env.INTERNAL_API_TOKEN || '').trim();
  return !!token && !!expected && token === expected;
}

async function verifyInternalRequest(request, env, rawBody) {
  if (!checkToken(request, env)) {
    return { ok: false, error: 'Invalid internal token' };
  }

  const ts = request.headers.get('x-ts') || '';
  const nonce = request.headers.get('x-nonce') || '';
  const sig = request.headers.get('x-signature') || '';
  const secret = env.SIGNING_SECRET || env.INTERNAL_TOKEN || env.INTERNAL_API_TOKEN;
  if (!ts || !nonce || !sig || !secret) {
    return { ok: false, error: 'Missing signed headers' };
  }

  const now = Date.now();
  const tsMs = Number(ts);
  const maxSkewMs = Number(env.SIGNATURE_MAX_SKEW_MS || 5 * 60 * 1000);
  if (!Number.isFinite(tsMs) || Math.abs(now - tsMs) > maxSkewMs) {
    return { ok: false, error: 'Stale request timestamp' };
  }

  const replayOk = await markReplayNonce(nonce, tsMs, env);
  if (!replayOk) return { ok: false, error: 'Replay detected' };

  const payloadToSign = `${ts}.${nonce}.${rawBody}`;
  const expected = await hmacSha256Base64Url(secret, payloadToSign);
  if (!constantTimeEqual(expected, sig)) {
    return { ok: false, error: 'Invalid signature' };
  }
  return { ok: true };
}

async function markReplayNonce(nonce, tsMs, env) {
  const kv = env.REPLAY_KV || env.RATE_LIMIT_KV;
  if (!kv) return true;
  const minuteBucket = new Date(tsMs).toISOString().slice(0, 16);
  const key = `nonce:${minuteBucket}:${nonce}`;
  const existed = await kv.get(key);
  if (existed) return false;
  await kv.put(key, '1', { expirationTtl: Number(env.NONCE_TTL_SEC || 600) });
  return true;
}

async function checkRateLimit(request, env) {
  if (!env.RATE_LIMIT_KV) return true;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const bucket = `${new Date().toISOString().slice(0,16)}:${ip}`; // per minute
  const current = Number((await env.RATE_LIMIT_KV.get(bucket)) || 0);
  const limit = Number(env.RATE_LIMIT_PER_MIN || 60);
  if (current >= limit) return false;
  await env.RATE_LIMIT_KV.put(bucket, String(current + 1), { expirationTtl: 70 });
  return true;
}

async function proxyAppsScript(rawBody, env) {
  if (!env.GAS_WEB_APP_URL) return json({ ok: false, error: 'GAS_WEB_APP_URL not set' }, 500);
  const res = await fetch(env.GAS_WEB_APP_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: rawBody
  });
  return new Response(res.body, {
    status: res.status,
    headers: {
      'content-type': res.headers.get('content-type') || 'application/json',
      'access-control-allow-origin': env.ALLOWED_ORIGIN || 'https://ads.cepat.top'
    }
  });
}

async function handleAppSnapshot(env, corsHeaders) {
  const reqId = requestId_();
  const upstream = await callGasAction_('snapshot', {}, env);
  return normalizeGasResponse_(upstream, corsHeaders, reqId);
}

async function handleAppImport(request, env, corsHeaders) {
  const reqId = requestId_();
  let body = {};
  try {
    body = await request.json();
  } catch (err) {
    return json({ ok: false, error: 'Invalid JSON body', request_id: reqId }, 400, corsHeaders);
  }

  const level = String(body.level || '').toLowerCase();
  if (!['campaign', 'adset', 'ad'].includes(level)) {
    return json({ ok: false, error: 'Invalid level', request_id: reqId }, 400, corsHeaders);
  }

  const fileName = String(body.file_name || '').slice(0, 120);
  const fileType = String(body.file_type || '').toLowerCase();
  const worksheetName = String(body.worksheet_name || '').slice(0, 80);
  const periodLabel = String(body.period_label || '').slice(0, 120);
  const csvText = typeof body.csv_text === 'string' ? body.csv_text : '';
  const excelBase64 = typeof body.excel_base64 === 'string' ? body.excel_base64 : '';

  const maxCsvBytes = Number(env.MAX_IMPORT_CSV_BYTES || 2_500_000);
  const maxXlsxB64 = Number(env.MAX_IMPORT_XLSX_B64_BYTES || 12_000_000);
  if (csvText && csvText.length > maxCsvBytes) {
    return json({ ok: false, error: 'CSV payload terlalu besar', request_id: reqId }, 413, corsHeaders);
  }
  if (excelBase64 && excelBase64.length > maxXlsxB64) {
    return json({ ok: false, error: 'XLSX payload terlalu besar', request_id: reqId }, 413, corsHeaders);
  }
  if (!csvText && !excelBase64) {
    return json({ ok: false, error: 'File payload kosong', request_id: reqId }, 400, corsHeaders);
  }

  const payload = {
    level,
    file_name: fileName || `import_${level}`,
    file_type: fileType || (excelBase64 ? 'xlsx' : 'csv'),
    worksheet_name: worksheetName,
    period_label: periodLabel,
    csv_text: csvText,
    excel_base64: excelBase64
  };

  const upstream = await callGasAction_('import_csv', payload, env);
  return normalizeGasResponse_(upstream, corsHeaders, reqId);
}

async function handleAppSaveNote(request, env, corsHeaders) {
  const reqId = requestId_();
  let body = {};
  try {
    body = await request.json();
  } catch (err) {
    return json({ ok: false, error: 'Invalid JSON body', request_id: reqId }, 400, corsHeaders);
  }

  const entityLevel = String(body.entity_level || '').toLowerCase();
  const entityName = String(body.entity_name || '').trim().slice(0, 200);
  const noteText = String(body.note_text || '').slice(0, 5000);
  if (!['campaign', 'adset', 'ad'].includes(entityLevel) || !entityName) {
    return json({ ok: false, error: 'Invalid note payload', request_id: reqId }, 400, corsHeaders);
  }

  const upstream = await callGasAction_('save_note', {
    entity_level: entityLevel,
    entity_name: entityName,
    note_text: noteText
  }, env);
  return normalizeGasResponse_(upstream, corsHeaders, reqId);
}

async function handleAppAi(request, env, corsHeaders) {
  const reqId = requestId_();
  let body = {};
  try {
    body = await request.json();
  } catch (err) {
    return json({ ok: false, error: 'Invalid JSON body', request_id: reqId }, 400, corsHeaders);
  }

  const question = String(body.question || '').trim();
  const rawProvider = String(body.provider || 'openai').toLowerCase();
  const provider = ['openai', 'gemini', 'claude', 'builtin'].includes(rawProvider) ? rawProvider : 'openai';
  if (!question) {
    return json({ ok: false, error: 'Question is required', request_id: reqId }, 400, corsHeaders);
  }

  if (provider === 'builtin') {
    return json({ ok: true, answer: 'Mode builtin aktif. Pilih provider AI di Settings untuk analisa model eksternal.' }, 200, corsHeaders);
  }

  const snapUpstream = await callGasAction_('snapshot', {}, env);
  const snapResponse = normalizeGasResponseObj_(snapUpstream, reqId);
  if (!snapResponse.ok) {
    return json({ ok: false, error: snapResponse.error, request_id: reqId }, snapResponse.status, corsHeaders);
  }
  const summary = buildCompactSummary_(snapResponse.data?.data || snapResponse.data || {});

  const aiResponse = await proxyAi(JSON.stringify({ question, provider, summary }), env, request);
  const text = await aiResponse.text();
  let parsed = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch (err) {
    parsed = { ok: false, error: 'Invalid AI response' };
  }
  return json(parsed, aiResponse.status, corsHeaders);
}

async function callGasAction_(action, payload, env) {
  const urls = resolveGasUrls_(env);
  const token = resolveInternalApiToken_(env);
  if (!urls.length) {
    return { ok: false, status: 500, error: 'Gateway not configured' };
  }

  const requestBody = withGatewaySheetId_(Object.assign({}, payload || {}, {
    action
  }), env);
  if (token) requestBody.internal_token = token;

  for (let i = 0; i < urls.length; i++) {
    let timer = null;
    try {
      const timeoutMs = Number(env.GAS_FETCH_TIMEOUT_MS || 25000);
      const ctrl = new AbortController();
      timer = setTimeout(() => ctrl.abort('upstream-timeout'), timeoutMs);
      const res = await fetch(urls[i], {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: ctrl.signal
      });
      const rawText = await res.text();
      let data = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch (err) {
        data = { ok: false, error: 'Invalid upstream JSON' };
      }
      return { ok: true, status: res.status, data };
    } catch (err) {
      // try next fallback URL
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return { ok: false, status: 502, error: 'Upstream unavailable' };
}

function withGatewaySheetId_(payload, env) {
  const body = Object.assign({}, payload || {});
  const sheetId = String(env.DB_TARGET_SHEET_ID || '').trim();
  if (sheetId && !body.db_target_sheet_id) {
    body.db_target_sheet_id = sheetId;
  }
  return body;
}

function resolveGasUrls_(env) {
  const defaults = [
    'https://script.google.com/macros/s/AKfycbyEQM12lmuZ_Q7NrBC_OVEHXDHN49oLEe52GLuMbFbSiH3HSzz6PK1S7DULwnfuTp4U/exec'
  ];

  const raw = String(env.GAS_WEB_APP_URL || '').trim();
  let primary = '';

  if (raw) {
    if (/^https?:\/\//i.test(raw)) {
      primary = raw;
    } else if (/^AKfy[a-zA-Z0-9_-]+$/.test(raw)) {
      primary = `https://script.google.com/macros/s/${raw}/exec`;
    }
  }

  const list = [];
  if (primary) list.push(primary);
  for (let i = 0; i < defaults.length; i++) {
    if (list.indexOf(defaults[i]) < 0) list.push(defaults[i]);
  }
  return list;
}

function resolveInternalApiToken_(env) {
  return String(env.INTERNAL_API_TOKEN || env.INTERNAL_TOKEN || '').trim();
}

async function checkUpstreamHealth_(env) {
  const urls = resolveGasUrls_(env);
  const token = resolveInternalApiToken_(env);
  const sheetId = String(env.DB_TARGET_SHEET_ID || '').trim();
  if (!urls.length) {
    return {
      ok: false,
      error: 'GAS url not configured',
      token_configured: !!token,
      sheet_id_configured: !!sheetId,
      urls: []
    };
  }

  const checks = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const probeBody = { action: 'snapshot' };
    if (token) probeBody.internal_token = token;
    if (sheetId) probeBody.db_target_sheet_id = sheetId;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(probeBody)
      });
      const text = await res.text();
      let parsed = {};
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch (err) {
        parsed = { ok: false, error: 'Invalid upstream JSON' };
      }
      const upstreamOk = !!(res.ok && parsed && parsed.ok === true);
      checks.push({
        url,
        status: res.status,
        ok: upstreamOk,
        error: parsed && parsed.ok === false ? String(parsed.error || 'Request failed') : ''
      });
      if (upstreamOk) {
        return {
          ok: true,
          token_configured: !!token,
          sheet_id_configured: !!sheetId,
          checks
        };
      }
    } catch (err) {
      checks.push({ url, ok: false, error: String(err && err.message ? err.message : err) });
    }
  }

  return {
    ok: false,
    error: 'all upstream attempts failed',
    token_configured: !!token,
    sheet_id_configured: !!sheetId,
    checks
  };
}

async function serveFrontend_(env, corsHeaders) {
  const defaultHtmlUrl = 'https://raw.githubusercontent.com/andhyaberna/ads/main/index.html';
  const htmlUrl = String(env.FRONTEND_HTML_URL || defaultHtmlUrl).trim();
  let timer = null;
  try {
    const timeoutMs = Number(env.FRONTEND_FETCH_TIMEOUT_MS || 12000);
    const ctrl = new AbortController();
    timer = setTimeout(() => ctrl.abort('frontend-timeout'), timeoutMs);
    const res = await fetch(htmlUrl, {
      method: 'GET',
      signal: ctrl.signal,
      headers: {
        'user-agent': 'ads-worker-frontend-proxy'
      }
    });

    if (!res.ok) {
      return json({ ok: false, error: 'Frontend unavailable' }, 502, corsHeaders);
    }

    const html = await res.text();
    const body = injectPublicRuntimeConfig_(html, env);
    return new Response(body, {
      status: 200,
      headers: {
        ...corsHeaders,
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store'
      }
    });
  } catch (err) {
    return json({ ok: false, error: 'Frontend unavailable' }, 502, corsHeaders);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function serveFrontendScript_(env, corsHeaders) {
  const defaultScriptUrl = 'https://raw.githubusercontent.com/andhyaberna/ads/main/app-main.js';
  const scriptUrl = String(env.FRONTEND_APP_MAIN_URL || defaultScriptUrl).trim();
  let timer = null;
  try {
    const timeoutMs = Number(env.FRONTEND_FETCH_TIMEOUT_MS || 12000);
    const ctrl = new AbortController();
    timer = setTimeout(() => ctrl.abort('frontend-js-timeout'), timeoutMs);
    const res = await fetch(scriptUrl, {
      method: 'GET',
      signal: ctrl.signal,
      headers: {
        'user-agent': 'ads-worker-frontend-proxy'
      }
    });

    if (!res.ok) {
      return json({ ok: false, error: 'Frontend script unavailable' }, 502, corsHeaders);
    }

    const js = await res.text();
    return new Response(js, {
      status: 200,
      headers: {
        ...corsHeaders,
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': 'no-store'
      }
    });
  } catch (err) {
    return json({ ok: false, error: 'Frontend script unavailable' }, 502, corsHeaders);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildPublicRuntimeConfig_(env) {
  const cfg = {};
  const gasWebAppUrl = String(env.GAS_WEB_APP_URL || '').trim();
  const dbTargetSheetId = String(env.DB_TARGET_SHEET_ID || '').trim();
  const authFallbackApiBase = String(env.PUBLIC_AUTH_FALLBACK_API_BASE || '').trim();

  if (gasWebAppUrl) cfg.gasWebAppUrl = gasWebAppUrl;
  if (dbTargetSheetId) cfg.dbTargetSheetId = dbTargetSheetId;
  if (authFallbackApiBase) cfg.authFallbackApiBase = authFallbackApiBase;

  return cfg;
}

function injectPublicRuntimeConfig_(html, env) {
  const source = String(html || '');
  const cfg = buildPublicRuntimeConfig_(env);
  const payload = JSON.stringify(cfg);
  const tag = `<script>window.__MATIQ_PUBLIC_CONFIG__=${payload};</script>`;

  if (source.indexOf('__MATIQ_PUBLIC_CONFIG__') >= 0) {
    return source;
  }
  if (source.indexOf('</head>') >= 0) {
    return source.replace('</head>', `${tag}</head>`);
  }
  return `${tag}${source}`;
}

async function tryServeStaticAsset_(request, env, corsHeaders) {
  if (!env || !env.ASSETS || typeof env.ASSETS.fetch !== 'function') return null;
  try {
    const res = await env.ASSETS.fetch(request);
    if (!res || res.status === 404) return null;
    const headers = new Headers(res.headers || {});
    headers.set('access-control-allow-origin', corsHeaders['access-control-allow-origin']);
    headers.set('access-control-allow-methods', corsHeaders['access-control-allow-methods']);
    headers.set('access-control-allow-headers', corsHeaders['access-control-allow-headers']);
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers
    });
  } catch (err) {
    return null;
  }
}

function normalizeGasResponseObj_(upstream, reqId) {
  if (!upstream || !upstream.ok) {
    return { ok: false, status: 502, error: 'Gateway upstream unavailable', request_id: reqId };
  }
  const status = Number(upstream.status || 502);
  const data = upstream.data || {};
  if (status >= 500) {
    return { ok: false, status: 502, error: 'Upstream service error', request_id: reqId };
  }
  if (data.ok === false) {
    return {
      ok: false,
      status: status >= 400 ? status : 400,
      error: sanitizeUpstreamError_(String(data.error || 'Request failed')),
      request_id: reqId
    };
  }
  return { ok: true, status: 200, data };
}

function normalizeGasResponse_(upstream, corsHeaders, reqId) {
  const normalized = normalizeGasResponseObj_(upstream, reqId);
  if (!normalized.ok) {
    return json({ ok: false, error: normalized.error, request_id: reqId }, normalized.status, corsHeaders);
  }
  return json(normalized.data, 200, corsHeaders);
}

function sanitizeUpstreamError_(message) {
  const msg = String(message || '').toLowerCase();
  if (!msg) return 'Request failed';
  if (msg.indexOf('forbidden') >= 0 || msg.indexOf('unauthorized') >= 0) return 'Akses ditolak';
  if (msg.indexOf('rate') >= 0) return 'Rate limit exceeded';
  if (msg.indexOf('invalid') >= 0) return 'Input tidak valid';
  if (msg.indexOf('tidak ada data valid') >= 0) return 'Tidak ada data valid yang bisa diimport';
  return message.slice(0, 180);
}

function buildCompactSummary_(snapshot) {
  const entities = Array.isArray(snapshot.entities) ? snapshot.entities : [];
  const urgentTop = entities
    .filter((e) => e && e.priority === 'Urgent')
    .sort((a, b) => ((b.metrics?.spend || 0) - (a.metrics?.spend || 0)))
    .slice(0, 20)
    .map((e) => ({
      level: e.level,
      name: e.name,
      spend: e.metrics?.spend || 0,
      ctr: e.metrics?.ctr || 0,
      roas: e.metrics?.roas || 0,
      cpa: e.metrics?.cpa || 0,
      freq: e.metrics?.freq || 0,
      status: e.status,
      diagnosis: e.diagnosis
    }));
  return {
    kpi: snapshot.kpi || {},
    urgent_top: urgentTop,
    alert_count: snapshot.kpi?.alert_count || 0
  };
}

function requestId_() {
  try {
    return crypto.randomUUID();
  } catch (err) {
    return `req_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  }
}

function parseCookies_(request) {
  const raw = request && request.headers ? (request.headers.get('cookie') || '') : '';
  const out = {};
  raw.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    const k = part.slice(0, idx).trim();
    if (!k) return;
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v || '');
  });
  return out;
}

function cookieAttr_(maxAgeSec, path) {
  const attrs = [
    `Path=${path || '/'}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax'
  ];
  if (Number.isFinite(maxAgeSec)) attrs.push(`Max-Age=${Math.max(0, Math.floor(maxAgeSec))}`);
  return attrs.join('; ');
}

function cookieSet_(name, value, maxAgeSec, path) {
  return `${name}=${encodeURIComponent(String(value || ''))}; ${cookieAttr_(maxAgeSec, path)}`;
}

function cookieClear_(name, path) {
  return `${name}=; ${cookieAttr_(0, path)}`;
}

function getOpenAiRedirectUri_(request, env) {
  const explicit = String(env.OPENAI_OAUTH_REDIRECT_URI || '').trim();
  if (explicit) return explicit;
  const url = new URL(request.url);
  return `${url.origin}/oauth/openai/callback`;
}

function getOpenAiAuthorizeUrl_(env) {
  return String(env.OPENAI_OAUTH_AUTHORIZE_URL || 'https://auth.openai.com/oauth/authorize').trim();
}

function getOpenAiTokenUrl_(env) {
  return String(env.OPENAI_OAUTH_TOKEN_URL || 'https://auth.openai.com/oauth/token').trim();
}

function getOpenAiScope_(env) {
  return String(env.OPENAI_OAUTH_SCOPES || 'openid profile offline_access').trim();
}

function getOpenAiClientId_(env) {
  return String(env.OPENAI_OAUTH_CLIENT_ID || '').trim();
}

function getOpenAiClientSecret_(env) {
  return String(env.OPENAI_OAUTH_CLIENT_SECRET || '').trim();
}

function openAiOauthErrorRedirect_(returnTo, errorCode, errorMsg) {
  const target = safeReturnPath_(returnTo);
  const qs = new URLSearchParams({
    oauth_provider: 'openai',
    oauth_status: String(errorCode || 'error'),
    oauth_error: String(errorMsg || 'OAuth gagal').slice(0, 180)
  });
  return `${target}${target.indexOf('?') >= 0 ? '&' : '?'}${qs.toString()}`;
}

function safeReturnPath_(returnTo) {
  const raw = String(returnTo || '').trim();
  if (!raw || raw.charAt(0) !== '/') return '/';
  if (/^\/\//.test(raw)) return '/';
  return raw.slice(0, 300);
}

function randomB64Url_(bytes = 32) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return toBase64Url(buf);
}

function decodeBase64UrlToString_(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4;
  const input = normalized + (pad ? '='.repeat(4 - pad) : '');
  return atob(input);
}

async function startOpenAiOAuth(request, env) {
  const clientId = getOpenAiClientId_(env);
  const redirectUri = getOpenAiRedirectUri_(request, env);
  const authorizeUrl = getOpenAiAuthorizeUrl_(env);
  const scope = getOpenAiScope_(env);
  if (!clientId || !redirectUri || !authorizeUrl) {
    return json({ ok: false, error: 'OpenAI OAuth config belum lengkap' }, 500, {
      'access-control-allow-origin': env.ALLOWED_ORIGIN || 'https://ads.cepat.top'
    });
  }

  const reqUrl = new URL(request.url);
  const state = randomB64Url_(24);
  const verifier = randomB64Url_(48);
  const challenge = await sha256ToBase64Url_(verifier);
  const returnTo = safeReturnPath_(reqUrl.searchParams.get('return_to') || '/');
  const statePayload = {
    state,
    verifier,
    return_to: returnTo,
    ts: Date.now()
  };
  const stateToken = await signStatePayload_(statePayload, env);

  const oauthParams = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  });

  const headers = new Headers({
    location: `${authorizeUrl}?${oauthParams.toString()}`,
    'cache-control': 'no-store'
  });
  headers.append('set-cookie', cookieSet_('oa_openai_state', stateToken, 600, '/oauth/openai'));
  return new Response(null, { status: 302, headers });
}

async function finishOpenAiOAuth(request, env) {
  const url = new URL(request.url);
  const code = String(url.searchParams.get('code') || '');
  const state = String(url.searchParams.get('state') || '');
  const providerError = String(url.searchParams.get('error') || '');
  const providerErrorDesc = String(url.searchParams.get('error_description') || '');
  const cookies = parseCookies_(request);
  const stateToken = cookies.oa_openai_state || '';
  const parsedState = await verifyStatePayload_(stateToken, env);
  const returnTo = safeReturnPath_(parsedState && parsedState.return_to ? parsedState.return_to : '/');

  const headers = new Headers({ 'cache-control': 'no-store' });
  headers.append('set-cookie', cookieClear_('oa_openai_state', '/oauth/openai'));

  if (!parsedState || !state || parsedState.state !== state) {
    headers.set('location', openAiOauthErrorRedirect_(returnTo, 'state_mismatch', 'State OAuth tidak valid')); 
    return new Response(null, { status: 302, headers });
  }

  if (providerError) {
    headers.set('location', openAiOauthErrorRedirect_(returnTo, 'provider_error', providerErrorDesc || providerError));
    return new Response(null, { status: 302, headers });
  }

  if (!code) {
    headers.set('location', openAiOauthErrorRedirect_(returnTo, 'missing_code', 'Authorization code tidak ada'));
    return new Response(null, { status: 302, headers });
  }

  const tokenRes = await exchangeOpenAiCode_(code, parsedState.verifier, getOpenAiRedirectUri_(request, env), env);
  if (!tokenRes.ok) {
    headers.set('location', openAiOauthErrorRedirect_(returnTo, 'token_exchange_failed', tokenRes.error || 'Token exchange gagal'));
    return new Response(null, { status: 302, headers });
  }

  const sessionCookie = await sealOpenAiSession_(tokenRes.session, env);
  if (!sessionCookie) {
    headers.set('location', openAiOauthErrorRedirect_(returnTo, 'session_store_failed', 'Session OAuth tidak dapat disimpan'));
    return new Response(null, { status: 302, headers });
  }

  headers.append('set-cookie', cookieSet_('oa_openai_session', sessionCookie, Number(tokenRes.session.max_age_sec || 3600), '/'));
  headers.set('location', `${returnTo}${returnTo.indexOf('?') >= 0 ? '&' : '?'}oauth_provider=openai&oauth_status=success`);
  return new Response(null, { status: 302, headers });
}

async function getOpenAiOAuthStatus(request, env, corsHeaders) {
  const refreshed = await getValidOpenAiSession(request, env);
  const headers = new Headers(corsHeaders || {});
  headers.set('content-type', 'application/json; charset=utf-8');
  if (refreshed && refreshed.set_cookie) headers.append('set-cookie', refreshed.set_cookie);
  if (refreshed && refreshed.clear_cookie) headers.append('set-cookie', refreshed.clear_cookie);
  if (!refreshed || !refreshed.access_token) {
    return new Response(JSON.stringify({ ok: true, connected: false, provider: 'openai' }), { status: 200, headers });
  }
  return new Response(JSON.stringify({
    ok: true,
    connected: true,
    provider: 'openai',
    expires_at: refreshed.expires_at || ''
  }), { status: 200, headers });
}

function logoutOpenAiOAuth(env, corsHeaders) {
  const headers = new Headers(corsHeaders || {});
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.append('set-cookie', cookieClear_('oa_openai_session', '/'));
  return new Response(JSON.stringify({ ok: true, provider: 'openai', logged_out: true }), { status: 200, headers });
}

async function exchangeOpenAiCode_(code, verifier, redirectUri, env) {
  const tokenUrl = getOpenAiTokenUrl_(env);
  const clientId = getOpenAiClientId_(env);
  const clientSecret = getOpenAiClientSecret_(env);
  if (!tokenUrl || !clientId || !clientSecret || !redirectUri || !code) {
    return { ok: false, error: 'OpenAI OAuth token config tidak lengkap' };
  }
  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
      code_verifier: verifier || ''
    });
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    const raw = await res.text();
    let parsed = {};
    try { parsed = raw ? JSON.parse(raw) : {}; } catch (_) { parsed = {}; }
    if (!res.ok || !parsed.access_token) {
      return { ok: false, error: String(parsed.error_description || parsed.error || `HTTP ${res.status}`) };
    }
    const nowMs = Date.now();
    const expSec = Number(parsed.expires_in || 3600);
    const expiresAtMs = nowMs + Math.max(60, expSec) * 1000;
    return {
      ok: true,
      session: {
        provider: 'openai',
        access_token: String(parsed.access_token || ''),
        refresh_token: String(parsed.refresh_token || ''),
        token_type: String(parsed.token_type || 'Bearer'),
        scope: String(parsed.scope || ''),
        expires_at: new Date(expiresAtMs).toISOString(),
        max_age_sec: Math.max(60, expSec)
      }
    };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

async function refreshOpenAiToken_(session, env) {
  const refreshToken = String(session && session.refresh_token ? session.refresh_token : '');
  if (!refreshToken) return { ok: false, error: 'no refresh token' };
  const tokenUrl = getOpenAiTokenUrl_(env);
  const clientId = getOpenAiClientId_(env);
  const clientSecret = getOpenAiClientSecret_(env);
  if (!tokenUrl || !clientId || !clientSecret) {
    return { ok: false, error: 'OpenAI OAuth token config tidak lengkap' };
  }
  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret
    });
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    const raw = await res.text();
    let parsed = {};
    try { parsed = raw ? JSON.parse(raw) : {}; } catch (_) { parsed = {}; }
    if (!res.ok || !parsed.access_token) {
      return { ok: false, error: String(parsed.error_description || parsed.error || `HTTP ${res.status}`) };
    }
    const expSec = Number(parsed.expires_in || 3600);
    const expiresAtMs = Date.now() + Math.max(60, expSec) * 1000;
    return {
      ok: true,
      session: {
        provider: 'openai',
        access_token: String(parsed.access_token || ''),
        refresh_token: String(parsed.refresh_token || refreshToken),
        token_type: String(parsed.token_type || session.token_type || 'Bearer'),
        scope: String(parsed.scope || session.scope || ''),
        expires_at: new Date(expiresAtMs).toISOString(),
        max_age_sec: Math.max(60, expSec)
      }
    };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

function isSessionExpired_(session) {
  const exp = Date.parse(String(session && session.expires_at ? session.expires_at : ''));
  if (!Number.isFinite(exp)) return true;
  return Date.now() > (exp - 30 * 1000);
}

async function getValidOpenAiSession(request, env) {
  if (!request) return null;
  const cookies = parseCookies_(request);
  const enc = cookies.oa_openai_session || '';
  if (!enc) return null;
  const session = await unsealOpenAiSession_(enc, env);
  if (!session || !session.access_token) {
    return { clear_cookie: cookieClear_('oa_openai_session', '/') };
  }
  if (!isSessionExpired_(session)) return session;
  const refreshed = await refreshOpenAiToken_(session, env);
  if (!refreshed.ok || !refreshed.session) {
    return { clear_cookie: cookieClear_('oa_openai_session', '/') };
  }
  const sealed = await sealOpenAiSession_(refreshed.session, env);
  if (!sealed) return refreshed.session;
  return Object.assign({}, refreshed.session, {
    set_cookie: cookieSet_('oa_openai_session', sealed, Number(refreshed.session.max_age_sec || 3600), '/')
  });
}

async function signStatePayload_(payload, env) {
  const secret = resolveOpenAiCookieSecret_(env);
  if (!secret) return '';
  const raw = JSON.stringify(payload || {});
  const encoded = toBase64Url(new TextEncoder().encode(raw));
  const sig = await hmacSha256Base64Url(secret, encoded);
  return `${encoded}.${sig}`;
}

async function verifyStatePayload_(token, env) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const secret = resolveOpenAiCookieSecret_(env);
  if (!secret) return null;
  const expected = await hmacSha256Base64Url(secret, encoded);
  if (!constantTimeEqual(expected, sig)) return null;
  try {
    const raw = decodeBase64UrlToString_(encoded);
    const parsed = JSON.parse(raw || '{}');
    const ts = Number(parsed.ts || 0);
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 10 * 60 * 1000) return null;
    return parsed;
  } catch (err) {
    return null;
  }
}

function resolveOpenAiCookieSecret_(env) {
  return String(
    env.OPENAI_OAUTH_SESSION_SECRET
    || env.SIGNING_SECRET
    || env.INTERNAL_TOKEN
    || env.INTERNAL_API_TOKEN
    || ''
  ).trim();
}

async function aesKeyFromSecret_(secret) {
  const enc = new TextEncoder().encode(String(secret || ''));
  const digest = await crypto.subtle.digest('SHA-256', enc);
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function sealOpenAiSession_(session, env) {
  const secret = resolveOpenAiCookieSecret_(env);
  if (!secret) return '';
  const key = await aesKeyFromSecret_(secret);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const clear = new TextEncoder().encode(JSON.stringify(session || {}));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, clear);
  const payload = `${toBase64Url(iv)}.${toBase64Url(new Uint8Array(cipher))}`;
  return payload;
}

async function unsealOpenAiSession_(sealed, env) {
  const secret = resolveOpenAiCookieSecret_(env);
  if (!secret) return null;
  const parts = String(sealed || '').split('.');
  if (parts.length !== 2) return null;
  try {
    const ivRaw = decodeBase64UrlToString_(parts[0]);
    const dataRaw = decodeBase64UrlToString_(parts[1]);
    const iv = new Uint8Array(ivRaw.length);
    for (let i = 0; i < ivRaw.length; i++) iv[i] = ivRaw.charCodeAt(i);
    const data = new Uint8Array(dataRaw.length);
    for (let i = 0; i < dataRaw.length; i++) data[i] = dataRaw.charCodeAt(i);
    const key = await aesKeyFromSecret_(secret);
    const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    const text = new TextDecoder().decode(clear);
    return JSON.parse(text || '{}');
  } catch (err) {
    return null;
  }
}

async function sha256ToBase64Url_(input) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(input || '')));
  return toBase64Url(new Uint8Array(buf));
}

async function proxyAi(rawBody, env, request) {
  let body = {};
  try {
    body = JSON.parse(rawBody || '{}');
  } catch (err) {
    return json({ ok: false, error: 'Invalid JSON body' }, 400, {
      'access-control-allow-origin': env.ALLOWED_ORIGIN || 'https://ads.cepat.top'
    });
  }
  const question = body.question || '';
  const summary = body.summary || {};
  const rawProvider = String(body.provider || 'openai').toLowerCase();
  const provider = ['openai', 'gemini', 'claude'].includes(rawProvider) ? rawProvider : 'openai';
  const userApiKey = String(body.user_api_key || '').trim();
  const model = body.model || body.mode || (
    provider === 'gemini'
      ? (env.GEMINI_MODEL || 'gemini-1.5-flash')
      : provider === 'claude'
        ? (env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022')
        : (env.OPENAI_MODEL || 'gpt-4o-mini')
  );

  if (!question) {
    return json({ ok: false, error: 'Question is required' }, 400, {
      'access-control-allow-origin': env.ALLOWED_ORIGIN || 'https://ads.cepat.top'
    });
  }

  const cacheTtl = Number(env.AI_CACHE_TTL_SEC || 300);
  const cacheKey = await sha256Hex(`${provider}|${model}|${question}|${JSON.stringify(summary)}`);
  const aiCache = env.AI_CACHE_KV;
  if (aiCache) {
    const cached = await aiCache.get(`ai:${cacheKey}`);
    if (cached) {
      return json({ ok: true, answer: cached, cached: true }, 200, {
        'access-control-allow-origin': env.ALLOWED_ORIGIN || 'https://ads.cepat.top'
      });
    }
  }

  const allowLegacyOpenAiUserKey = String(env.OPENAI_ALLOW_LEGACY_USER_KEY || '').toLowerCase() === 'true';
  const oauthOpenAi = provider === 'openai' ? await getValidOpenAiSession(request, env) : null;
  const resolvedApiKey = provider === 'openai'
    ? (
      (oauthOpenAi && oauthOpenAi.access_token ? oauthOpenAi.access_token : '')
      || (allowLegacyOpenAiUserKey ? userApiKey : '')
      || (env.OPENAI_API_KEY || '')
    )
    : (
      userApiKey || (
        provider === 'gemini'
          ? (env.GEMINI_API_KEY || '')
          : provider === 'claude'
            ? (env.CLAUDE_API_KEY || '')
            : (env.OPENAI_API_KEY || '')
      )
    );
  if (!resolvedApiKey) {
    const miss = provider === 'openai'
      ? 'OpenAI belum terhubung. Login OpenAI OAuth di Settings lalu validasi session.'
      : `API key ${provider.toUpperCase()} belum tersedia untuk request ini.`;
    return json({ ok: true, answer: miss }, 200, {
      'access-control-allow-origin': env.ALLOWED_ORIGIN || 'https://ads.cepat.top'
    });
  }

  const prompt = [
    'Kamu adalah analis Meta Ads senior.',
    'Jawab dalam Bahasa Indonesia.',
    'Berikan jawaban spesifik, actionable, urut prioritas.',
    'Jika datanya kurang, sebutkan data tambahan paling penting.',
    '',
    'RINGKASAN DATA:',
    JSON.stringify(summary),
    '',
    'PERTANYAAN:',
    question
  ].join('\n');

  let answer = 'Tidak ada jawaban AI.';
  if (provider === 'gemini') {
    const geminiBase = env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
    const geminiRes = await fetch(`${geminiBase}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(resolvedApiKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3 }
      })
    });
    const geminiData = await geminiRes.json();
    answer = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || answer;
  } else if (provider === 'claude') {
    const claudeBase = env.CLAUDE_BASE_URL || 'https://api.anthropic.com/v1';
    const claudeRes = await fetch(`${claudeBase}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': resolvedApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: 800,
        temperature: 0.3,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const claudeData = await claudeRes.json();
    answer = claudeData?.content?.[0]?.text || answer;
  } else {
    const base = env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const openAiRes = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${resolvedApiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3
      })
    });
    const data = await openAiRes.json();
    answer = data?.choices?.[0]?.message?.content || answer;
  }
  if (aiCache && answer) {
    await aiCache.put(`ai:${cacheKey}`, answer, { expirationTtl: cacheTtl });
  }
  return json({ ok: true, answer }, 200, {
    'access-control-allow-origin': env.ALLOWED_ORIGIN || 'https://ads.cepat.top'
  });
}

async function receiveWebhook(request, env) {
  const rawBody = await request.text();
  const token = request.headers.get('x-webhook-token') || '';
  const ts = request.headers.get('x-webhook-ts') || '';
  const sig = request.headers.get('x-webhook-signature') || '';
  if (env.WEBHOOK_SECRET) {
    const tsMs = Number(ts);
    if (!Number.isFinite(tsMs) || Math.abs(Date.now() - tsMs) > Number(env.WEBHOOK_MAX_SKEW_MS || 5 * 60 * 1000)) {
      return json({ ok: false, error: 'Stale webhook timestamp' }, 401);
    }
    const expected = await hmacSha256Base64Url(env.WEBHOOK_SECRET, `${ts}.${rawBody}`);
    if (!constantTimeEqual(expected, sig)) {
      return json({ ok: false, error: 'Invalid webhook signature' }, 401);
    }
  } else if (!env.WEBHOOK_TOKEN || token !== env.WEBHOOK_TOKEN) {
    return json({ ok: false, error: 'Invalid webhook token' }, 401);
  }

  let payload = {};
  try {
    payload = JSON.parse(rawBody || '{}');
  } catch (err) {
    return json({ ok: false, error: 'Invalid webhook JSON' }, 400);
  }

  return json({ ok: true, received: true, keys: Object.keys(payload || {}) }, 200, {
    'access-control-allow-origin': env.ALLOWED_ORIGIN || 'https://ads.cepat.top'
  });
}

async function hmacSha256Base64Url(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return toBase64Url(new Uint8Array(signature));
}

async function sha256Hex(input) {
  const enc = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', enc);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function toBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function constantTimeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: Object.assign({
      'content-type': 'application/json; charset=utf-8'
    }, extraHeaders)
  });
}
