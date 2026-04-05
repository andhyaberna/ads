# Deploy Step-by-Step (Cloudflare + GAS)

Dokumen ini fokus untuk membuat `https://ads.cepat.top` tidak lagi error `404 /auth/login` dan memastikan alur login/register berjalan benar lewat backend.

## Arsitektur yang benar

- Frontend: `https://ads.cepat.top` (static site)
- API/Auth Gateway: Cloudflare Worker (disarankan di `https://api.ads.cepat.top`)
- Data/Auth source: Google Apps Script Web App + Google Sheets

> Root problem 404 biasanya karena frontend static memanggil path relatif `/auth/login` ke host static, padahal route auth ada di Worker/GAS.

---

## 1) Siapkan Google Sheets target

1. Buka spreadsheet target:
   - `https://docs.google.com/spreadsheets/d/1hbhtYLqzSIRlZoIiB0my-05tSIXdgAOjPbgpf7dJIEs`
2. Pastikan akun Apps Script punya akses **Editor** ke sheet ini.
3. Pastikan tab schema tersedia (boleh auto-create via bootstrap):
   - `campaigns`, `adsets`, `ads`, `thresholds`, `notes`, `settings`, `import_logs`, `users`, `sessions`

---

## 2) Deploy Google Apps Script Web App

1. Buka project Apps Script Anda.
2. Pastikan file terbaru sudah terpasang:
   - `Code.gs`, `Api.gs`, `Auth.gs`, `Sheets.gs`, `Parser.gs`, `Analyzer.gs`, `Ai.gs`, `App.html`
3. Di **Project Settings -> Script properties**, isi minimal:
   - `DB_TARGET_SHEET_ID=1hbhtYLqzSIRlZoIiB0my-05tSIXdgAOjPbgpf7dJIEs`
   - `AUTH_PASSWORD_MODE=PLAINTEXT` *(jika ingin akun dummy plaintext sesuai kebutuhan Anda)*
   - `INTERNAL_API_TOKEN=<token-internal-anda>` *(wajib jika lewat worker protected actions)*
4. Deploy ulang sebagai Web App:
   - **Deploy -> Manage deployments -> Edit -> New version -> Deploy**
5. Gunakan URL Web App aktif:
   - `https://script.google.com/macros/s/AKfycbyEQM12lmuZ_Q7NrBC_OVEHXDHN49oLEe52GLuMbFbSiH3HSzz6PK1S7DULwnfuTp4U/exec`

---

## 3) Deploy Cloudflare Worker (gateway API)

Di folder `worker/`:

```bash
wrangler login
wrangler kv namespace create RATE_LIMIT_KV
wrangler kv namespace create REPLAY_KV
wrangler kv namespace create AI_CACHE_KV
```

1. Salin ID KV hasil command ke `worker/wrangler.toml`.
2. Isi `worker/wrangler.toml` (vars) minimal:
   - `ALLOWED_ORIGIN = "https://ads.cepat.top"`
   - `GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbyEQM12lmuZ_Q7NrBC_OVEHXDHN49oLEe52GLuMbFbSiH3HSzz6PK1S7DULwnfuTp4U/exec"`
3. Set secret Worker:

```bash
wrangler secret put INTERNAL_API_TOKEN
wrangler secret put INTERNAL_TOKEN
wrangler secret put SIGNING_SECRET
```

4. Deploy worker:

```bash
wrangler deploy
```

---

## 4) Mapping domain API (WAJIB untuk hindari 404 auth)

Gunakan domain API terpisah untuk Worker:

- `api.ads.cepat.top` -> Cloudflare Worker `ads`

Langkah di Cloudflare Dashboard:

1. **Workers & Pages -> ads -> Triggers -> Custom Domains**
2. Add custom domain: `api.ads.cepat.top`
3. Pastikan DNS record dikelola Cloudflare (proxied/orange cloud).

Verifikasi:

```bash
curl -i https://api.ads.cepat.top/health
```

Harus return `200` dengan JSON `{ "ok": true, ... }`.

---

## 5) Deploy frontend terbaru

Frontend (`index.html`) sudah dipatch agar:

- Pada host `ads.cepat.top`, auth route otomatis fallback ke GAS (`action=login/register/verify/logout`) jika endpoint utama tidak tersedia.
- Tidak lagi hard-fail ke `/auth/login` relatif saja.

Deploy static terbaru ke origin `ads.cepat.top` (sesuai pipeline hosting Anda), lalu hard refresh browser (`Ctrl+F5`).

---

## 6) Seed akun dummy (plaintext)

File seed siap pakai:

- `templates/meta_ads_tracker_seed_full.xlsx`

Isi dummy login:

- Admin: `admin@cepat.top` / `Admin1234`
- User: `user@cepat.top` / `User1234`

Cara pakai:

1. Buka file XLSX tersebut.
2. Copy tiap worksheet ke tab sheet dengan nama yang sama di spreadsheet target.
3. Pastikan tab `settings` berisi `AUTH_PASSWORD_MODE = PLAINTEXT`.

---

## 7) Uji end-to-end wajib

### A. API health

```bash
curl -i https://api.ads.cepat.top/health
```

### B. Register

```bash
curl -i -X POST https://api.ads.cepat.top/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"User Test","email":"test_login_flow@example.com","password":"Test1234"}'
```

### C. Login

```bash
curl -i -X POST https://api.ads.cepat.top/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@cepat.top","password":"Admin1234"}'
```

### D. Cek penulisan ke sheet

- `users`: user register baru harus muncul.
- `sessions`: setiap login sukses harus membuat row session baru.

---

## 8) Troubleshooting cepat

### Error: `(index):112 POST https://ads.cepat.top/auth/login 404`

Penyebab: frontend lama masih aktif / belum redeploy.

Solusi:
1. Redeploy `index.html` terbaru.
2. Hard refresh (`Ctrl+F5`) / incognito.
3. Pastikan domain API worker aktif (`api.ads.cepat.top/health`).

### Error: `INTERNAL_API_TOKEN not configured`

Penyebab: Script Property atau Worker secret belum sinkron.

Solusi:
1. Isi `INTERNAL_API_TOKEN` di Apps Script.
2. Isi `INTERNAL_API_TOKEN` di Worker secrets dengan nilai sama.
3. Redeploy GAS + Worker.

### Register/Login sukses tapi data tidak masuk sheet

Penyebab umum:
- Sheet ID salah
- Auth sheet belum ada
- Akses Apps Script ke spreadsheet belum editor

Solusi:
1. Validasi `DB_TARGET_SHEET_ID`.
2. Jalankan bootstrap/ensure sheet.
3. Cek tab `users` dan `sessions`.
