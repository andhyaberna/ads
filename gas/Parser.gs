var HEADER_ALIASES = {
  campaign_name: ['campaign_name','campaign name','nama kampanye'],
  adset_name: ['adset_name','ad set name','nama set iklan'],
  ad_name: ['ad_name','ad name','nama iklan'],
  spend: ['spend','amount spent','amount spent (idr)','jumlah yang dibelanjakan (idr)','jumlah yang dibelanjakan'],
  impressions: ['impressions','impresi'],
  ctr: ['ctr','ctr (link click-through rate)','ctr (rasio klik tayang tautan)'],
  results: ['results','hasil','pembelian','purchases'],
  revenue: ['revenue','purchase conversion value','nilai konversi pembelian'],
  roas: ['roas','purchase roas','roas (imbal hasil belanja iklan) pembelian'],
  cpm: ['cpm','cpm (cost per 1,000 impressions)','cpm (biaya per 1.000 tayangan) (idr)'],
  reach: ['reach','jangkauan'],
  freq: ['frequency','frekuensi','freq'],
  atc: ['add to cart','tambahkan ke keranjang','atc'],
  cpa: ['cpa','cost per result','biaya per hasil'],
  date_start: ['date start','reporting starts','awal pelaporan','day'],
  date_end: ['date end','reporting ends','akhir pelaporan']
};

function parseCsvImport_(csvText, level, fileName, periodLabel) {
  var lines = (csvText || '').replace(/\r/g, '').split('\n').filter(function (l) { return l.trim(); });
  if (lines.length < 2) return { rows: [], warnings: ['CSV kosong / tidak valid'] };

  var headers = parseCsvLine_(lines[0]);
  var dataRows = [];
  for (var i = 1; i < lines.length; i++) {
    var vals = parseCsvLine_(lines[i]);
    dataRows.push(vals);
  }

  return mapParsedRowsToObjects_(headers, dataRows, level, fileName, periodLabel);
}

function parseExcelImport_(xlsxBase64, level, fileName, periodLabel, preferredSheetName) {
  if (!xlsxBase64) return { rows: [], warnings: ['XLSX base64 kosong'] };
  var bytes = Utilities.base64Decode(xlsxBase64);
  var blob = Utilities.newBlob(bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileName || 'import.xlsx');
  var entries = Utilities.unzip(blob);
  if (!entries || !entries.length) return { rows: [], warnings: ['File XLSX tidak bisa dibaca'] };

  var sharedStrings = readSharedStringsFromXlsx_(entries);
  var worksheetName = findWorksheetEntryName_(entries, preferredSheetName);
  if (!worksheetName) return { rows: [], warnings: ['Worksheet tidak ditemukan di file XLSX'] };

  var worksheetXml = readZipText_(entries, worksheetName);
  if (!worksheetXml) return { rows: [], warnings: ['Worksheet XML kosong/invalid'] };

  var allRows = parseWorksheetRows_(worksheetXml, sharedStrings);
  if (allRows.length < 2) return { rows: [], warnings: ['Worksheet tidak memiliki data'] };

  var headers = allRows[0].map(function (v) { return String(v || '').trim(); });
  var dataRows = allRows.slice(1);
  return mapParsedRowsToObjects_(headers, dataRows, level, fileName, periodLabel);
}

