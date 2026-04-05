/**
 * Entry point Google Apps Script Web App
 */

// Actions that don't require internal API token (public auth endpoints)
var PUBLIC_ACTIONS = ['register', 'login', 'create_first_admin', 'verify_token'];

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  if (e && e.parameter && e.parameter.db_target_sheet_id) {
    setDbTargetSheetIdOverride_(e.parameter.db_target_sheet_id);
  }
  if (action) {
    // Check if this action requires internal token
    if (PUBLIC_ACTIONS.indexOf(action) < 0) {
      try {
        requireInternalApiToken_(e && e.parameter ? e.parameter.internal_token : '');
      } catch (authErr) {
        return jsonResponse({ ok: false, error: authErr.message || 'Unauthorized' });
      }
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
  var sheetOverride = payload.db_target_sheet_id || (e && e.parameter ? e.parameter.db_target_sheet_id : '');
  if (sheetOverride) {
    setDbTargetSheetIdOverride_(sheetOverride);
  }
  if (!action) return jsonResponse({ ok: false, error: 'Missing action' });

  // Check if this action requires internal token
  if (PUBLIC_ACTIONS.indexOf(action) < 0) {
    try {
      requireInternalApiToken_(payload.internal_token || (e && e.parameter ? e.parameter.internal_token : ''));
    } catch (authErr) {
      return jsonResponse({ ok: false, error: authErr.message || 'Unauthorized' });
    }
  }

  return handleApiPost(action, payload);
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
