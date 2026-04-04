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
  var indexes = buildHeaderIndex_(headers);
  var out = [];
  var now = new Date().toISOString();

  for (var i = 1; i < lines.length; i++) {
    var vals = parseCsvLine_(lines[i]);
    if (!vals.some(function (v) { return String(v || '').trim() !== ''; })) continue;

    var campaign = getString_(vals, indexes.campaign_name);
    var adset = getString_(vals, indexes.adset_name);
    var ad = getString_(vals, indexes.ad_name);
    var safeLevel = level || (ad ? 'ad' : adset ? 'adset' : 'campaign');

    var row = {
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
    };
    out.push(row);
  }

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
  return String(vals[i] || '').trim();
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
