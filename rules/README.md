# Reglerna för ampeln

Den här mappen innehåller alla trösklar och poäng som avgör om en dag blir grön, gul eller röd. Appen läser reglerna från `rules.json`. Ingen språkmodell sätter nivån. En modell kan bara hitta personens egna tecken i anteckningen; poängen och nivån räknas sedan med reglerna nedan.

Filen har ett versionsnummer. Varje bedömning sparar vilken version den räknades med. Ändras en regel ska versionen höjas, och *Räkna om historiken med nya regler* visar vilka dagar som skulle få en annan nivå innan något sparas. `rules.schema.json` beskriver vilka fält som får finnas och vilka värden de får ha. Appen vägrar starta med en regelfil som inte följer schemat.

Version: **1.2.0**. Version 1.2.0 (granskning 2 november): alkoholfrågan räknar värdena mot gult i stället för att nolla dem, stämning ±3 väger som ett allvarligt tecken, nattinlägg slutar 04:00 och ett stämningshopp i samma riktning som en skattning på ±2 eller mer räknas inte en gång till. Version 1.1.0 lade till stämningen på skalan −3 till +3: `points.moodModerate`, `points.moodSevere` och `moodJumpThreshold`. Reglerna har inte granskats av en människa med klinisk kunskap.

## Dygnet

| Fält | Värde | Betydelse |
| --- | --- | --- |
| `dayStartHour` | 4 | Dygnet går från 04:00 till 04:00 i telefonens lokala tid. Ett inlägg 00:30 räknas till dagen innan. |

## Poäng per tecken

| Fält | Poäng | När |
| --- | --- | --- |
| `points.earlySign` | 1 | Ett av personens tidiga tecken ur krisplanen står i anteckningen. |
| `points.seriousSign` | 2 | Ett av personens allvarliga tecken står i anteckningen. |
| `points.measured` | 1 | Ett mätt tecken: sömn under gränsen, två nätter i rad med kort sömn, stress över baslinjen, inlägg mitt i natten eller tal som är fortare än vanligt. |
| `points.lateSleepNoEntry` | 1 | Klockan visar insomning efter `lateSleepHour` och det finns inget inlägg kvällen innan. |
| `points.silence` | 1 | Inga inlägg på `silenceDays` dagar före dagens inlägg. |
| `points.jump` | 1 | Energin skiljer sig med minst `jumpThreshold` steg, eller stämningen med minst `moodJumpThreshold` steg (2), från snittet de senaste `jumpWindowDays` dagarna. Kräver minst `jumpMinSamples` tidigare dagar. |
| `points.moodModerate` | 1 | Personen skattade stämningen som *Depression* (−2) eller *Uppvarvning* (+2). |
| `points.moodSevere` | 2 | Personen skattade stämningen som *Akut depression* (−3) eller *Akut mani* (+3). Väger som ett allvarligt tecken: planens steg vid rött visas, och tillsammans med ett annat tecken blir dagen röd. Ett hopp i samma riktning räknas inte en gång till. |
| `points.heavyDay` | 1 | Personen tryckte *Orkar bara trycka*. |
| `points.medicationMissed` | 1 | Personen svarade nej på medicinfrågan `medicationMissedDays` kvällar i rad. |

## Mätta tecken

| Fält | Värde | Betydelse |
| --- | --- | --- |
| `sleepThresholdHoursDefault` | 5 | Sömn under så här många timmar är ett tecken, tills personen väljer en egen gräns i krisplanen. |
| `stressFactor` | 1,3 | Dagens snittstress över 1,3 gånger personens baslinje är ett tecken. |
| `speechFastFraction` | 0,25 | Tal mer än 25 % fortare än personens baslinje är ett tecken. Mäts inte ännu. |
| `lateSleepHour` | 2 | Insomning från 02:00 räknas som sen. |
| `lateSleepLatestHour` | 12 | Insomning från 12:00 räknas som dagsömn och ger inget. |
| `nightEntryEndHour` | 4 | Ett inlägg mellan 00:00 och 04:00 är ett tecken. Samma gräns som dygnet, så ett inlägg 04:01 hör till ett nytt dygn och ger inget nattecken. |
| `measuredCapPerDay` | 2 | De mätta tecknen ger tillsammans högst 2 poäng per dag, så att en dålig natt inte räknas flera gånger. Ett mätt tecken bidrar bara till rött om det fanns även dagen innan. Svarar personen ja på *Alkohol, sjuk eller hård träning i går?* räknas sömn, sen insomning och stress som vanligt och syns med "möjlig förklaring", men se `excusedMeasuredToRed`. |
| `excusedMeasuredToRed` | false | Efter ja på *Alkohol, sjuk eller hård träning i går?* kan sömn, sen insomning och stress ge gult men inte bidra till rött. Svaret är en möjlig förklaring, inte ett bevis på att förändringen är ofarlig. |
| `trendDays` | 3 | Har sömnen blivit kortare, eller stressen högre, så här många dagar i rad utan att passera gränsen visas en neutral rad under grönt. Den ger ingen poäng. |

