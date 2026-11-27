# Dagsljus – granskningsunderlag 27 november 2026

Underlaget beskriver ändringarna sedan granskningen 25 november (commit `bab2519`) fram till `58c21ad`, med filvägar så att varje påstående går att kontrollera i koden. Allt i exemplen är påhittat; inga riktiga anteckningar, namn eller krisplaner finns i repot.

Granskaren ombeds särskilt titta på **startsidan (Hem)**, **rutinerna mot egna mål per kalendervecka**, **sömnregeln som skärptes** och **Prata vid akutregeln**. Frågorna står i avsnitt 7.

## 1. Kontrollera själv

```bash
git checkout claude/mood-health-pwa-zLJP3
npm install
npm test            # 897 tester i Jest
npx tsc --noEmit    # typkontroll
npx expo lint       # 0 fel, 11 kända varningar
```

Inget av det nya är provat på en fysisk telefon, mot ett riktigt Garmin-konto eller med en riktig språkmodell. Det som är provat i webbversionen (Playwright, påhittade data) står vid respektive punkt.

## 2. Appen i korthet

Dagsljus är en stämningsdagbok för en person med bipolär sjukdom, för personligt bruk. Varje kväll jämförs en anteckning med personens egen krisplan och mätta värden; svaret är ett trafikljus, en mening och planens åtgärder. Koden avgör nivån (`src/core/analysis/rules.ts`, `scoring.ts`, regler i `rules/rules.json`), akutregeln körs på telefonen före allt annat (`src/core/context/akut.ts`), och en språkmodell används bara där det står uttryckligen. All text till en modell går genom `scrub()` (`src/core/privacy/scrub.ts`). Mer i `README.md` och `PRIVACY.md`.

## 3. Ändringar sedan 25 november

| Datum | Commit | Område | Ändring |
|---|---|---|---|
| 27 nov | `58c21ad` | Rutiner | Kalenderveckor måndag–söndag i Trend och i veckans kommentar |
| 27 nov | `f540fed` | Trend | Varje rutin mot sitt eget mål; riktningsrutiner räknas bara när de följs |
| 27 nov | `c9ee7ff` | Hem, sömn | Lugnare startsida; regler 1.11.0: en normallång natt flaggas aldrig som kort |
| 27 nov | `ea7b344` | Hem | Ordning efter vad som behöver uppmärksamhet; ett kort för sömn och dygnsrytm |
| 26 nov | `969c83b` | Garmin | Högst 28 dagar per anrop; ifyllnaden av sömnfaser bad om 29 och gav "nyckeln godtogs inte" |
| 26 nov | `c96fe51` m.fl. | Hem | Veckans kommentar: appens egna meningar, ingen språkmodell (efter granskning 26 nov) |
| 26 nov | `63d084c` | Dygnsrytm | "Din vanliga rytm" i stället för "Inget tydligt nytt mönster" |
| 25 nov | `ca6ee38` | Rutiner | Andelen räknade bara sparade bockar och visade nära 100 % |
| 25 nov | `1ebb0bd` | Mina mönster | Metodtexten säger "före eller vid starten", som testet räknar |
| 25 nov | `a74967d` | Sömnfaser | Bakom ett tryck, inte till modellen; djupsömn som separat utforskande analys |
| 25 nov | `f77999f` | Sömnfaser | Saknad vaken tid visas som "saknas", aldrig 0 |
| 25 nov | `5672f08` | Bedömning | Regler 1.10.0: ett negerat tecken som står ordagrant räknas oavsett modellen |
| 25 nov | `b59dfb5` | Prata | Hjälp nu öppnas direkt när ett meddelande stoppas; kortet under meddelandet |

## 4. Patientsäkerhet

### 4.1 Prata vid akutregeln (`b59dfb5`)

Tidigare stod kriskortet ovanför meddelandena medan vyn rullade till slutet, så i ett långt samtal syntes bara "Hjälp nu visas i stället". Nu öppnar ett stoppat meddelande arket *Hjälp nu* direkt över samtalet (`nav.push({ name: 'crisis' })` i `src/ui/screens/ChatScreen.tsx`), vilket också flyttar skärmläsaren dit, och kortet står kvar under det senaste stoppade meddelandet. Provat i webbversionen med ett samtal på 30 meddelanden; inte på telefon med tangentbordet öppet.

