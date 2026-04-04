var DB_NAME = 'Ad Campaign Tracker DB';
var DB_TARGET_SHEET_ID = '1hbhtYLqzSIRlZoIiB0my-05tSIXdgAOjPbgpf7dJIEs';

var SHEETS = {
  campaigns: ['id','import_batch_id','period_label','campaign_name','spend','impressions','ctr','results','revenue','roas','cpm','reach','freq','atc','cpa','date_start','date_end','created_at'],
  adsets: ['id','import_batch_id','period_label','campaign_name','adset_name','spend','impressions','ctr','results','revenue','roas','cpm','reach','freq','atc','cpa','date_start','date_end','created_at'],
  ads: ['id','import_batch_id','period_label','campaign_name','adset_name','ad_name','spend','impressions','ctr','results','revenue','roas','cpm','reach','freq','atc','cpa','date_start','date_end','created_at'],
  thresholds: ['metric_key','enabled','rule_type','value','label'],
  notes: ['id','entity_level','entity_name','note_text','updated_at'],
  settings: ['key_name','key_value'],
  import_logs: ['import_batch_id','level','file_name','row_count','imported_at','status','message'],
  users: ['id','email','password_hash','salt','name','role','payment_status','created_at','updated_at','last_login','is_active'],
  sessions: ['token_id','user_id','email','role','payment_status','created_at','expires_at','is_revoked']
};

function ensureDbReady() {
  var ss = getOrCreateSpreadsheet_();
  Object.keys(SHEETS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var headers = SHEETS[name];
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    } else {
      var existing = sh.getRange(1, 1, 1, headers.length).getValues()[0];
      if (existing.join('|') !== headers.join('|')) {
        sh.clear();
        sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      }
    }
  });
  seedDefaultThresholds_();
  return ss;
}

function getOrCreateSpreadsheet_() {
  var configuredId = '';
  try {
    configuredId = String(getScriptConfig_('DB_SHEET_ID', DB_TARGET_SHEET_ID) || DB_TARGET_SHEET_ID).trim();
  } catch (err) {
    configuredId = DB_TARGET_SHEET_ID;
  }
  if (!configuredId) {
    throw new Error('DB_SHEET_ID tidak dikonfigurasi');
  }

  try {
    return SpreadsheetApp.openById(configuredId);
  } catch (err2) {
    throw new Error('Gagal akses Google Sheets target. Pastikan ID benar dan Apps Script punya akses: ' + configuredId);
  }
}

function getSheetRows_(sheetName) {
  var ss = ensureDbReady();
  var sh = ss.getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) return [];
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  return rows.map(function (r) {
    var obj = {};
    headers.forEach(function (h, i) { obj[h] = r[i]; });
    return obj;
  });
}

function appendRows_(sheetName, objects) {
  if (!objects || !objects.length) return;
  var ss = ensureDbReady();
  var sh = ss.getSheetByName(sheetName);
  var headers = SHEETS[sheetName];
  var values = objects.map(function (obj) {
    return headers.map(function (h) { return obj[h] !== undefined ? obj[h] : ''; });
  });
  sh.getRange(sh.getLastRow() + 1, 1, values.length, headers.length).setValues(values);
}

function clearDataSheets_() {
  var ss = ensureDbReady();
  ['campaigns','adsets','ads','notes','import_logs'].forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (sh && sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// USER SHEET HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function getUserByEmail_(email) {
  var users = getSheetRows_('users');
  var emailLower = String(email || '').toLowerCase().trim();
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].email || '').toLowerCase() === emailLower) {
      return users[i];
    }
  }
  return null;
}

function getUserById_(userId) {
  var users = getSheetRows_('users');
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].id) === String(userId)) {
      return users[i];
    }
  }
  return null;
}

function createUser_(userData) {
  var now = new Date().toISOString();
  var user = {
    id: 'usr_' + Utilities.getUuid(),
    email: String(userData.email || '').toLowerCase().trim(),
    password_hash: userData.password_hash || '',
    salt: userData.salt || '',
    name: String(userData.name || '').trim(),
    role: userData.role || 'user',
    payment_status: userData.payment_status || 'NONE',
    created_at: now,
    updated_at: now,
    last_login: '',
    is_active: userData.is_active !== undefined ? userData.is_active : 'true'
  };
  appendRows_('users', [user]);
  return user;
}

function updateUser_(userId, updates) {
  var users = getSheetRows_('users');
  var found = false;
  var now = new Date().toISOString();
  
  users = users.map(function (u) {
    if (String(u.id) === String(userId)) {
      found = true;
      Object.keys(updates).forEach(function (key) {
        if (key !== 'id' && key !== 'created_at') {
          u[key] = updates[key];
        }
      });
      u.updated_at = now;
    }
    return u;
  });
  
  if (!found) return null;
  
  var ss = ensureDbReady();
  var sh = ss.getSheetByName('users');
  if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  appendRows_('users', users);
  return getUserById_(userId);
}

