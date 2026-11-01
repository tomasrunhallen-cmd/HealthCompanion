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

- **Data sparas i ditt eget Firebase-projekt** hos Google, bakom din inloggning, och inte bara på telefonen. Den krypteras i webbläsaren innan den sparas, med en nyckel från ett lösenord som bara du känner till. Se *Krypteringen i webbversionen* nedan.
- **Två små funktioner körs på din Netlify.** Den ena skickar Garmin-anropen vidare, eftersom Garmin inte tar emot anrop från webbläsare. Den andra skapar kalenderhändelsen för påminnelsen. Ingen av dem sparar något.
- **Nycklarna till Mistral och Garmin sparas okrypterade** i webbläsaren.
- **Applåset är en sifferkod**, inte Face ID. **Påminnelsen är en återkommande händelse i telefonens kalender**, eftersom en webbapp inte kan schemalägga notiser.

Mistral och Anthropic anropas direkt från webbläsaren. Ingen text passerar Netlify.

### Ställ in Firebase (från telefonen, som för Veckopeng)

1. Gå till console.firebase.google.com och lägg till ett nytt projekt, till exempel `dagsljus`. Stäng av Google Analytics.
2. **Firestore Database:** skapa en databas i produktionsläge, i en region i EU, till exempel `europe-west1` (Belgien) eller `eur3` (flera regioner i EU). Regionen går inte att ändra efteråt.
3. **Authentication:** starta, slå på **Email/Password** under Sign-in method och lägg upp ditt konto under **Users** med *Add user*.
4. **Firestore, fliken Rules:** ersätt allt med innehållet i `firestore.rules` i repot och publicera.
5. **Project settings, Your apps:** lägg till en webbapp med ikonen `</>`. Kopiera blocket `firebaseConfig` och skicka det till mig, eller klistra in det i `src/cloud/projectConfig.ts`. Blocket är ingen hemlighet. Det pekar bara ut projektet, och reglerna skyddar datan.

### Krypteringen i webbversionen

- **Allt krypteras i webbläsaren innan det sparas i Firebase:** anteckningar, krisplan, kontextbank, bedömningar och inställningar. AES-256-GCM med en nyckel som härleds ur ett lösenord med PBKDF2-SHA256 och 600 000 iterationer, via webbläsarens Web Crypto. Koden ligger i `src/cloud/vault.ts`.
- **Lösenordet lämnar aldrig webbläsaren och sparas ingenstans.** Det är ett annat lösenord än inloggningen. Appen frågar efter det varje gång den öppnas. **Glömmer du det går datan inte att läsa**, och appen säger det tydligt när lösenordet skapas.
- **Dokumentens id är en HMAC** av postens id, så varken typ av post eller datum syns i Firebase. Det enda som inte är krypterat är dokumentet `_vault`, med salt och ett kontrollvärde som visar om lösenordet är rätt.
- **Befintlig data krypteras första gången** du loggar in efter uppdateringen. Appen provkör först på en kopia i webbläsaren och visar resultatet. Sedan skrivs krypterade kopior bredvid originalen i Firebase, läses tillbaka och jämförs post för post. Först när alla stämmer tas de okrypterade bort. Stämmer något inte tas kopiorna bort och originalen lämnas orörda. Avbryts flytten görs den klart nästa gång du låser upp. Flytten är också provkörd mot Firebase-emulatorn med den riktiga Firebase-koden.
- **Regionen.** En Firestore-databas kan inte byta region efter att den skapats. Om din ligger i EU, till exempel `europe-west1` som guiden ovan föreslog, behövs ingen flytt: krypteringen sker på plats. Du ser regionen i Firebase-konsolen under Firestore Database, i listan över databaser. Ligger den utanför EU finns två vägar. Den ena är en ny databas i samma projekt, vilket kräver betalplanen Blaze. Den andra är ett nytt projekt med databasen i EU, vilket är gratis. I båda fallen flyttar appen datan krypterad, men det är inte byggt än.
- **Byte av lösenord** finns inte än.

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

