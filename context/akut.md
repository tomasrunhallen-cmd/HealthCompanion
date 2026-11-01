---
id: akut
version: 0.2.0
status: utkast, ska granskas av en människa med klinisk kunskap innan release
---
# Akutordlista

Formuleringar om att inte vilja leva eller att skada sig. Matchas i appen, på telefonen,
innan något skickas till en språkmodell och oberoende av den. Listan skickas aldrig till
en modell. Användarens egna formuleringar läggs till från krisplanen.

Matchningen tål böjningar ("skadar" och "skada") och upp till två ord emellan
("vill verkligen inte leva"). Den läses sats för sats.

- Träff utan negation: krisrutan, dagen blir röd, ingenting skickas eller hämtas.
- Träff med en negation mellan orden eller upp till två ord före frasen i samma sats
  ("vill inte dö", "tänker inte göra mig illa", "har aldrig haft självmordstankar"):
  en mildare krisruta med planens steg vid rött och numren. Dagen blir inte röd av
  detta, och anteckningen skickas inte till modellen.

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
- självmord
- självmordstankar
- suicid
- suicidtankar
- dödstankar
- skada mig själv
- göra mig illa
- skadar mig själv
- självskada
- skära mig
- skär mig
- skar mig
- hoppa framför tåget
- tabletter för att dö
