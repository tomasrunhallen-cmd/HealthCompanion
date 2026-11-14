# Reglerna för ampeln

Den här mappen innehåller alla trösklar och poäng som avgör om en dag blir grön, gul eller röd. Appen läser reglerna från `rules.json`. Ingen språkmodell sätter nivån. En modell kan bara hitta personens egna tecken i anteckningen; poängen och nivån räknas sedan med reglerna nedan.

Filen har ett versionsnummer. Varje bedömning sparar vilken version den räknades med. Ändras en regel ska versionen höjas, och *Räkna om historiken med nya regler* visar vilka dagar som skulle få en annan nivå innan något sparas. `rules.schema.json` beskriver vilka fält som får finnas och vilka värden de får ha. Appen vägrar starta med en regelfil som inte följer schemat.

Version: **1.5.0**. Version 1.5.0 (13 november) lade till *Dygnsrytm*, en experimentell passiv signal ur klockans sömn och puls, som personen själv väljer till (se nedan). Version 1.4.0 (personens test 2 november): stress räknas som tecken först när den är 30 eller mer tre dagar i rad, i stället för en enda dag över 1,3 gånger baslinjen. Version 1.3.0 lade till kategorin personliga textmönster (*Mina tidigare texter*, experimentell, se nedan). Version 1.2.0 (granskning 2 november): alkoholfrågan räknar värdena mot gult i stället för att nolla dem, stämning ±3 väger som ett allvarligt tecken, nattinlägg slutar 04:00 och ett stämningshopp i samma riktning som en skattning på ±2 eller mer räknas inte en gång till. Version 1.1.0 lade till stämningen på skalan −3 till +3: `points.moodModerate`, `points.moodSevere` och `moodJumpThreshold`. Reglerna har inte granskats av en människa med klinisk kunskap.

## Dygnet

| Fält | Värde | Betydelse |
| --- | --- | --- |
| `dayStartHour` | 4 | Dygnet går från 04:00 till 04:00 i telefonens lokala tid. Ett inlägg 00:30 räknas till dagen innan. |

## Poäng per tecken

| Fält | Poäng | När |
| --- | --- | --- |
| `points.earlySign` | 1 | Ett av personens tidiga tecken ur krisplanen står i anteckningen. |
| `points.seriousSign` | 2 | Ett av personens allvarliga tecken står i anteckningen. |
| `points.measured` | 1 | Ett mätt tecken: sömn under gränsen, två nätter i rad med kort sömn, stress 30 eller mer tre dagar i rad, inlägg mitt i natten eller tal som är fortare än vanligt. |
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
| `stressHighAt` | 30 | Snittstress 30 eller mer, på Garmins skala 0–100, räknas som hög. Egen uppgift följer samma skala: *Låg* 25, *Medel* 50, *Hög* 75. |
| `stressHighDays` | 3 | Hög stress blir ett tecken först när den varit det så här många dagar i rad, i dag inräknat. En enstaka dag ger inget. Saknas värdet en av dagarna räknas det inte. |
| `speechFastFraction` | 0,25 | Tal mer än 25 % fortare än personens baslinje är ett tecken. Mäts inte ännu. |
| `lateSleepHour` | 2 | Insomning från 02:00 räknas som sen. |
| `lateSleepLatestHour` | 12 | Insomning från 12:00 räknas som dagsömn och ger inget. |
| `nightEntryEndHour` | 4 | Ett inlägg mellan 00:00 och 04:00 är ett tecken. Samma gräns som dygnet, så ett inlägg 04:01 hör till ett nytt dygn och ger inget nattecken. |
| `measuredCapPerDay` | 2 | De mätta tecknen ger tillsammans högst 2 poäng per dag, så att en dålig natt inte räknas flera gånger. Ett mätt tecken bidrar bara till rött om det fanns även dagen innan. Svarar personen ja på *Alkohol, sjuk eller hård träning i går?* räknas sömn, sen insomning och stress som vanligt och syns med "möjlig förklaring", men se `excusedMeasuredToRed`. |
| `excusedMeasuredToRed` | false | Efter ja på *Alkohol, sjuk eller hård träning i går?* kan sömn, sen insomning och stress ge gult men inte bidra till rött. Svaret är en möjlig förklaring, inte ett bevis på att förändringen är ofarlig. |
| `trendDays` | 3 | Har sömnen blivit kortare, eller stressen högre, så här många dagar i rad utan att det blivit ett tecken visas en neutral rad under grönt. Den ger ingen poäng. |

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

