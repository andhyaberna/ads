# Setup dari Nol - Ad Campaign Tracker

## 1) Prioritas Pengerjaan (urutan paling penting)

1. **Google Sheets + schema** (fondasi data)
2. **Google Apps Script backend + UI** (aplikasi utama)
3. **Import CSV** (agar data bisa masuk)
4. **Dashboard + Rekomendasi + Alert** (nilai bisnis utama)
5. **Cloudflare Worker AI proxy + security**
6. **Periode, Hierarki, Analitik lanjutan**

## 2) Bagian yang bisa ditunda ke versi berikutnya

- Rate limiting yang lebih canggih (durable object)
- Caching AI per hash pertanyaan
- Webhook Meta yang lebih detail
- Audit trail user/action per perubahan threshold/notes

---

## 3) Setup Google Sheets

1. Gunakan Google Sheets target utama ini:
   - **Sheet ID:** `1hbhtYLqzSIRlZoIiB0my-05tSIXdgAOjPbgpf7dJIEs`
2. Pastikan akun Apps Script punya akses edit ke sheet tersebut.
3. Tidak perlu manual buat sheet jika pakai `uiBootstrap` karena script akan membuat otomatis:
   - campaigns
   - adsets
   - ads
   - thresholds
   - notes
   - settings
   - import_logs
4. Threshold default otomatis di-seed:
   - roas | true | min | 1.5 | ROAS min
   - cpa | false | max | 150000 | CPA max
   - ctr | true | min | 1 | CTR min %
   - cpm | false | max | 60000 | CPM max

---

## 4) Setup Google Apps Script

1. Buka `script.google.com` -> New project
2. Tambahkan file sesuai folder `gas/`:
   - `Code.gs`
   - `Api.gs`
   - `Parser.gs`
   - `Analyzer.gs`
   - `Sheets.gs`
   - `Ai.gs`
   - `App.html`
3. Paste isi file satu per satu
4. Save semua file

### Deploy Web App

1. Klik **Deploy** -> **New deployment**
2. Type: **Web app**
3. Execute as: **Me**
4. Who has access: **Anyone within domain** (atau sesuai kebijakan internal)
5. Deploy, salin URL Web App

Gunakan endpoint aktif berikut (sudah terhubung di kode):
- `https://script.google.com/macros/s/AKfycbyEQM12lmuZ_Q7NrBC_OVEHXDHN49oLEe52GLuMbFbSiH3HSzz6PK1S7DULwnfuTp4U/exec`

---

## 5) Setup Cloudflare Worker

Kebutuhan user:
- Worker name: **ads**
- Allowed domain: **ads.cepat.top**

1. Buat project Worker
2. Copy file:
   - `worker/index.js`
   - `worker/wrangler.toml`
3. Ubah `kv_namespaces.id` di `wrangler.toml`
4. Set secrets/env:
   - `INTERNAL_API_TOKEN` (wajib jika ingin pakai action API `doGet/doPost?action=...`)
   - `INTERNAL_TOKEN`
   - `SIGNING_SECRET` (disarankan, untuk HMAC internal request)
   - `WEBHOOK_TOKEN`
   - `WEBHOOK_SECRET` (opsional, untuk signature webhook)
   - `OPENAI_API_KEY`
   - `OPENAI_BASE_URL` (opsional)
   - `OPENAI_MODEL` (opsional)
   - `GEMINI_API_KEY` (opsional)
   - `GEMINI_BASE_URL` (opsional)
   - `GEMINI_MODEL` (opsional)
   - `CLAUDE_API_KEY` (opsional)
   - `CLAUDE_BASE_URL` (opsional)
   - `CLAUDE_MODEL` (opsional)
   - `SIGNATURE_MAX_SKEW_MS` (default 300000)
   - `NONCE_TTL_SEC` (default 600)
   - `AI_CACHE_TTL_SEC` (default 300)
   - `WEBHOOK_MAX_SKEW_MS` (default 300000)
   - `GAS_WEB_APP_URL` (opsional jika pakai route `/proxy/apps-script`)

5. Set Script Properties di Apps Script (Project Settings):
   - `ADMIN_EMAILS` = daftar email admin dipisah koma
   - `APP_ALLOWED_DOMAIN` = domain internal (contoh: `cepat.top`)
   - `INTERNAL_API_TOKEN` = token internal untuk endpoint action API
