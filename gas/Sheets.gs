var DB_NAME = 'Ad Campaign Tracker DB';

var SHEETS = {
  campaigns: ['id','import_batch_id','period_label','campaign_name','spend','impressions','ctr','results','revenue','roas','cpm','reach','freq','atc','cpa','date_start','date_end','created_at'],
  adsets: ['id','import_batch_id','period_label','campaign_name','adset_name','spend','impressions','ctr','results','revenue','roas','cpm','reach','freq','atc','cpa','date_start','date_end','created_at'],
  ads: ['id','import_batch_id','period_label','campaign_name','adset_name','ad_name','spend','impressions','ctr','results','revenue','roas','cpm','reach','freq','atc','cpa','date_start','date_end','created_at'],
  thresholds: ['metric_key','enabled','rule_type','value','label'],
  notes: ['id','entity_level','entity_name','note_text','updated_at'],
  settings: ['key_name','key_value'],
  import_logs: ['import_batch_id','level','file_name','row_count','imported_at','status','message']
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
  var files = DriveApp.getFilesByName(DB_NAME);
  if (files.hasNext()) {
    return SpreadsheetApp.open(files.next());
  }
  return SpreadsheetApp.create(DB_NAME);
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
