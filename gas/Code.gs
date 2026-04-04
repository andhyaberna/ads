/**
 * Entry point Google Apps Script Web App
 */
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  if (action) {
    try {
      requireInternalApiToken_(e && e.parameter ? e.parameter.internal_token : '');
    } catch (authErr) {
      return jsonResponse({ ok: false, error: authErr.message || 'Unauthorized' });
    }
    return handleApiGet(action, e.parameter || {});
  }

  ensureDbReady();
  return HtmlService.createHtmlOutputFromFile('App')
    .setTitle('Ad Campaign Tracker')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  var payload = {};
  try {
    payload = e && e.postData && e.postData.contents
      ? JSON.parse(e.postData.contents)
      : {};
  } catch (err) {
    return jsonResponse({ ok: false, error: 'Invalid JSON body' });
  }

  var action = payload.action || (e && e.parameter && e.parameter.action) || '';
  if (!action) return jsonResponse({ ok: false, error: 'Missing action' });

  try {
    requireInternalApiToken_(payload.internal_token || (e && e.parameter ? e.parameter.internal_token : ''));
  } catch (authErr) {
    return jsonResponse({ ok: false, error: authErr.message || 'Unauthorized' });
  }

  return handleApiPost(action, payload);
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