1. Tryck *Lägg in krisplan*. Klistra in planen, välj den som PDF eller Word-fil, eller tryck *Fyll i ett exempel*. Tryck *Sortera raderna*.
2. Raderna står i planens ordning under planens egna rubriker. Kontrollera vad varje rad är, godkänn raderna, rubrik för rubrik om du vill, och spara. Inget sparas utan godkännande. Utkastet sparas medan du granskar.
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
6. Lägg in en krisplan. Har planen rubriker som appen inte känner igen visar appen exakt vad som skickas, rubrik för rubrik, innan du trycker *Skicka till Mistral*. Modellen svarar bara med vad varje rad är och skriver aldrig om texten.
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
npm test          # 465 tester i Jest, alla testfall på fyra plattformar, tidstester i två tidszoner och 4 för Netlify-funktionerna: ampel, testfall, promptspärr, rensning, promptladdare, adaptrar, Garmin, lagring, Firebase, backup, Testa modellen
npm run typecheck
```

Testfallen ligger i `prompts/testfall.md`, se *Testfall och modellbyte* nedan. Varje fall har ett referenssvar, och testerna skickar referenssvaren genom hela LLM-vägen och kontrollerar nivån. Adaptrarna testas mot fejkade svar i leverantörernas dokumenterade format. Hela flödet är också provkört i webbförhandsvisningen med en fejkad Mistral: inställningar, test, krisplansimport och avstämning.

Inget anrop har gjorts mot Mistrals, Anthropics eller Garmins riktiga tjänster, eftersom det kräver dina nycklar. Det är det som verifieringen på telefonen visar. Garmin-flödet är provkört i webbförhandsvisningen med fejkade svar: fel nyckel, rätt nyckel, veckovyn, avstämningen och texten till modellen.

## Design

Appen följer Apples Human Interface Guidelines. Se `DESIGN.md` för vilka avsnitt, hur, och var de krockar med specen. Kraven från App Store Review Guidelines, integritetsuppgifterna och det som återstår före inskickning står i `APPSTORE.md`. Integritetspolicyn för användare är `INTEGRITETSPOLICY.md`. Den publiceras som `https://dagsljus.netlify.app/integritet.html` vid varje webbygge.

- **Flikar:** Hem, Avstämning, Trend och Jag. Varje flik har en native stack med stor rubrik.
- **Ark:** krisplanen, förslag, rättelser och *Hjälp nu* öppnas som ark.
- **Utseende:** systemets färger, ljust och mörkt läge, och systemtypsnittet med Dynamic Type och Fet text.
- **Ampeln:** varje nivå har ord och en egen symbol (cirkel, triangel, oktagon), inte bara färg.
- **Krisrutan** nås med ett tryck från varje flik via *Hjälp nu*.
- **Ikon och startskärm:** ikonen är en soluppgång. Startskärmen är bara bakgrundsfärgen.

## Import från en annan dagbok

*Inställningar*, *Importera dagbok* läser årsrapporterna från **Bipolär dagbok** (CSV-filer, en per år, flera på en gång). Filerna läses i appen. Ingenting skickas till någon språkmodell.

1. **Granska.** Appen visar varje fil, antalet ifyllda dagar och perioden. Dagar där formuläret är tomt ("-" överallt) hoppas över. Ett datum som redan finns i Dagsljus lämnas som det är.
2. **Koppla.** Varje punkt i dagboken som förekommer, till exempel "Ångest", "Handlat Mer Än Vanligt" eller "Lågt Humör: Nedstämdhet", visas med antal dagar. En punkt ger poäng bara om du kopplar den till ett av dina tecken i krisplanen. Appen föreslår kopplingar där orden liknar varandra. Allt annat ignoreras tills du väljer.
3. **Garmin för samma period.** Om Garmin är anslutet hämtar appen sömn och stress för hela perioden, nyast först, 28 dagar i taget. Värdena sparas i ett arkiv med ett dokument per månad, skilt från de senaste 120 dagarna. Säger Garmin stopp fortsätter hämtningen där den slutade nästa gång. Har Garmin inget under tre omgångar i rad slutar appen fråga, eftersom klockan då inte användes.
4. **Räkna.** Varje dag får sin nivå med samma regler i koden som en vanlig kväll, äldsta dagen först, så att tidigare dagar räknas som historik för senare. Akutregeln körs på varje anteckning.

