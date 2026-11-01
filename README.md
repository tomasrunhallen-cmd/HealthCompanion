# Dagsljus

En stämningsdagbok för iOS och Android för en person med bipolär sjukdom. Varje kväll jämför appen en anteckning med personens egen krisplan och med mätta värden. Svaret är en ampel, en mening och planens egna åtgärder. Allt sparas på telefonen. Det finns ingen server.

Specen finns i uppdraget *Dagsljus – byggprompt för Claude Code*. Den här filen beskriver vad som är byggt, hur du kör det och vad som återstår.

## Status: steg 3 av 3

Bygget görs i tre steg som verifieras ett i taget.

| Steg | Innehåll | Status |
| --- | --- | --- |
| 1. Gränssnitt och funktion | Krisplan, kvällens avstämning, bedömning, Orkar bara trycka, tystnadsregel, påminnelse, applås, export och radering. Ordmatchning i stället för språkmodell. | Godkänt |
| 2. Koppling till språkmodell | LLM-inställningar, egen nyckel, Mistral, Anthropic och OpenAI-kompatibel adress, Testa modellen, kostnadsuppskattning, krisplansimport med modell. | **Klart för verifiering** |
| 3. Garmin | Sömn, stress och Body Battery från Garmin Personal API med egen nyckel. Dagens och veckans värden följer med till språkmodellen vid bedömningen. | **Klart för verifiering** |

Det finns också en **webbversion** på Netlify med data i ditt eget Firebase-projekt. Den går att använda helt utan dator. Se *Webbversionen* nedan.

Specens första leverans är funktion 1–6 med minst Anthropic och OpenAI-kompatibel adress. Med steg 2 är den komplett. Mistral är med eftersom det är den nyckel du har.

## Verifiera steg 1

### På iPhone: utvecklingsbuild (rekommenderas)

Expo Go i App Store stöder bara SDK 54, och Dagsljus använder SDK 58. På iPhone behövs därför antingen en utvecklingsbuild eller en egen Expo Go via TestFlight. Båda kräver Apple Developer-kontot. Utvecklingsbuilden slår dessutom på krypteringen av databasen, så då kan du använda din riktiga krisplan.

Kör på din egen dator med Node.js 22. Bygget görs i Expos moln, så ingen Xcode behövs.

```bash
git clone https://github.com/tomasrunhallen-cmd/healthcompanion.git
cd healthcompanion
git checkout claude/mood-health-pwa-zLJP3
npm install
npx eas-cli@latest login          # gratis Expo-konto
npx eas-cli@latest device:create  # välj "Website" och öppna länken på iPhonen
npx eas-cli@latest build --profile development --platform ios
```

1. Installera profilen från länken under Inställningar på iPhonen.
2. Slå på Utvecklarläge under Inställningar, Integritet och säkerhet.
3. Installera appen via länken eller QR-koden när bygget är klart.
4. Kör `npm start` och öppna Dagsljus. Telefon och dator ska vara på samma wifi. Annars fungerar `npx expo start --tunnel`.

Har Apple-medlemskapet nyligen startats eller förnyats kan Apple behöva 24 till 72 timmar innan en ny telefon kan ingå i ett bygge.

### På iPhone: Expo Go via TestFlight

```bash
npx eas-cli@latest go       # bygger Expo Go för SDK 58 och lägger den i TestFlight
npx expo login              # samma Expo-konto som i Expo Go på telefonen
npx expo start --go         # --go behövs eftersom projektet har utvecklingsklienten
```

Installera Expo Go från TestFlight och logga in i appen med samma Expo-konto. I Expo Go är databasen **okrypterad**, eftersom SQLCipher kräver en utvecklingsbuild. Skärmen *Data och integritet* visar det. Använd därför testdata där.

### Android

