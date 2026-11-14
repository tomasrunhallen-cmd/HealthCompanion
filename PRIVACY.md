# Integritet i Dagsljus

Dagsljus hanterar uppgifter om psykisk hälsa. Det är den känsligaste kategorin i GDPR (artikel 9). Appen är byggd så att utvecklaren aldrig behandlar någon användardata.

## Var data finns

| Data | Var | Skydd |
| --- | --- | --- |
| Krisplan, anteckningar, bedömningar, inställningar | Bara på telefonen, i en SQLite-databas | Krypterad med SQLCipher i utvecklingsbuild och butiksversion. Nyckeln ligger i iOS Keychain eller Android Keystore och följer inte med backup. |
| Ljud (när inspelning finns) | Telefonen, tillfälligt | Raderas i samma steg som texten sparas |
| Språkmodellens nyckel | Keychain eller Keystore, bara på den här enheten | Visas aldrig i klartext igen. Följer inte med backup eller export. Raderas med *Radera allt* och *Använd ingen språkmodell*. |
| Tokenräkning och senast skickade text | Databasen på telefonen | Används för kostnadsuppskattningen och promptbiblioteket |
| Garmin-nyckel | Keychain eller Keystore, bara på den här enheten | Sparas bara om Garmin godtar den. Raderas med *Koppla bort Garmin* och *Radera allt*. |
| Sömn, stress och Body Battery från Garmin | Databasen på telefonen | Alla hämtade dagar sparas, för trenden över 6 månader och ett år: de senaste 120 dagarna i en post, äldre i en post per månad. Försvinner med *Radera allt* |
| Backup | Där användaren själv sparar exportfilen | Krypterad med AES-256-GCM, nyckel från lösenordet med PBKDF2-SHA256 |

I Expo Go går SQLCipher inte att använda. Databasen är då okrypterad och appen säger det på skärmen *Data och integritet*. Webbförhandsvisningen sparar okrypterat i webbläsaren och är bara till för att titta på gränssnittet.

Android-backup är avstängd. På iOS kan databasfilen hamna i iCloud-backup tills en config plugin som utesluter den är på plats. Filen är krypterad och nyckeln följer inte med.

## Vad som lämnar telefonen

Utan språkmodell lämnar ingenting telefonen. Bedömningen görs då med ordmatchning på telefonen.

Med en språkmodell kopplad skickas **rensad text** till den leverantör användaren själv har valt, med användarens egen nyckel. Det gäller kvällens anteckning, normalläget, planens tecken och, vid import, raderna under rubriker i krisplanen som appen inte känner igen. För dagens förslag på startsidan skickas en gång per dag rutinernas ord, rensade, hur ofta de gjorts, veckodagen, gårdagens nivå och nattens sömn, men inga anteckningar. Det kan stängas av under *Rutiner*. Rensningen tar alltid bort:

- personnummer, telefonnummer, e-postadresser, gatuadresser, postnummer och länkar
- namn från användarens egen lista och namn som hittas i krisplanen
- journaltermer som avdelningsnummer och patient-id

Rensningen körs på telefonen, också när modellen är lokal. Den är en ren funktion med egna tester i `tests/scrub.test.ts`.

Vid krisplansimport läses PDF- och Word-filer på telefonen. Sidhuvuden och sidfötter med namn, personnummer och adress tas bort och sparas inte. Raderna sorteras efter planens rubriker i koden. Bara rader under rubriker som appen inte känner igen skickas, en rubrik i taget och rensade. Användaren ser exakt vad som skickas innan något skickas. Modellen svarar bara med vad varje rad är, aldrig med text. Rader under kända rubriker, som önskemål, rader till vården och kontakter, skickas aldrig. Önskemål, rader till vården och kontakter används inte heller i bedömningen.

Före första anropet till en leverantör visas vart texten går, att leverantörens villkor för lagring och träning gäller, och en länk till villkoren. Samtycket gäller exakt den leverantören och adressen. Byts något av dem frågar appen igen. Appen påstår inget om leverantörens lagring som den inte kan visa. Med en OpenAI-kompatibel adress på det egna nätverket, till exempel Ollama på en hemdator, säger appen att texten inte lämnar användarens enheter.

