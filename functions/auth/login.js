import { proxyAuthAction, optionsResponse, withCors } from '../_lib/gas.js';

export async function onRequestPost(context) {
  return withCors(await proxyAuthAction(context, 'login'));
}

export async function onRequestOptions() {
  return optionsResponse();
}