| I dagboken | I Dagsljus |
| --- | --- |
| Anteckningar | Dagens text. "-" blir tom |
| Högt Humör, Lågt Humör | Stämning 1–10: Balanserad 5, Glädje 7, Uppvarvning 9, de tre nivåerna av lågt humör 4, 3 och 2. Ett lågt värde går före ett högt samma dag |
| Medicin NEJ | Medicin inte tagen. Två kvällar i rad ger 1 poäng. JA sparas bara på dagen |
| Alkohol JA | Ja på *Alkohol, sjuk eller hård träning i går?* dagen efter |
| Raden "Sömn: … ca 7 h" | Sömn, om Garmin saknar natten. Värden under 3 timmar ur texten används inte |
| Övriga JA-punkter | Poäng bara via din koppling till ett tecken |
| Energi, klockslag | Finns inte i dagboken och lämnas tomma |
| Tomma dagar | Dagar utan inlägg, som i Dagsljus |

Alla ursprungliga värden sparas på den importerade dagen. En import kan tas bort i sin helhet under *Importera dagbok*, och då ligger det du skrivit i Dagsljus och de hämtade Garmin-värdena kvar. Historiken visar 60 dagar i taget, med årtal på äldre dagar.

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
| Grund | Krisplanens tecken och åtgärder, akuta formuleringar, risksituationer, livsstil och rutiner, värdeankare, kontakter, önskemål, rader till vården, kända falsklarm, medicin, önskad ton vid gult och rött | Bara användaren |
| Profil | Normalläge, typiska formuleringar, tidigare perioder (nedstämd, uppvarvad och blandad var för sig), kända förlopp | Godkända förslag, eller användaren själv |
| Dagligt | Medicin tagen, kommande händelser, rättelser. Anteckningar och mätvärden räknas fram ur avstämningarna | Användaren |

Varje post har ursprung (`standard`, `crisis_plan`, `user`, `suggested`, `correction`) och datum för när den skapades och godkändes. Vyn *Det appen vet om mig* visar allt och låter användaren ändra och radera.

- **`buildContext`** i `src/core/context/buildContext.ts` bygger promptens variabler ur banken. Rensningen körs på resultatet.
- **Standardläget** laddar `context/standard.md`. Obekräftade standardrader kan bara ge gult.
- **Akutregeln** i `src/core/context/akut.ts` matchar `context/akut.md` och användarens egna formuleringar i koden, före och oberoende av modellen. Träff utan negation ger röd dag och krisruta. Träff med negation ger en mildare krisruta utan att ändra nivån.
- **Lärandet** sker bara genom förslag: rättelser (tre likadana om samma tecken), profilgenomgång varje månad och efter en period, och förlopp räknat i koden. Inget når banken utan godkännande.
- **Baslinjer** för sömn, stress, ord per minut och klocktid räknas om varje måndag ur gröna dagar de senaste 28 dagarna.
- **Export och import** av kontexten ger tre läsbara markdownfiler, `grund.md`, `profil.md` och `dagligt.md`.

## Krisplanen som textblock (den här versionen)

Krisplanen skrivs eller klistras in som text under samma rubriker för alla. Varje rubrik är ett block, och personen skriver en sak per rad med egna ord:

1. Värdeankare – det som är viktigt för mig
2. Mitt normalläge
3. Livsstil och rutiner – varje dag
4. Risksituationer
5. Tidiga varningstecken – uppvarvning
6. Tidiga varningstecken – nedstämdhet
7. Livsstil och rutiner vid uppvarvning
8. Livsstil och rutiner vid nedstämdhet
9. Det här gör jag vid tidiga tecken
10. Det här gör mina närstående vid tidiga tecken
11. Tecken på allvarlig försämring – uppvarvning
12. Tecken på allvarlig försämring – nedstämdhet
13. Det här gör jag vid allvarlig försämring
14. Det här gör närstående och vården vid allvarlig försämring
15. Strategier för att undvika tvångsåtgärder
16. Kontakter
17. Mina önskemål
18. Till vården

Raderna som appen behöver görs i koden, en per rad i blocket. Tecken ger poäng, rutiner bockas av och stegen visas i *Hjälp nu*. Rader som står kvar ordagrant behåller sitt id, sina påminnelser och sin historik, också när en ny version av planen läses in. En plan från vården (text, PDF eller Word) delas upp efter sina egna rubriker. Personen kontrollerar blocken och väljer bara för rubriker som appen inte känner igen. Inget skickas till en modell vid importen, och planen som den lästes in sparas och går att läsa.