function deleteUser_(userId) {
  var users = getSheetRows_('users');
  var filtered = users.filter(function (u) {
    return String(u.id) !== String(userId);
  });
  
  if (filtered.length === users.length) return false;
  
  var ss = ensureDbReady();
  var sh = ss.getSheetByName('users');
  if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  if (filtered.length) appendRows_('users', filtered);
  return true;
}

function listUsers_(options) {
  options = options || {};
  var users = getSheetRows_('users');
  var search = String(options.search || '').toLowerCase();
  var roleFilter = options.role || '';
  var statusFilter = options.payment_status || '';
  
  if (search) {
    users = users.filter(function (u) {
      return (u.email || '').toLowerCase().indexOf(search) >= 0 ||
             (u.name || '').toLowerCase().indexOf(search) >= 0;
    });
  }
  
  if (roleFilter) {
    users = users.filter(function (u) {
      return u.role === roleFilter;
    });
  }
  
  if (statusFilter) {
    users = users.filter(function (u) {
      return u.payment_status === statusFilter;
    });
  }
  
  // Remove sensitive fields
  return users.map(function (u) {
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      payment_status: u.payment_status,
      created_at: u.created_at,
      updated_at: u.updated_at,
      last_login: u.last_login,
      is_active: u.is_active
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSION SHEET HELPERS  
// ─────────────────────────────────────────────────────────────────────────────

function createSession_(sessionData) {
  appendRows_('sessions', [sessionData]);
  return sessionData;
}

function getSessionByToken_(tokenId) {
  var sessions = getSheetRows_('sessions');
  for (var i = 0; i < sessions.length; i++) {
    if (String(sessions[i].token_id) === String(tokenId)) {
      return sessions[i];
    }
  }
  return null;
}

function revokeSession_(tokenId) {
  var sessions = getSheetRows_('sessions');
  var found = false;
  
  sessions = sessions.map(function (s) {
    if (String(s.token_id) === String(tokenId)) {
      found = true;
      s.is_revoked = 'true';
    }
    return s;
  });
  
  if (!found) return false;
  
  var ss = ensureDbReady();
  var sh = ss.getSheetByName('sessions');
  if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  appendRows_('sessions', sessions);
  return true;
}

function revokeAllUserSessions_(userId) {
  var sessions = getSheetRows_('sessions');
  
  sessions = sessions.map(function (s) {
    if (String(s.user_id) === String(userId)) {
      s.is_revoked = 'true';
    }
    return s;
  });
  
  var ss = ensureDbReady();
  var sh = ss.getSheetByName('sessions');
  if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  if (sessions.length) appendRows_('sessions', sessions);
}

function cleanExpiredSessions_() {
  var sessions = getSheetRows_('sessions');
  var now = new Date().toISOString();
  
  var active = sessions.filter(function (s) {
    return s.expires_at > now && s.is_revoked !== 'true';
  });
  
  var ss = ensureDbReady();
  var sh = ss.getSheetByName('sessions');
  if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  if (active.length) appendRows_('sessions', active);
}

function upsertSettings_(items) {
  var existing = getSheetRows_('settings');
  var map = {};
  existing.forEach(function (r) { map[r.key_name] = r; });
  items.forEach(function (i) { map[i.key_name] = i; });

  var ss = ensureDbReady();
  var sh = ss.getSheetByName('settings');
  if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  appendRows_('settings', Object.keys(map).map(function (k) { return map[k]; }));
}

function upsertThresholds_(items) {
  var ss = ensureDbReady();
  var sh = ss.getSheetByName('thresholds');
  if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  appendRows_('thresholds', items);
}

function upsertNote_(entityLevel, entityName, noteText) {
  var notes = getSheetRows_('notes');
  var id = entityLevel + '::' + entityName;
  var now = new Date().toISOString();
  var found = false;

  notes = notes.map(function (n) {
    if (n.id === id) {
      found = true;
      return {
        id: id,
        entity_level: entityLevel,
        entity_name: entityName,
        note_text: noteText,
        updated_at: now
      };
    }
    return n;
  });

  if (!found) {
    notes.push({
      id: id,
      entity_level: entityLevel,
      entity_name: entityName,
      note_text: noteText,
      updated_at: now
    });
  }

  var ss = ensureDbReady();
  var sh = ss.getSheetByName('notes');
  if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  appendRows_('notes', notes);
}

function seedDefaultThresholds_() {
  var current = getSheetRows_('thresholds');
  if (current.length) return;
  appendRows_('thresholds', [
    { metric_key: 'roas', enabled: 'true', rule_type: 'min', value: 1.5, label: 'ROAS min' },
    { metric_key: 'cpa', enabled: 'false', rule_type: 'max', value: 150000, label: 'CPA max' },
    { metric_key: 'ctr', enabled: 'true', rule_type: 'min', value: 1, label: 'CTR min %' },
    { metric_key: 'cpm', enabled: 'false', rule_type: 'max', value: 60000, label: 'CPM max' }
  ]);
}
