---
id: krisplan-rubriker
version: 1.0.0
status: utkast, ska granskas av en människa med klinisk kunskap innan release
---
# Rubriker i krisplaner

Appen sorterar raderna i en krisplan efter planens egna rubriker, i koden och utan språkmodell. En rad ärver fälten från alla rubriker ovanför sig. När flera mönster passar samma rubrik vinner det längsta mönstret för varje fält. Bara rader under rubriker som ingen regel känner igen skickas till språkmodellen, rensade, en rubrik i taget.

- **Mönster:** ord som ska finnas i rubriken, skilda med kommatecken. Stora och små bokstäver spelar ingen roll.
- **Nivå:** *huvud* för en huvudrubrik, *under* för en underrubrik. Används när den inklistrade texten inte visar nivån.
- **Fält:** `kind`, `severity`, `observer`, `when`, `who` och `polarity` enligt appens datamodell. `ladder=ja` betyder att raderna är steg i en trappa och numreras i den ordning de står. `special=normal` betyder normalläge.

| Mönster | Nivå | Fält |
| --- | --- | --- |
| värdeankare, det som är viktigt för mig | huvud | kind=value_anchor |
| risksituationer, risksituation, utlösande faktorer, utlösare, triggers | huvud | kind=trigger |
| tidiga varningstecken, tidiga tecken, tidiga signaler, varningstecken | huvud | kind=sign severity=early |
| tecken som brukar tyda på allvarlig försämring, allvarlig försämring, allvarliga tecken, allvarliga varningstecken, sena tecken | huvud | kind=sign severity=serious |
| överenskomna åtgärder vid tidiga varningstecken, åtgärder vid tidiga varningstecken, åtgärder vid tidiga tecken, vid gult | huvud | kind=action when=early |
| överenskomna åtgärder vid allvarlig försämring, åtgärder vid allvarlig försämring, åtgärder vid allvarliga tecken, vid rött | huvud | kind=action when=serious |
| strategier för att undvika tvångsåtgärder, undvika tvångsåtgärder, undvika tvång | huvud | kind=action when=serious ladder=ja |
| livsstil och rutiner, livsstil, rutiner, egenvård | huvud | kind=routine |
| patientens önskemål, mina önskemål, önskemål | huvud | kind=wish |
| rekommendationer, rekommendationer till vården, till vården | huvud | kind=note_for_care |
| kontaktuppgifter, viktiga telefonnummer, telefonnummer, kontakter | huvud | kind=contact |
| normalläge, när jag mår bra | huvud | special=normal |
| mani, hypomani, manisk, uppvarvad, uppvarvning | under | polarity=up |
| depression, depressiv, nedstämd, nedstämdhet | under | polarity=down |
| tecken för omgivningen, tecken som andra ser, andra kan se, omgivningen | under | observer=others |
| egna upplevelser, egna tecken, det jag själv märker | under | observer=self |
| vad jag själv gör, egna åtgärder, jag själv | under | who=me |
| vad mina närstående gör, närstående, anhöriga, familjen | under | who=relative |
| vad mottagningen gör, vad vården gör, mottagningen, vården, psykiatrin | under | who=care |
| alltid, oavsett | under | when=always |

## Ledtrådar i radens text

Används bara för steg i en trappa, där rubriken inte säger vem som gör något. Det första ordet som passar avgör.

| Ord | Fält |
| --- | --- |
| närstående, anhöriga, bror, syster, partner, sambo, familjen, mamma, pappa | who=relative |
| mottagningen, vården, sjuksköterska, läkare, psykiatrin, kontaktperson | who=care |