5. Deploy:
   ```bash
   wrangler deploy
   ```

---

## 6) Cara Menghubungkan Apps Script ↔ Worker

Di tab **Settings** aplikasi:

- `WORKER_URL` = URL Worker, contoh `https://ads.<subdomain>.workers.dev`
- `WORKER_TOKEN` = sama dengan secret `INTERNAL_TOKEN` di Worker
- `WORKER_SIGNING_SECRET` = sama dengan `SIGNING_SECRET` di Worker (boleh dikosongkan jika fallback ke WORKER_TOKEN)
- `AI_MODE` = model alias, contoh `gpt-4o-mini`

### Konfigurasi AI Per User

Di section **Konfigurasi AI Pribadi (Per User)**:
- Pilih provider aktif: **Mode Bawaan**, **OpenAI**, **Gemini**, atau **Claude**
- Isi API key provider masing-masing jika ingin memakai provider eksternal
- Status key tampil sebagai indikator tersimpan/belum + masked value
- Key tidak ditampilkan full lagi setelah disimpan

Penting:
- Semua API key bersifat **opsional (tidak wajib)**
- Jika API key kosong atau provider eksternal tidak siap, sistem otomatis fallback ke **mode bawaan**
- Fitur utama tetap berjalan normal tanpa API key eksternal

Catatan:
- Konfigurasi ini disimpan **per user** (User Properties), bukan global
- Request AI akan memakai provider+credential milik user yang sedang login

Flow AI:
1. User bertanya di tab AI
2. Apps Script kirim ringkasan data + pertanyaan ke Worker `/ai/analyze`
3. Request ditandatangani (`x-ts`, `x-nonce`, `x-signature`) untuk anti-replay + integritas payload
4. Worker panggil provider AI dengan API key dari env
5. Jawaban kembali ke Apps Script lalu tampil di UI

---

## 7) Dummy Data Cepat

Setelah deploy, gunakan tab Import untuk upload file contoh pada level:
- Excel template siap import: `templates/meta_ads_import_template.xlsx`
- CSV template: `docs/IMPORT_TEMPLATE.csv`

Flow import mendukung:
- `.csv` (existing flow)
- `.xlsx` (parser workbook internal; bisa isi `worksheet_name` opsional)

Untuk upload bertahap, gunakan level:
- campaign
- adset
- ad

Atau isi manual di sheet:

Campaign contoh:
- campaign_name: C1 - Skincare Sale
- spend: 1200000
- impressions: 120000
- ctr: 1.8
- results: 18
- revenue: 3600000

---

## 8) Catatan Asumsi

- Import dilakukan terpisah per level (campaign/adset/ad)
- Header CSV Meta Ads bisa campuran EN/ID sesuai mapping di `Parser.gs`
- Untuk AI, keamanan bergantung pada penyimpanan token di settings + env Worker
- MVP ini menargetkan internal tool, bukan high-scale public product

## 9) Baseline Keamanan Minimum

- Jangan simpan secret sistem di sheet `settings` (gunakan Script Properties)
- Jangan tampilkan raw secret ke UI (hanya status masked)
- Batasi role admin via `ADMIN_EMAILS`
- Batasi domain user via `APP_ALLOWED_DOMAIN`
- Rotasi `WORKER_TOKEN`, `WORKER_SIGNING_SECRET`, `INTERNAL_API_TOKEN` secara berkala

## 10) Integrasi Live ads.cepat.top

- Domain `https://ads.cepat.top/` menampilkan frontend publik (tanpa ekspos URL GAS di UI).
- Frontend hanya akses endpoint Worker publik (`/app/snapshot`, `/app/import`, `/app/save-note`, `/app/ai`).
- Worker menyuntik `internal_token` server-side saat relay ke GAS (browser tidak pernah memegang token internal).
- Data flow live: **Excel/CSV -> Worker /app/import -> GAS import -> Google Sheets target ID -> Worker /app/snapshot -> UI ads.cepat.top**.
- Jika endpoint/GSheets gagal diakses, Worker kirim error aman ber-ID request (tanpa detail sensitif).
