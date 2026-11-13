# Integritetspolicy för Dagsljus

Gäller från 1 november 2026.

Dagsljus är en stämningsdagbok. Varje kväll jämför appen en kort anteckning med tecknen i din egen krisplan och visar en nivå: grönt, gult eller rött. Appen ställer ingen diagnos och ersätter inte vården. Prata med din läkare eller vårdkontakt innan du fattar beslut om din behandling.

## Vem som ansvarar

Personuppgiftsansvarig är **[NAMN PÅ UTGIVAREN]**. Frågor om dina uppgifter skickar du till **[KONTAKTADRESS]**.

## Kort sagt

- I telefonappen stannar allt på din telefon, krypterat. Utgivaren har ingen server och kan inte se något av det du skriver.
- Appen har ingen reklam, ingen analys av hur du använder den och ingen spårning.
- Text lämnar telefonen bara om du själv kopplar en språkmodell med din egen nyckel och godkänner vart texten går. Då skickas den rensad på namn och nummer.
- Du kan radera allt i appen när du vill.

## Vilka uppgifter appen hanterar

- Din krisplan: tecken, åtgärder och det du själv skrivit om dig.
- Kvällens anteckning, stämning och energi, och dina svar om medicin och om alkohol, sjukdom eller träning.
- Appens bedömningar och dina rättelser av dem.
- Det appen lärt sig om dig, men bara det du själv godkänt.
- Om du ansluter Garmin: sömn, insomning, stress och Body Battery per dag.
- Dagar du importerat från en annan dagbok.
- Nycklar till din språkmodell och till Garmin.

## Var uppgifterna finns

**Telefonappen.** Allt sparas i en krypterad databas på telefonen. Krypteringsnyckeln och dina nycklar ligger i telefonens nyckelring (Keychain eller Keystore) och följer inte med i säkerhetskopior.

**Webbversionen.** Om du använder webbversionen sparas uppgifterna i ditt eget Firebase-projekt hos Google, i EU. De krypteras i webbläsaren innan de sparas, med en nyckel som görs av ett lösenord som bara du känner till. Lösenordet lämnar aldrig webbläsaren. Google kan inte läsa innehållet. Glömmer du lösenordet går uppgifterna inte att läsa för någon.

## När något lämnar telefonen

Det händer bara efter ditt eget val.

- **Språkmodell.** Om du kopplar en språkmodell (till exempel Mistral eller Anthropic) med din egen nyckel skickas kvällens anteckning och en sammanställning ur din krisplan till den leverantören, för att hitta dina tecken i texten. En gång per dag skickas också dina rutiners ord och hur ofta du gjort dem, för dagens förslag på startsidan; det kan stängas av under Rutiner. Innan första anropet visar appen vart texten går, och du måste godkänna det. Namn, telefonnummer, personnummer, e-post, adresser och länkar tas bort på telefonen först. Leverantörens egna villkor gäller för det de tar emot, och vissa sparar text en tid för att motverka missbruk. Anteckningar med formuleringar om att inte vilja leva skickas aldrig.
- **Garmin.** Om du ansluter Garmin skickar appen din Garmin-nyckel och vilka datum den vill ha till Garmin och får tillbaka dina värden. I webbversionen går anropet via en liten funktion på appens webbplats som inte sparar något.
- **Påminnelse i webbversionen.** Klockslaget skickas till appens webbplats, som svarar med en kalenderhändelse. Inget sparas.

Appen kontaktar aldrig någon person åt dig. Krisnumren öppnar telefonens uppringning.

## Hur länge uppgifterna sparas

Tills du raderar dem. Alla Garmin-värden appen hämtat, också för perioder du importerat, sparas på samma sätt som resten.

## Dina val

- **Koppla bort språkmodellen** under Inställningar. Nyckeln raderas, och inget mer skickas.
- **Koppla bort Garmin** under Inställningar. Nyckeln raderas.
- **Se allt appen vet om dig** under Jag, Det appen vet om mig, och ändra eller radera det.
- **Exportera allt** till en fil som är krypterad med ett lösenord du väljer.
- **Radera allt** under Inställningar. Databasen och dess nyckel tas bort från telefonen. I webbversionen raderas också uppgifterna i ditt Firebase-projekt.

## Apple Hälsa

Appen använder inte Apple Hälsa.

## Ändringar

Ändras policyn står det nya datumet överst, och appen säger till.
