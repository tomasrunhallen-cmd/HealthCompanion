---
id: testfall
version: 2.6.0
response: data
---
# Testfall

Testfallen för ampeln och för knappen *Testa modellen*. Varje fall har en anteckning, mätvärden, en historik, den nivå appen ska ge och ett referenssvar.

**Referenssvaret** är det svar en noggrann modell ska ge: vilka tecken i planen anteckningen beskriver, med ett ordagrant citat. Enhetstesterna skickar referenssvaren genom hela kedjan (rensning, schema, poäng i koden) och kontrollerar att varje fall ger sin nivå. Fall med `"akut"` når aldrig modellen; akutregeln avgör dem i koden.

**Godkännande.** *Testa modellen* godkänner en ny modell bara om alla fall ger samma nivå som här, och visar vilka fall som skilde sig. En ändrad analysprompt måste klara alla fall med en riktig modell innan den checkas in: kör `npm run prompt:check` (se README). Godkännandet sparas i `prompts/godkand.json`, och ett test stoppar en prompt som ändrats utan nytt godkännande.

Historiken räknas bakåt från fallets kväll. `time` är klockslaget då inlägget gjordes; inlägg före 04:00 hör till dagen innan (dygnet går 04:00–04:00). `sleepStart` är insomningen enligt Garmin. `medication` är svaret på medicinfrågan per kväll, räknat i dagar bakåt (0 är i dag). `plan: "standard"` kör fallet med standardinnehållet obekräftat i stället för testplanens tecken. `trend` är de neutrala raderna som en grön dag ska visa. `redActions: true` betyder att ett allvarligt tecken syntes och att bedömningen ska visa planens åtgärder vid rött, även när nivån är gul.

