function safeDiv_(a, b) {
  var x = Number(a) || 0;
  var y = Number(b) || 0;
  return y ? (x / y) : 0;
}

function calcMetrics_(row) {
  var spend = Number(row.spend) || 0;
  var impressions = Number(row.impressions) || 0;
  var ctr = Number(row.ctr) || 0;
  var results = Number(row.results) || 0;
  var revenue = Number(row.revenue) || 0;
  var atc = Number(row.atc) || 0;

  var roas = Number(row.roas) || safeDiv_(revenue, spend);
  var cpm = Number(row.cpm) || (impressions ? safeDiv_(spend, impressions) * 1000 : 0);
  var cpa = Number(row.cpa) || safeDiv_(spend, results);
  var clicks = row.clicks ? Number(row.clicks) || 0 : Math.round(impressions * ctr / 100);
  var atcRate = safeDiv_(atc, clicks) * 100;
  var conversionRate = safeDiv_(results, atc) * 100;

  return {
    spend: spend,
    impressions: impressions,
    ctr: ctr,
    results: results,
    revenue: revenue,
    atc: atc,
    roas: roas,
    cpm: cpm,
    cpa: cpa,
    clicks: clicks,
    atcRate: atcRate,
    conversionRate: conversionRate,
    freq: Number(row.freq) || 0
  };
}

function diagnose_(row, level) {
  var m = calcMetrics_(row);
  var issues = [];
  var lv = level || 'campaign';

  if (m.spend === 0) {
    return [{
      status: 'Tidak Aktif',
      priority: 'Monitor',
      diagnosis: 'Tidak ada spend.',
      action: 'Cek status aktif dan budget.'
    }];
  }

  if (m.roas >= 3) {
    issues.push({ status: 'Perform - Scale', priority: 'Urgent', diagnosis: 'ROAS sangat baik.', action: 'Naikkan budget 25%, jangan ubah targeting/creative.' });
  } else if (m.roas >= 2) {
    issues.push({ status: 'Perform - Maintain', priority: 'Normal', diagnosis: 'ROAS bagus dan stabil.', action: 'Pertahankan budget, test 1 variasi creative baru.' });
  } else if (m.roas >= 1) {
    issues.push({ status: 'Break Even', priority: 'Urgent', diagnosis: 'ROAS mendekati impas.', action: 'Jangan naikkan budget. Jika 2 hari tidak naik >2x, pause dan rebuild.' });
  } else if (m.roas > 0) {
    issues.push({ status: 'Rugi - Pause', priority: 'Urgent', diagnosis: 'ROAS di bawah 1.', action: 'Pause item, audit hook, landing page, offer, audience.' });
  }

  if (m.ctr > 0 && m.ctr < 0.8) {
    issues.push({
      status: 'Hook Gagal',
      priority: 'Urgent',
      diagnosis: 'CTR rendah.',
      action: lv === 'ad'
        ? 'Ganti thumbnail + 3 detik pertama, test 3 hook.'
        : 'Cek creative di level ad.'
    });
  } else if (m.ctr >= 2.5) {
    issues.push({ status: 'CTR Kuat', priority: 'Normal', diagnosis: 'CTR kuat.', action: 'Pertahankan creative, fokus optimasi landing page.' });
  }

  if (m.freq >= 4) {
    issues.push({
      status: 'Fatigue Kritis',
      priority: 'Urgent',
      diagnosis: 'Frequency sangat tinggi.',
      action: lv === 'ad'
        ? 'Retire creative, buat 2-3 angle baru.'
        : 'Rotasi creative, expand/exclude audience.'
    });
  } else if (m.freq >= 2.5) {
    issues.push({ status: 'Mulai Fatigue', priority: 'Normal', diagnosis: 'Frequency mulai tinggi.', action: 'Siapkan creative baru sebelum CTR turun.' });
  }

  if (m.cpm > 60000) {
    issues.push({
      status: 'CPM Mahal',
      priority: 'Normal',
      diagnosis: 'CPM tinggi.',
      action: lv === 'adset'
        ? 'Perluas targeting, coba broad atau lookalike.'
        : 'Cek targeting di level ad set.'
    });
  }

  if (m.atc > 0 && m.conversionRate < 20) {
    issues.push({ status: 'Funnel Bocor', priority: 'Urgent', diagnosis: 'ATC ada, conversion rendah.', action: 'Audit LP, speed, CTA, harga, social proof.' });
  }

  if (m.ctr >= 1.5 && m.results === 0 && m.spend > 50000) {
    issues.push({ status: 'LP Bermasalah', priority: 'Urgent', diagnosis: 'CTR bagus tapi tidak ada hasil.', action: 'Cek LP mobile: loading, message match, CTA.' });
  }

  if (!issues.length) {
    issues.push({ status: 'Monitor', priority: 'Monitor', diagnosis: 'Belum cukup data.', action: 'Tunggu minimal 3 hari spend.' });
  }

  return issues;
}

