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

1. Buat file Google Sheets baru dengan nama: **Ad Campaign Tracker DB**
2. Tidak perlu manual buat sheet jika pakai `uiBootstrap` karena script akan membuat otomatis:
   - campaigns
   - adsets
   - ads
   - thresholds
   - notes
   - settings
   - import_logs
3. Threshold default otomatis di-seed:
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
   - `INTERNAL_TOKEN`
   - `SIGNING_SECRET` (disarankan, untuk HMAC internal request)
   - `WEBHOOK_TOKEN`
   - `WEBHOOK_SECRET` (opsional, untuk signature webhook)
   - `OPENAI_API_KEY`
   - `OPENAI_BASE_URL` (opsional)
   - `OPENAI_MODEL` (opsional)
   - `SIGNATURE_MAX_SKEW_MS` (default 300000)
   - `NONCE_TTL_SEC` (default 600)
   - `AI_CACHE_TTL_SEC` (default 300)
   - `WEBHOOK_MAX_SKEW_MS` (default 300000)
   - `GAS_WEB_APP_URL` (opsional jika pakai route `/proxy/apps-script`)
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

Flow AI:
1. User bertanya di tab AI
2. Apps Script kirim ringkasan data + pertanyaan ke Worker `/ai/analyze`
3. Request ditandatangani (`x-ts`, `x-nonce`, `x-signature`) untuk anti-replay + integritas payload
4. Worker panggil provider AI dengan API key dari env
5. Jawaban kembali ke Apps Script lalu tampil di UI

---

## 7) Dummy Data Cepat

Setelah deploy, gunakan tab Import untuk upload CSV contoh (`docs/IMPORT_TEMPLATE.csv`) pada level:
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
