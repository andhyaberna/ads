import { optionsResponse, proxyProtectedAction, withCors } from '../_lib/gas.js';

export async function onRequestGet(context) {
  return withCors(await proxyProtectedAction(context, 'get_user'));
}

export async function onRequestPost(context) {
  return withCors(await proxyProtectedAction(context, 'update_user'));
}

export async function onRequestOptions() {
  return optionsResponse();
}
