import { withCors, optionsResponse } from './_lib/gas.js';

export async function onRequestGet() {
  return withCors(
    new Response(
      JSON.stringify({ ok: true, service: 'pages-functions-gateway' }),
      {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      },
    ),
  );
}

export async function onRequestOptions() {
  return optionsResponse();
}
