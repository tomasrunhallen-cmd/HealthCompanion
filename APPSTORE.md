# App Store: krav och hur Dagsljus uppfyller dem

Det här dokumentet går igenom App Store Review Guidelines och Apples sida om integritetsuppgifter (App Privacy), lästa 1 november 2026 på developer.apple.com. Citaten är ordagranna.

- Designen enligt Human Interface Guidelines står i `DESIGN.md`.
- Integritetspolicyn för användare står i `INTEGRITETSPOLICY.md`.
- Tekniska detaljer om datan står i `PRIVACY.md`.

## Status före inskickning

| Krav | Status |
| --- | --- |
| Integritetspolicy med en URL | Klar som sida, men **namn och kontaktadress saknas** (se nedan) |
| Policyn lätt att nå i appen | Klar: *Jag*, *Integritetspolicy*, och *Data och integritet* |
| Integritetsuppgifter (App Privacy) | Förslag nedan, ska fyllas i i App Store Connect |
| Påminnelse om att rådgöra med läkare (1.4.1) | Klar: första start, varje bedömning, *Data och integritet* och policyn |
| Samtycke innan text går till en AI (5.1.2) | Klar sedan tidigare |
| Fungerar utan konto och utan egen nyckel (2.1) | Klar: inget konto i telefonappen, ordmatchning utan nyckel, standardläge utan egen plan |
| Hälsodata inte i iCloud (5.1.3) | **Inte klar.** Databasfilen kan hamna i iCloud-backup (se nedan) |
| Skärmbilder från simulator | Inte gjort. Webbilder finns, simulatorbilder senare |
| Exportregler för kryptering | **Öppen fråga** (se nedan) |

## Integritetspolicy (5.1.1)

> "All apps must include a link to their privacy policy in the App Store Connect metadata field and within the app in an easily accessible manner."

Policyn måste förklara vilka uppgifter som samlas in och hur, vilka tredje parter som får dem, hur länge de sparas, och hur man återkallar samtycke och raderar.

- **Källa:** `INTEGRITETSPOLICY.md`. Den har avsnitt för just detta: *Vilka uppgifter appen hanterar*, *Var uppgifterna finns*, *När något lämnar telefonen*, *Hur länge uppgifterna sparas* och *Dina val*. Ett test (`tests/policy.test.ts`) ser till att avsnitten finns kvar.
- **URL:** `https://dagsljus.netlify.app/integritet.html`. `scripts/build-policy.js` gör sidan av Markdown-filen vid varje webbygge (`npm run export:web`), och Expo kopierar `public/` till webbplatsen. Adressen står i `src/legal.ts`.
- **I appen:** *Jag*, *Integritetspolicy* öppnar sidan. *Jag*, *Data och integritet* visar vart datan tar vägen och har knappen *Läs hela integritetspolicyn*.
- **Att göra:** `[NAMN PÅ UTGIVAREN]` och `[KONTAKTADRESS]` i `INTEGRITETSPOLICY.md` ska bytas mot riktiga uppgifter. Riktlinje 2.1 säger att platshållare måste vara borta vid inskickningen. Kontrollera också att `dagsljus.netlify.app` är den riktiga adressen.

## Integritetsuppgifter i App Store Connect (App Privacy)

Apples definition:

> "Collect" refers to transmitting data off the device in a way that allows you and/or your third-party partners to access it for a period longer than what is necessary to service the transmitted request in real time.

> Data that is processed only on device is not "collected" and does not need to be disclosed in your answers.

Datatabellen i underlaget (avsnittet Integritet) och vad den betyder för svaren i telefonappen:

| Data enligt underlaget | Var | Insamlad enligt Apple? |
| --- | --- | --- |
| Krisplan, anteckningar, bedömningar, kontextbank | Telefonen, krypterad | Nej, stannar på telefonen |
| Nycklar till språkmodell och Garmin | Telefonens nyckelring | Nej |
| Kvällens text till modellen | Leverantören personen valt, med egen nyckel | **Oklart**, se nedan |
| Profilgenomgång | Samma leverantör, efter personens tryck | **Oklart**, se nedan |
| Garmin | Personens eget konto, data hämtas *till* telefonen | Nej, inget skickas ut utom nyckel och datum |
| Backup och export av kontext | Där personen själv sparar filen | Nej, personen väljer själv |

**Språkmodellen** är den enda svåra frågan. Utgivaren har ingen server och ser ingenting. Texten går med personens egen nyckel direkt till den leverantör personen valt, och leverantörer som Mistral och Anthropic kan spara den en tid för att motverka missbruk. Apples sida säger inte hur ett anrop som användaren själv styr ska räknas.

