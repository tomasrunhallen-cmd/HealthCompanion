# Integritet i Dagsljus

Dagsljus hanterar uppgifter om psykisk hälsa. Det är den känsligaste kategorin i GDPR (artikel 9). Appen är byggd så att utvecklaren aldrig behandlar någon användardata.

## Var data finns

| Data | Var | Skydd |
| --- | --- | --- |
| Krisplan, anteckningar, bedömningar, inställningar | Bara på telefonen, i en SQLite-databas | Krypterad med SQLCipher i utvecklingsbuild och butiksversion. Nyckeln ligger i iOS Keychain eller Android Keystore och följer inte med backup. |
| Ljud (när inspelning finns) | Telefonen, tillfälligt | Raderas i samma steg som texten sparas |
| Språkmodellens nyckel (steg 2) | Keychain eller Keystore | Visas aldrig i klartext igen |
| Garmin-nyckel (steg 3) | Keychain eller Keystore | |
| Backup | Där användaren själv sparar exportfilen | Krypterad med AES-256-GCM, nyckel från lösenordet med PBKDF2-SHA256 |

I Expo Go går SQLCipher inte att använda. Databasen är då okrypterad och appen säger det på skärmen *Data och integritet*. Webbförhandsvisningen sparar okrypterat i webbläsaren och är bara till för att titta på gränssnittet.

Android-backup är avstängd. På iOS kan databasfilen hamna i iCloud-backup tills en config plugin som utesluter den är på plats. Filen är krypterad och nyckeln följer inte med.

## Vad som lämnar telefonen

I steg 1 lämnar ingenting telefonen. Bedömningen görs med ordmatchning på telefonen.

Från steg 2 skickas **rensad text** till den språkmodell användaren själv har valt, med användarens egen nyckel. Rensningen tar alltid bort:

- personnummer, telefonnummer, e-postadresser, gatuadresser, postnummer och länkar
- namn från användarens egen lista och namn som hittas i krisplanen
- journaltermer som avdelningsnummer och patient-id

Rensningen körs på telefonen, också när modellen är lokal. Den är en ren funktion med egna tester i `tests/scrub.test.ts`.

Före första anropet visas vilken leverantör texten går till, att leverantörens villkor för lagring och träning gäller, och en länk till dem. Appen påstår inget om leverantörens lagring som den inte kan visa. Med en modell på en egen dator eller på telefonen lämnar texten aldrig användarens enheter.

Från steg 3 hämtar appen sömn och stress från användarens eget Garmin-konto.

## Vad som aldrig händer

- Appen skickar aldrig meddelanden, notiser eller data till någon annan person. Påminnelsen är en lokal notis på användarens egen telefon.
- Appen skickar aldrig orensad text eller ljud till en språkmodell i molnet.
- Appen lägger aldrig till ett tecken eller en åtgärd utan användarens godkännande.
- Appen använder aldrig diagnosord som inte står i krisplanen.
- Appen innehåller inga analysverktyg, ingen kraschrapportering, ingen reklam och inga tredjeparts-SDK:er som skickar data.

## Tangentbordets diktering

I steg 1 finns ingen inspelning i appen. Den som använder tangentbordets mikrofon ska veta att dikteringen kan skicka ljud till Apple eller Google, beroende på telefonens inställningar. Det ligger utanför appens kontroll, och appen visar en varning.

## Användarens rättigheter

- *Exportera allt* skapar en krypterad fil med all data.
- *Radera allt* tar bort databasen och databasnyckeln från telefonen.

## Inför publicering

Apple och Google kräver en integritetsdeklaration innan appen kan publiceras i butikerna. Om appen någon gång börjar larma eller ge kliniska råd behöver den bedömas mot EU:s förordning om medicintekniska produkter (MDR).
