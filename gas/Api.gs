function handleApiGet(action, params) {
  try {
    if (action === 'health') {
      ensureDbReady();
      return jsonResponse({ ok: true, message: 'healthy' });
    }
    if (action === 'snapshot') {
      return jsonResponse({ ok: true, data: apiGetSnapshot_() });
    }
    if (action === 'ai_config') {
      return jsonResponse({ ok: true, data: apiGetAiConfig_() });
    }
    return jsonResponse({ ok: false, error: 'Unknown GET action: ' + action });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message || String(err) });
  }
}

function handleApiPost(action, payload) {
  try {
    switch (action) {
      // ─────────────────────────────────────────────────────────────────────
      // AUTH ENDPOINTS (no token required)
      // ─────────────────────────────────────────────────────────────────────
      case 'register':
        return jsonResponse(registerUser_(payload));
      case 'login':
        return jsonResponse(loginUser_(payload));
      case 'verify_token':
        return jsonResponse(verifyToken_(payload.auth_token));
      case 'logout':
        var tokenResult = validateAuthToken_(payload.auth_token);
        return jsonResponse(logoutUser_(tokenResult.valid ? tokenResult.token_id : null));
      case 'create_first_admin':
        return jsonResponse(createFirstAdmin_(payload.email, payload.password, payload.name));
      
      // ─────────────────────────────────────────────────────────────────────
      // PROTECTED ENDPOINTS (token required)
      // ─────────────────────────────────────────────────────────────────────
      case 'bootstrap':
        ensureDbReady();
        return jsonResponse({ ok: true, message: 'DB ready' });
      case 'import_csv':
        return jsonResponse(apiImportCsv_(payload));
      case 'snapshot':
        return jsonResponse({ ok: true, data: apiGetSnapshot_() });
      case 'save_thresholds':
        return jsonResponse(apiSaveThresholds_(payload));
      case 'save_note':
        return jsonResponse(apiSaveNote_(payload));
      case 'save_settings':
        return jsonResponse(apiSaveSettings_(payload));
      case 'reset_data':
        return jsonResponse(apiResetData_(payload));
      case 'compare_periods':
        return jsonResponse(apiComparePeriods_(payload));
      case 'ask_ai':
        return jsonResponse(apiAskAi_(payload));
      case 'save_ai_config':
        return jsonResponse(apiSaveAiConfig_(payload));
      case 'get_ai_config':
        return jsonResponse({ ok: true, data: apiGetAiConfig_() });
      
      // ─────────────────────────────────────────────────────────────────────
      // USER MANAGEMENT ENDPOINTS (admin only)
      // ─────────────────────────────────────────────────────────────────────
      case 'list_users':
        var adminUser1 = assertAdminRole_(payload);
        return jsonResponse(apiListUsers_(payload, adminUser1));
      case 'get_user':
        var adminUser2 = assertAdminRole_(payload);
        return jsonResponse(apiGetUser_(payload, adminUser2));
      case 'create_user':
        var adminUser3 = assertAdminRole_(payload);
        return jsonResponse(apiCreateUser_(payload, adminUser3));
      case 'update_user':
        var adminUser4 = assertAdminRole_(payload);
        return jsonResponse(apiUpdateUser_(payload, adminUser4));
      case 'delete_user':
        var adminUser5 = assertAdminRole_(payload);
        return jsonResponse(apiDeleteUser_(payload, adminUser5));
      case 'reset_user_password':
        var adminUser6 = assertAdminRole_(payload);
        return jsonResponse(apiResetUserPassword_(payload, adminUser6));
      case 'bulk_update_status':
        var adminUser7 = assertAdminRole_(payload);
        return jsonResponse(apiBulkUpdateStatus_(payload, adminUser7));
      case 'get_user_stats':
        assertAdminRole_(payload);
        return jsonResponse(apiGetUserStats_());
      
      // ─────────────────────────────────────────────────────────────────────
      // PROFILE ENDPOINTS (any logged in user)
      // ─────────────────────────────────────────────────────────────────────
      case 'get_profile':
        var currentUser = assertAuthToken_(payload);
        return jsonResponse({ ok: true, user: currentUser });
      case 'update_profile':
        return jsonResponse(apiUpdateProfile_(payload));
      case 'change_password':
        return jsonResponse(apiChangePassword_(payload));
      
      default:
        return jsonResponse({ ok: false, error: 'Unknown action: ' + action });
    }
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message || String(err) });
  }
}

