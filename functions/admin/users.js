import { optionsResponse, proxyProtectedAction, withCors } from '../_lib/gas.js';

export async function onRequestGet(context) {
  return withCors(await proxyProtectedAction(context, 'list_users'));
}

export async function onRequestPost(context) {
  const payload = await context.request.clone().json().catch(() => ({}));
  const action = payload && payload.password ? 'create_user' : 'list_users';
  return withCors(await proxyProtectedAction(context, action));
}

export async function onRequestOptions() {
  return optionsResponse();
}