### 4.2 Modellen kan inte sänka gult genom att missa ett negerat tecken (`5672f08`, regler 1.10.0)

Ett tidigt tecken som självt innehåller en negation ("Svarar inte på sms") lämnades till modellen. Nu räknas det på telefonen när anteckningen säger tecknet ordagrant utan någon annan negation i samma sats (`confirmsSign` i `src/core/analysis/wordmatch.ts`, använd i `assess.ts`). En sats slutar vid `. ! ? ; ,`, radbrytning eller "men". "Det är inte så att jag svarar inte på sms" lämnas fortfarande till modellen. Tester i `tests/model-guard.test.ts`.

### 4.3 Veckans kommentar på Hem vid gult, rött och Hjälp nu

Kommentaren räknas fram varje gång Hem visas, ur det som är sparat, och lagras inte (`src/core/plan/status.ts`, `src/services/status.ts`). En röd avstämning eller ett stoppat meddelande ändrar den därför direkt, också utan nät. Acceptanstestet från granskningen 26 november finns i `tests/status.test.ts`: först en uppmuntrande rad, sedan en röd avstämning (bara det som gjorts sägs), sedan en träff på akutregeln (inga meningar, bara Hjälp nu).

## 5. Startsidan (Hem)

Ordning (`src/ui/screens/HomeScreen.tsx`):

1. *Hjälp nu*-kort, bara en vecka då akutregeln visat Hjälp nu (`StatusHelp` i `src/ui/StatusToday.tsx`).
2. **Senaste veckan**: bara de sju dagssymbolerna (form och färg). *Kommentar* fäller ut en rad om tomma ringar ("I dag: ingen avstämning än") och veckans iakttagelse. VoiceOver läser varje dag som "tisdag 24 november, gul nivå".
3. En gul eller röd kväll: nivån och första steget i planen (`firstStep`).
4. **Sömn och dygnsrytm** (`src/ui/SleepAndRhythm.tsx`): ett kort där hela raden är en knapp. Senaste natten, Dygnsrytms rubrik och ett plansteg vid förändring, sömnnotisen. Hämtningstiden visas bara när natten saknas, data är äldre än ett dygn eller hämtningen misslyckades.
5. **Rutiner i dag** (`src/ui/RoutinesToday.tsx`): en kort lista, dagens förslag först med modellens kommentar, *Gjord i dag* i ord vid en avbockad rutin, inga versalrubriker, resten bakom *Visa alla rutiner (N)*.
6. Kortkön (krisplan, förslag med mera) och kvällens avstämning.

Granskat i webbversionen en grön dag med påhittade rutiner och en manuellt angiven natt. Den gula och röda vyn och stor text är inte sedda.

## 6. Rutiner, veckor och sömn

### 6.1 Kalenderveckor och egna mål (`f540fed`, `58c21ad`)

Varje rutin har ett mål: *varje dag*, *N gånger i veckan* eller *vissa dagar* (till exempel mån–fre för "Sluta jobb i tid"), valt under *Jag → Rutiner* eller läst ur rutinens ord. Veckor räknas måndag till söndag. En dag utan avstämning räknas varken som gjord eller missad:

- daglig rutin: målet är kvällarna med någon avbockning den veckan;
- veckomål: talet, så snart veckan har någon avbockning;
- vissa dagar: de planerade dagarna som har avbockning.

`weekGoal` och `routineWeeks` i `src/core/plan/routineFrequency.ts`. Trend visar per rutin "Den här veckan: 2 av 3 gånger" (med dagar kvar) och "Förra veckan: 3 av 3 gånger ✓", vid längre perioder "Målet nått 3 av 4 hela veckor". Diagrammet per dag gäller bara dagliga rutiner. Planens rutiner för en riktning (uppvarvning, nedstämdhet) räknas bara medan personen följer den riktningen (`countedRoutineIds` i `routines.ts`).

