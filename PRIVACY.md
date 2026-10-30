# Integritet i Dagsljus

Dagsljus hanterar uppgifter om psykisk hälsa. Det är den känsligaste kategorin i GDPR (artikel 9). Appen är byggd så att utvecklaren aldrig behandlar någon användardata.

## Var data finns

| Data | Var | Skydd |
| --- | --- | --- |
| Krisplan, anteckningar, bedömningar, inställningar | Bara på telefonen, i en SQLite-databas | Krypterad med SQLCipher i utvecklingsbuild och butiksversion. Nyckeln ligger i iOS Keychain eller Android Keystore och följer inte med backup. |
| Ljud (när inspelning finns) | Telefonen, tillfälligt | Raderas i samma steg som texten sparas |
| Språkmodellens nyckel | Keychain eller Keystore, bara på den här enheten | Visas aldrig i klartext igen. Följer inte med backup eller export. Raderas med *Radera allt* och *Använd ingen språkmodell*. |
| Tokenräkning och senast skickade text | Databasen på telefonen | Används för kostnadsuppskattningen och promptbiblioteket |
| Garmin-nyckel (steg 3) | Keychain eller Keystore | |
| Backup | Där användaren själv sparar exportfilen | Krypterad med AES-256-GCM, nyckel från lösenordet med PBKDF2-SHA256 |

I Expo Go går SQLCipher inte att använda. Databasen är då okrypterad och appen säger det på skärmen *Data och integritet*. Webbförhandsvisningen sparar okrypterat i webbläsaren och är bara till för att titta på gränssnittet.

Android-backup är avstängd. På iOS kan databasfilen hamna i iCloud-backup tills en config plugin som utesluter den är på plats. Filen är krypterad och nyckeln följer inte med.

## Vad som lämnar telefonen

Utan språkmodell lämnar ingenting telefonen. Bedömningen görs då med ordmatchning på telefonen.

Med en språkmodell kopplad skickas **rensad text** till den leverantör användaren själv har valt, med användarens egen nyckel. Det gäller kvällens anteckning, normalläget, planens tecken och, vid import, den inklistrade krisplanen. Rensningen tar alltid bort:

- personnummer, telefonnummer, e-postadresser, gatuadresser, postnummer och länkar
- namn från användarens egen lista och namn som hittas i krisplanen
- journaltermer som avdelningsnummer och patient-id

Rensningen körs på telefonen, också när modellen är lokal. Den är en ren funktion med egna tester i `tests/scrub.test.ts`.

Vid krisplansimport får varje namn och nummer en numrerad platshållare, till exempel [NAMN1]. Användaren ser den rensade texten med markeringar och godkänner den innan den skickas. När svaret kommer sätts originalen tillbaka på telefonen. Kopplingen mellan platshållare och original lämnar aldrig telefonen.

Före första anropet till en leverantör visas vart texten går, att leverantörens villkor för lagring och träning gäller, och en länk till villkoren. Samtycket gäller exakt den leverantören och adressen. Byts något av dem frågar appen igen. Appen påstår inget om leverantörens lagring som den inte kan visa. Med en OpenAI-kompatibel adress på det egna nätverket, till exempel Ollama på en hemdator, säger appen att texten inte lämnar användarens enheter.

Om modellen inte svarar, eller svarar fel två gånger, gör appen bedömningen med ordmatchning och visar att det skedde.

Från steg 3 hämtar appen sömn och stress från användarens eget Garmin-konto.

## Vad som aldrig händer

- Appen skickar aldrig meddelanden, notiser eller data till någon annan person. Påminnelsen är en lokal notis på användarens egen telefon.
- Appen skickar aldrig orensad text eller ljud till en språkmodell i molnet.
- Appen lägger aldrig till ett tecken eller en åtgärd utan användarens godkännande.
- Appen använder aldrig diagnosord som inte står i krisplanen.
- Appen innehåller inga analysverktyg, ingen kraschrapportering, ingen reklam och inga tredjeparts-SDK:er som skickar data.

## Tangentbordets diktering

Än så länge finns ingen inspelning i appen. Den som använder tangentbordets mikrofon ska veta att dikteringen kan skicka ljud till Apple eller Google, beroende på telefonens inställningar. Det ligger utanför appens kontroll, och appen visar en varning.

## Användarens rättigheter

- *Exportera allt* skapar en krypterad fil med all data.
- *Radera allt* tar bort databasen och databasnyckeln från telefonen.

## Inför publicering

Apple och Google kräver en integritetsdeklaration innan appen kan publiceras i butikerna. Om appen någon gång börjar larma eller ge kliniska råd behöver den bedömas mot EU:s förordning om medicintekniska produkter (MDR).
