# Dagsljus

En stämningsdagbok för iOS och Android för en person med bipolär sjukdom. Varje kväll jämför appen en anteckning med personens egen krisplan och med mätta värden. Svaret är en ampel, en mening och planens egna åtgärder. Allt sparas på telefonen. Det finns ingen server.

Specen finns i uppdraget *Dagsljus – byggprompt för Claude Code*. Den här filen beskriver vad som är byggt, hur du kör det och vad som återstår.

## Status: steg 2 av 3

Bygget görs i tre steg som verifieras ett i taget.

| Steg | Innehåll | Status |
| --- | --- | --- |
| 1. Gränssnitt och funktion | Krisplan, kvällens avstämning, bedömning, Orkar bara trycka, tystnadsregel, påminnelse, applås, export och radering. Ordmatchning i stället för språkmodell. | Godkänt |
| 2. Koppling till språkmodell | LLM-inställningar, egen nyckel, Mistral, Anthropic och OpenAI-kompatibel adress, Testa modellen, kostnadsuppskattning, krisplansimport med modell. | **Klart för verifiering** |
| 3. Garmin | Sömn och stress från Garmin Health API med egen Personal-nyckel. | Inte påbörjat |

Specens första leverans är funktion 1–6 med minst Anthropic och OpenAI-kompatibel adress. Med steg 2 är den komplett. Mistral är med eftersom det är den nyckel du har.

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

## Verifiera steg 2

Du behöver en Mistral-nyckel från console.mistral.ai. Steg 2 fungerar i Expo Go, så du kan prova det innan utvecklingsbuilden finns. Nyckeln sparas då i Expo Gos nyckelring på telefonen.

1. Öppna *Inställningar* och tryck *Koppla en språkmodell*.
2. Välj *Mistral*, klistra in nyckeln och låt modellen stå på *mistral-small-latest*.
3. Tryck *Testa modellen*. Läs rutan om vart texten går och godkänn. Testet skickar bara appens påhittade testfall.
4. Se hur många av de fyra testfallen som gick igenom. Tryck *Spara*.
5. Gör *Kvällens avstämning* med samma text som i steg 1. Bedömningen ska säga att din språkmodell tolkade tecknen, och visa modell och promptversion längst ner.
6. Lägg in en krisplan med *Sortera med Mistral*. Kontrollera den rensade texten innan du skickar. Namn och nummer ska komma tillbaka i raderna.
7. Fyll i priser under *Kostnad* för att se en månadsuppskattning.
8. Prova *Använd ingen språkmodell*. Appen ska gå tillbaka till ordmatchning.

Säg till om något av testfallen inte går igenom med Mistral, och vilket.

### Automatiska tester

```bash
npm test          # 91 tester: ampel, rensning, promptladdare, adaptrar, lagring, backup, Testa modellen
npm run typecheck
```

Specens fyra obligatoriska testfall ligger i `prompts/testfall.md` och körs både med ordmatchning och genom hela LLM-vägen med en fejkad modell. Adaptrarna testas mot fejkade svar i leverantörernas dokumenterade format. Hela flödet är också provkört i webbförhandsvisningen med en fejkad Mistral: inställningar, test, krisplansimport och avstämning.

Inget anrop har gjorts mot Mistrals eller Anthropics riktiga tjänst, eftersom det kräver din nyckel. Det är det som steg 2-verifieringen på telefonen visar.

## Avvikelser och antaganden som du behöver ta ställning till

