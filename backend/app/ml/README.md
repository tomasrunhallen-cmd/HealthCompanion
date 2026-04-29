# ML — Fas 2: Episod-prediktion

Denna katalog är reserverad för maskininlärningsmodeller för episodprediktion.

## Planerad arkitektur

### Input-features
- Dagboksmarkörer (alla ~40 fält) för rullande 14-dagarsfönster
- Garmin-trender: sömn, HRV, vilopuls, stress — delta från 7-dagars rullande medel
- Veckodag, årstid (cyklisk encoding)
- Mania-score trend (lutning senaste 7 dagarna)

### Output
- Binär klassificering: "episod-risk inom 3 dagar" (ja/nej)
- Alternativt: sannolikhetsscore 0–1 per episodtyp (hypoman / depressiv / blandad)

### Modellförslag
1. **XGBoost** — bra startpunkt, hanterar missing values, tolkningsbar via SHAP
2. **Enkel LSTM** — om tidsseriemönster är viktiga (t.ex. sekventiella sömnsignaler)

### Dataunderlag
- Minst 365 dagar med ~80% ifyllnad rekommenderas för meningsfull träning
- Med 2+ år data är underlag bättre
- Etikettera med hjälp av retrospektiv granskning: markera vilka perioder som var hypomana/depressiva

### Integration
- Träningsscript: `backend/app/ml/train.py` (bygg när data finns)
- Inferens-endpoint: `POST /api/ml/predict` — returnerar episod-risk för nästa 3/7/14 dagar
- Daglig automatisk screening: `POST /api/ml/daily-screen` — kör kl 06:00 lokaltid

### Dataexport för träning
```python
# Hämta träningsdata via API:
GET /api/diary/?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD&limit=1000
GET /api/garmin/data?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
```

### Kom ihåg
- Aldrig träna modell och prediktera på samma data (temporal split!)
- Modeller sparas aldrig med PII — bara aggregerade features
- Förklara alltid prediktioner med SHAP-värden för transparens
