function getSettingsMap_() {
  var rows = getSheetRows_('settings');
  var map = {};
  rows.forEach(function (r) { map[r.key_name] = r.key_value; });
  return map;
}

function getUserAiConfig_() {
  var props = PropertiesService.getUserProperties();
  var provider = String(props.getProperty('AI_PROVIDER') || 'openai').toLowerCase();
  var openaiKey = props.getProperty('AI_OPENAI_KEY') || '';
  var geminiKey = props.getProperty('AI_GEMINI_KEY') || '';
  return {
    provider: provider === 'gemini' ? 'gemini' : 'openai',
    openai_key: openaiKey,
    gemini_key: geminiKey
  };
}

function getUserAiConfigStatus_() {
  var c = getUserAiConfig_();
  return {
    provider: c.provider,
    has_openai_key: !!c.openai_key,
    has_gemini_key: !!c.gemini_key,
    openai_key_masked: maskApiKey_(c.openai_key),
    gemini_key_masked: maskApiKey_(c.gemini_key)
  };
}

function saveUserAiConfig_(payload) {
  payload = payload || {};
  var provider = String(payload.provider || '').toLowerCase();
  var openaiInput = String(payload.openai_key || '').trim();
  var geminiInput = String(payload.gemini_key || '').trim();

  if (['openai', 'gemini'].indexOf(provider) < 0) {
    return { ok: false, error: 'Provider harus openai atau gemini.' };
  }

  var current = getUserAiConfig_();
  var nextOpenAiKey = openaiInput || current.openai_key;
  var nextGeminiKey = geminiInput || current.gemini_key;

  if (openaiInput && !isOpenAiKeyLike_(openaiInput)) {
    return { ok: false, error: 'Format API key OpenAI terlihat tidak valid.' };
  }
  if (geminiInput && !isGeminiKeyLike_(geminiInput)) {
    return { ok: false, error: 'Format API key Gemini terlihat tidak valid.' };
  }

  if (provider === 'openai' && !nextOpenAiKey) {
    return { ok: false, error: 'API key OpenAI wajib diisi saat provider aktif OpenAI.' };
  }
  if (provider === 'gemini' && !nextGeminiKey) {
    return { ok: false, error: 'API key Gemini wajib diisi saat provider aktif Gemini.' };
  }

  var props = PropertiesService.getUserProperties();
  props.setProperty('AI_PROVIDER', provider);
  if (openaiInput) props.setProperty('AI_OPENAI_KEY', openaiInput);
  if (geminiInput) props.setProperty('AI_GEMINI_KEY', geminiInput);

  return { ok: true, config: getUserAiConfigStatus_() };
}

function isOpenAiKeyLike_(key) {
  return /^sk-[A-Za-z0-9\-_]{16,}$/.test(String(key || ''));
}

function isGeminiKeyLike_(key) {
  return /^AIza[0-9A-Za-z\-_]{20,}$/.test(String(key || ''));
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
  if (email) return email.toLowerCase();
  try {
    return Session.getTemporaryActiveUserKey() || 'anonymous';
  } catch (err2) {
    return 'anonymous';
  }
}

function askAiByWorker_(question, snapshot) {
  var settings = getSettingsMap_();
  var workerUrl = settings.WORKER_URL || '';
  var workerToken = settings.WORKER_TOKEN || '';
  var signingSecret = settings.WORKER_SIGNING_SECRET || workerToken;
  var aiMode = settings.AI_MODE || 'ad-analysis-mini';
  var userCfg = getUserAiConfig_();
  var provider = userCfg.provider || 'openai';
  var selectedApiKey = provider === 'gemini' ? userCfg.gemini_key : userCfg.openai_key;

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

  if (!selectedApiKey) {
    return [
      'Konfigurasi AI per-user belum lengkap.',
      'Masuk ke Settings > Konfigurasi AI Pribadi, pilih provider aktif, lalu isi API key provider tersebut.',
      'Provider aktif saat ini: ' + provider
    ].join('\n');
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