**Rensa.** Varje block har *Töm blocket*, som tar bort raderna under rubriken men låter rubriken stå kvar. Längst ner under *Min krisplan* finns *Rensa hela krisplanen*. Den tömmer alla block och tar bort tecken, rutiner, steg och standardinnehåll ur appen, liksom planen som den lästes in, planens egna ord för riktningarna och sömnfönstret. Dagar, bedömningar, avbockade rutiner och akuta formuleringar som personen lagt till själv finns kvar, och så gör sömngränsen. En kopia sparas på telefonen, och *Återställ den rensade planen* tar tillbaka allt utom påminnelserna för rutinerna, som behöver ställas in igen.

**Rutiner i dag** på startsidan och i avstämningen: dagens grundrutiner med en bock per rutin, under dagen eller på kvällen. Pekade de senaste tecknen åt ett håll föreslår appen att följa planens rutiner för det hållet, till exempel *Livsstil och rutiner vid uppvarvning*. De visas då under grundrutinerna tills personen slutar följa dem. Avbockningen ändrar aldrig nivån och skickas aldrig till en modell.

### Funktionerna från granskningen (fas C)

1. **Inför återbesök** (*Jag*): 14 eller 30 dagar med nivå per dag, sömn och stress, tecken som syntes per riktning, rutiner, svaren efter röda dagar, och listan *Saker jag vill ta upp*. Sparas som PDF som personen själv delar.
2. **Dagen efter rött:** nästa avstämning börjar med *I går var det rött. Gjorde du något av stegen?*, ja eller nej per steg.
3. **Visa för någon:** ampel, sömn och stress och tecken som syntes, för 7, 14 eller 30 dagar, aldrig anteckningarna. Personen väljer innehåll.
4. **Anhörigkort:** tecken som är markerade *Andra ser*, vad närstående gör, trappan och kontakterna, som PDF.
5. **Sömnnotis:** tredje natten i rad under det egna snittet eller utanför sömnfönstret ger en notis med planens sömnrutin. I webbversionen ett kort på startsidan. Inga poäng.
6. **Kontroll över signaler** (*Inställningar*): tysta timmar för appens egna notiser, förslag direkt, på måndagar eller bara inför återbesök, och ett lågt läge med bara avstämningen och *Hjälp nu*.
7. **Gröna dagar:** en rutin och hur länge den hållits, till exempel *Sömnrutinen 22:30–07:00 hållen 4 nätter i rad*. Aldrig att allt ser bra ut.
8. **Kommande händelser:** en gång i veckan frågar avstämningen om något stort är på gång. Dagen före visar startsidan planens rutin som passar.
9. **Uppdaterad plan:** *Planen har uppdaterats hos vården* läser in den nya planen och visar ändringarna rad för rad innan något sparas.
10. **Första veckan:** dag 1 bara avstämningen, från dag 3 förslag på sömnkälla, dag 7 veckobilden med vad grönt betyder.

PDF:erna görs på telefonen med `expo-print` och öppnas i delningsarket. I webbversionen öppnas utskriften, där personen väljer *Spara som PDF*. Appen skickar inget själv.

## Krisplansimporten

Vårdens krisplaner har ofta 100 rader eller fler, under rubriker som *Tidiga varningstecken*, *Tecken som brukar tyda på allvarlig försämring* och *Strategier för att undvika tvångsåtgärder*, med underrubriker som *Mani* och *Depression*. Importen bygger på planens egen struktur.

