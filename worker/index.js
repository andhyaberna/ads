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

    if (path === '/health') {
      return json({ ok: true, worker: 'ads', ts: Date.now() }, 200, corsHeaders);
    }

    if (path === '/' && request.method === 'GET') {
      return json({ ok: true, service: 'ads-gateway' }, 200, corsHeaders);
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
      return handleProtectedAction(request, env, corsHeaders, 'create_user');
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
    
    if (path === '/admin/stats' && request.method === 'GET') {
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
      return proxyAi(rawBody, env);
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
    try {
      const res = await fetch(urls[i], {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestBody)
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
  return !!token && token === env.INTERNAL_TOKEN;
}

async function verifyInternalRequest(request, env, rawBody) {
  if (!checkToken(request, env)) {
    return { ok: false, error: 'Invalid internal token' };
  }

  const ts = request.headers.get('x-ts') || '';
  const nonce = request.headers.get('x-nonce') || '';
  const sig = request.headers.get('x-signature') || '';
  const secret = env.SIGNING_SECRET || env.INTERNAL_TOKEN;
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

  const aiResponse = await proxyAi(JSON.stringify({ question, provider, summary }), env);
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
  const token = String(env.INTERNAL_API_TOKEN || '').trim();
  if (!urls.length) {
    return { ok: false, status: 500, error: 'Gateway not configured' };
  }

  const requestBody = withGatewaySheetId_(Object.assign({}, payload || {}, {
    action
  }), env);
  if (token) requestBody.internal_token = token;

  for (let i = 0; i < urls.length; i++) {
    try {
      const res = await fetch(urls[i], {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestBody)
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

async function proxyAi(rawBody, env) {
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

  const resolvedApiKey = userApiKey || (
    provider === 'gemini'
      ? (env.GEMINI_API_KEY || '')
      : provider === 'claude'
        ? (env.CLAUDE_API_KEY || '')
        : (env.OPENAI_API_KEY || '')
  );
  if (!resolvedApiKey) {
    return json({ ok: true, answer: `API key ${provider.toUpperCase()} belum tersedia untuk request ini.` }, 200, {
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
