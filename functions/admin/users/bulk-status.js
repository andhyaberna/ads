import { optionsResponse, proxyProtectedAction, withCors } from '../../_lib/gas.js';

export async function onRequestPost(context) {
  return withCors(await proxyProtectedAction(context, 'bulk_update_status'));
}

export async function onRequestOptions() {
  return optionsResponse();
}