### 6.2 Veckans kommentar (`src/core/plan/status.ts`)

Högst tre meningar, appens egna, var och en ett bestämt faktum:

- *"”X” kom igång förra veckan: fem kvällar, mot två kvällar veckan innan."* Kräver minst två fler bekräftade gånger, 60 % av målet och 30 procentenheter mer än veckan innan, och för en daglig rutin minst fyra kvällar med avbockning båda veckorna.
- *"Du nådde ditt mål för ”X”, …, både förra veckan och veckan innan."* Bara när avbockningarna bekräftar hela målet båda hela veckorna (sju av sju för en daglig rutin).
- *"Du har redan nått veckans mål för ”X”, 3 gånger i veckan."*
- *"Du har gjort ”X” tre gånger den här veckan."*
- *"Dina två avstämningar sedan ”Flytten” 22 november har varit gröna."*: 2–7 dagar efter en egen händelse med datum.

Vid gult, rött eller uppvarvningsplan sägs bara vad som gjorts. Inget sägs om hur personen mår. Ingen språkmodell används (den första versionen 26 november gjorde det; den togs bort efter granskningen samma dag).

### 6.3 Sömn: regler 1.11.0 (`c9ee7ff`)

Personen fick en sömnnotis efter en natt på 8,4 timmar, eftersom notisen gällde tre nätter i rad under det egna snittet med vilken marginal som helst. Nu:

- **Sömnnotisen** (`src/core/analysis/sleepNotice.ts`): tre nätter i rad, var och en minst 1 timme under det egna snittet och under 7 timmar.
- **Dygnsrytm, kortare sömn** (`src/core/analysis/rhythm.ts`): som förut (tre nätter, robust z ≤ −1,5) och dessutom varje natt under 7 timmar (`rhythm.shorterBelowHours`).
- **Ampeln** är oförändrad: sömn under personens gräns (5 h som standard), kort sömn två nätter i rad, och insomning efter 02:00 utan avstämning kvällen innan ger ett tecken.

`RYTMRAPPORT.md` är omgenererad. I simuleringen ger sömnnotisen nu 0,2 falsklarm per 30 bedömda dagar i stället för 1,4, och missar den enda simulerade uppvarvade starten som den tidigare fångade.

### 6.4 Sömnfaser och Garmin

- Djup, lätt, REM och vaken hämtas från Garmin. Faserna ger aldrig poäng och skickas inte till språkmodellen. En enskild natts fördelning ligger bakom *Visa sömnfaser*; saknad vaken tid visas som "saknas" och snitt räknar bara nätter som har uppgiften (`src/core/analysis/sleepPhases.ts`, `src/ui/SleepPhases.tsx`).
- Mina mönster är tillbaka på fem samband; lägre **andel** djupsömn prövas separat som utforskande, aldrig som fynd (`EXPLORATORY` i `src/core/analysis/moodPatterns.ts`).
- Garmin-klienten delar nu upp längre perioder i anrop om högst 28 dagar (`days` i `src/garmin/client.ts`). Ifyllnaden av fyra veckors faser bad om 29 dagar; Garmin svarade 400, appen läste det som en ogiltig nyckel, och varje hämtning därefter misslyckades. Svar 400 tolkas fortfarande som nyckelfel i `fail()`, vilket kan vara missvisande om något annat anrop blir fel.

## 7. Frågor till granskaren

1. **Hem:** blir ordningen (vecka, gult/rött steg, sömn och dygnsrytm, rutiner, avstämning) begriplig, och är det rätt att kommentaren under veckan är ihopfälld från början?
2. **Kalenderveckor:** är "den här veckan" och "förra veckan" tydligare än "senaste 7 dagarna" för rutiner? Hur ska en vecka med bara en eller två avstämningar visas, så att ett veckomål inte ser missat ut?
3. **Sömn:** är 7 timmar och 1 timme under snittet rimliga gränser för notisen och för Dygnsrytm? En person som brukar sova 9 timmar och sover 7,5 tre nätter i rad flaggas nu inte, fast nedgången är stor mot det egna normala. Finns det ett bättre sätt än en absolut gräns?
4. **Garmin:** bör ett 400-svar visas som "Garmin tog inte emot frågan" i stället för nyckelfel?
5. **Prata:** räcker det att *Hjälp nu* öppnas som ark och att kortet står under meddelandet, eller ska samtalet låsas tills personen stängt arket?
6. Finns det något i avsnitt 4 som bör prövas på telefon innan appen används dagligen, utöver stor text och VoiceOver?

