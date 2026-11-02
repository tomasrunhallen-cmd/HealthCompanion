# Design enligt Apples riktlinjer

Det här dokumentet säger vilka avsnitt i Apples Human Interface Guidelines (HIG) appen följer, hur, och var riktlinjerna krockar med specen. Avsnitten lästes 1 november 2026 på developer.apple.com/design/human-interface-guidelines. Citaten nedan är ordagranna.

App Store Review Guidelines hanteras i `APPSTORE.md`.

## Avsnitt som följs

### Tab bars

> "Use a tab bar to support navigation, not to provide actions."
> "Include tab labels to help with navigation. … Use single words whenever possible."
> "Consider using SF Symbols to provide familiar, scalable tab bar icons." "Prefer filled symbols or icons for consistency with the platform."
> "Make sure the tab bar is visible when people navigate to different sections of your app."

- Fyra flikar längst ned: **Hem, Avstämning, Trend, Jag**. Etiketterna är enstaka ord, och ikonerna är SF Symbols: `house.fill`, `square.and.pencil`, `chart.line.uptrend.xyaxis` och `person.crop.circle.fill`.
- Flikfältet syns på alla skärmar i flikarna. Det döljs bara av ark.
- Ingen flik är avstängd.
- Inga badges, eftersom HIG förbehåller dem kritisk information.

Se *Krockar* om fliken Avstämning.

### Navigation bars och toolbars

> "Use a large title to help people stay oriented as they navigate and scroll."
> "Write a concise title. … keep the title under 15 characters long."
> "Use the standard Back and Close buttons. … don't use a text label that says Back or Close."

- Varje flik är en native stack (`@react-navigation/native-stack`, som bygger på UINavigationController genom `react-native-screens`).
- **Stora rubriker** på varje fliks första skärm (`headerLargeTitleEnabled`). Innehållet scrollar med `contentInsetAdjustmentBehavior="automatic"`, så rubriken krymper som i systemets appar.
- **Rubriker under 15 tecken**, till exempel *Avstämning*, *Bedömning*, *Det appen vet* och *Integritet*.
- **Systemets bakåtknapp.** Den egna knappen *‹ Tillbaka* är borttagen.
- **Ark stängs med symbolen `xmark`**, med VoiceOver-etiketten *Stäng*.

### Sheets och Modality

> "A sheet is useful for requesting specific information from people or presenting a simple task …"
> "Display only one sheet at a time from the main interface."
> "Always give people an obvious way to dismiss a modal view."

- Fyra saker öppnas som ark: **krisplanen** (med *Lägg in plan* som andra steg), **förslag**, **rättelsen** *Stämmer det?* och **Hjälp nu**.
- Arken visas som page sheet på iPhone och stängs med att svepa nedåt eller med stängknappen.
- **Ett ark i taget.** När en rättelse ger ett förslag stängs rättelsens ark innan förslagen öppnas.

### Typography

> "SF Pro is the system font in iOS." Default 17 pt, minimum 11 pt.
> "Make sure your app's layout adapts to all font sizes." "Avoid truncating text in scrollable regions …" "Reduce the number of columns when the font size increases …"
> "System fonts automatically support Dynamic Type … and respond when people turn on accessibility features, such as Bold Text."

- **Systemtypsnittet överallt**, alltså SF Pro på iOS. Inga egna typsnitt.
- **Brödtext 17 pt**, rubriker i närheten av iOS textstilar: Large Title 28, Title 3 20, Body 17, Subheadline 15 och Footnote 13 (`src/ui/theme.ts`). Inga lätta vikter.
- **Dynamic Type.** React Native skalar all text med systemets textstorlek. Ingen text har `numberOfLines` i scrollbara vyer, utom två rader i listan *Alla dagar*. Hela texten finns där en tryckning bort.
- **Färre kolumner vid stor text.** Veckoraden på Hem går över flera rader när textstorleken är stor (`fontScale > 1.4`). Rader med två texter bredvid varandra får radbrytas (`flexWrap`, `flexShrink`).
- **Fet text (Bold Text).** React Natives text med uttalad vikt blir inte fetare av sig själv. Appen läser inställningen (`AccessibilityInfo.isBoldTextEnabled`) och höjer varje textstil ett viktsteg, både vid start och när inställningen ändras.

### Color och Dark Mode

> "Use the system-provided label colors for labels." "Prefer the system background colors."
> "If you define a custom color, make sure to supply light and dark variants …"
> "At a minimum, make sure the contrast ratio between colors is no lower than 4.5:1."
> "Avoid offering an app-specific appearance setting."

- **Systemets semantiska färger på iOS** via `PlatformColor`: `label`, `secondaryLabel`, `placeholderText` och `separator`, samt bakgrunderna `systemGroupedBackground`, `secondarySystemGroupedBackground` och `tertiarySystemGroupedBackground`. De följer ljust och mörkt läge och Öka kontrast.
- **Appens egna färger** har en ljus och en mörk variant (`DynamicColorIOS`): accentfärgen och de tre nivåerna. På webben används CSS-variabler som följer `prefers-color-scheme`.
- **Ingen egen inställning för utseende.** `userInterfaceStyle` är `automatic`.
- **En accentfärg** (bärnsten) för knappar och valda element, som specen kräver.

