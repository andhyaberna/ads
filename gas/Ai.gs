function getSettingsMap_() {
  var rows = sanitizeSettingsForClient_(getSheetRows_('settings'));
  var map = {};
  rows.forEach(function (r) { map[r.key_name] = r.key_value; });
  map.WORKER_TOKEN = getScriptConfig_('WORKER_TOKEN', '');
  map.WORKER_SIGNING_SECRET = getScriptConfig_('WORKER_SIGNING_SECRET', '');
  return map;
}

function getUserAiConfig_() {
  var props = PropertiesService.getUserProperties();
  var provider = String(props.getProperty('AI_PROVIDER') || 'builtin').toLowerCase();
  var openaiKey = props.getProperty('AI_OPENAI_KEY') || '';
  var geminiKey = props.getProperty('AI_GEMINI_KEY') || '';
  var claudeKey = props.getProperty('AI_CLAUDE_KEY') || '';
  return {
    provider: normalizeProvider_(provider),
    openai_key: openaiKey,
    gemini_key: geminiKey,
    claude_key: claudeKey
  };
}

function getUserAiConfigStatus_() {
  var c = getUserAiConfig_();
  return {
    provider: c.provider,
    has_openai_key: !!c.openai_key,
    has_gemini_key: !!c.gemini_key,
    has_claude_key: !!c.claude_key,
    openai_key_masked: maskApiKey_(c.openai_key),
    gemini_key_masked: maskApiKey_(c.gemini_key),
    claude_key_masked: maskApiKey_(c.claude_key)
  };
}

function saveUserAiConfig_(payload) {
  payload = payload || {};
  var provider = normalizeProvider_(String(payload.provider || '').toLowerCase());
  var openaiInput = String(payload.openai_key || '').trim();
  var geminiInput = String(payload.gemini_key || '').trim();
  var claudeInput = String(payload.claude_key || '').trim();

  if (['builtin', 'openai', 'gemini', 'claude'].indexOf(provider) < 0) {
    return { ok: false, error: 'Provider harus builtin/openai/gemini/claude.' };
  }

  if (openaiInput && !isOpenAiKeyLike_(openaiInput)) {
    return { ok: false, error: 'Format API key OpenAI terlihat tidak valid.' };
  }
  if (geminiInput && !isGeminiKeyLike_(geminiInput)) {
    return { ok: false, error: 'Format API key Gemini terlihat tidak valid.' };
  }
  if (claudeInput && !isClaudeKeyLike_(claudeInput)) {
    return { ok: false, error: 'Format API key Claude terlihat tidak valid.' };
  }

  var props = PropertiesService.getUserProperties();
  props.setProperty('AI_PROVIDER', provider);
  if (openaiInput) props.setProperty('AI_OPENAI_KEY', openaiInput);
  if (geminiInput) props.setProperty('AI_GEMINI_KEY', geminiInput);
  if (claudeInput) props.setProperty('AI_CLAUDE_KEY', claudeInput);

  return { ok: true, config: getUserAiConfigStatus_() };
}

function normalizeProvider_(provider) {
  if (provider === 'openai' || provider === 'gemini' || provider === 'claude' || provider === 'builtin') return provider;
  return 'builtin';
}

function isOpenAiKeyLike_(key) {
  return /^sk-[A-Za-z0-9\-_]{16,}$/.test(String(key || ''));
}

function isGeminiKeyLike_(key) {
  return /^AIza[0-9A-Za-z\-_]{20,}$/.test(String(key || ''));
}

function isClaudeKeyLike_(key) {
  return /^sk-ant-[A-Za-z0-9\-_]{16,}$/.test(String(key || ''));
}

function maskApiKey_(key) {
  var s = String(key || '');
  if (!s) return '';
  if (s.length <= 8) return '********';
  return s.slice(0, 4) + '********' + s.slice(-4);
}

function getActiveUserIdentifier_() {
  var email = '';
  try {
    email = Session.getActiveUser().getEmail() || '';
  } catch (err) {
    email = '';
  }
  if (email) return pseudoUserId_(email.toLowerCase());
  try {
    return pseudoUserId_(Session.getTemporaryActiveUserKey() || 'anonymous');
  } catch (err2) {
    return pseudoUserId_('anonymous');
  }
}

function pseudoUserId_(raw) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(raw || ''));
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '').slice(0, 24);
}

