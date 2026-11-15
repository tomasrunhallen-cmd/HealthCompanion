---
id: akut
version: 0.6.0
status: utkast, ska granskas av en människa med klinisk kunskap innan release
---
# Akutordlista

Formuleringar om att inte vilja leva eller att skada sig. Matchas i appen, på telefonen,
innan något skickas till en språkmodell och oberoende av den. Listan skickas aldrig till
en modell. Användarens egna formuleringar läggs till från krisplanen.

Fraserna matchas ord för ord. De tål böjningar ("skadar" och "skada"), utdragna
bokstäver ("döö") och upp till tre ord emellan ("vill verkligen just nu dö"). Kärnorden matchar som början på ett ord,
hur många bokstäver som än följer: "självmord" ger träff på "självmordstankar",
"självmordsplaner" och "självmordsförsök". Kärnord med minst åtta bokstäver tål en
bokstav fel, borta eller omkastad ("sjävmordstankar"). Undantagen är kända falska träffar, ord
eller fraser: deras ord räknas aldrig som en böjning av ett ord i en fras ("jag
skärper mig" är inte "skär mig"), bara som exakt samma ord. Anteckningen läses sats för sats.

- Träff utan negation: krisrutan, dagen blir röd, ingenting skickas eller hämtas.
- Träff med en negation mellan orden eller upp till två ord före frasen i samma sats
  ("vill inte dö", "tänker inte göra mig illa", "har aldrig haft självmordstankar"):
  en mildare krisruta med planens steg vid rött och numren. Dagen blir inte röd av
  detta, och anteckningen skickas inte till modellen.
- Träff som handlar om något förr, någon annan eller ett ämne: samma mildare ruta. Hjälpen
  visas alltid, men dagen bokförs inte som akut. Var sammanhangsordet står avgör, se de tre
  listorna nedan (lista 0.6.0): "Jag vill dö och min vän vet om det" gäller personen själv,
  "Min vän vill dö" gör det inte. Personens egna formuleringar räknas alltid fullt.

## Fraser

- vill inte leva
- vet inte om jag orkar leva
- vill inte vara med längre
- orkar inte finnas
- orkar inte leva
- inte vill leva
- inte vilja leva
- vill dö
- vill vara död
- önskar att jag var död
- ta livet av mig
- ta mitt liv
- ta mitt eget liv
- avsluta mitt liv
- avsluta allt
- göra slut på allt
- göra slut på mig
- inte finnas längre
- bättre om jag inte fanns
- bättre utan mig
- försvinna för alltid
- skada mig själv
- göra mig illa
- skadar mig själv
- skära mig
- skär mig
- skar mig
- hoppa framför tåget
- tabletter för att dö
- vill inte finnas
- pallar inte leva
- ska skada mig
- vill skada mig
- tänker skada mig
- skadat mig själv
- skurit mig
- hänga mig
- dränka mig
- hoppa från bron
- hoppa från balkongen
- ta en överdos
- samlat tabletter
- sparat tabletter
- somna och aldrig vakna
- aldrig vakna igen
- aldrig vakna mer
- inte vakna igen
- somna in för gott
- want to die
- kill myself
- end my life
- hurt myself

## Kärnord

- självmord
- suicid
- självskad
- dödslängt
- dödstank
- dödsönsk
- livsled
- avskedsbrev

## Undantag

- för mig själv
- skärper
- skärpa
- skärpte
- skärpt

## Sammanhang: tid

Gäller i hela satsen, utom när det är en jämförelse ("precis som för tio år sedan").

- år sedan
- länge sedan
- som barn
- som tonåring
- i tonåren

## Sammanhang: person

Gäller bara när personen nämns före träffen och inget "jag" står mellan ("Min vän vill dö").
"Min mamma vet inte att jag vill dö" och "Jag vill dö och min vän vet om det" gäller personen själv.

- min vän
- min kompis
- min mamma
- min pappa
- min bror
- min syster
- min kollega
- min partner
- min sambo

## Sammanhang: ämne

Gäller när ordet sitter i träffordet ("självmordsprevention"), står direkt efter träffen
("dö av skratt"), eller när satsen saknar "jag" före träffen ("Filmen handlar om självmord").

- prevention
- statistik
- forskning
- utbildning
- föreläsning
- film
- serie
- bok
- boken
- artikel
- dikt
- nyhet
- podd
- ekonomisk
- politisk
- av skratt