## Baslinjer

| Fält | Värde | Betydelse |
| --- | --- | --- |
| `baselineWindowDays` | 28 | Baslinjen för sömn, stress, talhastighet och klockslag räknas på gröna dagar de senaste 28 dagarna, om varje måndag. |
| `baselineMinSamples` | 3 | Baslinjen används först när det finns minst tre gröna dagar. |

## Nivå

Reglerna prövas i den här ordningen, och den första som gäller visas för personen.

| Fält | Värde | Betydelse |
| --- | --- | --- |
| `level.redAt` | 4 | 4 poäng eller mer ger rött. |
| `level.seriousPlusOtherSigns` | 2 | Ett allvarligt tecken tillsammans med minst ett annat tecken, alltså minst 2 tecken som gav poäng, ger rött. |
| `level.redWithHistoryAt`, `level.historyNonGreenDays`, `level.historyWindowDays` | 2, 3, 7 | 2 poäng eller mer ger rött om minst 3 av de senaste 7 dagarna var gula eller röda. |
| `level.yellowAt` | 1 | 1 poäng eller mer ger gult. |
| | | Annars grönt. Grönt säger alltid "Inget av dina tecken syntes i dag." |

Två begränsningar gäller alltid, oavsett siffrorna: standardrader som personen inte bekräftat kan bara ge gult, och mätta tecken som inte fanns dagen innan kan bara ge gult.

## Algoritmen i ordning

Så räknas en dag, steg för steg. Koden ligger i `src/core/analysis/scoring.ts` (`score`, `levelFromSignals`) och `assess.ts`.

1. **Akutregeln** (`context/akut.md`) körs först, på telefonen. Fullt larm ger rött, krisrutan och att inget skickas. Milt larm vid negation eller sammanhang ger den mildare rutan, och dagen räknas vidare som vanligt utan modell.
2. **Tecken ur planen.** Ordmatchningen eller modellen avgör vilka tecken anteckningen beskriver.
   - En träff med en negation som tecknet inte har räknas inte.
   - Med modell räknas ett allvarligt tecken som ordmatchningen hittar, även om modellen inte tog med det.
   - Tidigt tecken 1 poäng, allvarligt 2.
3. **Mätta tecken:** sömn under gränsen, andra natten i rad, stress, sen insomning och talhastighet.
   - Ett tecken märks *fanns i går* om det fanns även dagen innan.
   - Efter ja på alkoholfrågan märks det *möjlig förklaring*.
   - Tillsammans ger de högst `measuredCapPerDay` poäng, i den ordningen.
4. **Övriga tecken:**
   - nattinlägg 00:00–04:00
   - tystnad
   - medicin
   - stämning skattad till ±2 eller ±3, där ±3 väger som ett allvarligt tecken
   - hopp i stämning eller energi; ett stämningshopp i samma riktning som en skattning på ±2 eller mer räknas inte
   - *Orkar bara trycka*
5. **Nivån.** Den första regeln som gäller avgör:
   1. Poäng ≥ `redAt` ger rött.
   2. Ett allvarligt tecken tillsammans med minst ett annat tecken ger rött.
   3. Poäng ≥ `redWithHistoryAt` ger rött om minst `historyNonGreenDays` av de `historyWindowDays` dagarna före i dag var gula eller röda. Dagen själv räknas inte.
   4. Poäng ≥ `yellowAt` ger gult.
   5. Annars grönt.
6. **Spärrar mot rött.** Blir det rött räknas dagen om utan tre sorters tecken:
   - obekräftade standardrader
   - mätta tecken som inte fanns i går
   - mätta tecken med möjlig förklaring

   Blir det fortfarande rött är dagen röd. Annars blir den gul, med skälet: standardinnehåll, första dagen eller möjlig förklaring.
7. **Grönt** visar alltid samma mening, och neutrala trendrader utan poäng.

**Tid och källor**

- **Dygnet** går 04:00–04:00. Ett inlägg 01:30 hör till dagen innan.
- **Sömnen** hör till morgonen man vaknade, alltså till dygnet som börjar den morgonen.
- **"I går"** i alkoholfrågan är dygnet före avstämningen.
- **En ny avstämning samma dygn** ersätter den förra.
- **Källor för sömn och stress:** egen uppgift går före Garmin, Garmin före telefonens hälsoapp, och anteckningen används bara om inget annat finns.
- **Omräkning:** när en äldre dag uppdateras, till exempel med klockans senare värden, räknas senare dagar inte om automatiskt. *Räkna om historiken* räknar om alla dagar i ordning.
- **Ingen avdubblering** mellan planens tecken om kort sömn och den mätta sömnen. Båda räknas.

## Utanför reglerna

Akutregeln ligger i `context/akut.md` och avgörs före allt annat. En träff utan negation ger röd dag och krisrutan, oavsett poäng.