1. **Inläsning på telefonen.** Inklistrad text, PDF (texten läses med pdf.js, som laddas först när en PDF öppnas) och Word (.docx). Inskannade PDF:er utan text går inte, då hänvisar appen till telefonens textigenkänning.
2. **Sidhuvud och sidfot tas bort.** Rader som upprepas överst eller nederst på minst hälften av sidorna, sidnummer och rader med personnummer överst på en sida. De visas som *Borttaget sidhuvud* och sparas aldrig. I Word ligger sidhuvudet i en egen del av filen och läses aldrig in som plan.
3. **Rubrikträd i koden.** Varje rad vet vilka rubriker den står under. Underpunkter hör till sin punkt, löptext blir en egen rad. Rubrikens nivå kommer från #, Words rubrikformat eller teckenstorleken i PDF:en. I inklistrad text utan nivåer gissar appen nivån ur regeltabellen.
4. **Regeltabellen** `context/krisplan-rubriker.md` säger vilka fält en rubrik ger. En rad ärver fälten från alla rubriker ovanför sig. På den påhittade exempelplanen sorteras 87 av 92 rader så, utan modell.
5. **Modellen bara för okända rubriker**, en rubrik i taget, rensad (`prompts/krisplan-sortera.md`). Den svarar med `{"id","kind","polarity"}` per rad och skriver aldrig om text. Okända id, saknade rader eller ogiltiga värden ger ett nytt försök med felet bifogat. Håller inte heller det blir raderna tidiga tecken åt båda hållen, markerade *Behöver din sortering*. Rader med telefonnummer eller e-post under okända rubriker blir kontakter direkt i koden. Akuta rader skickas aldrig. Importen kan ha en egen modell under *Språkmodell*; tomt fält betyder samma modell som kvällens bedömning.
6. **Granskningen** visar raderna i planens ordning under planens rubriker, med antal per rubrik (enligt rubriken, av modellen, behöver din sortering), *Godkänn alla under den här rubriken* och rader som behöver sortering först. Byts vad en rad är ligger kortet kvar, och statusraden säger *Ändrat*. Utkastet sparas efter varje ändring.

Radernas fält: `kind` (tecken, risksituation, åtgärd, livsstil och rutin, kontakt, värdeankare, önskemål, till vården, spara inte), `polarity` (uppåt, nedåt, båda), för tecken `severity` och `observer`, för åtgärder `when`, `who` och `order`, och `source_heading`. Riktningarna visas med planens egna ord om planen har dem, annars *uppvarvad* och *nedstämd*. Äldre rader fick fälten från sin gamla kategori, åt båda hållen (schema 3).

Så används fälten. Poäng och nivå ändras inte.

- Bedömningen säger åt vilket håll dagens tecken pekar, med planens ord, och visar åtgärderna för det hållet och för båda. Pekar tecknen åt båda hållen visas allt.
- Livsstil och rutiner visas med åtgärderna vid gult.
- Värdeankarna visas ordagrant överst vid rött och efter tre gula dagar i rad.
- Trappan i *Strategier för att undvika tvångsåtgärder* visas som numrerade steg i *Hjälp nu*, under planens rubrik.
- Önskemål, rader till vården och kontakter används aldrig i bedömningen och skickas aldrig till en modell.
- Ett sömnfönster i planen, som *Sömn 22:30–07:00*, föreslås för sömnregeln efter sparandet och gäller först när du godkänner det.

### Rutiner och livsstil

Raderna under *Livsstil och rutiner* blir rutiner. Under *Jag → Rutiner* väljer du vilka du vill bocka av i kvällens avstämning och vilka du vill bli påmind om. Rutiner som gäller båda hållen bockas av från början. De som bara gäller vid tecken åt ett håll väljer du själv. Påminnelsens tid föreslås ur planens ord: *klockan 21* ger 21:00, och sömnfönstret *22:30–07:00* ger 22:00, en halvtimme före läggdags. På telefonen är påminnelsen en lokal notis med rutinens ord. I webbversionen är den en kalenderhändelse som bara heter *Dagsljus: din rutin*, så rutinens ord lämnar aldrig telefonen. I avstämningen svarar du *Gjort* eller *Inte i dag*. Bedömningen visar det du gjorde, och skärmen *Rutiner* visar hur ofta du gjort varje rutin de senaste 14 dagarna. Loggningen ändrar aldrig nivån och skickas aldrig till en modell.

`fixtures/krisplan-exempel.md`, `.pdf` och `.facit.json` är en påhittad plan med 92 rader, sidhuvud med påhittat namn och personnummer och fyra sidor. `node fixtures/make-krisplan-exempel.js --pdf` bygger om dem. Lägg aldrig in en verklig plan i repot. `npm run plan:check` kör importen mot riktiga modeller och jämför med facit:

