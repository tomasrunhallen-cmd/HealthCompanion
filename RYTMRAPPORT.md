# Klockans rytm: rapport över vad som kunnat utvärderas

Version 1 av den experimentella funktionen, regler 1.5.0, 14 november 2026.

## Kort svar

- **Dina egna data har spelats upp en gång, den 14 november, men inga episodstarter är dokumenterade.** Därför går det ännu inte att säga om modellen fångar något i förväg, eller om dess larm var rätt eller fel. Det som går att läsa är hur ofta varje metod larmar och hur ofta den avstår. Se nästa avsnitt.
- **Utvärderingen körs i appen,** under *Jag → Inställningar → Klockans rytm → Utvärdera på mina data*. Dina klockdata ligger krypterade i ditt eget Firebase-projekt och dekrypteras bara i din webbläsare.
- **Allt med siffror nedan kommer från simulerade testfall.** De visar att reglerna och uppspelningen räknar som de ska, inte att modellen fungerar.

## Första körningen på dina data (14 november 2026)

Avläst från appen. Perioden 8 juni 2024 – 14 november 2026 är 890 dagar, med 615 nätter med sömn från klockan och 108 kvällar med puls. Antalet kvällar är litet eftersom pulsen bara hade hämtats 120 dagar bakåt. Inga episodstarter är dokumenterade.

| Del | Metod | Larm | Per månad | Avstod |
| --- | --- | --- | --- | --- |
| Utveckling, 8 juni 2024 – 26 augusti 2025 | Sömnnotisen | 23 på 180 bedömda dagar | 3,8 | 265 av 445 dagar |
| | Modellen, bara sömn | 3 på 174 | 0,5 | 271 av 445 |
| | Modellen, sömn och aktivitet | 3 på 174 | 0,5 | 271 av 445 |
| Test, 27 augusti 2025 – 14 november 2026 | Sömnnotisen | 48 på 392 | 3,7 | 53 av 445 |
| | Modellen, bara sömn | 9 på 419 | 0,6 | 26 av 445 |
| | Modellen, sömn och aktivitet | 9 på 419 | 0,6 | 26 av 445 |

Vad det säger:

- **Larmtakten:** modellen larmar ungefär en sjättedel så ofta som sömnnotisen, i båda delarna. Om larmen var rätt eller fel går inte att säga utan dokumenterade starter.
- **Data före hösten 2025:** under utvecklingsdelen saknade klockan data så ofta att alla metoderna avstod på ungefär sex dagar av tio. Från hösten 2025 avstår modellen sällan, på 26 av 445 dagar.
- **Aktiviteten:** den gjorde ingen skillnad här, eftersom pulsen bara fanns för de senaste månaderna. Efter en hämtning ett år bakåt går de två modellerna att jämföra.
- **Ordet "falsklarm":** appen kallade larmen falsklarm i den här körningen. Det var fel när inga episoder är dokumenterade, och är rättat. Appen säger nu "larm" och visar en lista med modellens larm, så att du kan pröva dem mot ditt minne.

## Hypotesen

Lee m.fl. fann att digitala mått på dygnsrytm kunde bidra till att förutsäga en episodstart inom tre dagar. Ludwig m.fl. fick betydligt svagare resultat med en annan metod. Funktionen prövar därför ”möjlig episodstart inom tre dygn” som en hypotes. Den påstår inte att den kan förutsäga episoder. Sammanfattningen av studierna är din. Appen hänvisar inte till dem för några siffror.

## Datakällor

Kontrollerat mot Garmins eget Python-paket för Personal API, `garmin-connect-personal-api-python` 1.0.0, den 13 november 2026. Fältnamnen kommer från öppna klienter, inte från Garmins dokumentation, och läses försiktigt.

| Källa | Adress | Tidsupplösning | Används |
| --- | --- | --- | --- |
| Sömn per natt | `/sleep-service/sleep/dailySleepSummariesByDate` | Insomning och uppvakning på minuten, lokal tid och GMT. Skillnaden ger tidszonen | Ja: insomning, uppvakning, sömnlängd och variation mellan nätterna |
| Puls över dygnet | `/wellness-service/wellness/dailyHeartRate?date=` | Ett värde varannan minut, ett anrop per dag | Ja: räknas om till aktiva minuter per timme (puls minst 25 slag över vilopuls). Själva pulsen sparas inte |
| Stress per dag | `/usersummary-service/stats/stress/daily/` | Dagssnitt | Nej, inte i rytmmodellen |
| Body Battery | `/wellness-service/wellness/bodyBattery/reports/daily` | Tidsstämplade värden | Nej, bara för hur långt klockan synkat |
| Steg | `/usersummary-service/stats/steps/daily/` | Bara dagssumma | Nej: för grov för fördelningen över dygnet |