**Mitt förslag är att deklarera det försiktigt**, eftersom en för snål deklaration är en vanlig orsak till avslag:

| Datatyp | Används för | Kopplad till personen | Spårning |
| --- | --- | --- | --- |
| Health & Fitness: **Health** ("any other user provided health or medical data") | App Functionality | Nej | Nej |
| User Content: **Other User Content** ("generic free form text fields") | App Functionality | Nej | Nej |

Allt annat: inte insamlat. Ingen reklam, ingen analys, ingen spårning och ingen App Tracking Transparency.

Alternativet är *Data Not Collected*, med motiveringen att utgivaren aldrig får tillgång till något. Det kan stämma, men det är inte säkert att Apple ser det så. Fråga Apple om du vill gå den vägen.

**Webbversionen** omfattas inte av App Store och påverkar inte svaren.

## Medicinska och hälsorelaterade appar (1.4.1)

> "Medical apps that could provide inaccurate data or information, or that could be used for diagnosing or treating patients may be reviewed with greater scrutiny."
> "Apps must clearly disclose data and methodology to support accuracy claims relating to health measurements …"
> "Apps should remind users to check with a doctor in addition to using the app and before making medical decisions. If your medical app has received regulatory clearance, please submit a link to that documentation with your app."

Vad det betyder för Dagsljus:

- **Granskningen kan bli noggrannare.** Appen visar en nivå (grönt, gult, rött) som personen kan agera på, och den handlar om psykisk hälsa.
- **Metoden ska kunna redovisas.** Nivån räknas i koden med fasta regler (`src/analysis/rules.ts`, `src/analysis/scoring.ts`), och appen visar för varje bedömning vilka data den använde och vilken regel som avgjorde. Appen påstår inte att den mäter något med telefonens sensorer. Sömn och stress kommer från personens egen Garmin. I granskningsanteckningen och i beskrivningen ska appen beskrivas som en dagbok som jämför med personens egen plan, inte som ett mätinstrument.
- **Påminnelse om att rådgöra med läkare.** Texten "Appen ställer ingen diagnos och ersätter inte vården. Prata med din läkare eller vårdkontakt innan du fattar beslut om din behandling." står vid första start, längst ned i varje bedömning, under *Data och integritet* och i policyn (`src/legal.ts`).
- **Ingen diagnos.** Appen använder bara personens egna ord och inga diagnosord om de inte står i planen. Beskrivningen i App Store ska följa samma regel.
- **Krav på godkännande från myndighet.** Apple kräver det inte uttryckligen, men ber om en länk om appen har ett. Om Dagsljus är en medicinteknisk produkt enligt EU:s förordning (MDR) beror på dess avsedda ändamål. Det är fråga 8 till granskaren i underlaget. Ordval som "upptäcker", "förutser" eller "varnar för skov" kan göra appen till en medicinteknisk produkt. Ordval som "dagbok som jämför med din egen krisplan" och "visar din plans egna steg" gör det mindre sannolikt. Det här är ingen juridisk bedömning. Den behöver göras av någon som kan MDR, gärna med Läkemedelsverkets vägledning för medicinsk programvara, innan appen släpps till fler än utvecklaren.

Förslag till beskrivning (inga diagnosord, inga löften):

> Dagsljus är en stämningsdagbok för kvällen. Du skriver några meningar, och appen jämför dem med tecknen i din egen krisplan och med sömn och stress från din klocka. Du får en nivå, grönt, gult eller rött, och din plans egna steg för den nivån. Appen ställer ingen diagnos och ersätter inte vården. Allt sparas krypterat på din telefon.

**Åldersgräns.** Apples formulär har kategorin *Medical or Wellness*. "Medical or Treatment Information" definieras som "Content that provides diagnoses or guidance around the management of medical conditions …", där "Infrequent" ger 13+ och "Frequent" ger 16+. Appen visar personens egen plan och krisnummer, inte egen medicinsk rådgivning. Rimliga svar är *Health or Wellness Topics* och *Infrequent Medical or Treatment Information*, vilket ger 13+. Med tanke på ämnet kan du välja högre.

## Delning med AI hos tredje part (5.1.2)

> "You must clearly disclose where personal data will be shared with third parties, including with third-party AI, and obtain explicit permission before doing so."

Uppfyllt sedan tidigare:

