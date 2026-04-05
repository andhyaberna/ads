function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch (err) {
    return {};
  }
}

function readQuery(request) {
  const url = new URL(request.url);
  const payload = {};
  for (const [key, value] of url.searchParams.entries()) {
    payload[key] = value;
  }
  return payload;
}

function inferErrorStatus(message, fallbackStatus = 400) {
  const msg = String(message || '').toLowerCase();
  if (!msg) return fallbackStatus;
  if (msg.includes('unauthorized') || msg.includes('login diperlukan') || msg.includes('token')) {
    return 401;
  }
  if (msg.includes('forbidden') || msg.includes('hanya admin') || msg.includes('akses ditolak')) {
    return 403;
  }
  if (msg.includes('not found') || msg.includes('tidak ditemukan')) {
    return 404;
  }
  return fallbackStatus;
}

async function proxyGasAction(context, action, options = {}) {
  const { request, env } = context;
  const gasUrl = String(env.GAS_WEB_APP_URL || '').trim();
  if (!gasUrl) {
    return json({ ok: false, error: 'GAS_WEB_APP_URL is not configured' }, 500);
  }

  const method = String(request.method || 'POST').toUpperCase();
  const payload = method === 'GET' ? readQuery(request) : await readJson(request);
  const body = {
    ...payload,
    action,
  };

  if (env.DB_TARGET_SHEET_ID && !body.db_target_sheet_id) {
    body.db_target_sheet_id = String(env.DB_TARGET_SHEET_ID).trim();
  }

  const authHeader = request.headers.get('authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (bearer && !body.auth_token) body.auth_token = bearer;

  if (options.requireAuth && !body.auth_token) {
    return json({ ok: false, error: 'Unauthorized: Login diperlukan' }, 401);
  }

  if (options.includeInternalToken !== false) {
    const internalToken = String(env.INTERNAL_API_TOKEN || '').trim();
    if (internalToken && !body.internal_token) {
      body.internal_token = internalToken;
    }
  }

  try {
    const response = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch (err) {
      return json(
        {
          ok: false,
          error: 'Invalid JSON response from GAS endpoint',
          status: response.status,
        },
        502,
      );
    }

    if (parsed && parsed.ok === false) {
      const status = response.ok
        ? inferErrorStatus(parsed.error, 400)
        : (response.status || inferErrorStatus(parsed.error, 502));
      return json(parsed, status);
    }

    const status = response.ok ? 200 : response.status || 500;
    return json(parsed, status);
  } catch (err) {
    return json({ ok: false, error: err.message || 'Failed to reach GAS endpoint' }, 502);
  }
}

export async function proxyAuthAction(context, action) {
  return proxyGasAction(context, action, { includeInternalToken: false });
}

export async function proxyProtectedAction(context, action) {
  return proxyGasAction(context, action, {
    includeInternalToken: true,
    requireAuth: true,
  });
}

export function optionsResponse() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'Content-Type, Authorization',
      'access-control-max-age': '86400',
    },
  });
}

export function withCors(response) {
  const headers = new Headers(response.headers);
  headers.set('access-control-allow-origin', '*');
  headers.set('access-control-allow-methods', 'GET, POST, OPTIONS');
  headers.set('access-control-allow-headers', 'Content-Type, Authorization');
  return new Response(response.body, { status: response.status, headers });
}