function askAiByWorker_(question, snapshot) {
  var settings = getSettingsMap_();
  var workerUrl = settings.WORKER_URL || '';
  var workerToken = settings.WORKER_TOKEN || '';
  var signingSecret = settings.WORKER_SIGNING_SECRET || workerToken;
  var aiMode = settings.AI_MODE || 'ad-analysis-mini';
  var userCfg = getUserAiConfig_();
  var provider = userCfg.provider || 'builtin';
  var selectedApiKey = provider === 'gemini'
    ? userCfg.gemini_key
    : provider === 'claude'
      ? userCfg.claude_key
      : provider === 'openai'
        ? userCfg.openai_key
        : '';

  if (provider === 'builtin') {
    return generateLocalAiFallbackAnswer_(question, snapshot, 'builtin');
  }

  if (!workerUrl || !workerToken) {
    return generateLocalAiFallbackAnswer_(question, snapshot, 'worker_not_configured');
  }

  if (!selectedApiKey) {
    return generateLocalAiFallbackAnswer_(question, snapshot, 'provider_key_missing_' + provider);
  }

  var compact = buildCompactSummaryForAi_(snapshot);
  var body = {
    question: question,
    provider: provider,
    user_api_key: selectedApiKey,
    user_id: getActiveUserIdentifier_(),
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
    return generateLocalAiFallbackAnswer_(question, snapshot, 'worker_http_' + res.getResponseCode());
  }

  var json = JSON.parse(res.getContentText() || '{}');
  return json.answer || generateLocalAiFallbackAnswer_(question, snapshot, 'empty_ai_response');
}

function generateLocalAiFallbackAnswer_(question, snapshot, reason) {
  var q = String(question || '').toLowerCase();
  var entities = (snapshot && snapshot.entities) ? snapshot.entities : [];
  var urgent = entities.filter(function (e) { return e.priority === 'Urgent'; });
  var pausedCandidates = entities
    .filter(function (e) {
      return (Number(e.metrics && e.metrics.spend || 0) > 0) && (
        Number(e.metrics && e.metrics.roas || 0) < 1 ||
        Number(e.metrics && e.metrics.freq || 0) >= 4
      );
    })
    .sort(function (a, b) { return (Number(b.metrics.spend) || 0) - (Number(a.metrics.spend) || 0); })
    .slice(0, 3);
  var scaleCandidates = entities
    .filter(function (e) { return Number(e.metrics && e.metrics.roas || 0) >= 3; })
    .sort(function (a, b) { return (Number(b.metrics.roas) || 0) - (Number(a.metrics.roas) || 0); })
    .slice(0, 3);

  var lines = [];
  lines.push('Mode bawaan aktif (tanpa ketergantungan API eksternal).');
  if (reason) lines.push('Catatan mode: ' + reason + '.');
  lines.push('Ringkasan cepat:');
  lines.push('- Total item: ' + entities.length + ', Urgent: ' + urgent.length + ', Alert: ' + ((snapshot && snapshot.kpi && snapshot.kpi.alert_count) || 0));

  if (q.indexOf('pause') >= 0 || q.indexOf('hentikan') >= 0) {
    if (!pausedCandidates.length) {
      lines.push('Tidak ada kandidat pause kritis dari rule saat ini. Lanjutkan monitor 24 jam.');
    } else {
      lines.push('Prioritas pause hari ini:');
      pausedCandidates.forEach(function (e, i) {
        lines.push((i + 1) + '. ' + e.name + ' [' + e.level + '] | ROAS ' + fmtLocal_(e.metrics.roas) + ' | Freq ' + fmtLocal_(e.metrics.freq) + ' | Spend Rp ' + numLocal_(e.metrics.spend));
      });
    }
  } else if (q.indexOf('scale') >= 0 || q.indexOf('naik') >= 0) {
    if (!scaleCandidates.length) {
      lines.push('Belum ada kandidat scale kuat (ROAS >= 3). Fokus maintenance + test creative.');
    } else {
      lines.push('Kandidat scale:');
      scaleCandidates.forEach(function (e, i) {
        lines.push((i + 1) + '. ' + e.name + ' [' + e.level + '] | ROAS ' + fmtLocal_(e.metrics.roas) + ' | CTR ' + fmtLocal_(e.metrics.ctr) + '%');
      });
    }
  } else {
    lines.push('Top prioritas eksekusi:');
    urgent.slice(0, 3).forEach(function (e, i) {
      lines.push((i + 1) + '. ' + e.name + ' - ' + e.status + ' | Action: ' + e.action);
    });
    if (!urgent.length) lines.push('- Tidak ada item urgent saat ini. Lanjutkan monitor dan optimasi bertahap.');
  }

  lines.push('Anda tetap bisa mengisi API key OpenAI/Gemini/Claude di Settings kapan saja untuk mode eksternal.');
  return lines.join('\n');
}

function fmtLocal_(n) {
  var x = Number(n) || 0;
  return x.toFixed(2);
}

function numLocal_(n) {
  return (Number(n) || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 });
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
