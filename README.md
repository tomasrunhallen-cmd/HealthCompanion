# HealthCompanion

Personlig bipolär stämnings- och hälsoanalys-PWA. Single-user, self-hosted.

## Funktioner

- **Dagbok** — mobilvänlig daglig ifyllnad av stämning, skyddande beteenden och mani-indikatorer
- **Garmin-sync** — sömn, HRV, vilopuls, stress, Body Battery
- **AI-analys** — Claude Opus 4.7 med prompt caching hittar mönster i dina data
- **Heatmap-kalender** — GitHub-stil med tillståndsfärgning
- **CSV-import** — importera befintlig historik utan dataförlust
- **PWA** — installerbar på iOS/Android, offline-stöd för dagbokifyllnad

## Snabbstart (lokal development)

### Förkrav
- Python 3.12+
- Node 22+
- En Anthropic API-nyckel

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Konfigurera
cp .env.example .env
# Redigera .env: sätt APP_PASSWORD, SECRET_KEY, ANTHROPIC_API_KEY

uvicorn app.main:app --reload
# API körs på http://localhost:8000
# Docs: http://localhost:8000/docs
```

### Frontend

```bash
cd frontend
npm install
# Skapa .env.local:
echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > .env.local
npm run dev
# UI på http://localhost:3000
```

### Kör tester

```bash
cd backend
pytest tests/ -v
```

## Docker Compose (produktion)

```bash
cp backend/.env.example backend/.env
# Redigera backend/.env

docker compose up -d
# Backend: :8000, Frontend: :3000
```

### HTTPS med Caddy (rekommenderat)

Lägg till en `Caddyfile`:

```caddy
your-domain.com {
    reverse_proxy /api/* backend:8000
    reverse_proxy frontend:3000
}
```

## Konfiguration (`backend/.env`)

| Variabel | Beskrivning |
|---|---|
| `APP_PASSWORD` | Lösenord för inloggning i appen |
| `SECRET_KEY` | JWT-signeringsnyckel (64 slumpmässiga hex-tecken) |
| `ANTHROPIC_API_KEY` | API-nyckel från console.anthropic.com |
| `GARMIN_ENCRYPTION_KEY` | Fernet-nyckel för krypterat credential-lagring |
| `DATABASE_URL` | SQLite-sökväg (default: `sqlite+aiosqlite:///./data/mood.db`) |

Generera `SECRET_KEY`:
```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

Generera `GARMIN_ENCRYPTION_KEY`:
```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

## CSV-import

Stöder exakt samma format som ursprungsappen (svenska månadsnamn, JA/NEJ/-).

1. Gå till **Inställningar** → drag och släpp CSV-filen
2. Granska förhandsgranskning
3. Välj konflikthantering (hoppa över / skriv över / avbryt)
4. Bekräfta import

Exporten (knapp i Inställningar) genererar identiskt format — du är aldrig låst.

## AI-analys

Analysen körs via Claude Opus 4.7 och:
- Identifierar återkommande mönster
- Korrelerar Garmin-fysiologi med stämningsmarkörer
- Identifierar tidiga varningssignaler för hypomani/depression
- Lyfter fram skyddande faktorer
- Ger personaliserade rekommendationer

**Prompt caching** reducerar kostnaden vid upprepade analyser av samma period.
Rapporten cachas i databasen och behöver inte köras om om inte "Tvinga ny analys" väljs.

### Integritet och PII
Fritext-anteckningar granskas av en enkel regex-baserad scrubber som ersätter kända
svenska namn, telefonnummer och e-postadresser med platshållare innan data skickas
till Anthropic API.

## Fas 2: ML-prediktion

Se [`backend/app/ml/README.md`](backend/app/ml/README.md) för planerad arkitektur för
episodprediktion baserad på historisk data.

## Datastruktur

```
data/
  mood.db          # SQLite — all data
backend/
  app/
    models.py      # SQLAlchemy-modeller (DiaryEntry, GarminData, m.fl.)
    parsers/
      mood_csv.py  # CSV-parser för originalformatet
    analysis/
      ai_insights.py  # Claude API med prompt caching
    garmin/
      auth.py      # Fernet-krypterad credential storage
      sync.py      # Garmin Connect sync
    utils/
      pii_scrub.py # PII-anonymisering av anteckningar
```

## Säkerhet

- All data i lokal SQLite — inga molntjänster för data
- JWT-autentisering med konfigurerat lösenord
- Garmin-credentials krypterade med Fernet (AES-128-CBC)
- Rate limiting på alla endpoints
- PII-scrubbing av anteckningar innan AI-analys
- Service Worker cachar aldrig API-svar

## Licens

Personligt projekt — ej för distribution.