function mapParsedRowsToObjects_(headers, dataRows, level, fileName, periodLabel) {
  var indexes = buildHeaderIndex_(headers || []);
  var out = [];
  var now = new Date().toISOString();

  (dataRows || []).forEach(function (vals) {
    if (!vals.some(function (v) { return String(v || '').trim() !== ''; })) return;

    var campaign = getString_(vals, indexes.campaign_name);
    var adset = getString_(vals, indexes.adset_name);
    var ad = getString_(vals, indexes.ad_name);
    var safeLevel = level || (ad ? 'ad' : adset ? 'adset' : 'campaign');

    out.push({
      id: safeLevel + '_' + Utilities.getUuid(),
      import_batch_id: '',
      period_label: periodLabel || '',
      campaign_name: campaign,
      adset_name: adset,
      ad_name: ad,
      spend: getNumber_(vals, indexes.spend),
      impressions: getNumber_(vals, indexes.impressions),
      ctr: getNumber_(vals, indexes.ctr),
      results: getNumber_(vals, indexes.results),
      revenue: getNumber_(vals, indexes.revenue),
      roas: getNumber_(vals, indexes.roas),
      cpm: getNumber_(vals, indexes.cpm),
      reach: getNumber_(vals, indexes.reach),
      freq: getNumber_(vals, indexes.freq),
      atc: getNumber_(vals, indexes.atc),
      cpa: getNumber_(vals, indexes.cpa),
      date_start: getString_(vals, indexes.date_start),
      date_end: getString_(vals, indexes.date_end),
      created_at: now,
      _level: safeLevel,
      _file_name: fileName || ''
    });
  });

  return { rows: out, warnings: [] };
}

function parseCsvLine_(line) {
  var out = [];
  var cur = '';
  var inQuotes = false;
  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function buildHeaderIndex_(headers) {
  var lowered = headers.map(function (h) { return String(h || '').trim().toLowerCase(); });
  var idx = {};
  Object.keys(HEADER_ALIASES).forEach(function (key) {
    idx[key] = -1;
    var aliases = HEADER_ALIASES[key];
    for (var i = 0; i < aliases.length; i++) {
      var a = aliases[i].toLowerCase();
      var found = lowered.findIndex(function (h) { return h.indexOf(a) >= 0; });
      if (found >= 0) {
        idx[key] = found;
        break;
      }
    }
  });
  return idx;
}

function getString_(vals, i) {
  if (i < 0 || i >= vals.length) return '';
  return sanitizeSheetString_(String(vals[i] || '').trim());
}

function sanitizeSheetString_(value) {
  var s = String(value || '');
  if (!s) return '';
  // Prevent formula injection when written to sheet cells.
  if (/^[=+\-@]/.test(s)) return "'" + s;
  return s;
}

function getNumber_(vals, i) {
  if (i < 0 || i >= vals.length) return 0;
  var raw = String(vals[i] || '').trim();
  if (!raw) return 0;

  // Support decimal comma + thousand separators
  var s = raw.replace(/\s/g, '');
  if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (s.indexOf(',') >= 0 && s.indexOf('.') < 0) {
    s = s.replace(',', '.');
  }
  s = s.replace(/[^0-9.-]/g, '');

  var n = parseFloat(s);
  if (!isFinite(n) || isNaN(n)) return 0;
  return n;
}

function readZipText_(entries, name) {
  var item = null;
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].getName() === name) {
      item = entries[i];
      break;
    }
  }
  if (!item) return '';
  return item.getDataAsString('UTF-8');
}

function readSharedStringsFromXlsx_(entries) {
  var xml = readZipText_(entries, 'xl/sharedStrings.xml');
  if (!xml) return [];
  var doc = XmlService.parse(xml);
  var root = doc.getRootElement();
  var ns = root.getNamespace();
  var sis = root.getChildren('si', ns);
  return sis.map(function (si) {
    var t = si.getChild('t', ns);
    if (t) return t.getText() || '';
    var runs = si.getChildren('r', ns);
    if (!runs.length) return '';
    return runs.map(function (r) {
      var rt = r.getChild('t', ns);
      return rt ? (rt.getText() || '') : '';
    }).join('');
  });
}