- Ingen språkmodell används förrän personen själv valt leverantör och lagt in sin nyckel.
- Före första anropet visar appen vart texten går och att leverantörens villkor gäller. Samtycket sparas per leverantör och adress.
- Texten rensas på namn och nummer på telefonen först.
- Anteckningar som träffar akutregeln skickas aldrig.
- *Koppla bort* tar bort nyckeln och samtycket.

## Hälsodata och Apple Hälsa (5.1.3)

> "Apps may not use or disclose to third parties data gathered in the health, fitness, and medical research context, including from … HealthKit API … for advertising, marketing, or other use-based data mining purposes …"
> "Apps must not write false or inaccurate data into HealthKit … and may not store personal health information in iCloud."

- **Apple Hälsa används inte nu.** Om det läggs till senare:
  - Läs bara det som behövs, och säg exakt vilka typer (riktlinjen kräver "You must disclose the specific health data that you are collecting").
  - Ingen reklam eller marknadsföring.
  - Inget till språkmodellen utan samma samtycke som för anteckningen.
  - Skriv aldrig något till Apple Hälsa.
- **iCloud är inte löst.** Databasen ligger i appens katalog och kan följa med i iCloud-backupen. Filen är krypterad med SQLCipher och nyckeln ligger i nyckelringen utan att följa med, men riktlinjen säger att personlig hälsoinformation inte får lagras i iCloud. Expo SDK 58 har ingen funktion för att undanta en fil från backup (dokumentationen för `expo-file-system` och `expo-sqlite` nämner det inte). Lösningen är en liten egen Expo-modul som sätter `isExcludedFromBackup` på databasens katalog, och den kräver en utvecklingsbuild. **Det ska vara gjort före inskickningen.**

## Granskning utan konto och utan nyckel (2.1)

> "… include demo account info (and turn on your back-end service!) if your app includes a login."

> "If your app doesn't include significant account-based features, let people use it without a login." (5.1.1(v))

- **Inget konto i telefonappen.** Webbversionens Firebase-inloggning finns inte i App Store-appen.
- **Ingen nyckel krävs.** Utan språkmodell används ordmatchning på telefonen, och allt fungerar.
- **Standardläget** låter granskaren börja utan egen krisplan.
- **Applåset** är på från början och använder telefonens Face ID eller kod, alltså granskarens egen.

Förslag till granskningsanteckning (Notes for Review), på engelska:

> Dagsljus is a Swedish evening mood diary. No account and no API key are needed. On first start, tap "Börja med standard" to load general signs, then "Kvällens avstämning" (evening check-in): type a few sentences and save. The level (green, yellow, red) is computed on the device by fixed rules shown under "Så gjordes bedömningen". Connecting a language model (Settings > Språkmodell) is optional and uses the user's own key from the provider; before any text is sent, the app shows where it goes and asks for consent. "Hjälp nu" in the top bar shows Swedish crisis numbers; tapping a number opens the phone's dialer and the app never places calls itself. The app does not diagnose and reminds users to talk to their doctor. The app lock uses the device's Face ID or passcode.

## Övrigt före inskickning

- **Tillgänglighet i App Store.** Appen är på svenska och krisnumren är svenska (112, 1177, 90101). Välj bara Sverige som land, eller lägg till nummer per land först.
- **Exportregler för kryptering.** Appen använder SQLCipher (AES) för databasen och AES-256-GCM för exportfilen. App Store Connect frågar om kryptering vid varje version. Apples sida om exportregler gick inte att läsa när det här skrevs, så jag har inte satt `ios.config.usesNonExemptEncryption` i `app.json`. Svaret ska bygga på Apples aktuella text, inte på en gissning.
- **Integritetsmanifest (Privacy Manifest).** Expos moduler har egna manifest. Om Apple skickar varningar om "required reason APIs" efter första bygget i EAS, ska skälen läggas i `ios.privacyManifests` i `app.json`.
- **Skärmbilder** från en iOS-simulator eller en riktig iPhone, i de storlekar App Store Connect kräver.
- **Kontakt för granskningen** (namn, telefon, e-post) fylls i i App Store Connect, inte i appen.

## Källor

- App Store Review Guidelines: developer.apple.com/app-store/review/guidelines (1.4.1, 2.1, 5.1.1, 5.1.2, 5.1.3)
- App Privacy Details: developer.apple.com/app-store/app-privacy-details
- Age ratings: developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions
- Expo: docs.expo.dev/versions/v58.0.0/config/app (`ios.config.usesNonExemptEncryption`, `ios.privacyManifests`), docs.expo.dev/guides/publishing-websites (`public/`)