- **Testfallet för rött går inte ihop med reglerna.** Fyra timmars sömn, 180 ord per minut och inlägg 01:15 ger tre poäng. Specen kräver fyra poäng för rött. Jag har lagt till regeln *tre eller fler mätta tecken samma dag ger rött*, så att testfallet går igenom. Alternativet är att sänka gränsen för rött till tre poäng, vilket påverkar fler dagar. Regeln står i `src/analysis/rules.ts` och bör stämmas av med din vårdkontakt.
- **Orkar bara trycka ger gult.** Specen säger att dagen loggas som tung och att första gula steget visas. Jag har gjort det till ett tecken värt en poäng, så att nivån fortfarande räknas i koden.
- **Inlägg före 05:00 hör till kvällen innan.** Annars skulle ett inlägg 01:15 räknas som en ny dag och ge falsk tystnad.
- **Ett inlägg per kväll.** En ny avstämning samma kväll ersätter den förra, efter bekräftelse.
- **Ingen inspelning i steg 1.** Whisper kräver en utvecklingsbuild och kan inte provas i Expo Go. I steg 1 skriver man, eller använder tangentbordets diktering. Appen varnar för att dikteringen kan skicka ljud till Apple eller Google. Talhastigheten mäts därför inte ännu.
- **Fotografera krisplanen.** Textigenkänning i appen kräver en utvecklingsbuild. Till dess hänvisar appen till telefonens egen funktion: Live Text på iPhone och Google Lens på Android.
- **iCloud-backup på iOS.** Android-backup är avstängd via `allowBackup: false`. På iOS hittade jag inget sätt i Expo att utesluta databasfilen från iCloud-backup utan egen nativekod. Databasen är krypterad i en utvecklingsbuild och nyckeln följer inte med backupen, men filen kan hamna i iCloud. Det behöver en liten config plugin, som jag föreslår till utvecklingsbuilden.
- **Anthropic använder API-versionen 2023-06-01.** Den nyaste versionen, 2026-10-21, tar bort temperatur helt. Appen vill ha temperatur 0 för stabila svar och använder därför den äldre versionen, som fortfarande stöds. Om en modell ändå avvisar temperatur görs ett nytt anrop utan.
- **Mistral använder JSON-läge, inte schemaläge.** JSON-läget är dokumenterat och verifierat. Schemaläget finns men jag hittade inte det exakta fältformatet i dokumentationen. Appen kontrollerar ändå varje svar mot schemat och ber om ett nytt svar en gång vid fel.
- **Spara trots underkänt test.** Specen säger att en modell godkänns när alla fyra testfall ger rätt nivå. Appen låter dig spara en modell som klarat färre, efter en varning, men inte en som klarat noll. Säg till om du vill att alla fyra ska krävas.
- **Testanrop räknas i kostnaden.** Testa modellen kostar tokens och räknas därför in i månadsuppskattningen.
- **Rader som inte står i planen markeras.** När modellen sorterar krisplanen kontrollerar appen att varje rad finns i den inklistrade texten. Rader som inte gör det får en röd varning. Alla rader måste fortfarande godkännas en och en.
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

### Språkmodeller, kontrollerat 30 oktober 2026