## Personliga textmönster (experimentellt)

Kategorin hör till *Mina tidigare texter* och gäller bara mönster som personen själv godkänt. Viktningen är ett **produktantagande, inte kliniskt prövad**. Godkännandet betyder att mönstret får användas experimentellt, inte att det är validerat.

| Fält | Värde | Betydelse |
| --- | --- | --- |
| `textPatterns.points` | 1 | Ett godkänt mönster med ett belägg i dagens anteckning ger 1 poäng. Beläggen kontrolleras på telefonen: mönstrets id, citatet ordagrant i anteckningen, och att det handlar om personen själv nu. |
| `textPatterns.capPerDay` | 2 | Högst 2 poäng om dagen från kategorin, och bara från skilda mönster, fenomen och citat. |
| `textPatterns.aloneCanGiveRed` | false | Mönstren kan tillsammans med andra tecken höja gult till rött, men aldrig ensamma ge rött: inte genom poäng, inte genom allvarligt tecken plus annat och inte genom regeln om de senaste dagarna. Dagen blir då gul med skälet *text_alone*. |

**Avdubblering.** Ett mönster räknas inte när samma sak redan räknas. Vid tvekan läggs ingen poäng till.

- **Planens tecken:** mönstret är kopplat till ett tecken ur planen som syntes, eller citatet delar tre ord i rad med ett tecken som räknas.
- **Mätta och skattade värden:** sömnmönster räknas inte när sömnen redan gav poäng, stämningsmönster inte när stämningen gjorde det, tempomönster inte när talhastigheten gjorde det och aktivitetsmönster inte när energin gjorde det.
- **Andra mönster samma dag:** samma mönster, samma fenomen och samma citat räknas en gång.

Ett mönster blir aldrig ett allvarligt tecken. Att inget mönster syns, eller att anteckningen liknar stabila texter, sänker aldrig något. Riktningen visas, och mönster uppåt och nedåt samma dag tar inte ut varandra.

**Prioritet:** akutregeln går före allt och påverkas aldrig av referensmaterialet. Därefter räknas tecken, mätvärden och textmönster, och nivån sätts. Sist gäller spärrarna mot rött i ordningen standardinnehåll, första dagens mätvärden, möjlig förklaring och textmönster ensamma.

## Dygnsrytm (experimentellt)

En passiv modell som jämför de senaste nätterna från klockan med personens egna tidigare nätter, utan anteckning och utan avstämning. Koden ligger i `src/core/analysis/rhythm.ts`. Personen väljer *Av*, *Visa* eller *Använd*. Bara med *Använd* kan signalen påverka nivån. Trösklarna sattes innan modellen prövades på riktiga data och är **produktantaganden, inte kliniskt prövade**.

