export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const corsHeaders = {
      'access-control-allow-origin': env.ALLOWED_ORIGIN || 'https://ads.cepat.top',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type,x-internal-token,x-webhook-token,x-ts,x-nonce,x-signature'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (path === '/health') {
      return json({ ok: true, worker: 'ads', ts: Date.now() }, 200, corsHeaders);
    }

    if (path === '/' && request.method === 'GET') {
      const target = env.GAS_WEB_APP_URL || 'https://script.google.com/macros/s/AKfycbyEQM12lmuZ_Q7NrBC_OVEHXDHN49oLEe52GLuMbFbSiH3HSzz6PK1S7DULwnfuTp4U/exec';
      return Response.redirect(target, 302);
    }

    if (!isAllowedOrigin(request, env)) {
      return json({ ok: false, error: 'Origin not allowed' }, 403, corsHeaders);
    }

    if (!(await checkRateLimit(request, env))) {
      return json({ ok: false, error: 'Rate limit exceeded' }, 429, corsHeaders);
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
  const model = body.mode || (
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