```bash
DAGSLJUS_LLM_PROVIDER=mistral DAGSLJUS_LLM_KEY=... \
DAGSLJUS_IMPORT_MODELS=mistral-small-latest,mistral-large-latest npm run plan:check
```

## Arkitektur (fas B)

- **Kärnpaketet `src/core`** (`@dagsljus/core`) innehåller poäng, nivå, akutregel, rensning, krisplansimport, promptladdare och kontextbank. Det importerar inget från React Native, Expo, databasen, nätverket eller filer, och ett test kontrollerar det. Telefonen och webben använder samma kod. `npm run test:core` kör alla testfall på webb, Node, iOS och Android och kräver samma nivå på alla fyra.
- **Reglerna som data.** Alla trösklar och poäng står i `rules/rules.json`, med ett JSON-schema och ett versionsnummer. Appen startar inte med en regelfil som inte följer schemat. `rules/README.md` förklarar varje regel i klartext för en klinisk granskare, och ett test kontrollerar att varje fält finns förklarat.
- **Reproducerbara bedömningar.** Varje bedömning sparar sin indata: anteckningen som den skickades (rensad), modellens råa svar, tecknen och träffarna, mätvärdena de dagar reglerna tittar på, medicinsvaren, baslinjen, regelversionen och promptversionen. *Alla dagar → Räkna om historiken med nya regler* räknar om varje dag med de nuvarande reglerna utifrån det sparade, utan att fråga någon modell igen, och visar vilka dagar som ändras innan något sparas. Den tidigare nivån finns kvar i varje omräknad bedömning.
- **Dygnet går 04:00–04:00 i lokal tid.** Inlägg sparar klockslaget där de gjordes. Testerna körs med telefonen i Stockholm och i New York, med sommartid åt båda hållen och en resa.
- **Sömn och stress från tre källor** i ett gemensamt format: egen uppgift i avstämningen, Garmin, och Apple Hälsa eller Health Connect. Samma dag slås de ihop fält för fält i den ordningen. Bedömningen och prompten säger vilken källa som användes, och stress jämförs bara med en baslinje från samma källa. Att läsa Apple Hälsa och Health Connect kräver en utvecklingsbuild med en modul för hälsodata, som inte finns ännu.
- **Schemanummer på exporten.** Varje kontextfil har `<!-- dagsljus-schema 2 -->` under rubriken. Filer utan nummer är schema 1 och flyttas framåt när de läses. En fil från en nyare version avvisas.
- **Prestandabudget.** Bedömningen visas inom 10 sekunder. Garmin får högst 3 sekunder före bedömningen. Modellen får tiden som är kvar. Hinner den inte svara visas ordmatchningens resultat direkt, med en rad om att bedömningen fylls på, och modellens svar ersätter det när det kommer.

## Avvikelser och antaganden som du behöver ta ställning till

- **`context/krisplan-rubriker.md` är ett utkast och bör granskas av en människa med klinisk kunskap.** Tabellen bygger på hur svenska krisplaner brukar se ut. Rubriker som inte finns där går till modellen eller till din sortering.
- **Det vården gör visas inte som ditt eget steg.** Åtgärder under *Vad mottagningen gör* sparas, men räknas inte som *det första steget i din plan*. Trappans steg visas i *Hjälp nu* och inte bland åtgärderna vid rött.
- **Sömngränsen ur sömnfönstret är appens tolkning.** Fönstret minus två timmar, avrundat till halvtimmar. Planen säger inget om var gränsen går. Du godkänner den och kan ändra den under *Min krisplan*.
- **Rubriknivåer i inklistrad text gissas.** Utan # eller teckenstorlek vet appen inte vad som är underrubrik. En underrubrik som *Anhöriga* efter rader under *Vid rött* blir en egen huvudrubrik. Läs gärna in PDF:en eller Word-filen i stället för att klistra in.
- **pdf.js är inte provat på en riktig telefon.** PDF-läsningen är provad i webbversionen och i testerna med den text pdf.js ger. På iPhone och Android kör appen Hermes, och pdf.js kan behöva justeras där. Det går att se först i en utvecklingsbuild.

