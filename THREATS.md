# Hotmodell

Svar på granskningens F08 (2 november 2026). Dokumentet beskriver vart data går, vad som kan gå fel och vad som skyddar mot det. Det säger också vad som är testat och vad som inte är det. Kontrollramarna är OWASP MASVS för telefonen och OWASP ASVS för webben. Ingen extern säkerhetsgranskning är gjord.

## Dataflöde

```
Telefonen                                   Webben (eget Firebase-projekt)
---------                                   ------------------------------
Anteckning, plan, bedömningar               Samma data, krypterad i webbläsaren
  -> SQLite med SQLCipher                     -> Firestore (EU), bara egna konto
     nyckel i Keychain / Keystore             -> Firestores cache i webbläsaren
                                            Nyckel: PBKDF2 ur lösenord, bara i minnet

Rensad anteckning ---------------------------> Språkmodell (Mistral, Anthropic, OpenAI-kompatibel)
  (namn, nummer, e-post, adresser bort)        med personens egen nyckel

Garmin-nyckel (Keychain / webbläsaren) -----> Garmin Personal API
                                              webben via /api/garmin på Netlify

Klockslag för påminnelse (bara webben) -----> /api/reminder på Netlify -> .ics till kalendern

Export: lösenordsskyddad fil (AES-256-GCM, PBKDF2-SHA256) som personen själv sparar
PDF:er (Inför återbesök, Visa för någon, Anhörigkort): okrypterade, delas av personen
```

## Hot och skydd

| Hot | Skydd | Testat | Inte testat |
| --- | --- | --- | --- |
| Någon får tag i telefonens databas | SQLCipher, nyckeln i Keychain/Keystore som inte följer med backup. `allowBackup: false` på Android | `PRAGMA cipher_version` kontrolleras i appen | På riktig iPhone. Undantag från iCloud-backup är inte byggt |
| Någon ser appen på en olåst telefon | Applås med Face ID, Touch ID eller kod | Enhetstester för koden | Skärmdump i appväxlaren döljs inte |
| Firebase eller Google läser webbdatan | Kryptering i webbläsaren före uppladdning, HMAC-id:n | Kryptering, felaktigt lösenord och skadad post i enhetstester | Metadata som Google ser (konto, IP, tider, storlekar) är inte kartlagd |
| Ett annat konto läser data | `firestore.rules`: bara `users/{uid}` för samma uid | Nej | Reglerna har inte körts i Firebase-emulatorn |
| Skadlig kod i webbversionen (XSS, beroende, driftsättning) läser upplåst data | React escapar text, inga `dangerouslySetInnerHTML`, beroenden låsta i `package-lock.json` | Nej | Innehållssäkerhetspolicy (CSP) saknas. Ingen granskning av beroenden |
| Garmin-funktionen missbrukas som öppen proxy | Bara fyra Garmin-vägar släpps igenom, anrop från andra webbplatser nekas, högst 60 anrop i minuten per adress | `tests/functions/*.test.mjs` | Gränsen lever i funktionens minne och nollställs när Netlify startar en ny instans |
| Kalenderfunktionen missbrukas | Bara klockslag och datum valideras och används, anrop från andra webbplatser nekas, högst 30 i minuten | Samma | Samma |
| Personuppgifter läcker till språkmodellen | `scrub()` före varje anrop: namn ur listan och planen (även genitiv), telefon, personnummer, postnummer, e-post, adresser, länkar. Skickad text visas under *Så räknade appen* | `tests/scrub.test.ts` | Smeknamn, initialer, arbetsplatser och kombinationer av sällsynta uppgifter tas inte bort. Ingen svensk testsamling |
| Leverantören lagrar eller tränar på texten | Personens egen nyckel, leverantörens villkor länkas och måste godkännas | Nej | Avtal och lagring hos leverantören |
| En anteckning styr modellen (promptinjektion) | Nivån räknas i koden. Allvarliga tecken som ordmatchningen hittar räknas alltid. Citat måste finnas i texten och får inte vara negerade. Modellens mening används bara om den nämner det som gav poäng | `tests/model-guard.test.ts` | Injektion via planens egen text |
| Export eller PDF hamnar fel | Exporten är lösenordsskyddad. PDF:erna skapas på telefonen och delas av personen | Exportens kryptering i enhetstester | Tillfälliga PDF-filer i telefonens cache tas inte bort uttryckligen |
| Webbens lösenord är svagt | Minst 10 tecken, PBKDF2 med 600 000 iterationer | Längdkravet | Ingen kontroll mot kända läckta lösenord |

## Nycklarnas livscykel

| Nyckel | Skapas | Lagras | Försvinner |
| --- | --- | --- | --- |
| Databasnyckel (telefonen) | Första start, slumpad | Keychain / Keystore, följer inte med backup | När appen tas bort |
| Webbens krypteringsnyckel | Ur lösenordet och ett slumpat salt | Bara i webbläsarens minne | Vid utloggning eller stängd flik |
| Exportens nyckel | Ur exportlösenordet och ett slumpat salt | Ingenstans | Direkt efter export |
| Modell- och Garmin-nyckel | Personen klistrar in | Keychain / Keystore, i webben webbläsarens lagring (okrypterat) | När personen raderar den |

## Nästa steg

1. Kör `firestore.rules` i Firebase-emulatorn med nekande tester: annat konto, utloggad, fel sökväg.
2. Lägg till en innehållssäkerhetspolicy för webbversionen på Netlify.
3. Undanta databasen från iCloud-backup och dölj innehållet i appväxlaren.
4. Bygg en svensk testsamling för `scrub()` med smeknamn, initialer, arbetsplatser och felstavade namn.
5. Ta bort tillfälliga PDF-filer efter delning.