Pulsadressen har inte anropats mot ett riktigt konto härifrån. Svarar Garmin att den inte är tillgänglig via din nyckel visar *Datakällor* det, och modellen räknar då bara med sömn.

**Färskhet.** Värdena är så färska som klockans senaste synk till Garmin Connect. Appen visar klockslaget för senaste pulsvärdet och när varje hämtning gjordes.

## När beräkningen sker

Beräkningen sker efter varje lyckad hämtning från Garmin och när appen öppnas. Hämtningen sker när appen öppnas eller kommer fram, före en avstämning och när du trycker *Hämta igen*.

**Hämtning när appen är stängd: nej.** Safari ger inte webbappar på hemskärmen någon bakgrundshämtning, och telefonappen har ingen bakgrundsuppgift. I praktiken räknas analysen alltså när du öppnar appen. Varje hämtning sparas i en logg under *Datakällor*, med om appen var öppen. Loggen är kontrollen på din telefon: om alla hämtningar har skett med appen öppen, har ingen skett i bakgrunden.

## Modellen

Den är enkel, begriplig och körs helt på telefonen. Alla värden finns i `rules/rules.json` och förklaras i `rules/README.md`.

- **Baslinjen:** dina nätter 8–63 dagar bakåt. Den senaste veckan och dokumenterade episoder räknas inte. Minst 14 nätter behövs. Det vanliga är medianen, och spridningen är 1,4826 × MAD med ett golv (30 minuter, 0,5 timmar, 5 procentenheter).
- **En förändring** kräver tre nätter i rad bland de fyra senaste:
    - insomning senare eller tidigare än vanligt
    - sömn kortare eller längre än vanligt
    - kvällsaktivitet senare än vanligt (andel av dygnets aktiva minuter efter 21)
    - oregelbundna sovtider den senaste veckan
- **En enstaka kort natt** är ingen förändring. Appen säger det uttryckligen.
- **Luckor:** en natt utan data hoppas över. Två av fyra saknade nätter ger *för lite data*. En kväll räknas bara om klockan haft puls minst 70 % av dygnet.
- **Tidszonsbyte:** de tre första nätterna efter bytet jämförs inte.
- **Missade avstämningar** används aldrig. Modellen tar inte emot några anteckningar eller avstämningar alls.
- **Två besked.**
    - Det första beskriver vad som ändrats, med nätterna och det vanliga värdet.
    - Det andra säger om din historik ger stöd för en riktning. Det räknar hur ofta samma mönster fanns sju dagar före dokumenterade starter, och hur ofta under stabila perioder.
    - Svaren kan vara *förändring upptäckt, riktning oklar* eller *för lite data*. Ingen procentsats visas.
- **Ampeln:** först väljer du *Visa*, som visar nivån med och utan signalen. *Använd* gör att en förändring med stöd för en riktning ger 1 poäng.
    - Samma korta sömn räknas en gång.
    - Signalen avgör aldrig rött, sänker aldrig en nivå och går aldrig före akutregeln.
    - Effekten på senare dagar genom regeln om de senaste dagarna visas under *Påverkan på ampeln*.

## Så utvärderas modellen

- **Uppspelning i tidsordning:** för varje morgon används bara nätterna fram till dess, kvällen innan och episodstarter som låg minst en vecka bakåt. Ett test kontrollerar att svaret för en dag blir detsamma med och utan senare data.
- **Facit** är de episodstarter du dokumenterar. Varje start anger om datumet är ditt eget i efterhand eller från en klinisk bedömning. Appens tidigare färger används aldrig.
- **Tre metoder** jämförs: sömnnotisen som finns i dag, modellen med bara sömn och modellen med sömn och aktivitet.
- **Redovisning per episodtyp:**
    - hur många starter som fångades i förväg (signal någon av de tre dygnen före)
    - förvarningstid
    - falsklarm per månad
    - hur ofta metoden avstod
- **Antalen** bakom varje mått står alltid med. Färre än tre bedömbara starter av en typ ger *för få för en andel*.
- **Utveckling och test:** trösklarna sattes innan modellen prövades på riktiga data. Den senare halvan av perioden redovisas för sig som testdel. Framtida justeringar får bara använda den tidigare halvan.

## Resultat på simulerade testfall

**Detta är simulerade testfall, inte dina data.**

<!-- simulerat:start -->
- Ett år av påhittade nätter: insomning kring 23:15 och 7,3 timmars sömn, med slumpmässig variation.
- Tre uppvarvade episoder, där sömnen förskjuts och kortas fem nätter före starten. I en av dem syns ingen kvällsaktivitet.
- Två nedstämda episoder, där sömnen blir längre före starten. Den sista har bara tre nätters förlopp.
- Två stabila veckor med sena kvällar och nätter utan någon episod, en enstaka kort natt, nio dygn utan klocka och en resa med tidszonsbyte.

