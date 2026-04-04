# Security Audit Summary (GAS + Sheets + Worker)

Tanggal audit: 2026-04-04

## Scope
- Apps Script Web App (`gas/*.gs`, `gas/App.html`)
- Cloudflare Worker gateway/proxy (`worker/index.js`, `worker/wrangler.toml`)
- Secret handling (Settings sheet vs Script/User Properties)
- Authz boundaries, rate limiting, sensitive-data exposure

## High-Risk Findings (Fixed)

1. **Action endpoint tanpa guard token internal**
   - Fix: `doGet/doPost` dengan `action` wajib `internal_token` valid (`INTERNAL_API_TOKEN` di Script Properties).

2. **Secret sistem terekspos ke UI snapshot**
   - Fix: `apiGetSnapshot_()` hanya kirim settings non-sensitive.
   - Secret sistem disimpan di Script Properties, bukan ditampilkan ke client.

3. **Batas admin vs user belum tegas**
   - Fix:
     - `assertAuthorizedUser_()` untuk user-domain internal
     - `assertAdminUser_()` untuk operasi admin (import, reset, save settings/threshold)
     - `ADMIN_EMAILS` wajib dikonfigurasi untuk hak admin.

4. **Proteksi abuse untuk endpoint mahal belum ada**
   - Fix: rate-limit user di Apps Script (`CacheService`) pada operasi import/compare/ask_ai/save_ai_config.

## Secret Storage Policy

### Script Properties (server-side, never sent raw to UI)
- `INTERNAL_API_TOKEN`
- `WORKER_TOKEN`
- `WORKER_SIGNING_SECRET`
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `CLAUDE_API_KEY`
- `WEBHOOK_TOKEN`
- `WEBHOOK_SECRET`
- `APP_ALLOWED_DOMAIN`
- `ADMIN_EMAILS`

### User Properties (per-user)
- `AI_PROVIDER`
- `AI_OPENAI_KEY`
- `AI_GEMINI_KEY`
- `AI_CLAUDE_KEY`

### Sheet `settings` (non-sensitive only)
- `WORKER_URL`
- `AI_MODE`
- value non-rahasia lain

## Worker Security Baseline

- Origin allowlist (`ALLOWED_ORIGIN=https://ads.cepat.top`)
- Internal token + signed request (`x-ts`, `x-nonce`, `x-signature`)
- Anti-replay nonce store (KV TTL)
- Timestamp skew validation
- Per-IP rate limit (KV)
- Root route tidak mengekspos URL GAS (service response netral)

## Encryption Posture

- **In transit:** HTTPS/TLS untuk browser↔Worker, Apps Script↔Worker, Worker↔AI provider.
- **At rest:**
  - Script/User Properties berada di infrastruktur Google Apps Script.
  - KV Worker berada di Cloudflare.
  - Secrets tidak diserialisasi ke response UI.

## Least Privilege Checklist

- Deploy Apps Script access dibatasi internal/domain (jangan publik anonymous)
- `ADMIN_EMAILS` hanya akun ops yang perlu
- `APP_ALLOWED_DOMAIN` diset ke domain perusahaan
- Worker secrets diset via env/secret, bukan hardcode
- Rotasi token berkala (`WORKER_TOKEN`, `WORKER_SIGNING_SECRET`, `INTERNAL_API_TOKEN`)

## Security Testing Executed

1. **Static/logic verification**
   - Confirm snapshot tidak mengandung key sensitif.
   - Confirm API wrapper admin-only untuk operasi mutasi kritis.

2. **Syntax/diagnostic checks**
   - `lsp_diagnostics` clean: `gas/App.html`, `worker/index.js`
   - `node --check worker/index.js` passed
   - Parse checks passed: `gas/Security.gs`, `gas/Code.gs`, `gas/Api.gs`, `gas/Ai.gs`

3. **Runtime behavior checks (manual)**
   - Non-admin user mencoba `uiSaveSettings/uiResetData` -> expected forbidden
   - Request signed header invalid/expired -> expected 401
   - Burst `ask_ai` > limit -> expected rate-limit error

## Remaining Recommendations (Next Iteration)

- Add structured audit log sheet (who/what/when) untuk admin changes
- Add periodic key rotation reminder in Settings UI
- Add optional HMAC webhook provider-specific verification schema
- Add automated security regression tests for Apps Script wrappers
