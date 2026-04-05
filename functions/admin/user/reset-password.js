import { optionsResponse, proxyProtectedAction, withCors } from '../../_lib/gas.js';

export async function onRequestPost(context) {
  return withCors(await proxyProtectedAction(context, 'reset_user_password'));
}

export async function onRequestOptions() {
  return optionsResponse();
}