- **`context/akut.md` är ett utkast och måste granskas av en människa med klinisk kunskap innan release.** Ordlistan matchas i appen innan något skickas till en modell. Vid träff blir dagen röd, krisplanens steg vid rött och numren 112, 1177 och Självmordslinjen 90101 visas, och anteckningen skickas inte till modellen. Fraserna tål böjningar och ord emellan. Sju kärnord, som "självmord", "dödslängt" och "livsled", ger träff som början på ett ord oavsett vad som följer, så "självmordstankar", "självmordsförsök", "dödslängtan" och "livsleda" ger full krisruta. Också "självmordsförsök för tio år sedan" ger träff, eftersom ett falsklarm är bättre än en miss. En undantagslista tar hand om kända falska träffar: "för mig själv" ger ingen träff, och "jag skärper mig" räknas inte som "skär mig". En negation mellan orden eller strax före frasen, som i "vill inte dö" eller "tänker inte göra mig illa", ger en mild träff: en mildare krisruta med samma steg och nummer, dagen blir inte röd, och anteckningen skickas inte till modellen. Listan har 29 fraser, 7 kärnord och 5 undantag och bör prövas mot verkliga formuleringar.
- **`context/standard.md` är ett utkast och måste granskas av en människa med klinisk kunskap innan release.** Filen innehåller allmänna tidiga tecken, åtgärder och ton för den som börjar utan egen krisplan. Jag har skrivit innehållet själv. Raderna är korta, eftersom ordmatchningen kräver att alla viktiga ord i ett tecken finns i samma mening. Standardrader kan bara ge gult tills de bekräftats eller ersatts.

- **Grönt säger alltid "Inget av dina tecken syntes i dag."** Texten sätts i koden, aldrig av modellen, och appen skriver aldrig att allt ser bra ut. Har sömnen blivit kortare tre nätter i rad, eller stressen ökat tre dagar i rad, utan att passera gränsen, visas en neutral rad under ampeln, till exempel "Din sömn har blivit kortare tre nätter i rad." Den ger ingen poäng och ingen färg.
- **Ett allvarligt tecken visar planens åtgärder vid rött, också när ampeln är gul.** Ampel och poäng ändras inte. Bedömningen säger "Ett av dina allvarliga tecken syntes. Din plan säger att du då ska:" och listar stegen vid rött. *Testa modellen* kontrollerar också detta, så att en modell som tar ett allvarligt tecken för ett tidigt inte godkänns.
- **Mätta tecken räknas inte dubbelt.** Sömn under gränsen, stress över baslinjen, sen insomning och ord per minut ger tillsammans högst 2 poäng per dag. De bidrar bara till rött om samma tecken fanns även dagen innan, annars blir dagen som mest gul. Regeln *tre mätta tecken samma dag ger rött* är borttagen. Därför ger specens testfall med fyra timmars sömn, 180 ord per minut och inlägg 01:15 numera gult första dagen. Svarar man ja på *Alkohol, sjuk eller hård träning i går?* ger sömn under gränsen, stress över baslinjen och insomning efter 02:00 0 poäng den dagen, och bedömningen säger det. En festkväll med insomning 03:00, 4 timmars sömn och stress 1,6 gånger det vanliga ger alltså gult utan ja och grönt med ja. Svarar man nej på medicinfrågan två kvällar i rad ger det 1 poäng. Trösklarna och poängen står i `rules/rules.json` och förklaras i `rules/README.md`. Logiken står i `src/core/analysis/scoring.ts`. Båda bör stämmas av med din vårdkontakt.
- **Orkar bara trycka ger gult.** Specen säger att dagen loggas som tung och att första gula steget visas. Jag har gjort det till ett tecken värt en poäng, så att nivån fortfarande räknas i koden.
- **Dygnet går 04:00–04:00 i lokal tid.** Ett inlägg 00:30 hör till dagen innan. Annars skulle ett inlägg 01:15 räknas som en ny dag och ge falsk tystnad. Varje inlägg sparar klockslaget där det gjordes, så en resa över tidszoner ändrar inte gamla dagar i efterhand. Regeln om inlägg mitt i natten gäller fortfarande 00:00–05:00, så ett inlägg 04:30 hör till den nya dagen men räknas som ett nattinlägg.
- **Ett inlägg per kväll.** En ny avstämning samma kväll ersätter den förra, efter bekräftelse.
- **Ingen inspelning i steg 1.** Whisper kräver en utvecklingsbuild och kan inte provas i Expo Go. I steg 1 skriver man, eller använder tangentbordets diktering. Appen varnar för att dikteringen kan skicka ljud till Apple eller Google. Talhastigheten mäts därför inte ännu.
- **Fotografera krisplanen.** Textigenkänning i appen kräver en utvecklingsbuild. Till dess hänvisar appen till telefonens egen funktion: Live Text på iPhone och Google Lens på Android.
- **iCloud-backup på iOS.** Android-backup är avstängd via `allowBackup: false`. På iOS hittade jag inget sätt i Expo att utesluta databasfilen från iCloud-backup utan egen nativekod. Databasen är krypterad i en utvecklingsbuild och nyckeln följer inte med backupen, men filen kan hamna i iCloud. Det behöver en liten config plugin, som jag föreslår till utvecklingsbuilden.
- **Anthropic använder API-versionen 2023-06-01.** Den nyaste versionen, 2026-10-21, tar bort temperatur helt. Appen vill ha temperatur 0 för stabila svar och använder därför den äldre versionen, som fortfarande stöds. Om en modell ändå avvisar temperatur görs ett nytt anrop utan.
- **Mistral använder JSON-läge, inte schemaläge.** JSON-läget är dokumenterat och verifierat. Schemaläget finns men jag hittade inte det exakta fältformatet i dokumentationen. Appen kontrollerar ändå varje svar mot schemat och ber om ett nytt svar en gång vid fel.
- **Testa modellen kör testfallen med din egen kontext.** Dina falsklarm, din ton och dina rättelser följer med, men testplanens tecken används. Ett eget falsklarm kan därför få ett fall att skilja sig, och då visas vilket.
- **Testanrop räknas i kostnaden.** Testa modellen kostar tokens och räknas därför in i månadsuppskattningen.
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
rules/              rules.json med alla trösklar och poäng, schemat och README för en klinisk granskare
context/            Akutordlistan, standardinnehållet och regeltabellen för krisplanens rubriker
scripts/            build-prompts.js buntar prompts/, schemas/, context/ och rules/ in i appen
src/core/           @dagsljus/core, utan plattformsberoenden, samma kod på telefon och webb:
  analysis/           poäng och nivå, regler, dygnet, källor för sömn och stress, omräkning, testfall
  context/            akutregeln, kontextbanken, export med schemanummer
  privacy/            rensning av personuppgifter
  plan/               krisplansimporten, radernas fält, rutiner
  prompts/            promptladdare
  llm/                gränssnittet mot en modell, schemakontroll, fejkade modeller
