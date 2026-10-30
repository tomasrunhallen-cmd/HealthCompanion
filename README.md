# Dagsljus

En stämningsdagbok för iOS och Android för en person med bipolär sjukdom. Varje kväll jämför appen en anteckning med personens egen krisplan och med mätta värden. Svaret är en ampel, en mening och planens egna åtgärder. Allt sparas på telefonen. Det finns ingen server.

Specen finns i uppdraget *Dagsljus – byggprompt för Claude Code*. Den här filen beskriver vad som är byggt, hur du kör det och vad som återstår.

## Status: steg 1 av 3

Bygget görs i tre steg som verifieras ett i taget.

| Steg | Innehåll | Status |
| --- | --- | --- |
| 1. Gränssnitt och funktion | Krisplan, kvällens avstämning, bedömning, Orkar bara trycka, tystnadsregel, påminnelse, applås, export och radering. Ordmatchning i stället för språkmodell. | **Klart för verifiering** |
| 2. Koppling till språkmodell | LLM-inställningar, egen nyckel, Anthropic och OpenAI-kompatibel adress, Testa modellen, kostnadsuppskattning, krisplansimport med modell. | Inte påbörjat |
| 3. Garmin | Sömn och stress från Garmin Health API med egen Personal-nyckel. | Inte påbörjat |

Det som redan finns för steg 2 är adaptergränssnittet, promptladdaren, schemavalideringen, rensningen av personuppgifter och en fejkad modell. Allt det är testat men inte kopplat till någon riktig leverantör.

## Verifiera steg 1

### På telefonen med Expo Go

Du behöver en dator med Node.js 22 och appen **Expo Go** på telefonen. Telefon och dator ska vara på samma wifi.

```bash
git clone <repot> && cd HealthCompanion
npm install
npm start
```

Skanna QR-koden med kameran (iPhone) eller i Expo Go (Android). Appen öppnas i Expo Go.

I Expo Go är databasen **okrypterad**, eftersom SQLCipher kräver en utvecklingsbuild. Skärmen *Data och integritet* visar det. Använd därför testdata och inte din riktiga krisplan förrän du kör en utvecklingsbuild.

### Utvecklingsbuild med kryptering

En utvecklingsbuild aktiverar SQLCipher via `app.json`. Den behövs också för Whisper senare.

```bash
npx expo run:android      # kräver Android Studio
npx expo run:ios          # kräver Mac med Xcode
# eller i molnet, utan Xcode/Android Studio (kräver gratis Expo-konto):
npx eas-cli@latest build --profile development --platform android
```

### I webbläsaren

`npm run web` startar samma app i webbläsaren. Data sparas då okrypterat i webbläsaren. Det är bara till för att se gränssnittet.

### Testlista för steg 1

1. Tryck *Lägg in krisplan*, sedan *Fyll i ett exempel* eller klistra in din egen plan, och *Sortera raderna*.
2. Kontrollera kategorin på varje rad, godkänn raderna och spara. Inget sparas utan godkännande.
3. Öppna *Min krisplan*. Ändra, flytta och ta bort rader. Ställ in normalläge och sömngräns.
4. Gör *Kvällens avstämning*. Skriv till exempel *Sov fyra timmar. Orkade inte svara på sms.* Det ska ge gult, med tecknet citerat och sömnen markerad som skattad.
5. Tryck *Orkar bara trycka* på startsidan. Dagen loggas som gul och planens första gula steg visas.
6. Under *Inställningar*: slå på påminnelsen, prova applåset, lägg till namn i rensningslistan, exportera med lösenord, radera allt och återställ från exporten.
7. Säg till om något i krisplansimporten blev fel, till exempel en rubrik som inte känns igen.

### Automatiska tester

```bash
npm test          # 69 tester: ampel, rensning, promptladdare, adapter, lagring, backup
npm run typecheck
```

Specens fyra obligatoriska testfall ligger i `prompts/testfall.md` och körs både med ordmatchning och genom hela LLM-vägen med en fejkad modell.

## Avvikelser och antaganden som du behöver ta ställning till

- **Testfallet för rött går inte ihop med reglerna.** Fyra timmars sömn, 180 ord per minut och inlägg 01:15 ger tre poäng. Specen kräver fyra poäng för rött. Jag har lagt till regeln *tre eller fler mätta tecken samma dag ger rött*, så att testfallet går igenom. Alternativet är att sänka gränsen för rött till tre poäng, vilket påverkar fler dagar. Regeln står i `src/analysis/rules.ts` och bör stämmas av med din vårdkontakt.
- **Orkar bara trycka ger gult.** Specen säger att dagen loggas som tung och att första gula steget visas. Jag har gjort det till ett tecken värt en poäng, så att nivån fortfarande räknas i koden.
- **Inlägg före 05:00 hör till kvällen innan.** Annars skulle ett inlägg 01:15 räknas som en ny dag och ge falsk tystnad.
- **Ett inlägg per kväll.** En ny avstämning samma kväll ersätter den förra, efter bekräftelse.
- **Ingen inspelning i steg 1.** Whisper kräver en utvecklingsbuild och kan inte provas i Expo Go. I steg 1 skriver man, eller använder tangentbordets diktering. Appen varnar för att dikteringen kan skicka ljud till Apple eller Google. Talhastigheten mäts därför inte ännu.
- **Fotografera krisplanen.** Textigenkänning i appen kräver en utvecklingsbuild. Till dess hänvisar appen till telefonens egen funktion: Live Text på iPhone och Google Lens på Android.
- **iCloud-backup på iOS.** Android-backup är avstängd via `allowBackup: false`. På iOS hittade jag inget sätt i Expo att utesluta databasfilen från iCloud-backup utan egen nativekod. Databasen är krypterad i en utvecklingsbuild och nyckeln följer inte med backupen, men filen kan hamna i iCloud. Det behöver en liten config plugin, som jag föreslår till utvecklingsbuilden.
- **Navigering.** Projektmallen rekommenderar Expo Router. Jag använder en enkel egen stack i stället, så att samma build fungerar i Expo Go, i en utvecklingsbuild och som webbförhandsvisning utan URL-hantering.