Om modellen inte svarar, eller svarar fel två gånger, gör appen bedömningen med ordmatchning och visar att det skedde. Hinner modellen inte svara inom tio sekunder visas ordmatchningens resultat först och fylls på när svaret kommer.

Varje bedömning sparar på telefonen det den räknades fram ur: anteckningen som den skickades till modellen (rensad), modellens svar, mätvärdena och vilka regler och vilken prompt som användes. Det gör att bedömningen kan räknas om med nya regler och granskas i efterhand. Uppgifterna sparas på samma sätt som anteckningen och följer med exporten.

Om användaren ansluter Garmin hämtar appen sömn, stress och Body Battery från användarens eget konto med användarens egen Personal API-nyckel. Hämtningen sker från telefonen direkt till Garmin. Appen skickar bara nyckeln och vilka datum den vill ha. Inget av det användaren skriver skickas till Garmin. Garmins Personal API är avsett för personligt bruk av den egna datan.

**Dygnsrytm (experimentell, av som standard).** När den är påslagen hämtar appen också pulsen över dygnet från Garmin, ett anrop per dag och bara för de senaste dagarna, och för tidigare dagar med sömn från klockan, av sig själv medan appen är öppen. Pulsen räknas om på telefonen till aktiva minuter per timme. Själva pulsen sparas inte. Det sparade, appens uppskattning per morgon och de episodstarter personen dokumenterar ligger i appens vanliga lagring, krypterat som allt annat. Inget av det skickas till någon språkmodell. Modellen tar inte emot anteckningar eller avstämningar.

Med en språkmodell kopplad följer dagens och veckans sömn och stress med till kvällens bedömning. Värdena skickas som siffror och datum, går genom samma rensning som all annan text, och visas i texten som sparas för promptbiblioteket.

## Mina tidigare texter (experimentellt)

- **Lagring.** Referenstexter och mönster sparas i appens vanliga lagring, som allt annat: krypterad på telefonen, och krypterad i webbläsaren innan den når Firebase.
- **Exporten** *Exportera texter och mönster* ger en okrypterad JSON-fil. Appen varnar innan.
- **Inget skickas** förrän personen sett förhandsvisningen och slagit på jämförelsen. Därefter:
  - när mönster föreslås: alla texter som får användas, rensade, högst 1 500 tecken var
  - varje kväll: anteckningen och högst 8 utdrag, rensade, högst två per period
- **Akutregeln.** Texter som den reagerar på skickas aldrig, inte heller gamla, och en anteckning med akutträff jämförs aldrig.
- **Meddelanden.** Från meddelandefiler tas bara personens egna rader med.
- **Rensat, inte anonymt.** Smeknamn, arbetsplatser och ovanliga händelser kan finnas kvar i det som skickas.

## Kontextbanken och lärandet

Det appen vet om användaren ligger i kontextbanken på telefonen (i webbversionen i användarens Firebase). Inget lärs in i någon modell, och leverantörernas minnesfunktioner används inte. Varje kväll skickas en sammanställning ur banken med till modellen, rensad på samma sätt som anteckningen.

En gång i månaden, och när en period med gult eller rött är över, kan användaren be appen gå igenom anteckningarna. Då skickas periodens rensade anteckningar till modellen, utom anteckningar som träffat akutregeln. Svaret blir förslag som användaren godkänner eller avvisar ett i taget. Förloppet för en period räknas i appen och skickas inte någonstans.

*Exportera kontext* ger tre läsbara markdownfiler. De är inte krypterade, till skillnad från *Exportera allt*, och appen säger det innan de skapas.

## Akutregeln

En anteckning jämförs på telefonen med en ordlista för tankar på att inte vilja leva eller att skada sig, plus användarens egna akuta formuleringar ur krisplanen. Jämförelsen görs innan något skickas och fungerar utan nätverk. Vid träff visas krisplanens steg vid rött och krisnumren direkt. Anteckningen skickas då inte till språkmodellen, och appen hämtar inte heller något från Garmin. Står formuleringen med en negation, som i "jag vill inte dö", visas en mildare krisruta och dagen räknas som vanligt, men anteckningen skickas inte heller då till språkmodellen. Ordlistan och de egna formuleringarna skickas aldrig till en modell, inte heller vid krisplansimport: rader som träffar listan stannar på telefonen.

