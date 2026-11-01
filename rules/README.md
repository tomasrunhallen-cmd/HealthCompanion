# Reglerna för ampeln

Den här mappen innehåller alla trösklar och poäng som avgör om en dag blir grön, gul eller röd. Appen läser reglerna från `rules.json`. Ingen språkmodell sätter nivån. En modell kan bara hitta personens egna tecken i anteckningen; poängen och nivån räknas sedan med reglerna nedan.

Filen har ett versionsnummer. Varje bedömning sparar vilken version den räknades med. Ändras en regel ska versionen höjas, och *Räkna om historiken med nya regler* visar vilka dagar som skulle få en annan nivå innan något sparas. `rules.schema.json` beskriver vilka fält som får finnas och vilka värden de får ha. Appen vägrar starta med en regelfil som inte följer schemat.

Version: **1.0.0**. Reglerna har inte granskats av en människa med klinisk kunskap.

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
| `points.jump` | 1 | Stämning eller energi skiljer sig med minst `jumpThreshold` steg från snittet de senaste `jumpWindowDays` dagarna. Kräver minst `jumpMinSamples` tidigare dagar. |
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
| `nightEntryEndHour` | 5 | Ett inlägg mellan 00:00 och 05:00 är ett tecken. |
| `measuredCapPerDay` | 2 | De mätta tecknen ger tillsammans högst 2 poäng per dag, så att en dålig natt inte räknas flera gånger. Ett mätt tecken bidrar bara till rött om det fanns även dagen innan. Svarar personen ja på *Alkohol, sjuk eller hård träning i går?* ger sömn, sen insomning och stress 0 poäng den dagen. |
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

## Utanför reglerna

Akutregeln ligger i `context/akut.md` och avgörs före allt annat. En träff utan negation ger röd dag och krisrutan, oavsett poäng.