```json
{
  "plan": {
    "normalState": "Jag sover sju till åtta timmar, jobbar dagtid och träffar vänner på helgerna.",
    "sleepThresholdHours": 5,
    "signs": [
      {
        "id": "s1",
        "kind": "early",
        "text": "Svarar inte på sms"
      },
      {
        "id": "s2",
        "kind": "early",
        "text": "Handlar saker jag inte behöver"
      },
      {
        "id": "s3",
        "kind": "early",
        "text": "Massor av nya projekt samtidigt"
      },
      {
        "id": "s4",
        "kind": "serious",
        "text": "Slutar äta"
      },
      {
        "id": "s5",
        "kind": "serious",
        "text": "Känner att andra är emot mig"
      }
    ],
    "actions": [
      {
        "kind": "action_yellow",
        "text": "Håll fasta tider för sömn och mat"
      },
      {
        "kind": "action_red",
        "text": "Ring min vårdkontakt i dag"
      },
      {
        "kind": "action_red",
        "text": "Be någon jag litar på att vara med mig i kväll"
      }
    ],
    "context": [
      {
        "kind": "false_alarm",
        "text": "Storhandla inför helger och fester är inte att handla saker jag inte behöver"
      },
      {
        "kind": "medication",
        "text": "Tar min medicin varje kväll"
      }
    ]
  },
  "histories": {
    "gron_vecka": [
      {
        "daysAgo": 1,
        "time": "21:00",
        "mood": 0,
        "energy": 5,
        "wordsPerMinute": 120,
        "sleepHours": 7.5,
        "stressAvg": 30,
        "level": "green"
      },
      {
        "daysAgo": 2,
        "time": "21:15",
        "mood": 0,
        "energy": 6,
        "wordsPerMinute": 118,
        "sleepHours": 7,
        "stressAvg": 30,
        "level": "green"
      },
      {
        "daysAgo": 3,
        "time": "20:45",
        "mood": 0,
        "energy": 5,
        "wordsPerMinute": 125,
        "sleepHours": 8,
        "stressAvg": 30,
        "level": "green"
      },
      {
        "daysAgo": 4,
        "time": "21:30",
        "mood": 0,
        "energy": 5,
        "wordsPerMinute": 122,
        "sleepHours": 7.5,
        "stressAvg": 30,
        "level": "green"
      },
      {
        "daysAgo": 5,
        "time": "21:05",
        "mood": 1,
        "energy": 6,
        "wordsPerMinute": 119,
        "sleepHours": 7,
        "stressAvg": 30,
        "level": "green"
      },
      {
        "daysAgo": 6,
        "time": "20:50",
        "mood": 0,
        "energy": 5,
        "wordsPerMinute": 121,
        "sleepHours": 8,
        "stressAvg": 30,
        "level": "green"
      },
      {
        "daysAgo": 7,
        "time": "21:20",
        "mood": 0,
        "energy": 6,
        "wordsPerMinute": 117,
        "sleepHours": 7.5,
        "stressAvg": 30,
        "level": "green"
      }
    ],
    "gron_vecka_sedan_tyst": [
      {
        "daysAgo": 3,
        "time": "21:00",
        "mood": 0,
        "energy": 5,
        "wordsPerMinute": 120,
        "sleepHours": 7.5,
        "stressAvg": 30,
        "level": "green"
      },
      {
        "daysAgo": 4,
        "time": "21:15",
        "mood": 0,
        "energy": 6,
        "wordsPerMinute": 118,
        "sleepHours": 7,
        "stressAvg": 30,
        "level": "green"
      },
      {
        "daysAgo": 5,
        "time": "20:45",
        "mood": 0,
        "energy": 5,
        "wordsPerMinute": 125,
        "sleepHours": 8,
        "stressAvg": 30,
        "level": "green"
      },
      {
        "daysAgo": 6,
        "time": "21:30",
        "mood": 0,
        "energy": 5,
        "wordsPerMinute": 122,
        "sleepHours": 7.5,
        "stressAvg": 30,
        "level": "green"
      },
      {
        "daysAgo": 7,
        "time": "21:05",
        "mood": 1,
        "energy": 6,
        "wordsPerMinute": 119,
        "sleepHours": 7,
        "stressAvg": 30,
        "level": "green"
      },
      {
        "daysAgo": 8,
        "time": "20:50",
        "mood": 0,
        "energy": 5,
        "wordsPerMinute": 121,
        "sleepHours": 8,
        "stressAvg": 30,
        "level": "green"
      },
      {
        "daysAgo": 9,
        "time": "21:20",
        "mood": 0,
        "energy": 6,
        "wordsPerMinute": 117,
        "sleepHours": 7.5,
        "stressAvg": 30,
        "level": "green"
      }
    ],
    "kort_somn_i_gar": [
      {
        "daysAgo": 1,
        "time": "21:00",
        "mood": 0,
        "energy": 5,
        "wordsPerMinute": 120,
        "sleepHours": 4.5,
        "stressAvg": 30,
        "level": "yellow"
      },
      {
        "daysAgo": 2,
        "time": "21:15",
        "mood": 0,
        "energy": 6,
        "wordsPerMinute": 118,
        "sleepHours": 7,
        "stressAvg": 30,
        "level": "green"
      },
      {
        "daysAgo": 3,
        "time": "20:45",
        "mood": 0,
        "energy": 5,
        "wordsPerMinute": 125,
        "sleepHours": 8,
        "stressAvg": 30,
        "level": "green"
      },
      {
        "daysAgo": 4,
        "time": "21:30",
        "mood": 0,
        "energy": 5,
        "wordsPerMinute": 122,
        "sleepHours": 7.5,
        "stressAvg": 30,
        "level": "green"
      },
      {
        "daysAgo": 5,
        "time": "21:05",
        "mood": 1,
        "energy": 6,
        "wordsPerMinute": 119,
        "sleepHours": 7,
        "stressAvg": 30,
        "level": "green"
      },
      {
        "daysAgo": 6,
        "time": "20:50",
        "mood": 0,
        "energy": 5,
        "wordsPerMinute": 121,
        "sleepHours": 8,
        "stressAvg": 30,
        "level": "green"
      },
      {
        "daysAgo": 7,
        "time": "21:20",
        "mood": 0,
        "energy": 6,
        "wordsPerMinute": 117,
        "sleepHours": 7.5,
        "stressAvg": 30,
        "level": "green"
      }
    ],
    "tre_gula_dagar": [
      {
        "daysAgo": 1,
        "time": "21:00",
        "mood": 0,
        "energy": 5,
        "wordsPerMinute": 120,
        "sleepHours": 7.5,
        "stressAvg": 30,
        "level": "yellow"
      },
      {
        "daysAgo": 2,
        "time": "21:15",
        "mood": 0,
        "energy": 6,
        "wordsPerMinute": 118,
        "sleepHours": 7,
        "stressAvg": 30,
        "level": "yellow"
      },
      {
        "daysAgo": 3,
        "time": "20:45",
        "mood": 0,
        "energy": 5,
        "wordsPerMinute": 125,
        "sleepHours": 8,
        "stressAvg": 30,
        "level": "yellow"
      },
      {
        "daysAgo": 4,
        "time": "21:30",
        "mood": 0,
        "energy": 5,
        "wordsPerMinute": 122,
        "sleepHours": 7.5,
        "stressAvg": 30,
        "level": "green"
      },
      {
        "daysAgo": 5,
        "time": "21:05",
        "mood": 1,
        "energy": 6,
        "wordsPerMinute": 119,
        "sleepHours": 7,
        "stressAvg": 30,
        "level": "green"
      },
      {
        "daysAgo": 6,
        "time": "20:50",
        "mood": 0,
        "energy": 5,
        "wordsPerMinute": 121,
        "sleepHours": 8,
        "stressAvg": 30,
        "level": "green"
      },
      {
        "daysAgo": 7,
        "time": "21:20",
        "mood": 0,
        "energy": 6,
        "wordsPerMinute": 117,
        "sleepHours": 7.5,
        "stressAvg": 30,
        "level": "green"
      }
    ],
    "gron_vecka_utan_igar": [
      {
        "daysAgo": 2,
        "time": "21:15",
        "mood": 0,
        "energy": 6,
        "wordsPerMinute": 118,
        "sleepHours": 7,
        "stressAvg": 30,
        "level": "green"
      },
      {
        "daysAgo": 3,
        "time": "20:45",
        "mood": 0,
        "energy": 5,
        "wordsPerMinute": 125,
        "sleepHours": 8,
        "stressAvg": 30,
        "level": "green"
      },
      {
        "daysAgo": 4,
        "time": "21:30",
        "mood": 0,
        "energy": 5,
        "wordsPerMinute": 122,
        "sleepHours": 7.5,
        "stressAvg": 30,
        "level": "green"
      },
      {
        "daysAgo": 5,
        "time": "21:05",
        "mood": 1,
        "energy": 6,
        "wordsPerMinute": 119,
        "sleepHours": 7,
        "stressAvg": 30,
        "level": "green"
      },
      {
        "daysAgo": 6,
        "time": "20:50",
        "mood": 0,
        "energy": 5,
        "wordsPerMinute": 121,
        "sleepHours": 8,
        "stressAvg": 30,
        "level": "green"
      },
      {
        "daysAgo": 7,
        "time": "21:20",
        "mood": 0,
        "energy": 6,
        "wordsPerMinute": 117,
        "sleepHours": 7.5,
        "stressAvg": 30,
        "level": "green"
      }
    ],
    "kortare_somn": [
      {
        "daysAgo": 1,
        "time": "21:00",
        "mood": 0,
        "energy": 5,
        "wordsPerMinute": 120,
        "sleepHours": 6.0,
        "stressAvg": 30,
        "level": "green"
      },
      {
        "daysAgo": 2,
        "time": "21:15",
        "mood": 0,
        "energy": 6,
        "wordsPerMinute": 118,
        "sleepHours": 6.5,
        "stressAvg": 30,
        "level": "green"
      },
      {
        "daysAgo": 3,
        "time": "20:45",
        "mood": 0,
        "energy": 5,
        "wordsPerMinute": 125,
        "sleepHours": 8,
        "stressAvg": 30,
        "level": "green"
      },
      {
        "daysAgo": 4,
        "time": "21:30",
        "mood": 0,
        "energy": 5,
        "wordsPerMinute": 122,
        "sleepHours": 7.5,
        "stressAvg": 30,
        "level": "green"
      },
      {
        "daysAgo": 5,
        "time": "21:05",
        "mood": 1,
        "energy": 6,
        "wordsPerMinute": 119,
        "sleepHours": 7,
        "stressAvg": 30,
        "level": "green"
      },
      {
        "daysAgo": 6,
        "time": "20:50",
        "mood": 0,
        "energy": 5,
        "wordsPerMinute": 121,
        "sleepHours": 8,
        "stressAvg": 30,
        "level": "green"
      },
      {
        "daysAgo": 7,
        "time": "21:20",
        "mood": 0,
        "energy": 6,
        "wordsPerMinute": 117,
        "sleepHours": 7.5,
        "stressAvg": 30,
        "level": "green"
      }
    ]
  },
  "cases": [
    {
      "id": "lugn-dag",
      "name": "En lugn dag ger grönt",
      "expected": "green",
      "history": "gron_vecka",
      "entry": {
        "time": "21:10",
        "note": "Lugn dag. Jobbade, lagade middag och gick en promenad med hunden. Känns som vanligt.",
        "mood": 0,
        "energy": 5,
        "wordsPerMinute": 121,
        "sleepHours": 7.5
      },
      "reference": {
        "matches": []
      }
    },
    {
      "id": "orkade-inte-svara",
      "name": "Ett tidigt tecken och inget annat ger gult",
      "expected": "yellow",
      "history": "gron_vecka",
      "entry": {
        "time": "21:00",
        "note": "Orkade inte svara på sms i dag.",
        "mood": 0,
        "energy": 5,
        "wordsPerMinute": null,
        "sleepHours": 7
      },
      "reference": {
        "matches": [
          {
            "sign": "Svarar inte på sms",
            "quote": "Orkade inte svara på sms i dag"
          }
        ]
      }
    },
    {
      "id": "omskrivet-tecken",
      "name": "Ett tecken med andra ord än i planen ger gult",
      "expected": "yellow",
      "history": "gron_vecka",
      "entry": {
        "time": "21:05",
        "note": "Telefonen har legat i en låda hela dagen. Har låtit alla meddelanden från vänner ligga olästa.",
        "mood": 0,
        "energy": 5,
        "wordsPerMinute": 121,
        "sleepHours": 7.5
      },
      "reference": {
        "matches": [
          {
            "sign": "Svarar inte på sms",
            "quote": "Har låtit alla meddelanden från vänner ligga olästa"
          }
        ]
      }
    },
    {
      "id": "negation",
      "name": "”Jag har inte slutat svara på sms” är inget tecken och ger grönt",
      "expected": "green",
      "history": "gron_vecka",
      "entry": {
        "time": "21:00",
        "note": "Jag har inte slutat svara på sms, skrev med flera vänner i kväll. Vanlig dag annars.",
        "mood": 0,
        "energy": 5,
        "wordsPerMinute": 121,
        "sleepHours": 7.5
      },
      "reference": {
        "matches": []
      }
    },
    {
      "id": "kant-falsklarm",
      "name": "Ett känt falsklarm ger ingen poäng och grönt",
      "expected": "green",
      "history": "gron_vecka",
      "entry": {
        "time": "21:20",
        "note": "Storhandlade inför helgens fest, fyllde hela bilen med mat och dryck. Annars en lugn dag.",
        "mood": 0,
        "energy": 5,
        "wordsPerMinute": 121,
        "sleepHours": 7.5
      },
      "reference": {
        "matches": []
      }
    },
    {
      "id": "allvarligt-ensamt",
      "name": "Ett allvarligt tecken ensamt ger gult, med planens åtgärder vid rött",
      "expected": "yellow",
      "redActions": true,
      "history": "gron_vecka",
      "entry": {
        "time": "21:00",
        "note": "Känner att alla på jobbet är emot mig. Satt mest för mig själv på lunchen.",
        "mood": 0,
        "energy": 5,
        "wordsPerMinute": 121,
        "sleepHours": 7.5
      },
      "reference": {
        "matches": [
          {
            "sign": "Känner att andra är emot mig",
            "quote": "Känner att alla på jobbet är emot mig"
          }
        ]
      }
    },
    {
      "id": "allvarligt-plus-annat",
      "name": "Ett allvarligt tecken och ett tidigt tecken ger rött",
      "expected": "red",
      "redActions": true,
      "history": "gron_vecka",
      "entry": {
        "time": "21:15",
        "note": "Har slutat äta ordentligt, hoppade över både lunch och middag. Köpte dessutom två dyra jackor som jag inte behöver.",
        "mood": 0,
        "energy": 6,
        "wordsPerMinute": 121,
        "sleepHours": 7.5
      },
      "reference": {
        "matches": [
          {
            "sign": "Slutar äta",
            "quote": "Har slutat äta ordentligt"
          },
          {
            "sign": "Handlar saker jag inte behöver",
            "quote": "Köpte dessutom två dyra jackor som jag inte behöver"
          }
        ]
      }
    },
    {
      "id": "precis-under-gult",
      "name": "Precis under gränserna (5 h sömn, 150 ord per minut, stress 39 mot 30) ger grönt",
      "expected": "green",
      "history": "gron_vecka",
      "entry": {
        "time": "23:30",
        "note": "Lite trött och seg i dag. Jobbade och gick hem tidigt.",
        "mood": -1,
        "energy": 3,
        "wordsPerMinute": 150,
        "sleepHours": 5,
        "stressAvg": 39
      },
      "reference": {
        "matches": []
      }
    },
    {
      "id": "precis-pa-gult",
      "name": "Samma dag med 4,9 timmars sömn ger en poäng och gult",
      "expected": "yellow",
      "history": "gron_vecka",
      "entry": {
        "time": "23:30",
        "note": "Lite trött och seg i dag. Jobbade och gick hem tidigt.",
        "mood": -1,
        "energy": 3,
        "wordsPerMinute": 150,
        "sleepHours": 4.9,
        "stressAvg": 39
      },
      "reference": {
        "matches": []
      }
    },
    {
      "id": "kort-somn-snabbt-tal-natt",
      "name": "Fyra timmars sömn, 180 ord per minut och inlägg 01:15 ger gult första dagen",
      "expected": "yellow",
      "history": "gron_vecka",
      "entry": {
        "time": "01:15",
        "note": "Kunde inte somna så jag pratar in det här nu. Det har varit en lång dag på jobbet.",
        "mood": 0,
        "energy": 6,
        "wordsPerMinute": 180,
        "sleepHours": 4
      },
      "reference": {
        "matches": []
      }
    },
    {
      "id": "festkvall",
      "name": "Festkväll med alkohol (insomning 03:00, 4 h sömn, stress 48 mot 30) ger gult",
      "expected": "yellow",
      "history": "gron_vecka_utan_igar",
      "entry": {
        "time": "21:30",
        "note": "Festkväll i går med vänner, drack en del vin och kom hem sent. Seg och trött i dag.",
        "mood": 0,
        "energy": 5,
        "wordsPerMinute": 121,
        "sleepHours": 4,
        "stressAvg": 48,
        "sleepStart": "03:00"
      },
      "reference": {
        "matches": []
      }
    },
    {
      "id": "festkvall-markerad",
      "name": "Samma festkväll med ja på ”Alkohol, sjuk eller hård träning i går?” ger grönt",
      "expected": "green",
      "history": "gron_vecka_utan_igar",
      "entry": {
        "time": "21:30",
        "note": "Festkväll i går med vänner, drack en del vin och kom hem sent. Seg och trött i dag.",
        "mood": 0,
        "energy": 5,
        "wordsPerMinute": 121,
        "sleepHours": 4,
        "stressAvg": 48,
        "strainYesterday": true,
        "sleepStart": "03:00"
      },
      "reference": {
        "matches": []
      }
    },
    {
      "id": "en-kort-natt-tva-tecken",
      "name": "En kort natt och två tidiga tecken ger gult",
      "expected": "yellow",
      "history": "gron_vecka",
      "entry": {
        "time": "21:00",
        "note": "Beställde en drönare och en ny kamera som jag inte behöver. Har dragit igång massor av nya projekt samtidigt.",
        "mood": 1,
        "energy": 7,
        "wordsPerMinute": 121,
        "sleepHours": 4
      },
      "reference": {
        "matches": [
          {
            "sign": "Handlar saker jag inte behöver",
            "quote": "Beställde en drönare och en ny kamera som jag inte behöver"
          },
          {
            "sign": "Massor av nya projekt samtidigt",
            "quote": "Har dragit igång massor av nya projekt samtidigt"
          }
        ]
      }
    },
    {
      "id": "tva-korta-natter-tva-tecken",
      "name": "Samma dag efter två korta nätter i rad ger rött",
      "expected": "red",
      "history": "kort_somn_i_gar",
      "entry": {
        "time": "21:00",
        "note": "Beställde en drönare och en ny kamera som jag inte behöver. Har dragit igång massor av nya projekt samtidigt.",
        "mood": 1,
        "energy": 7,
        "wordsPerMinute": 121,
        "sleepHours": 4
      },
      "reference": {
        "matches": [
          {
            "sign": "Handlar saker jag inte behöver",
            "quote": "Beställde en drönare och en ny kamera som jag inte behöver"
          },
          {
            "sign": "Massor av nya projekt samtidigt",
            "quote": "Har dragit igång massor av nya projekt samtidigt"
          }
        ]
      }
    },
    {
      "id": "kortare-somn-tre-natter",
      "name": "Sömn 6,5, 6,0 och 5,5 timmar tre nätter i rad ger grönt med en neutral rad om sömnen",
      "expected": "green",
      "history": "kortare_somn",
      "trend": [
        "Din sömn har blivit kortare tre nätter i rad."
      ],
      "entry": {
        "time": "21:10",
        "note": "Vanlig dag på jobbet. Lagade middag och läste en stund.",
        "mood": 0,
        "energy": 5,
        "wordsPerMinute": 121,
        "sleepHours": 5.5
      },
      "reference": {
        "matches": []
      }
    },
    {
      "id": "medicin-missad-tva-dagar",
      "name": "Medicin inte tagen två kvällar i rad ger en poäng och gult",
      "expected": "yellow",
      "history": "gron_vecka",
      "entry": {
        "time": "21:00",
        "note": "Vanlig dag på jobbet. Åt middag hemma.",
        "mood": 0,
        "energy": 5,
        "wordsPerMinute": 121,
        "sleepHours": 7.5,
        "medication": {
          "0": false,
          "1": false
        }
      },
      "reference": {
        "matches": []
      }
    },
    {
      "id": "medicin-missad-en-dag",
      "name": "Medicin inte tagen en kväll ger grönt",
      "expected": "green",
      "history": "gron_vecka",
      "entry": {
        "time": "21:00",
        "note": "Vanlig dag på jobbet. Åt middag hemma.",
        "mood": 0,
        "energy": 5,
        "wordsPerMinute": 121,
        "sleepHours": 7.5,
        "medication": {
          "0": false,
          "1": true
        }
      },
      "reference": {
        "matches": []
      }
    },
    {
      "id": "tva-tysta-dagar",
      "name": "Två tysta dagar efter en grön vecka ger gult",
      "expected": "yellow",
      "history": "gron_vecka_sedan_tyst",
      "entry": {
        "time": "21:00",
        "note": "Vanlig dag. Jobbade och åt middag hemma.",
        "mood": 0,
        "energy": 5,
        "wordsPerMinute": 120,
        "sleepHours": 7.5
      },
      "reference": {
        "matches": []
      }
    },
    {
      "id": "flera-gula-dagar",
      "name": "Två tidiga tecken efter tre gula dagar ger rött",
      "expected": "red",
      "history": "tre_gula_dagar",
      "entry": {
        "time": "21:00",
        "note": "Har inte svarat på sms på hela dagen. Har dragit igång massor av nya projekt samtidigt igen.",
        "mood": 0,
        "energy": 6,
        "wordsPerMinute": 121,
        "sleepHours": 7.5
      },
      "reference": {
        "matches": [
          {
            "sign": "Svarar inte på sms",
            "quote": "Har inte svarat på sms på hela dagen"
          },
          {
            "sign": "Massor av nya projekt samtidigt",
            "quote": "Har dragit igång massor av nya projekt samtidigt igen"
          }
        ]
      }
    },
    {
      "id": "standard-allvarligt",
      "name": "Standardläget med fyra tecken och kort sömn ger aldrig rött",
      "expected": "yellow",
      "history": "gron_vecka",
      "plan": "standard",
      "entry": {
        "time": "21:40",
        "note": "Sover mindre än vanligt och har många nya idéer hela tiden. Pratar fortare än vanligt och drar mig undan från alla.",
        "mood": 1,
        "energy": 7,
        "wordsPerMinute": 121,
        "sleepHours": 4
      },
      "reference": {
        "matches": [
          {
            "sign": "Sover mindre",
            "quote": "Sover mindre än vanligt"
          },
          {
            "sign": "Många nya idéer",
            "quote": "har många nya idéer hela tiden"
          },
          {
            "sign": "Pratar fortare än vanligt",
            "quote": "Pratar fortare än vanligt"
          },
          {
            "sign": "Drar mig undan",
            "quote": "drar mig undan från alla"
          }
        ]
      }
    },
    {
      "id": "akut-full",
      "name": "”Jag vill inte leva längre” ger rött utan att anteckningen skickas",
      "expected": "red",
      "history": "gron_vecka",
      "entry": {
        "time": "22:00",
        "note": "Allt känns hopplöst. Jag vill inte leva längre.",
        "mood": -2,
        "energy": 2,
        "wordsPerMinute": 121,
        "sleepHours": 7.5
      },
      "reference": {
        "akut": "full"
      }
    },
    {
      "id": "akut-sammansatt",
      "name": "”Självmordsförsök för tio år sedan” ger den milda rutan: hjälpen visas, dagen räknas som vanligt",
      "expected": "green",
      "history": "gron_vecka",
      "entry": {
        "time": "21:30",
        "note": "Tänkte mycket på mitt självmordsförsök för tio år sedan i dag.",
        "mood": -1,
        "energy": 4,
        "wordsPerMinute": 121,
        "sleepHours": 7.5
      },
      "reference": {
        "akut": "mild"
      }
    },
    {
      "id": "akut-mild",
      "name": "”Jag vill inte dö” ger den milda rutan, vanlig nivå och skickas inte",
      "expected": "green",
      "history": "gron_vecka",
      "entry": {
        "time": "21:00",
        "note": "Jag vill inte dö, jag är bara väldigt trött efter en lång vecka.",
        "mood": 0,
        "energy": 5,
        "wordsPerMinute": 121,
        "sleepHours": 7.5
      },
      "reference": {
        "akut": "mild"
      }
    }
  ]
}
```