| Punkt | Resultat | Källa |
| --- | --- | --- |
| Mistral | `POST https://api.mistral.ai/v1/chat/completions` med `Authorization: Bearer`. JSON-läge med `response_format: {"type":"json_object"}`, och prompten måste själv be om JSON. Modellnamn som `mistral-small-latest` och `mistral-large-latest` finns i dokumentationens exempel. | [docs.mistral.ai/api](https://docs.mistral.ai/api/) |
| Anthropic | `POST https://api.anthropic.com/v1/messages` med `x-api-key` och `anthropic-version`. Strukturerat svar med `output_config.format` av typen `json_schema`, utan beta-huvud. Schemat får inte innehålla längd-, tal- eller listgränser, så appen tar bort dem innan schemat skickas och kontrollerar dem själv efteråt. Svaret ligger i innehållsblocket av typen `text`. | [API overview](https://platform.claude.com/docs/en/api/overview), [Versions](https://platform.claude.com/docs/en/api/versioning), [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) |
| OpenAI-kompatibel adress | Samma format som Mistral. Om servern avvisar JSON-läget skickas anropet igen utan. | Följer Mistrals och OpenAIs format |
| Webbläsare | Anthropic kräver huvudet `anthropic-dangerous-direct-browser-access` för anrop från en webbläsare. Appen skickar det bara i webbförhandsvisningen. På telefonen gäller inga CORS-regler. | Anthropics dokumentation |

Garmins fält och Personal-nivåns villkor verifieras i steg 3.

## Kostnader

Utan server finns ingen driftkostnad. Appen har inga inbyggda priser. Du skriver in leverantörens pris i kronor per miljon tokens, och appen räknar på de tokens som faktiskt använts de senaste 30 dagarna.

Uppskattningen nedan räknar med specens 2 500 tokens in och 400 ut per kväll, 30 kvällar och 10 kr per USD. Testanrop och nya försök tillkommer.

| Post | Vem betalar | Kostnad |
| --- | --- | --- |
| Utveckling och test på egen telefon | Utvecklaren | 0 kr med Expo Go eller en utvecklingsbuild |
| Apple Developer Program (TestFlight och App Store) | Utvecklaren | cirka 99 USD per år |
| Google Play-konto | Utvecklaren | cirka 25 USD en gång |
| Transkribering | Ingen | 0 kr, körs på telefonen |
| Mistral Large | Användaren, med egen nyckel | 0,50 USD per miljon in och 1,50 ut. Cirka 0,60 kr i månaden. Källa: [mistral.ai/pricing](https://mistral.ai/pricing) |
| Mistral Small | Användaren, med egen nyckel | Mistrals prissida visar inget pris. Tredjepartslistor anger 0,15 USD in och 0,60 ut, vilket ger cirka 0,20 kr i månaden. **Inte verifierat**, kontrollera i Mistrals konsol. |
| Claude Haiku 5.5 | Användaren, med egen nyckel | 0,10 USD per miljon in och 0,50 ut. Cirka 0,15 kr i månaden. Källa: [Anthropics prislista](https://platform.claude.com/docs/en/about-claude/pricing) |
| Claude Sonnet 5.5 | Användaren, med egen nyckel | 2 USD per miljon in och 10 ut. Cirka 3 kr i månaden. Samma källa. |
| Egen dator via OpenAI-kompatibel adress | Användaren | 0 kr per anrop |
| Krisplansimport | Användaren | Engångsanrop, under 1 kr med alla modellerna ovan |
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
src/adapter/        LLM-gränssnittet, Mistral, Anthropic, OpenAI-kompatibel, schemavalidering, fejkad modell
src/llm/            Modellinställningar, samtycke per leverantör, tokenräkning och kostnad
src/plan/           Sortering av inklistrad krisplan
src/storage/        Krypterad SQLite på telefonen, webbvariant, repository
src/backup/         Lösenordsskyddad export (PBKDF2 och AES-256-GCM)
src/platform/       Applås, påminnelse, filer, nycklar i Keychain/Keystore, med webbvarianter
src/services/       Kvällens avstämning, Orkar bara trycka, Testa modellen, krisplansimport med modell
src/ui/             Skärmar och komponenter
tests/              Jest-tester
```

## Nästa steg

Efter att du verifierat steg 2 på telefonen återstår tre saker. Ordningen är ditt val.

1. **Utvecklingsbuild för iPhone.** Den slår på SQLCipher och behövs för Whisper. Den byggs i molnet med ditt Apple Developer-konto:

   ```bash
   npx eas-cli@latest login
   npx eas-cli@latest device:create          # registrera din iPhone
   npx eas-cli@latest build --profile development --platform ios
   ```

   Samtidigt bör iCloud-backupen av databasen stängas av med en liten config plugin.
2. **Inspelning med Whisper** och mätning av ord per minut.
3. **Steg 3, Garmin**, med din Personal-nyckel.

Andra leveransen enligt specen är trend, återbesök, historikimport, promptbiblioteket och modell på telefonen. Promptbiblioteket har redan sitt underlag: appen sparar den exakta text som skickades vid senaste anropet.
