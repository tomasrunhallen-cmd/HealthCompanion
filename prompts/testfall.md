---
id: testfall
version: 1.0.0
response: data
---
# Testfall

De fyra testfallen ur specen. De används av enhetstesterna för ampeln och av knappen *Testa modellen* (steg 2). En modell godkänns när alla fall ger rätt nivå och svaret följer JSON-schemat.

Varje fall har en anteckning, mätvärden och en historik. Historiken räknas bakåt från fallets kväll. `time` är klockslaget då inlägget gjordes; inlägg före 05:00 hör till kvällen innan.

```json
{
  "plan": {
    "normalState": "Jag sover sju till åtta timmar, jobbar dagtid och träffar vänner på helgerna.",
    "sleepThresholdHours": 5,
    "signs": [
      { "id": "s1", "kind": "early", "text": "Svarar inte på sms" },
      { "id": "s2", "kind": "early", "text": "Handlar saker jag inte behöver" },
      { "id": "s3", "kind": "early", "text": "Massor av nya projekt samtidigt" },
      { "id": "s4", "kind": "serious", "text": "Slutar äta" },
      { "id": "s5", "kind": "serious", "text": "Känner att andra är emot mig" }
    ]
  },
  "histories": {
    "gron_vecka": [
      { "daysAgo": 1, "time": "21:00", "mood": 6, "energy": 5, "wordsPerMinute": 120, "sleepHours": 7.5, "level": "green" },
      { "daysAgo": 2, "time": "21:15", "mood": 6, "energy": 6, "wordsPerMinute": 118, "sleepHours": 7, "level": "green" },
      { "daysAgo": 3, "time": "20:45", "mood": 5, "energy": 5, "wordsPerMinute": 125, "sleepHours": 8, "level": "green" },
      { "daysAgo": 4, "time": "21:30", "mood": 6, "energy": 5, "wordsPerMinute": 122, "sleepHours": 7.5, "level": "green" },
      { "daysAgo": 5, "time": "21:05", "mood": 7, "energy": 6, "wordsPerMinute": 119, "sleepHours": 7, "level": "green" },
      { "daysAgo": 6, "time": "20:50", "mood": 6, "energy": 5, "wordsPerMinute": 121, "sleepHours": 8, "level": "green" },
      { "daysAgo": 7, "time": "21:20", "mood": 6, "energy": 6, "wordsPerMinute": 117, "sleepHours": 7.5, "level": "green" }
    ],
    "gron_vecka_sedan_tyst": [
      { "daysAgo": 3, "time": "21:00", "mood": 6, "energy": 5, "wordsPerMinute": 120, "sleepHours": 7.5, "level": "green" },
      { "daysAgo": 4, "time": "21:15", "mood": 6, "energy": 6, "wordsPerMinute": 118, "sleepHours": 7, "level": "green" },
      { "daysAgo": 5, "time": "20:45", "mood": 5, "energy": 5, "wordsPerMinute": 125, "sleepHours": 8, "level": "green" },
      { "daysAgo": 6, "time": "21:30", "mood": 6, "energy": 5, "wordsPerMinute": 122, "sleepHours": 7.5, "level": "green" },
      { "daysAgo": 7, "time": "21:05", "mood": 7, "energy": 6, "wordsPerMinute": 119, "sleepHours": 7, "level": "green" },
      { "daysAgo": 8, "time": "20:50", "mood": 6, "energy": 5, "wordsPerMinute": 121, "sleepHours": 8, "level": "green" },
      { "daysAgo": 9, "time": "21:20", "mood": 6, "energy": 6, "wordsPerMinute": 117, "sleepHours": 7.5, "level": "green" }
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
        "mood": 6, "energy": 5, "wordsPerMinute": 121, "sleepHours": 7.5
      }
    },
    {
      "id": "kort-somn-snabbt-tal-natt",
      "name": "Fyra timmars sömn, 180 ord per minut och inlägg 01:15 ger rött",
      "expected": "red",
      "history": "gron_vecka",
      "entry": {
        "time": "01:15",
        "note": "Kunde inte somna så jag pratar in det här nu. Det har varit en lång dag på jobbet.",
        "mood": 6, "energy": 6, "wordsPerMinute": 180, "sleepHours": 4
      }
    },
    {
      "id": "orkade-inte-svara",
      "name": "Orkade inte svara på sms och inget annat ger gult",
      "expected": "yellow",
      "history": "gron_vecka",
      "entry": {
        "time": "21:00",
        "note": "Orkade inte svara på sms i dag.",
        "mood": 5, "energy": 5, "wordsPerMinute": null, "sleepHours": 7
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
        "mood": 6, "energy": 5, "wordsPerMinute": 120, "sleepHours": 7.5
      }
    }
  ]
}
```