## 8. Kända begränsningar

- Reglerna har inte granskats av en människa med klinisk kunskap.
- Inget är provat på fysisk telefon, mot ett riktigt Garmin-konto eller med en riktig modell sedan förra granskningen.
- Garmins fältnamn för lätt sömn och vaken tid är inte officiellt dokumenterade.
- En rutin utan valt mål räknas som daglig om dess ord inte säger något annat; "Sluta jobb i tid" behöver *Vissa dagar mån–fre* för att helgen inte ska räknas.
- Krypteringslösenordet i webbversionen går inte att återställa eller byta; skyddet i dag är den krypterade säkerhetskopian under *Säkerhetskopiera appen*.

## 9. Rättat efter granskningens svar 27 november

| Fynd | Ändring | Var |
|---|---|---|
| En röd kväll utan plansteg hamnade långt ner | Gul och röd nivå har en fast plats överst, med plansteget när det finns | `HomeScreen.tsx` |
| Rutiner före sömn en vanlig natt | Sömnkortet kommer först bara när något behöver uppmärksamhet (`sleepAttention`) | `SleepAndRhythm.tsx` |
| Veckodagsmål: lördag räknades mot mån–fre | Samma dagar i täljare och nämnare (`countedDays`, `weekGoal`) | `routineFrequency.ts`, `status.ts` |
| Gles registrering såg ut som missat veckomål | En vecka som inte går att avgöra är öppen: "1 gång registrerad, rutiner bockades av 2 dagar"; nått mål heter "veckomålet nått" | `routineFrequency.ts`, `TrendScreen.tsx` |
| Tydlig personlig sömnförändring över 7 timmar syntes inte | "De senaste tre nätterna sov du omkring 7,5 timmar. Ditt vanliga snitt är 9 timmar." i sömnkortet, utan notis och poäng (`sleepDrop`) | `sleepNotice.ts`, `SleepAndRhythm.tsx` |
| Garmin 400 lästes som nyckelfel | 400 på ett dataanrop: "Garmin kunde inte behandla begäran (fel 400). Nyckeln är troligen i ordning"; på tokenanropet fortfarande nyckelfel | `client.ts` |

Kvar att prova på telefon: Prata med tangentbordet öppet och Hjälp nu (fokus i arket och efter stängning), Hem med stor text en röd dag utan plansteg, och Hem offline efter en uppmuntrande veckokommentar.

## 10. Rättat efter granskningens andra svar 27 november

| Fynd | Ändring | Var |
|---|---|---|
| Gul eller röd nivå doldes första användningsdagen | Förstadagsvyn visar samma nivåkort, med plansteg när det finns, före välkomstkortet. Kontrollerat i webbversionen (Playwright, påhittade data) med en röd första kväll med och utan plansteg | `HomeScreen.tsx` (`levelCard`) |
| Trend kunde visa 1 av 1 kväll ✓ för en daglig rutin | Samma innebörd som på Hem: ett mål är nått först när avbockningarna bekräftar hela målet (sju kvällar, talet, alla planerade dagar). En vecka där målet varken är nått eller utom räckhåll är öppen: "Gjort den enda registrerade kvällen", "Gjort alla 3 registrerade kvällar". En registrerad kväll utan rutinen gör målet avgjort | `weekGoal` i `routineFrequency.ts`, `TrendScreen.tsx` |
| Sömnmeningen kunde läsas som tre likartade nätter | "Snitt de senaste tre nätterna: 8 timmar. Ditt tidigare snitt: 9 timmar." | `SleepAndRhythm.tsx` |