src/adapter/        Mistral, Anthropic, OpenAI-kompatibel över HTTP
src/llm/            Modellinställningar, samtycke per leverantör, tokenräkning och kostnad
src/garmin/         Garmin Personal API: token, sömn, stress, Body Battery
src/cloud/          Webbversionen: inloggning och Firestore i ditt eget Firebase-projekt
netlify/functions/  Webbversionen: vidarekoppling till Garmin och kalenderhändelser för påminnelser
src/storage/        Krypterad SQLite på telefonen, webbvariant, repository
src/backup/         Lösenordsskyddad export (PBKDF2 och AES-256-GCM)
src/platform/       Applås, påminnelser, filer, hälsodata, nycklar i Keychain/Keystore, med webbvarianter
src/services/       Det som skriver till databasen: avstämningen, rättelser, standardinnehåll, sparad plan, omräkning, Garmin-synk
src/ui/             Skärmar och komponenter
tests/              Jest-tester; tests/core körs på webb, Node, iOS och Android, tests/tz i två tidszoner
```

## Nästa steg

Efter att du verifierat steg 2 och 3 på telefonen återstår två saker från första leveransen. Ordningen är ditt val.

1. **Stäng av iCloud-backup av databasen** med en liten config plugin. Det spelar störst roll när du kör utvecklingsbuilden med riktiga uppgifter.
2. **Inspelning med Whisper** och mätning av ord per minut. Det kräver utvecklingsbuilden.

Andra leveransen enligt specen är trend, återbesök, historikimport, promptbiblioteket och modell på telefonen. Promptbiblioteket har redan sitt underlag: appen sparar den exakta text som skickades vid senaste anropet. Trenden har sitt: Garmin-värden sparas för 120 dagar.