| Fält | Värde | Betydelse |
| --- | --- | --- |
| `rhythm.points` | 1 | En förändring med stöd för en riktning i personens egen historik ger 1 poäng, om personen valt *Använd*. En förändring med oklar riktning ger 0. |
| `rhythm.aloneCanGiveRed` | false | Signalen kan höja en dag men aldrig avgöra rött. Blir dagen röd bara genom den blir den gul med skälet *passive_cap*. Den sänker aldrig en nivå och går aldrig före akutregeln. |
| `rhythm.baselineDays` | 63 | Det vanliga räknas på nätter upp till 63 dagar bakåt ... |
| `rhythm.baselineGapDays` | 7 | ... utom den senaste veckan, så att en långsam förskjutning inte blir det nya vanliga. Nätter under dokumenterade episoder räknas inte. |
| `rhythm.baselineMinNights` | 14 | Färre nätter än så: svaret är *för lite data*. |
| `rhythm.windowNights` | 3 | En förändring kräver tre nätter i rad ... |
| `rhythm.windowSpanNights` | 4 | ... bland de fyra senaste. En natt utan data hoppas över, två ger *för lite data*. |
| `rhythm.shiftZ` | 1,5 | Insomning senare eller tidigare än vanligt: avvikelsen från medianen delad med spridningen (1,4826 × MAD, minst 30 minuter). |
| `rhythm.durationZ` | 1,5 | Sömnen kortare eller längre än vanligt, på samma sätt (spridning minst 0,5 timmar). |
| `rhythm.activityZ` | 1,0 | Kvällsaktiviteten senare än vanligt: andelen av dygnets aktiva minuter efter 21, ur pulsen (spridning minst 5 procentenheter). Minst två av de tre kvällarna. |
| `rhythm.singleShortZ` | 2,0 | En enda så kort natt bland de tre är en enstaka kort natt, inte en förändring. |
| `rhythm.irregularNights` | 7 | Oregelbundna sovtider räknas på den senaste veckan ... |
| `rhythm.irregularMinNights` | 5 | ... med minst fem nätter ... |
| `rhythm.irregularFactor` | 2 | ... när insomningen skiftar från natt till natt minst dubbelt så mycket som vanligt ... |
| `rhythm.irregularMinMinutes` | 60 | ... och minst 60 minuter. |
| `rhythm.minActivityWornShare` | 0,7 | Ett dygns aktivitet räknas bara om klockan haft puls minst 70 % av dygnet. |
| `rhythm.timezoneSettleNights` | 3 | De tre första nätterna efter ett tidszonsbyte jämförs inte. |
| `rhythm.preEpisodeDays` | 7 | Riktningen: fanns samma mönster någon av de sju dagarna före en dokumenterad episodstart? |
| `rhythm.episodeDefaultDays` | 28 | En episod utan slutdatum räknas som fyra veckor. |
| `rhythm.stableMarginDays` | 14 | Stabila dagar ligger minst två veckor från varje episod. |
| `rhythm.horizonDays` | 3 | Hypotesen som prövas: en episodstart inom tre dygn efter signalen. Används i utvärderingen. |

**Riktningen** har stöd när mönstret fanns före minst en dokumenterad episod av en typ, inte före någon av den andra typen, och aldrig under stabila perioder. Fanns det också under stabila perioder krävs minst två episoder och färre stabila tillfällen än episoder. Annars är riktningen oklar. Ingen procentsats visas.

**Samma korta sömn räknas en gång:** är kortare sömn det enda mönstret och har sömnregeln redan gett poäng i dag, ger signalen 0.

**Missade avstämningar** används aldrig i den passiva modellen, och appens tidigare färger används aldrig som facit.

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
4. **Personliga textmönster** (experimentellt, se ovan): 1 poäng per godkänt mönster med kontrollerat belägg, högst 2, efter avdubbleringen.
5. **Övriga tecken:**
   - nattinlägg 00:00–04:00
   - tystnad
   - medicin
   - stämning skattad till ±2 eller ±3, där ±3 väger som ett allvarligt tecken
   - hopp i stämning eller energi; ett stämningshopp i samma riktning som en skattning på ±2 eller mer räknas inte
   - *Orkar bara trycka*
6. **Nivån.** Den första regeln som gäller avgör:
   1. Poäng ≥ `redAt` ger rött.
   2. Ett allvarligt tecken tillsammans med minst ett annat tecken ger rött.
   3. Poäng ≥ `redWithHistoryAt` ger rött om minst `historyNonGreenDays` av de `historyWindowDays` dagarna före i dag var gula eller röda. Dagen själv räknas inte.
   4. Poäng ≥ `yellowAt` ger gult.
   5. Annars grönt.
7. **Spärrar mot rött.** Blir det rött räknas dagen om utan tre sorters tecken:
   - obekräftade standardrader
   - mätta tecken som inte fanns i går
   - mätta tecken med möjlig förklaring

   Blir det fortfarande rött är dagen röd. Annars blir den gul, med skälet: standardinnehåll, första dagen eller möjlig förklaring. Ger bara textmönster poäng blir dagen också gul (*text_alone*).
8. **Grönt** visar alltid samma mening, och neutrala trendrader utan poäng.

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