> **Simulerade testfall.** Resultaten nedan kommer från påhittade data som appen genererar för att testa reglerna. De säger ingenting om hur modellen fungerar för dig.

Period: 5 december 2025 – 13 november 2026 (344 dagar). Nätter med sömn från klockan: 329. Kvällar med tillräcklig puls för aktivitet: 335.
Episodstarter i perioden: 5 (uppvarvade 3, nedstämda 2, blandade 0). Källa: 3 angivna i efterhand, 2 från klinisk bedömning.
Trösklarna sattes i rules/rules.json före utvärderingen. Testdelen från 26 maj 2026 redovisas för sig och får aldrig användas för att justera dem.

### Utvecklingsdel: 5 december 2025 – 25 maj 2026

| Metod | Typ | Starter | Bedömbara | Fångade i förväg | Förvarning | 
| --- | --- | --- | --- | --- | --- |
| Sömnnotisen (i dag) | Uppvarvade | 1 | 1 | 1 av 1 (för få för en andel) | 2 dygn |
| Sömnnotisen (i dag) | Nedstämda | 1 | 1 | 0 av 1 (för få för en andel) | – |
| Modellen, bara sömn | Uppvarvade | 1 | 1 | 1 av 1 (för få för en andel) | 1 dygn |
| Modellen, bara sömn | Nedstämda | 1 | 1 | 0 av 1 (för få för en andel) | – |
| Modellen, sömn och aktivitet | Uppvarvade | 1 | 1 | 1 av 1 (för få för en andel) | 2 dygn |
| Modellen, sömn och aktivitet | Nedstämda | 1 | 1 | 0 av 1 (för få för en andel) | – |

| Metod | Falsklarm | Avstod | 
| --- | --- | --- |
| Sömnnotisen (i dag) | 1,4 per månad (6 på 130 dagar) | 0 av 172 dagar |
| Modellen, bara sömn | 0,2 per månad (1 på 130 dagar) | 0 av 172 dagar |
| Modellen, sömn och aktivitet | 0,2 per månad (1 på 130 dagar) | 0 av 172 dagar |

För få dokumenterade episoder i den här delen (2) för att säga något om hur ofta starter fångas. Falsklarmen och hur ofta modellen avstod går att läsa ändå.

### Testdel (hållen utanför): 26 maj 2026 – 13 november 2026

| Metod | Typ | Starter | Bedömbara | Fångade i förväg | Förvarning | 
| --- | --- | --- | --- | --- | --- |
| Sömnnotisen (i dag) | Uppvarvade | 2 | 2 | 2 av 2 (för få för en andel) | 1–2 dygn (median 2) |
| Sömnnotisen (i dag) | Nedstämda | 1 | 1 | 0 av 1 (för få för en andel) | – |
| Modellen, bara sömn | Uppvarvade | 2 | 2 | 2 av 2 (för få för en andel) | 1–2 dygn (median 2) |
| Modellen, bara sömn | Nedstämda | 1 | 1 | 0 av 1 (för få för en andel) | – |
| Modellen, sömn och aktivitet | Uppvarvade | 2 | 2 | 2 av 2 (för få för en andel) | 2 dygn för alla 2 |
| Modellen, sömn och aktivitet | Nedstämda | 1 | 1 | 0 av 1 (för få för en andel) | – |

| Metod | Falsklarm | Avstod | 
| --- | --- | --- |
| Sömnnotisen (i dag) | 0,3 per månad (1 på 103 dagar) | 11 av 172 dagar |
| Modellen, bara sömn | 0,3 per månad (1 på 96 dagar) | 18 av 172 dagar |
| Modellen, sömn och aktivitet | 0,3 per månad (1 på 96 dagar) | 18 av 172 dagar |
<!-- simulerat:slut -->

## Det som återstår

1. **Dokumentera episodstarter** under *Episodstarter*. Ange typ och om datumet kommer från dig i efterhand eller från vården.
2. **Hämta puls bakåt:** tryck *Hämta puls ett år bakåt* (ungefär sju minuter, går att avbryta och fortsätta). Hämta sömn för samma period med *Hämta ett år bakåt* under Garmin.
3. **Kör *Utvärdera på mina data*** och skicka resultatet. Först då finns något att säga om modellen för dig.
4. **Kontrollera *Datakällor*:** att puls över dygnet går att hämta med din nyckel, och att loggen bara har hämtningar med appen öppen.