function apiImportCsv_(payload) {
  // Admin only via hybrid auth
  assertAdminHybrid_(payload);
  
  ensureDbReady();
  payload = payload || {};
  var level = String(payload.level || '').toLowerCase();
  var csvText = payload.csv_text || '';
  var excelBase64 = payload.excel_base64 || '';
  var fileType = String(payload.file_type || '').toLowerCase();
  var fileName = payload.file_name || 'meta_export.csv';
  var periodLabel = payload.period_label || '';
  var worksheetName = payload.worksheet_name || '';
  var now = new Date().toISOString();
  var batchId = 'batch_' + Utilities.getUuid();

  if (!level || ['campaign','adset','ad'].indexOf(level) < 0) {
    return { ok: false, error: 'level harus campaign/adset/ad' };
  }

  var parsed;
  try {
    var isXlsx = fileType === 'xlsx' || /\.xlsx$/i.test(fileName) || !!excelBase64;
    if (isXlsx) {
      if (!excelBase64) return { ok: false, error: 'excel_base64 kosong' };
      parsed = parseExcelImport_(excelBase64, level, fileName, periodLabel, worksheetName);
    } else {
      if (!csvText) return { ok: false, error: 'csv_text kosong' };
      parsed = parseCsvImport_(csvText, level, fileName, periodLabel);
    }
  } catch (parseErr) {
    appendRows_('import_logs', [{
      import_batch_id: batchId,
      level: level,
      file_name: fileName,
      row_count: 0,
      imported_at: now,
      status: 'failed',
      message: parseErr.message || String(parseErr)
    }]);
    return { ok: false, error: 'Gagal parsing file import: ' + (parseErr.message || String(parseErr)) };
  }

  var rows = parsed.rows;
  if (!rows.length) {
    appendRows_('import_logs', [{
      import_batch_id: batchId,
      level: level,
      file_name: fileName,
      row_count: 0,
      imported_at: now,
      status: 'failed',
      message: 'Tidak ada data valid yang bisa diimport'
    }]);
    return { ok: false, error: 'Tidak ada data valid yang bisa diimport. Cek header/isi file.' };
  }

  var target = level === 'campaign' ? 'campaigns' : level === 'adset' ? 'adsets' : 'ads';
  var normalized = rows.map(function (r) {
    r.import_batch_id = batchId;
    r.created_at = now;
    if (!r.roas) r.roas = safeDiv_(Number(r.revenue) || 0, Number(r.spend) || 0);
    if (!r.cpm) r.cpm = (Number(r.impressions) || 0) ? (safeDiv_(Number(r.spend) || 0, Number(r.impressions) || 0) * 1000) : 0;
    if (!r.cpa) r.cpa = safeDiv_(Number(r.spend) || 0, Number(r.results) || 0);
    return r;
  });

  appendRows_(target, normalized);
  appendRows_('import_logs', [{
    import_batch_id: batchId,
    level: level,
    file_name: fileName,
    row_count: normalized.length,
    imported_at: now,
    status: 'success',
    message: (parsed.warnings || []).join('; ')
  }]);

  return {
    ok: true,
    import_batch_id: batchId,
    row_count: normalized.length,
    warnings: parsed.warnings || []
  };
}

function apiGetSnapshot_() {
  ensureDbReady();
  var campaigns = getSheetRows_('campaigns').filter(function (r) { return !isEntityRowOff_(r); });
  var adsets = getSheetRows_('adsets').filter(function (r) { return !isEntityRowOff_(r); });
  var ads = getSheetRows_('ads').filter(function (r) { return !isEntityRowOff_(r); });
  var thresholds = getSheetRows_('thresholds');
  var notes = getSheetRows_('notes');
  var settings = sanitizeSettingsForClient_(getSheetRows_('settings'));

  var entities = [];

  campaigns.forEach(function (r) {
    entities.push(enrichEntity_(r, 'campaign', thresholds, notes));
  });
  adsets.forEach(function (r) {
    entities.push(enrichEntity_(r, 'adset', thresholds, notes));
  });
  ads.forEach(function (r) {
    entities.push(enrichEntity_(r, 'ad', thresholds, notes));
  });

  var totals = entities.reduce(function (acc, e) {
    var m = e.metrics;
    acc.spend += m.spend;
    acc.revenue += m.revenue;
    return acc;
  }, { spend: 0, revenue: 0 });

  var roasOverall = safeDiv_(totals.revenue, totals.spend);
  var urgentCount = entities.filter(function (e) { return e.priority === 'Urgent'; }).length;
  var alertCount = entities.reduce(function (n, e) { return n + (e.alerts ? e.alerts.length : 0); }, 0);

  return {
    kpi: {
      total_spend: totals.spend,
      total_revenue: totals.revenue,
      roas_overall: roasOverall,
      campaign_count: campaigns.length,
      adset_count: adsets.length,
      ad_count: ads.length,
      urgent_count: urgentCount,
      alert_count: alertCount
    },
    entities: entities,
    hierarchy: buildHierarchy_(campaigns, adsets, ads),
    thresholds: thresholds,
    notes: notes,
    settings: settings,
    import_logs: getSheetRows_('import_logs')
  };
}

