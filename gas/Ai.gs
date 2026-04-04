function getSettingsMap_() {
  var rows = getSheetRows_('settings');
  var map = {};
  rows.forEach(function (r) { map[r.key_name] = r.key_value; });
  return map;
}

function askAiByWorker_(question, snapshot) {
  var settings = getSettingsMap_();
  var workerUrl = settings.WORKER_URL || '';
  var workerToken = settings.WORKER_TOKEN || '';
  var signingSecret = settings.WORKER_SIGNING_SECRET || workerToken;
  var aiMode = settings.AI_MODE || 'ad-analysis-mini';

  if (!workerUrl || !workerToken) {
    return [
      'Mode AI belum aktif.',
      'Simpan WORKER_URL dan WORKER_TOKEN di Settings dulu.',
      'Contoh pertanyaan:',
      '- Ad mana yang harus dipause hari ini?',
      '- Creative mana yang bisa discale sekarang?',
      '- Di mana kebocoran budget terbesar?'
    ].join('\n');
  }

  var compact = buildCompactSummaryForAi_(snapshot);
  var body = {
    question: question,
    mode: aiMode,
    summary: compact
  };

  var res = UrlFetchApp.fetch(workerUrl.replace(/\/$/, '') + '/ai/analyze', {
    method: 'post',
    contentType: 'application/json',
    headers: createSignedHeaders_(workerToken, signingSecret, JSON.stringify(body)),
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });

  if (res.getResponseCode() >= 300) {
    return 'AI proxy error: ' + res.getResponseCode() + '\n' + res.getContentText();
  }

  var json = JSON.parse(res.getContentText() || '{}');
  return json.answer || 'AI tidak mengembalikan jawaban.';
}

function createSignedHeaders_(workerToken, signingSecret, rawBody) {
  var ts = String(Date.now());
  var nonce = Utilities.getUuid();
  var payload = ts + '.' + nonce + '.' + rawBody;
  var sigBytes = Utilities.computeHmacSha256Signature(payload, signingSecret);
  var signature = Utilities.base64EncodeWebSafe(sigBytes).replace(/=+$/, '');
  return {
    'x-internal-token': workerToken,
    'x-ts': ts,
    'x-nonce': nonce,
    'x-signature': signature
  };
}

function buildCompactSummaryForAi_(snapshot) {
  var entities = snapshot.entities || [];
  var urgent = entities
    .filter(function (e) { return e.priority === 'Urgent'; })
    .sort(function (a, b) { return (b.metrics.spend || 0) - (a.metrics.spend || 0); })
    .slice(0, 20)
    .map(function (e) {
      return {
        level: e.level,
        name: e.name,
        spend: e.metrics.spend,
        ctr: e.metrics.ctr,
        roas: e.metrics.roas,
        cpa: e.metrics.cpa,
        freq: e.metrics.freq,
        status: e.status,
        diagnosis: e.diagnosis
      };
    });

  return {
    kpi: snapshot.kpi,
    urgent_top: urgent,
    alert_count: snapshot.kpi ? snapshot.kpi.alert_count : 0
  };
}
