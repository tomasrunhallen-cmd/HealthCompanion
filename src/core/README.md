# @dagsljus/core

Allt som avgör vad appen säger, utan plattformsberoenden: poäng och nivå, akutregeln,
rensningen, krisplansimporten, promptladdaren, kontextbanken och gränssnittet mot en
språkmodell. Telefonappen och webbversionen importerar samma kod härifrån.

- `domain/` datatyperna
- `analysis/` poäng, nivå, ordmatchning, baslinjer, testfallen
- `context/` akutregeln, kontextbanken, standardinnehållet, rättelsereglerna
- `privacy/` rensningen av personuppgifter
- `plan/` krisplansimporten och radernas fält, rutinerna
- `prompts/` promptladdaren och de buntade promptarna (genereras av `scripts/build-prompts.js`)
- `llm/` gränssnittet mot en modell, schemakontroll, fejkade modeller för tester

Kärnan får bara importera från sig själv och från `fflate` och `unpdf`. Den läser och
skriver aldrig databasen, nätverket, filer eller notiser. Det gör `src/services/`,
`src/storage/`, `src/platform/` och `src/adapter/http.ts`. `tests/core-boundary.test.ts`
kontrollerar gränsen, och `npm run test:core` kör alla testfall på webb, Node, iOS och Android.