## Vad som aldrig händer

- Appen skickar aldrig meddelanden, notiser eller data till någon annan person. Påminnelsen är en lokal notis på användarens egen telefon.
- Appen skickar aldrig orensad text eller ljud till en språkmodell i molnet.
- Appen lägger aldrig till ett tecken eller en åtgärd utan användarens godkännande.
- Appen använder aldrig diagnosord som inte står i krisplanen.
- Appen innehåller inga analysverktyg, ingen kraschrapportering, ingen reklam och inga tredjeparts-SDK:er som skickar data.

## Tangentbordets diktering

Än så länge finns ingen inspelning i appen. Den som använder tangentbordets mikrofon ska veta att dikteringen kan skicka ljud till Apple eller Google, beroende på telefonens inställningar. Det ligger utanför appens kontroll, och appen visar en varning.

## Webbversionen

Webbversionen på Netlify avviker från principen att allt stannar på telefonen. Användaren har valt det för att kunna använda appen utan dator. Datan ligger i Firebase, men krypterad med en nyckel som bara användaren har.

Det som syns för Google är antalet poster, deras storlek och när de ändrades, samt inloggningens e-postadress. Innehållet syns inte.

| Data | Var | Skydd |
| --- | --- | --- |
| Krisplan, anteckningar, bedömningar, kontextbank, inställningar, Garmin-värden | Användarens eget Firebase-projekt (Firestore hos Google, i EU), plus Firestores cache i webbläsaren | Krypterade i webbläsaren innan de sparas: AES-256-GCM med en nyckel som härleds ur ett lösenord som bara användaren känner till (PBKDF2-SHA256, 600 000 iterationer, Web Crypto). Lösenordet och nyckeln lämnar aldrig webbläsaren och sparas inte. Dokumentens id är en HMAC av postens id, så varken typ av post eller datum syns. Firebase har bara krypterad data, saltet och ett kontrollvärde. Glömt lösenord betyder att datan inte går att läsa. Dessutom inloggning, och reglerna i `firestore.rules` låter bara det egna kontot läsa och skriva. |
| Nycklar till språkmodell och Garmin | Användarens Firebase-projekt, med övrig data | Krypterade i webbläsaren med samma nyckel som allt annat, innan de sparas. Följer kontot till alla webbläsare. Ingen okrypterad kopia ligger kvar i webbläsarens lagring. Följer aldrig med en export, och en import tar inte bort dem. |
| Applåsets kod | Webbläsarens lagring | Bara som saltad hash (PBKDF2) |

Två funktioner körs på användarens egen Netlify:

- **Garmin-vidarekopplingen** skickar appens fyra Garmin-anrop vidare, eftersom Garmin inte tar emot anrop från webbläsare. Nyckel, token och svar passerar igenom utan att sparas eller loggas. Inga andra adresser släpps igenom.
- **Kalenderhändelsen** tar emot klockslaget och dagens datum och svarar med en återkommande händelse. Inget annat skickas dit.

Text till språkmodellen går direkt från webbläsaren till leverantören, rensad på samma sätt som i appen. Den passerar inte Netlify eller Firebase.

Firebase-projektet ska inte ha Google Analytics påslaget. Appen laddar bara inloggning och Firestore.

## Import från en annan dagbok

Årsrapporter från Bipolär dagbok läses på enheten och sparas som vanliga dagar, krypterade på samma sätt som allt annat. Ingenting från importen skickas till någon språkmodell. Nivån för varje importerad dag räknas i koden. Garmin-värden för samma period hämtas med användarens egen nyckel och sparas på samma sätt som de senaste dagarnas. En import kan tas bort i sin helhet.

## Användarens rättigheter

- *Exportera allt* skapar en krypterad fil med all data.
- *Radera allt* tar bort databasen och databasnyckeln från telefonen.

## Inför publicering

Apple och Google kräver en integritetsdeklaration innan appen kan publiceras i butikerna. Om appen någon gång börjar larma eller ge kliniska råd behöver den bedömas mot EU:s förordning om medicintekniska produkter (MDR).
