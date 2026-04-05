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

export async function proxyAuthAction(context, action) {
  const { request, env } = context;
  const gasUrl = String(env.GAS_WEB_APP_URL || '').trim();
  if (!gasUrl) {
    return json({ ok: false, error: 'GAS_WEB_APP_URL is not configured' }, 500);
  }

  const payload = await readJson(request);
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

    const status = response.ok ? 200 : response.status || 500;
    return json(parsed, status);
  } catch (err) {
    return json({ ok: false, error: err.message || 'Failed to reach GAS endpoint' }, 502);
  }
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