## Verifierat inför kod

Webbdokumentationen för Expo var blockerad i den här miljön. API:erna är därför kontrollerade mot typdefinitionerna i de installerade paketen, som är den faktiska koden.

| Punkt | Resultat | Källa |
| --- | --- | --- |
| Expo SDK | SDK 58, React Native 0.88, versioner enligt Expos egen lista | `expo/bundledNativeModules.json` |
| SQLCipher | `expo-sqlite` har config plugin-flaggan `useSQLCipher`. Kräver utvecklingsbuild. Appen kontrollerar med `PRAGMA cipher_version` om krypteringen faktiskt är på. | expo-sqlite 58.0.14 |
| Nyckel i Keychain/Keystore | `expo-secure-store` med `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, så nyckeln aldrig följer med en backup | expo-secure-store 58.0.2 |
| Whisper | `whisper.rn` 0.7.4 kräver prebuild, alltså utvecklingsbuild. Ljudfilen ska vara WAV med 16-bitars PCM. | whisper.rn README |
| Inspelning för Whisper | `expo-audio` 58 har ljudström som kan skriva WAV med `int16` och valfri samplingsfrekvens på båda plattformarna. Vanlig inspelning ger inte WAV på Android. | expo-audio 58.0.10 |
| Svensk modell | KBLab publicerar svenska Whisper-modeller i storlekarna tiny till large, i whisper.cpp-format, med kvantiserade varianter. Filstorlek och hastighet på mellanklasstelefon är **inte verifierade ännu**. | [KBLab/kb-whisper-small](https://huggingface.co/KBLab/kb-whisper-small), [KBLab/kb-whisper-base](https://huggingface.co/KBLab/kb-whisper-base) |
| Påminnelse | Lokal daglig notis med `expo-notifications` | expo-notifications 58.1.7 |

Leverantörernas API-format och priser verifieras i steg 2. Garmins fält och Personal-nivåns villkor verifieras i steg 3.

## Kostnader

Utan server finns ingen driftkostnad. Siffrorna nedan kommer från specen och är **inte verifierade ännu**. De kontrolleras mot aktuella prislistor i steg 2.

| Post | Vem betalar | Kostnad |
| --- | --- | --- |
| Utveckling och test på egen telefon | Utvecklaren | 0 kr med Expo Go eller en utvecklingsbuild |
| Apple Developer Program (TestFlight och App Store) | Utvecklaren | cirka 99 USD per år |
| Google Play-konto | Utvecklaren | cirka 25 USD en gång |
| Transkribering | Ingen | 0 kr, körs på telefonen |
| Språkmodell i molnet | Användaren, med egen nyckel | Uppskattning görs i steg 2 |
| Garmin Health API, Personal-nivån | Ingen | 0 kr enligt specen |

## Varför Expo och inte Flutter

Expo ger en kodbas för iOS och Android och kan provas direkt i Expo Go utan Xcode eller Android Studio. Whisper finns som React Native-bibliotek (`whisper.rn`), SQLCipher finns inbyggt i `expo-sqlite`, och `expo-audio` kan spela in exakt det ljudformat Whisper vill ha. Flutter hade inte gett något av det enklare.

## Struktur

```
prompts/            Promptfilerna i markdown med versionsnummer (källan, ingen prompttext i koden)
schemas/            JSON-scheman för modellens svar
scripts/            build-prompts.js buntar prompts/ och schemas/ in i appen
src/analysis/       Poäng och nivå, ordmatchning, sömn ur text, testfall
src/privacy/        Rensning av personuppgifter
src/prompts/        Promptladdare: frontmatter, # System, # User, {{variabler}}
src/adapter/        LLM-gränssnittet, schemavalidering, nytt försök, fejkad modell
src/plan/           Sortering av inklistrad krisplan
src/storage/        Krypterad SQLite på telefonen, webbvariant, repository
src/backup/         Lösenordsskyddad export (PBKDF2 och AES-256-GCM)
src/platform/       Applås, påminnelse, filer, med webbvarianter
src/services/       Kvällens avstämning och Orkar bara trycka
src/ui/             Skärmar och komponenter
tests/              Jest-tester
```

## Nästa steg

När steg 1 är godkänt börjar steg 2. Jag behöver då veta vilka leverantörer du har nycklar till. Inför steg 3 behöver jag veta om du har en Garmin Personal-nyckel. Whisper och SQLCipher kräver en utvecklingsbuild, och då behöver jag veta om du börjar med iPhone eller Android.