Kontrast, uträknad med WCAG:s formel:

| Färg | Ljust: mot vitt / mot bakgrund / mot egen ton | Mörkt: mot yta / mot bakgrund / mot egen ton |
| --- | --- | --- |
| Grönt `#2B7A4B` / `#5FD38A` | 5,3 / 4,7 / 4,5 | 9,1 / 11,2 / 7,6 |
| Gult `#8A5F00` / `#F2C14E` | 5,6 / 5,1 / 5,0 | 10,1 / 12,5 / 8,6 |
| Rött `#B3261E` / `#FF8A80` | 6,5 / 5,9 / 5,3 | 7,5 / 9,2 / 6,8 |
| Accent `#9C500D` / `#F2A65A` | 5,9 / 5,3 / 4,9 | 8,4 / 10,4 / 7,1 |
| Text på accent: vit / `#1C1C1E` | 5,9 | 8,4 |
| Text på Radera-knappen: vit / `#1C1C1E` | 6,5 | 7,5 |

Alla par klarar 4,5:1 i båda lägena. HIG:s önskemål om 7:1 för små texter nås i mörkt läge men inte i ljust, där nivåfärgerna ligger mellan 4,5 och 6,5. Nivåns text är alltid stor och fet (28 pt), där kravet är 3:1.

### Accessibility och VoiceOver

> "Convey information with more than color alone. … Offer visual indicators, like distinct shapes or icons …"
> Touch targets: "44x44 pt" default, "28x28 pt" minimum.
> "Provide alternative labels for all key interface elements."
> Reduce Motion: "… reducing automatic and repetitive animations …"

- **Ampeln bygger inte bara på färg.** Varje nivå har ett ord och en egen form, som SF Symbol:

  | Nivå | Ord | Symbol |
  | --- | --- | --- |
  | Grönt | Grönt | `checkmark.circle.fill` (cirkel) |
  | Gult | Gult | `exclamationmark.triangle.fill` (triangel) |
  | Rött | Rött | `exclamationmark.octagon.fill` (oktagon) |

  Samma symboler används i veckoraden, i Trend och i *Alla dagar*. VoiceOver läser ampeln som ett element: "Nivå: Gult".
- **Tryckytor minst 44 × 44 punkter.** Knappar är minst 48 punkter höga, val (chips) och listrader minst 44, och reglagen 44. Stäng och Hjälp nu har minst 44 × 44.
- **VoiceOver-etiketter:**
  - Knappar och val har etiketter och tillstånd (valt, avstängt, upptagen).
  - Reglagen för stämning och energi har etikett, värde ("5 av 10") och ledtråd.
  - Krisnumren läses som "Ring 112, Vid fara för liv", med ledtråden att telefonens uppringning öppnas.
  - Veckoraden läses dag för dag, till exempel "måndag 26 oktober: Grönt".
  - Diagrammen i Trend har en sammanfattning, och samma siffror finns som lista.
- **Reduce Motion.** Stackarna byter från glidning till toning när inställningen är på. Appen har inga andra animationer.
- **Knappar med tecken som titel har en egen etikett.** Till exempel läses *−15 min* som "15 minuter tidigare". Egen sömn anges med ett reglage i halvtimmar, som stämning och energi, och VoiceOver läser värdet som "6,5 timmar". Knappar vars titel inte säger vad som händer har en ledtråd, till exempel *Inte nu*: "Kortet visas igen i morgon".
- **Ihopfällbara delar** (`Disclosure`) läses som en knapp med tillståndet expanderad eller hopfälld.

### Enkelhet: en sak i taget

> "Disclosure controls … hide and reveal information …" (Disclosure controls)
> "Prioritize the most important content." (Layout)

- **Startsidan visar ett kort åt gången.** Bara ett kort visas under knapparna för avstämningen. Tänkbara kort är tystnad, att lägga in planen, en händelse i morgon, sömnnotisen, första veckan, sömnkällan, förslag, profilgenomgång, påminnelse om allmänna tecken och rutiner i dag. Kortet med högst prioritet visas. *Inte nu* döljer det till i morgon, och då visas nästa. Under kortet står hur många som väntar. Ordningen ligger i `src/core/analysis/homeCards.ts`, med tester. Säkerhet och det som gäller i dag kommer först, påminnelser om appen sist.
- **Bedömningen talar patientens språk.** Överst står nivån, meningen och vad planen säger att du ska göra. Därefter *Det här syntes i dag*, utan poäng. Poäng, underlag, baslinje, metod, modell och regelversion ligger under *Så räknade appen*. Den delen är hopfälld från början och är till för den som vill veta, och för granskare.
- **Avstämningen börjar med anteckningen.** Ordningen är anteckningen, stämning och energi, sömn och stress, medicin, rutiner i dag och sist veckofrågan om händelser. Texten om att Whisper kräver en utvecklingsbuild är borttagen. Kvar finns en mening om att tangentbordets diktering kan skicka ljud till Apple eller Google. Frågan om alkohol, sjukdom och träning är ett reglage med en förklaring i stället för en knapp.