Hämta Expo Go för SDK 58 från [expo.dev/go](https://expo.dev/go) och kör `npx expo start --go`, eller bygg en utvecklingsbuild med `npx eas-cli@latest build --profile development --platform android`.

## Webbversionen (Netlify och Firebase)

Webbversionen är samma app i webbläsaren. Allt fungerar där utom inspelning, som inte är byggd än. Den avviker från specen på fyra sätt. Du har valt det medvetet:

- **Data sparas i ditt eget Firebase-projekt** hos Google, bakom din inloggning, och inte bara på telefonen. Den är inte krypterad med en nyckel som bara du har.
- **Två små funktioner körs på din Netlify.** Den ena skickar Garmin-anropen vidare, eftersom Garmin inte tar emot anrop från webbläsare. Den andra skapar kalenderhändelsen för påminnelsen. Ingen av dem sparar något.
- **Nycklarna till Mistral och Garmin sparas okrypterade** i webbläsaren.
- **Applåset är en sifferkod**, inte Face ID. **Påminnelsen är en återkommande händelse i telefonens kalender**, eftersom en webbapp inte kan schemalägga notiser.

Mistral och Anthropic anropas direkt från webbläsaren. Ingen text passerar Netlify.

### Ställ in Firebase (från telefonen, som för Veckopeng)

1. Gå till console.firebase.google.com och lägg till ett nytt projekt, till exempel `dagsljus`. Stäng av Google Analytics.
2. **Firestore Database:** skapa en databas i produktionsläge, i samma region som Veckopeng (`europe-west1`).
3. **Authentication:** starta, slå på **Email/Password** under Sign-in method och lägg upp ditt konto under **Users** med *Add user*.
4. **Firestore, fliken Rules:** ersätt allt med innehållet i `firestore.rules` i repot och publicera.
5. **Project settings, Your apps:** lägg till en webbapp med ikonen `</>`. Kopiera blocket `firebaseConfig` och skicka det till mig, eller klistra in det i `src/cloud/projectConfig.ts`. Blocket är ingen hemlighet. Det pekar bara ut projektet, och reglerna skyddar datan.

### Ställ in Netlify

Lägg till ett nytt projekt från GitHub, välj repot och branchen `claude/mood-health-pwa-zLJP3`. Allt annat står i `netlify.toml`. Netlify bygger om av sig själv när konfigurationen hamnar i repot.

### Första gången

1. Öppna webbplatsen i Safari och logga in med kontot från steg 3.
2. Lägg till sidan på hemskärmen med Dela-knappen. Logga in en gång till där, eftersom hemskärmsappen har egen lagring.
3. I appen: välj en kod under *Applås*, tryck *Lägg till i kalendern* under *Påminnelse*, koppla Mistral och anslut Garmin.

Appen kan inte skapa konton själv. Vill du vara säker på att ingen annan kan registrera sig i projektet kan du dessutom stänga av nya användare under Authentication och Settings.

Utan Firebase-konfiguration fungerar webbversionen också, men då sparas allt bara i webbläsaren och kan försvinna om Safari rensar webbplatsdata. Data som sparats så flyttas automatiskt till Firebase första gången du loggar in, om Firebase är tomt.

`npm run web` på en dator startar samma app lokalt. Där når appen inte Garmin, eftersom funktionen på Netlify saknas.

## Testlista för steg 1

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
4. Se hur många av de 23 testfallen som gav rätt nivå. *Spara* går bara att trycka när alla gjorde det. Annars står fallen som skilde sig först i listan.
5. Gör *Kvällens avstämning* med samma text som i steg 1. Bedömningen ska säga att din språkmodell tolkade tecknen, och visa modell och promptversion längst ner.
6. Lägg in en krisplan med *Sortera med Mistral*. Kontrollera den rensade texten innan du skickar. Namn och nummer ska komma tillbaka i raderna.
7. Fyll i priser under *Kostnad* för att se en månadsuppskattning.
8. Prova *Använd ingen språkmodell*. Appen ska gå tillbaka till ordmatchning.

Säg till om något av testfallen inte går igenom med Mistral, och vilket.

## Verifiera steg 3

Du behöver en Personal API-nyckel från Garmin Connect på webben, under Inställningar och Personal API Key. Garmin visar nyckeln bara en gång.

1. Öppna *Inställningar* och tryck *Anslut Garmin*. Klistra in nyckeln och tryck *Anslut*.
2. Appen hämtar de senaste två veckorna. Kontrollera under *Senaste veckan* att sömn, insomningstid och stress stämmer med Garmin Connect.
3. Gör *Kvällens avstämning*. Rutan *Från Garmin* ska visa nattens sömn och dagens stress.
4. Efter att du sparat ska bedömningen visa sömnen märkt *(Garmin)* och dagens stress.
5. Med språkmodell kopplad finns texten som skickades kvar på telefonen. Den innehåller avsnittet *Mätvärden* med dagens värden och veckan dag för dag.
6. Prova en felaktig nyckel. Appen ska säga att Garmin inte godtog den, och inget ska sparas.

Säg till om något värde saknas eller ser fel ut jämfört med Garmin Connect. Fältnamnen i Garmins svar är inte officiellt dokumenterade, så det är det viktigaste att kontrollera. I webbversionen går Garmin via funktionen på Netlify. Med `npm run web` lokalt når appen inte Garmin.

### Automatiska tester

```bash
npm test          # 246 tester i Jest och 3 för Netlify-funktionerna: ampel, testfall, promptspärr, rensning, promptladdare, adaptrar, Garmin, lagring, Firebase, backup, Testa modellen
npm run typecheck
```

Testfallen ligger i `prompts/testfall.md`, se *Testfall och modellbyte* nedan. Varje fall har ett referenssvar, och testerna skickar referenssvaren genom hela LLM-vägen och kontrollerar nivån. Adaptrarna testas mot fejkade svar i leverantörernas dokumenterade format. Hela flödet är också provkört i webbförhandsvisningen med en fejkad Mistral: inställningar, test, krisplansimport och avstämning.

Inget anrop har gjorts mot Mistrals, Anthropics eller Garmins riktiga tjänster, eftersom det kräver dina nycklar. Det är det som verifieringen på telefonen visar. Garmin-flödet är provkört i webbförhandsvisningen med fejkade svar: fel nyckel, rätt nyckel, veckovyn, avstämningen och texten till modellen.

## Testfall och modellbyte

`prompts/testfall.md` har 23 fall. Varje fall har en anteckning, mätvärden, en historik, den nivå appen ska ge och ett **referenssvar**: vilka av planens tecken en noggrann modell ska hitta, med ett ordagrant citat. Fallen täcker:

| Fall | Nivå |
| --- | --- |
| Lugn dag | grönt |
| Ett tidigt tecken | gult |
| Ett tecken med andra ord än i planen | gult |
| "Jag har inte slutat svara på sms" | grönt |
| Känt falsklarm (storhandla inför fest) | grönt |
| Ett allvarligt tecken ensamt | gult, med planens åtgärder vid rött |
| Allvarligt tecken och ett tidigt tecken | rött |
| Precis under gult: 5 h sömn, 150 ord per minut, stress 39 mot 30 | grönt |
| Precis på gult: samma dag med 4,9 h sömn | gult |
| Fyra timmars sömn, 180 ord per minut, inlägg 01:15 | gult |
| Festkväll med alkohol: insomning 03:00, 4 h sömn, stress 48 mot 30 (1,6 gånger det vanliga) | gult |
| Samma festkväll med ja på *Alkohol, sjuk eller hård träning i går?* | grönt |
| En kort natt och två tidiga tecken | gult |
| Samma dag efter två korta nätter i rad | rött |
| Sömn 6,5, 6,0 och 5,5 h tre nätter i rad | grönt, med raden om kortare sömn |
| Medicin inte tagen två kvällar i rad | gult |
| Medicin inte tagen en kväll | grönt |
| Två tysta dagar efter en grön vecka | gult |
| Två tidiga tecken efter tre gula dagar | rött |
| Standardläget med fyra tecken och kort sömn | gult, aldrig rött |
| "Jag vill inte leva längre" (akutregeln, når inte modellen) | rött |
| "Jag vill inte dö" (mild akutträff, når inte modellen) | grönt |
| "Självmordsförsök för tio år sedan" (kärnord, når inte modellen) | rött |

- **Testa modellen godkänner en ny modell bara om alla fall ger samma nivå som referenssvaren.** Fallen som skilde sig visas först, med nivån modellen gav och nivån som väntades. Akutfallen avgörs i koden precis som i avstämningen och skickas aldrig till modellen. En modell du redan sparat fortsätter att användas tills du sparar en ny.
- **En ändrad analysprompt måste klara alla fall innan den checkas in.** Godkännandet står i `prompts/godkand.json` med ett fingeravtryck av `prompts/analys.md` och `schemas/analys.json`. Testet `tests/prompt-gate.test.ts` i `npm test` stoppar så fort prompten eller schemat ändrats utan nytt godkännande. Ett nytt godkännande får man bara genom att köra alla fall mot en riktig modell:

  ```bash
  DAGSLJUS_LLM_PROVIDER=mistral DAGSLJUS_LLM_MODEL=mistral-small-latest DAGSLJUS_LLM_KEY=... npm run prompt:check
  ```

  Nyckeln läggs i miljön, aldrig i en fil i repot. Skriptet skriver om `prompts/godkand.json` bara om alla fall gick igenom, och listar annars fallen som skilde sig.
- **Prompten 1.2.0 står som utgångsläge, inte som godkänd.** Den är oförändrad i den här ändringen och har inte körts mot de 23 fallen med en riktig modell i repot. Kör *Testa modellen* med Mistral i appen för att se hur den klarar dem.

## Kontextbanken: det appen vet om dig

All kunskap om användaren ligger i en egen kontextbank, skild från promptarna och från modellen. Inget lärs in i modellen, och ett modellbyte ändrar ingenting i banken.

| Lager | Innehåll | Ändras av |
| --- | --- | --- |
| Grund | Krisplanens tecken och åtgärder, akuta formuleringar, utlösare, kända falsklarm, medicin, önskad ton vid gult och rött | Bara användaren |
| Profil | Normalläge, typiska formuleringar, tidigare perioder (nedstämd, uppvarvad och blandad var för sig), kända förlopp | Godkända förslag, eller användaren själv |
| Dagligt | Medicin tagen, kommande händelser, rättelser. Anteckningar och mätvärden räknas fram ur avstämningarna | Användaren |

Varje post har ursprung (`standard`, `crisis_plan`, `user`, `suggested`, `correction`) och datum för när den skapades och godkändes. Vyn *Det appen vet om mig* visar allt och låter användaren ändra och radera.

- **`buildContext`** i `src/context/buildContext.ts` bygger promptens variabler ur banken. Rensningen körs på resultatet.
- **Standardläget** laddar `context/standard.md`. Obekräftade standardrader kan bara ge gult.
- **Akutregeln** i `src/context/akut.ts` matchar `context/akut.md` och användarens egna formuleringar i koden, före och oberoende av modellen. Träff utan negation ger röd dag och krisruta. Träff med negation ger en mildare krisruta utan att ändra nivån.
- **Lärandet** sker bara genom förslag: rättelser (tre likadana om samma tecken), profilgenomgång varje månad och efter en period, och förlopp räknat i koden. Inget når banken utan godkännande.
- **Baslinjer** för sömn, stress, ord per minut och klocktid räknas om varje måndag ur gröna dagar de senaste 28 dagarna.
- **Export och import** av kontexten ger tre läsbara markdownfiler, `grund.md`, `profil.md` och `dagligt.md`.

## Avvikelser och antaganden som du behöver ta ställning till

- **`context/akut.md` är ett utkast och måste granskas av en människa med klinisk kunskap innan release.** Ordlistan matchas i appen innan något skickas till en modell. Vid träff blir dagen röd, krisplanens steg vid rött och numren 112, 1177 och Självmordslinjen 90101 visas, och anteckningen skickas inte till modellen. Fraserna tål böjningar och ord emellan. Sju kärnord, som "självmord", "dödslängt" och "livsled", ger träff som början på ett ord oavsett vad som följer, så "självmordstankar", "självmordsförsök", "dödslängtan" och "livsleda" ger full krisruta. Också "självmordsförsök för tio år sedan" ger träff, eftersom ett falsklarm är bättre än en miss. En undantagslista tar hand om kända falska träffar: "för mig själv" ger ingen träff, och "jag skärper mig" räknas inte som "skär mig". En negation mellan orden eller strax före frasen, som i "vill inte dö" eller "tänker inte göra mig illa", ger en mild träff: en mildare krisruta med samma steg och nummer, dagen blir inte röd, och anteckningen skickas inte till modellen. Listan har 29 fraser, 7 kärnord och 5 undantag och bör prövas mot verkliga formuleringar.
- **`context/standard.md` är ett utkast och måste granskas av en människa med klinisk kunskap innan release.** Filen innehåller allmänna tidiga tecken, åtgärder och ton för den som börjar utan egen krisplan. Jag har skrivit innehållet själv. Raderna är korta, eftersom ordmatchningen kräver att alla viktiga ord i ett tecken finns i samma mening. Standardrader kan bara ge gult tills de bekräftats eller ersatts.

- **Grönt säger alltid "Inget av dina tecken syntes i dag."** Texten sätts i koden, aldrig av modellen, och appen skriver aldrig att allt ser bra ut. Har sömnen blivit kortare tre nätter i rad, eller stressen ökat tre dagar i rad, utan att passera gränsen, visas en neutral rad under ampeln, till exempel "Din sömn har blivit kortare tre nätter i rad." Den ger ingen poäng och ingen färg.
- **Ett allvarligt tecken visar planens åtgärder vid rött, också när ampeln är gul.** Ampel och poäng ändras inte. Bedömningen säger "Ett av dina allvarliga tecken syntes. Din plan säger att du då ska:" och listar stegen vid rött. *Testa modellen* kontrollerar också detta, så att en modell som tar ett allvarligt tecken för ett tidigt inte godkänns.
- **Mätta tecken räknas inte dubbelt.** Sömn under gränsen, stress över baslinjen, sen insomning och ord per minut ger tillsammans högst 2 poäng per dag. De bidrar bara till rött om samma tecken fanns även dagen innan, annars blir dagen som mest gul. Regeln *tre mätta tecken samma dag ger rött* är borttagen. Därför ger specens testfall med fyra timmars sömn, 180 ord per minut och inlägg 01:15 numera gult första dagen. Svarar man ja på *Alkohol, sjuk eller hård träning i går?* ger sömn under gränsen, stress över baslinjen och insomning efter 02:00 0 poäng den dagen, och bedömningen säger det. En festkväll med insomning 03:00, 4 timmars sömn och stress 1,6 gånger det vanliga ger alltså gult utan ja och grönt med ja. Svarar man nej på medicinfrågan två kvällar i rad ger det 1 poäng. Reglerna står i `src/analysis/rules.ts` och `src/analysis/scoring.ts` och bör stämmas av med din vårdkontakt.
- **Orkar bara trycka ger gult.** Specen säger att dagen loggas som tung och att första gula steget visas. Jag har gjort det till ett tecken värt en poäng, så att nivån fortfarande räknas i koden.
- **Inlägg före 05:00 hör till kvällen innan.** Annars skulle ett inlägg 01:15 räknas som en ny dag och ge falsk tystnad.
- **Ett inlägg per kväll.** En ny avstämning samma kväll ersätter den förra, efter bekräftelse.
- **Ingen inspelning i steg 1.** Whisper kräver en utvecklingsbuild och kan inte provas i Expo Go. I steg 1 skriver man, eller använder tangentbordets diktering. Appen varnar för att dikteringen kan skicka ljud till Apple eller Google. Talhastigheten mäts därför inte ännu.
- **Fotografera krisplanen.** Textigenkänning i appen kräver en utvecklingsbuild. Till dess hänvisar appen till telefonens egen funktion: Live Text på iPhone och Google Lens på Android.
- **iCloud-backup på iOS.** Android-backup är avstängd via `allowBackup: false`. På iOS hittade jag inget sätt i Expo att utesluta databasfilen från iCloud-backup utan egen nativekod. Databasen är krypterad i en utvecklingsbuild och nyckeln följer inte med backupen, men filen kan hamna i iCloud. Det behöver en liten config plugin, som jag föreslår till utvecklingsbuilden.
- **Anthropic använder API-versionen 2023-06-01.** Den nyaste versionen, 2026-10-21, tar bort temperatur helt. Appen vill ha temperatur 0 för stabila svar och använder därför den äldre versionen, som fortfarande stöds. Om en modell ändå avvisar temperatur görs ett nytt anrop utan.
- **Mistral använder JSON-läge, inte schemaläge.** JSON-läget är dokumenterat och verifierat. Schemaläget finns men jag hittade inte det exakta fältformatet i dokumentationen. Appen kontrollerar ändå varje svar mot schemat och ber om ett nytt svar en gång vid fel.
- **Testa modellen kör testfallen med din egen kontext.** Dina falsklarm, din ton och dina rättelser följer med, men testplanens tecken används. Ett eget falsklarm kan därför få ett fall att skilja sig, och då visas vilket.
- **Testanrop räknas i kostnaden.** Testa modellen kostar tokens och räknas därför in i månadsuppskattningen.
- **Rader som inte står i planen markeras.** När modellen sorterar krisplanen kontrollerar appen att varje rad finns i den inklistrade texten. Rader som inte gör det får en röd varning. Alla rader måste fortfarande godkännas en och en.
- **Garmins fältnamn kommer inte från Garmin.** Garmins egna sidor och deras Python-klient anger värd, token och sökvägar. Fältnamnen i svaren, som `sleepTimeSeconds` och `overallStressLevel`, kommer från två oberoende öppna klienter för samma API. Garmin publicerar dem bara i sin Swagger-dokumentation, som jag inte kunde läsa. Appen tolkar svaren försiktigt och hoppar över fält som saknas.
- **Minuter med hög stress i stället för högsta stress.** Specen vill spara högsta stress per dag. Garmins stressendpoint ger snitt och tid i varje stressnivå, men inget maxvärde som jag kunnat bekräfta. Appen sparar därför minuter med hög stress.
- **Sen insomning ger en poäng.** Specen sa två tecken, men det räknade samma natt dubbelt. *Utan inlägg* tolkas som inget inlägg kvällen innan natten. Insomning från 12:00 räknas som dagsömn och ger inget.
- **Kort sömn två nätter i rad räknas även utan inlägg.** Gårdagens sömn tas från Garmin när det inte finns något inlägg den dagen.
- **Ingen hämtning i bakgrunden.** Specen vill hämta en gång per morgon i bakgrunden. Det kräver en ny modul och en utvecklingsbuild, och iOS bestämmer själv när det sker. Appen hämtar i stället när den öppnas, högst var trettionde minut, och alltid precis före kvällens avstämning.
- **Apple Hälsa som reserv är inte byggd.** Specen föreslår att läsa sömn från Apple Hälsa utan Garmin-nyckel. Det kräver en ny modul och en utvecklingsbuild, och Garmin skriver troligen ingen stress dit. Utan Garmin tas sömnen ur anteckningen som förut.
- **Modellen får mätvärdena som bakgrund, inte som tecken.** Prompten säger att tecken bara får matchas på det som står i anteckningen, och appen kontrollerar att citatet finns där. Om inget matchar får meningen nämna sömn eller stress som avviker från veckan. Poängen för sömn och stress räknas alltid i appen.
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

### Garmin, kontrollerat 30 oktober 2026

| Punkt | Resultat | Källa |
| --- | --- | --- |
| Nyckel | Skapas på Garmin Connect på webben, visas en gång, gäller 30, 90 eller 180 dagar eller ett år. Ingen ansökan. Garmin mejlar en vecka innan den går ut. | [Garmins FAQ för Personal API](https://developer.garmin.com/gc-developer-program/personal/personal-faq/) |
| Villkor | Personal API är för personligt bruk av den egna datan, inte för kommersiella appar med många användare. Dagsljus följer det eftersom varje användare har sin egen nyckel. | Samma FAQ |
| Token | `POST https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token` med `Authorization: ApiKey <nyckel>`. Svaret är en JWT som ren text. Den gäller högst 24 timmar och kan inte förnyas, så appen byter nyckeln mot en ny token vid behov. | [Personal API](https://developer.garmin.com/gc-developer-program/personal/personal-api), Garmins Python-klient `garmin-connect-personal-api-python` 1.0.0 |
| Sömn | `/sleep-service/sleep/dailySleepSummariesByDate?startDate=&endDate=`, högst 31 dagar. Datumet är morgonen man vaknade. | Garmins Python-klient, gränsen från tredjepartsklienter |
| Stress | `/usersummary-service/stats/stress/daily/{start}/{end}`, högst 28 dagar. Negativa värden betyder för lite data. | Samma |
| Body Battery | `/wellness-service/wellness/bodyBattery/reports/daily?startDate=&endDate=`. Appen tar första värdet efter uppvaknandet. | Samma |
| Fältnamn | `calendarDate`, `sleepTimeSeconds`, `deepSleepSeconds`, `remSleepSeconds`, `sleepStartTimestampLocal`, `sleepEndTimestampLocal`, `sleepEndTimestampGMT`, `overallStressLevel`, `highStressDuration`, `bodyBatteryValuesArray`. Tidsstämplar som slutar på *Local* är väggklockans tid kodad som UTC. **Inte bekräftat av Garmin**, se avvikelserna ovan. | [garmin-health-mcp](https://github.com/jonpojonpo/garmin-health-mcp), [garmin-personal-mcp](https://github.com/Mason-Levyy/garmin-personal-mcp) |
| Historik och gränser för antal anrop | Står inte i Garmins dokumentation. Appen hämtar två veckor vid anslutning och därefter en vecka i taget. | Garmins FAQ |
| Lansering | Personal API lanserades omkring 21 oktober 2026. Ett tidigt test rapporterade att tjänsten ännu inte var helt i drift. | [the5krunner](https://the5krunner.com/2026/10/22/garmin-personal-api/) |

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
| Garmin Personal API | Ingen | Inget pris anges av Garmin. Ingen ansökan krävs. |

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
src/garmin/         Garmin Personal API: token, sömn, stress, Body Battery
src/cloud/          Webbversionen: inloggning och Firestore i ditt eget Firebase-projekt
netlify/functions/  Webbversionen: vidarekoppling till Garmin och kalenderhändelse för påminnelsen
src/plan/           Sortering av inklistrad krisplan
src/storage/        Krypterad SQLite på telefonen, webbvariant, repository
src/backup/         Lösenordsskyddad export (PBKDF2 och AES-256-GCM)
src/platform/       Applås, påminnelse, filer, nycklar i Keychain/Keystore, med webbvarianter
src/services/       Kvällens avstämning, Orkar bara trycka, Testa modellen, krisplansimport med modell, Garmin-synk
src/ui/             Skärmar och komponenter
tests/              Jest-tester
```

## Nästa steg

Efter att du verifierat steg 2 och 3 på telefonen återstår två saker från första leveransen. Ordningen är ditt val.

1. **Stäng av iCloud-backup av databasen** med en liten config plugin. Det spelar störst roll när du kör utvecklingsbuilden med riktiga uppgifter.
2. **Inspelning med Whisper** och mätning av ord per minut. Det kräver utvecklingsbuilden.

Andra leveransen enligt specen är trend, återbesök, historikimport, promptbiblioteket och modell på telefonen. Promptbiblioteket har redan sitt underlag: appen sparar den exakta text som skickades vid senaste anropet. Trenden har sitt: Garmin-värden sparas för 120 dagar.
