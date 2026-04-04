# Dummy Data yang Bisa Dipakai

## thresholds (default)

| metric_key | enabled | rule_type | value | label |
|---|---|---|---:|---|
| roas | true | min | 1.5 | ROAS min |
| cpa | false | max | 150000 | CPA max |
| ctr | true | min | 1 | CTR min % |
| cpm | false | max | 60000 | CPM max |

## notes (contoh)

| id | entity_level | entity_name | note_text |
|---|---|---|---|
| ad::Ad 2 - Hook Curiosity | ad | Ad 2 - Hook Curiosity | CTR rendah 3 hari, butuh hook baru |
| campaign::C2 - Supplement New | campaign | C2 - Supplement New | Uji offer bundling minggu ini |

## settings (contoh)

| key_name | key_value |
|---|---|
| WORKER_URL | https://ads.<your-subdomain>.workers.dev |
| WORKER_TOKEN | <same-as-INTERNAL_TOKEN> |
| WORKER_SIGNING_SECRET | <same-as-SIGNING_SECRET> |
| AI_MODE | gpt-4o-mini |