### Layout

> "Respecting the safe area is essential …"

- **Säkra marginaler.** Rubrikfältet och flikfältet hanterar de säkra marginalerna i flikarna. Knappar längst ned i ett ark lägger till den nedre marginalen själva. Innehållet är som mest 640 punkter brett.

### Playing haptics

> "Avoid overusing haptics." "Use system-provided haptic patterns according to their documented meanings." Success: "Indicates that a task or action has completed."

- **En enda haptik:** *Success* när kvällens avstämning är sparad (`expo-haptics`).
- **Ingen haptik vid rött eller vid akutregeln**, som specen kräver.
- **Ingen haptik på webben.**

### Krisrutan

- **Ett tryck från alla flikar.** *Hjälp nu* står i rubrikfältet på varje fliks första skärm och öppnar arket med planens steg vid rött och numren 112, 1177 och 90101.
- **Numren öppnar telefonens uppringning** (`tel:`). Samtalet startar först när personen trycker på ring där. Appen säger aldrig att ett samtal har ringts. Den säger bara "Appen kontaktar ingen".

### App icons

> "Embrace simplicity in your icon design." "Include text only when it's essential …" "Use your light app icon as the basis for your dark icon."
> SF Symbols: "the prohibition against using symbols — or images that are confusingly similar — in app icons".

- **Motivet** är en sol som stiger över en horisont, med två halvgenomskinliga bågar för djup.
- **Ingen ampel, inget medicinskt kors och ingen text.**
- **Ingen SF Symbol.** Solen har inga strålar, så den inte liknar `sunrise`.
- **Format och varianter.** 1024 × 1024, utan genomskinlighet. Det finns en ljus, en mörk och en tonad variant (`ios.icon` i `app.json`), och adaptiva ikoner för Android.

### Launching

> "Design a launch screen that's nearly identical to the first screen of your app …" "Avoid including text on your launch screen …" "The launch screen isn't a branding opportunity."

- **Startskärmen är bara bakgrundsfärgen från första skärmen**, `#F2F2F7` i ljust läge och `#000000` i mörkt (`expo-splash-screen`).
- **Ingen bild, ingen logga, ingen text.**

## Krockar mellan riktlinjerna och specen

1. **Avstämning som flik.** HIG säger "Use a tab bar to support navigation, not to provide actions." Kvällens avstämning är en uppgift. Jag följer specen, men fliken visar en vy med formuläret och leder sedan vidare till bedömningen i samma flik, så den fungerar som ett avsnitt och inte som en knapp. Alternativet vore att flytta avstämningen till Hem som en tydlig knapp och låta fliken bli *Historik*.
2. **Krisplanen i ett ark.** HIG föreslår ark för enkla uppgifter och säger "For complex or prolonged user flows, consider alternatives to sheets." Att granska och ändra planen är kort, men *Lägg in plan* (klistra in, rensa, sortera, godkänna) är ett längre flöde. Jag har lagt det som andra steget i arket, med bakåtknapp, som HIG beskriver för ark med flera steg. Alternativet vore att låta *Lägg in plan* öppnas som en egen skärm i fliken Jag.
3. **Rött som nivåfärg.** HIG låter systemets röda betyda destruktiva handlingar. Appen använder en egen röd för nivån, alltid med ord och symbol, och samma röda för knappen *Radera*. Två betydelser av rött är en kompromiss som specen och ampeln ger.
4. **Ingen eget val av utseende.** Specen säger inget om det. HIG avråder, så appen följer bara systemet.
5. **Projektets regel om navigering.** `AGENTS.md` sa att appen medvetet inte använder Expo Router och har en egen liten stack. Specen kräver native stack, flikar och ark. Jag har bytt till React Navigation 7, som finns i Expo Go och fungerar på webben. Expo Router används fortfarande inte. `AGENTS.md` är uppdaterad.
6. **Webbversionen.** HIG gäller Apples plattformar, inte en webbapp i Safari. Webbversionen använder samma komponenter. Där följer färgerna `prefers-color-scheme`, symbolerna visas som Material Symbols, och rubrikerna blir inte stora.

## Vad som inte är verifierat här

- **iOS-simulatorn.** Den kräver en Mac med Xcode, och den här miljön kör Linux. Skärmbilderna härifrån är från webbversionen i Chromium, i ljust och mörkt läge.
- **Det som inte kan provas på webben:**
  - största tillgänglighetsstorleken (Dynamic Type)
  - Fet text
  - stora rubriker
  - VoiceOver
  - haptik
  - startskärmen
- **Det som är kontrollerat:** att iOS-projektet genereras med rätt ikonvarianter, startskärmsfärger och `UIUserInterfaceStyle Automatic` (`npx expo prebuild` i en kopia).
- **Det som återstår** innan App Store-dokumenten är skärmbilder från en simulator i ljust och mörkt läge och med största textstorleken.