function isEntityRowOff_(row) {
  row = row || {};
  var spend = Number(row.spend) || 0;
  var impressions = Number(row.impressions) || 0;
  var results = Number(row.results) || 0;
  var revenue = Number(row.revenue) || 0;
  return spend === 0 && impressions === 0 && results === 0 && revenue === 0;
}

function enrichEntity_(row, level, thresholdRows, notes) {
  var metrics = calcMetrics_(row);
  var diagnosis = diagnose_(row, level)[0];
  var alerts = checkThresholds_(row, thresholdRows);
  var noteId = level + '::' + (level === 'campaign' ? row.campaign_name : level === 'adset' ? row.adset_name : row.ad_name);
  var note = (notes || []).find(function (n) { return n.id === noteId; });
  var name = level === 'campaign' ? row.campaign_name : level === 'adset' ? row.adset_name : row.ad_name;

  return {
    id: row.id,
    level: level,
    name: name || '(tanpa nama)',
    campaign_name: row.campaign_name || '',
    adset_name: row.adset_name || '',
    ad_name: row.ad_name || '',
    metrics: metrics,
    status: diagnosis.status,
    priority: diagnosis.priority,
    diagnosis: diagnosis.diagnosis,
    action: diagnosis.action,
    briefs: generateBrief_(row),
    alerts: alerts,
    note: note ? note.note_text : '',
    period_label: row.period_label || '',
    date_start: row.date_start || '',
    date_end: row.date_end || ''
  };
}

function apiSaveThresholds_(payload) {
  // Admin only via hybrid auth
  assertAdminHybrid_(payload);
  var items = payload.items || [];
  upsertThresholds_(items);
  return { ok: true };
}

function apiSaveNote_(payload) {
  // Any authenticated user
  assertAuthorizedUserHybrid_(payload);
  var level = payload.entity_level;
  var name = payload.entity_name;
  var note = payload.note_text || '';
  if (!level || !name) return { ok: false, error: 'entity_level/entity_name wajib' };
  upsertNote_(level, name, note);
  return { ok: true };
}

function apiSaveSettings_(payload) {
  assertAdminHybrid_(payload);
  var items = payload.items || [];
  var nonSensitive = [];
  items.forEach(function (i) {
    var k = String(i.key_name || '').trim();
    if (!k) return;
    var v = String(i.key_value || '').trim();
    if (k === 'APP_ALLOWED_DOMAIN') {
      setScriptConfig_('APP_ALLOWED_DOMAIN', v.toLowerCase());
      return;
    }
    if (isSensitiveSettingKey_(k)) {
      if (v) setScriptConfig_(k, v);
    } else {
      nonSensitive.push({ key_name: k, key_value: v });
    }
  });
  if (nonSensitive.length) upsertSettings_(nonSensitive);
  return { ok: true };
}

function apiResetData_(payload) {
  assertAdminHybrid_(payload);
  clearDataSheets_();
  return { ok: true, message: 'Data campaigns/adsets/ads/notes/import_logs direset' };
}

function apiComparePeriods_(payload) {
  // Check access - only paid users or admin
  var user = assertAuthorizedUserHybrid_(payload);
  if (user.role !== 'admin' && user.payment_status !== 'LUNAS') {
    throw new Error('Forbidden: Fitur ini hanya untuk user dengan status LUNAS');
  }
  
  var level = String(payload.level || 'campaign').toLowerCase();
  var pA = parseCsvImport_(payload.csv_a || '', level, 'period_A.csv', 'A').rows;
  var pB = parseCsvImport_(payload.csv_b || '', level, 'period_B.csv', 'B').rows;

  var keyByLevel = level === 'campaign' ? 'campaign_name' : level === 'adset' ? 'adset_name' : 'ad_name';
  var mapA = {};
  pA.forEach(function (r) { mapA[r[keyByLevel]] = r; });

  var out = pB.map(function (b) {
    var a = mapA[b[keyByLevel]] || {};
    var mA = calcMetrics_(a);
    var mB = calcMetrics_(b);
    var deltaRoasPct = mA.roas ? ((mB.roas - mA.roas) / mA.roas) * 100 : 0;
    var deltaCtrPct = mA.ctr ? ((mB.ctr - mA.ctr) / mA.ctr) * 100 : 0;
    var deltaCpaPct = mA.cpa ? ((mB.cpa - mA.cpa) / mA.cpa) * 100 : 0;
    return {
      name: b[keyByLevel] || '(tanpa nama)',
      roas_a: mA.roas,
      roas_b: mB.roas,
      delta_roas_pct: deltaRoasPct,
      ctr_a: mA.ctr,
      ctr_b: mB.ctr,
      delta_ctr_pct: deltaCtrPct,
      cpa_a: mA.cpa,
      cpa_b: mB.cpa,
      delta_cpa_pct: deltaCpaPct
    };
  });

  return { ok: true, rows: out };
}