function checkThresholds_(row, thresholdRows) {
  var m = calcMetrics_(row);
  var tMap = {};
  (thresholdRows || []).forEach(function (t) { tMap[t.metric_key] = t; });

  var out = [];
  function enabled(k) {
    return tMap[k] && String(tMap[k].enabled).toLowerCase() === 'true';
  }

  if (enabled('roas') && m.roas > 0 && m.roas < Number(tMap.roas.value || 0)) {
    out.push({ metric: 'ROAS', value: m.roas, threshold: 'min ' + tMap.roas.value, severity: 'Urgent' });
  }
  if (enabled('cpa') && m.cpa > Number(tMap.cpa.value || 0)) {
    out.push({ metric: 'CPA', value: m.cpa, threshold: 'max ' + tMap.cpa.value, severity: 'Urgent' });
  }
  if (enabled('ctr') && m.ctr > 0 && m.ctr < Number(tMap.ctr.value || 0)) {
    out.push({ metric: 'CTR', value: m.ctr, threshold: 'min ' + tMap.ctr.value, severity: 'Normal' });
  }
  if (enabled('cpm') && m.cpm > Number(tMap.cpm.value || 0)) {
    out.push({ metric: 'CPM', value: m.cpm, threshold: 'max ' + tMap.cpm.value, severity: 'Normal' });
  }
  return out;
}

function generateBrief_(row) {
  var m = calcMetrics_(row);
  var briefs = [];

  if (m.ctr < 1 && m.spend > 0) {
    briefs.push({
      problem: 'CTR rendah',
      root_cause: 'Hook visual tidak stop-scroll.',
      angles: ['Pain point langsung', 'Hasil/transformasi', 'Curiosity gap'],
      hook_note: 'Frame awal harus kuat, langsung ke masalah audience.',
      format: 'Video 15-30 detik, rasio 9:16.'
    });
  }

  if (m.freq >= 3 && m.spend > 0) {
    briefs.push({
      problem: 'Audience fatigue',
      root_cause: 'Frequency tinggi.',
      angles: ['Ganti format', 'Ganti sudut pandang', 'Ganti hook'],
      hook_note: 'Jangan recycle visual lama.',
      format: 'UGC-style untuk refresh fatigue.'
    });
  }

  if (m.ctr >= 1.5 && m.results === 0 && m.spend > 50000) {
    briefs.push({
      problem: 'CTR bagus tapi 0 konversi',
      root_cause: 'Masalah utama di landing page.',
      angles: ['Selaraskan headline iklan & LP', 'Tambah social proof', 'Sederhanakan CTA'],
      hook_note: 'Fokus perbaikan LP, bukan ganti creative dulu.',
      format: 'Audit LP mobile terlebih dahulu.'
    });
  }

  if (!briefs.length && m.spend > 0) {
    briefs.push({
      problem: 'Performa stabil',
      root_cause: 'Tidak ada isu kritis.',
      angles: ['Test offer baru', 'Test audience baru', 'Test format tambahan'],
      hook_note: 'Pertahankan elemen iklan yang sudah bekerja.',
      format: 'Lakukan test bertahap terukur.'
    });
  }

  return briefs;
}

function buildHierarchy_(campaigns, adsets, ads) {
  var map = {};
  campaigns.forEach(function (c) {
    map[c.campaign_name] = { campaign: c, adsets: {}, orphanAds: [] };
  });

  adsets.forEach(function (a) {
    if (!map[a.campaign_name]) map[a.campaign_name] = { campaign: { campaign_name: a.campaign_name }, adsets: {}, orphanAds: [] };
    map[a.campaign_name].adsets[a.adset_name] = { adset: a, ads: [] };
  });

  ads.forEach(function (a) {
    if (!map[a.campaign_name]) map[a.campaign_name] = { campaign: { campaign_name: a.campaign_name }, adsets: {}, orphanAds: [] };
    var node = map[a.campaign_name].adsets[a.adset_name];
    if (!node) map[a.campaign_name].orphanAds.push(a);
    else node.ads.push(a);
  });

  return map;
}