function findWorksheetEntryName_(entries, preferredSheetName) {
  var names = entries.map(function (e) { return e.getName(); });
  var worksheetCandidates = names.filter(function (n) { return /^xl\/worksheets\/sheet\d+\.xml$/.test(n); }).sort();
  if (!preferredSheetName) return worksheetCandidates[0] || '';

  var wbXml = readZipText_(entries, 'xl/workbook.xml');
  var relXml = readZipText_(entries, 'xl/_rels/workbook.xml.rels');
  if (!wbXml || !relXml) return worksheetCandidates[0] || '';

  var wbDoc = XmlService.parse(wbXml);
  var wbRoot = wbDoc.getRootElement();
  var wbNs = wbRoot.getNamespace();
  var relNs = XmlService.getNamespace('r', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships');

  var sheetsNode = wbRoot.getChild('sheets', wbNs);
  if (!sheetsNode) return worksheetCandidates[0] || '';
  var sheets = sheetsNode.getChildren('sheet', wbNs);
  var targetRelId = '';

  for (var i = 0; i < sheets.length; i++) {
    var s = sheets[i];
    var nm = String(s.getAttribute('name') ? s.getAttribute('name').getValue() : '').toLowerCase();
    if (nm === String(preferredSheetName).toLowerCase()) {
      targetRelId = s.getAttribute('id', relNs) ? s.getAttribute('id', relNs).getValue() : '';
      break;
    }
  }
  if (!targetRelId) return worksheetCandidates[0] || '';

  var relDoc = XmlService.parse(relXml);
  var relRoot = relDoc.getRootElement();
  var rels = relRoot.getChildren();
  for (var j = 0; j < rels.length; j++) {
    var rel = rels[j];
    var id = rel.getAttribute('Id') ? rel.getAttribute('Id').getValue() : '';
    if (id === targetRelId) {
      var target = rel.getAttribute('Target') ? rel.getAttribute('Target').getValue() : '';
      if (!target) break;
      var normalized = target.replace(/^\//, '');
      if (normalized.indexOf('xl/') !== 0) normalized = 'xl/' + normalized;
      return names.indexOf(normalized) >= 0 ? normalized : (worksheetCandidates[0] || '');
    }
  }
  return worksheetCandidates[0] || '';
}

function parseWorksheetRows_(worksheetXml, sharedStrings) {
  var doc = XmlService.parse(worksheetXml);
  var root = doc.getRootElement();
  var ns = root.getNamespace();
  var sheetData = root.getChild('sheetData', ns);
  if (!sheetData) return [];

  var rows = sheetData.getChildren('row', ns);
  var out = [];
  rows.forEach(function (rowNode) {
    var rowArr = [];
    var cells = rowNode.getChildren('c', ns);
    cells.forEach(function (cell) {
      var ref = cell.getAttribute('r') ? cell.getAttribute('r').getValue() : '';
      var colIndex = refToColumnIndex_(ref);
      var tAttr = cell.getAttribute('t') ? cell.getAttribute('t').getValue() : '';
      var value = '';

      if (tAttr === 'inlineStr') {
        var isNode = cell.getChild('is', ns);
        var tNode = isNode ? isNode.getChild('t', ns) : null;
        value = tNode ? (tNode.getText() || '') : '';
      } else {
        var vNode = cell.getChild('v', ns);
        var raw = vNode ? (vNode.getText() || '') : '';
        if (tAttr === 's') {
          var idx = parseInt(raw, 10);
          value = !isNaN(idx) && sharedStrings[idx] !== undefined ? sharedStrings[idx] : '';
        } else if (tAttr === 'b') {
          value = raw === '1' ? 'TRUE' : 'FALSE';
        } else {
          value = raw;
        }
      }

      if (colIndex >= 0) rowArr[colIndex] = value;
    });
    out.push(rowArr);
  });
  return out;
}

function refToColumnIndex_(ref) {
  var m = String(ref || '').match(/^([A-Z]+)/i);
  if (!m) return -1;
  var col = m[1].toUpperCase();
  var n = 0;
  for (var i = 0; i < col.length; i++) {
    n = (n * 26) + (col.charCodeAt(i) - 64);
  }
  return n - 1;
}