function apiAskAi_(payload) {
  // Check access - only paid users or admin
  var user = assertAuthorizedUserHybrid_(payload);
  if (user.role !== 'admin' && user.payment_status !== 'LUNAS') {
    throw new Error('Forbidden: Fitur AI hanya untuk user dengan status LUNAS');
  }
  
  var question = payload.question || '';
  if (!question) return { ok: false, error: 'question kosong' };
  var snapshot = apiGetSnapshot_();
  var answer = askAiByWorker_(question, snapshot);
  return { ok: true, answer: answer };
}

function apiGetAiConfig_() {
  assertAuthorizedUserHybrid_({});
  return getUserAiConfigStatus_();
}

function apiSaveAiConfig_(payload) {
  assertAuthorizedUserHybrid_(payload);
  return saveUserAiConfig_(payload || {});
}

function apiGetSystemConfigStatus_() {
  assertAdminHybrid_({});
  var nonSensitiveMap = {};
  sanitizeSettingsForClient_(getSheetRows_('settings')).forEach(function (r) {
    nonSensitiveMap[r.key_name] = r.key_value;
  });
  var workerToken = getScriptConfig_('WORKER_TOKEN', '');
  var signingSecret = getScriptConfig_('WORKER_SIGNING_SECRET', '');
  return {
    WORKER_URL: nonSensitiveMap.WORKER_URL || '',
    AI_MODE: nonSensitiveMap.AI_MODE || 'ad-analysis-mini',
    APP_ALLOWED_DOMAIN: getScriptConfig_('APP_ALLOWED_DOMAIN', ''),
    has_worker_token: !!workerToken,
    has_signing_secret: !!signingSecret,
    worker_token_masked: maskSecretStatus_(workerToken),
    signing_secret_masked: maskSecretStatus_(signingSecret)
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PROFILE ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

function apiUpdateProfile_(payload) {
  var user = assertAuthToken_(payload);
  var updates = {};
  
  // Only allow updating name
  if (payload.name !== undefined) {
    var nameVal = validateName_(payload.name);
    if (!nameVal.valid) return { ok: false, error: nameVal.error };
    updates.name = String(payload.name).trim();
  }
  
  if (Object.keys(updates).length === 0) {
    return { ok: false, error: 'Tidak ada data yang diupdate' };
  }
  
  var updatedUser = updateUser_(user.id, updates);
  
  return {
    ok: true,
    message: 'Profil berhasil diupdate',
    user: {
      id: updatedUser.id,
      email: updatedUser.email,
      name: updatedUser.name,
      role: updatedUser.role,
      payment_status: updatedUser.payment_status
    }
  };
}

function apiChangePassword_(payload) {
  var user = assertAuthToken_(payload);
  var oldPassword = payload.old_password;
  var newPassword = payload.new_password;
  
  if (!oldPassword) return { ok: false, error: 'Password lama wajib diisi' };
  if (!newPassword) return { ok: false, error: 'Password baru wajib diisi' };
  
  return changePassword_(user.id, oldPassword, newPassword);
}

/**
 * Wrappers for HTMLService google.script.run
 */
function uiBootstrap() { assertAuthorizedUser_(); ensureDbReady(); return { ok: true }; }
function uiSnapshot() { assertAuthorizedUser_(); return { ok: true, data: apiGetSnapshot_() }; }
function uiImportCsv(payload) { assertAdminUser_(); enforceUserRateLimit_('import_csv', 20, 60); return apiImportCsv_(payload); }
function uiSaveThresholds(payload) { assertAdminUser_(); return apiSaveThresholds_(payload); }
function uiSaveNote(payload) { assertAuthorizedUser_(); return apiSaveNote_(payload); }
function uiSaveSettings(payload) { assertAdminUser_(); return apiSaveSettings_(payload); }
function uiResetData() { assertAdminUser_(); return apiResetData_({ auth_token: null }); }
function uiComparePeriods(payload) { assertAuthorizedUser_(); enforceUserRateLimit_('compare_periods', 30, 60); return apiComparePeriods_(payload); }
function uiAskAi(payload) { assertAuthorizedUser_(); enforceUserRateLimit_('ask_ai', 30, 60); return apiAskAi_(payload); }
function uiGetAiConfig() { assertAuthorizedUser_(); return { ok: true, data: apiGetAiConfig_() }; }
function uiSaveAiConfig(payload) { assertAuthorizedUser_(); enforceUserRateLimit_('save_ai_config', 20, 60); return apiSaveAiConfig_(payload); }
function uiGetSystemConfigStatus() { assertAdminUser_(); return { ok: true, data: apiGetSystemConfigStatus_() }; }
