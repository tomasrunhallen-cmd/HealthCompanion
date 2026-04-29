"""
AI analysis via Claude API with prompt caching.

Architecture:
- System prompt (static) is marked cache_control=ephemeral so Anthropic caches it
- The data payload (large, changes per request) is in the user message — also cacheable
  if the same period is requested repeatedly within the 5-minute cache TTL
- Returns structured JSON parsed into AnalysisReport schema
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime
from typing import Optional

import anthropic

from app.config import get_settings
from app.schemas import (
    AnalysisPattern,
    AnalysisReport,
    AnalysisResponse,
    AnalysisWarning,
)
from app.utils.pii_scrub import scrub_entry

logger = logging.getLogger(__name__)

MODEL = "claude-opus-4-7"

SYSTEM_PROMPT = """Du är ett specialiserat analysverktyg för bipolär stämningsövervakning. \
Du analyserar personlig hälsodata och dagboksdata för att hitta mönster som kan vara kliniskt \
relevanta för en person med bipolär sjukdom.

VIKTIGT — Medicinsk ansvarsfriskrivning:
- Din analys är mönsterhittning, INTE medicinsk rådgivning
- Du kan aldrig ställa diagnoser eller ersätta läkarbedömning
- Vid tecken på pågående mani, depression eller blandtillstånd: rekommendera alltid \
  kontakt med psykiater eller psykiatrisk akutvård
- Formulera insikter varsamt och utan att skapa onödig oro

Din uppgift:
1. Identifiera återkommande mönster i stämning, sömn, fysiologi och beteende
2. Hitta korrelationer mellan Garmin-fysiologi och stämningsmarkörer (t.ex. låg HRV → humörfall?)
3. Identifiera tidiga varningssignaler som historiskt föregått hypomana/depressiva perioder
4. Lyft fram skyddande faktorer (vad har korrelerat med balanserade perioder?)
5. Ge konkreta, personaliserade rekommendationer baserade på just denna persons data

Svara ALLTID på svenska.
Svara ALLTID med ett JSON-objekt enligt det exakta schemat nedan — inget annat text utanför JSON.

JSON-schema:
{
  "summary": "string (2-3 meningar om perioden)",
  "patterns": [
    {"title": "string", "description": "string", "supporting_dates": ["YYYY-MM-DD"]}
  ],
  "garmin_correlations": [
    {"title": "string", "description": "string", "supporting_dates": ["YYYY-MM-DD"]}
  ],
  "early_warning_signals": [
    {"title": "string", "description": "string", "supporting_dates": ["YYYY-MM-DD"]}
  ],
  "protective_factors": [
    {"title": "string", "description": "string", "supporting_dates": ["YYYY-MM-DD"]}
  ],
  "recommendations": ["string"],
  "warnings": [
    {"severity": "low|medium|high", "description": "string", "recommendation": "string"}
  ],
  "disclaimer": "string (påminnelse om att söka vård vid behov)"
}

Kliniska grupperingar att beakta:
- MANI-INDIKATORER: Hög Energi, Allt Bara Funkar, Många ideer, Energi flödar, \
  Smartare än andra, Spontana inlägg, Tydligare dofter/färger, Handlat mer/ovanligt, \
  Hetsig musik, Svårt vänta, Ser sammanhang, Brådska, Bromsa hjärnan, \
  Högt självförtroende, Högt Engagemang, Äntligen bra
- DEPRESSION/ÅNGEST: Lågt Humör, Ångest, Stor oro, Stress-symptom
- SKYDDANDE: Medicin, Mindfulness, Träning, Bad/Kallbad, Utomhus, \
  Sluta jobb i tid, 30-min timer, SORK, Ekonomiskt val, Psykolog, Känner sig mindful
- RISK: Alkohol, Sömnavvikelse, Handlat mer än vanligt"""


def _build_data_payload(
    diary_entries: list[dict],
    garmin_data: list[dict],
    date_from: date,
    date_to: date,
) -> str:
    """Serialize diary + Garmin data into a compact JSON string for the prompt."""
    # Scrub PII from notes before sending
    clean_entries = [scrub_entry(e) for e in diary_entries]
    payload = {
        "period": {"from": str(date_from), "to": str(date_to)},
        "diary_entries": clean_entries,
        "garmin_data": garmin_data,
    }
    return json.dumps(payload, ensure_ascii=False, default=str)


def _parse_response(text: str) -> AnalysisReport:
    """Extract JSON from Claude's response and parse into AnalysisReport."""
    # Strip markdown code fences if present
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1] if lines[-1] == "```" else lines[1:])

    data = json.loads(text)

    return AnalysisReport(
        summary=data.get("summary", ""),
        period_days=0,  # filled by caller
        filled_days=0,  # filled by caller
        patterns=[AnalysisPattern(**p) for p in data.get("patterns", [])],
        garmin_correlations=[AnalysisPattern(**p) for p in data.get("garmin_correlations", [])],
        early_warning_signals=[AnalysisPattern(**p) for p in data.get("early_warning_signals", [])],
        protective_factors=[AnalysisPattern(**p) for p in data.get("protective_factors", [])],
        recommendations=data.get("recommendations", []),
        warnings=[AnalysisWarning(**w) for w in data.get("warnings", [])],
        disclaimer=data.get("disclaimer", ""),
    )


async def run_analysis(
    diary_entries: list[dict],
    garmin_data: list[dict],
    date_from: date,
    date_to: date,
) -> AnalysisResponse:
    """
    Run AI analysis on the provided data.

    Uses prompt caching:
    - System prompt: cached (static, rarely changes)
    - Data block: cached if same period is requested within 5 min
    """
    settings = get_settings()
    if not settings.anthropic_api_key:
        raise ValueError("ANTHROPIC_API_KEY är inte satt i .env")

    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

    data_payload = _build_data_payload(diary_entries, garmin_data, date_from, date_to)

    user_message_content = (
        f"Analysera följande hälsodata för perioden {date_from} till {date_to}.\n\n"
        f"DATA:\n{data_payload}\n\n"
        f"Ge en fullständig analys enligt JSON-schemat i systempromten."
    )

    period_days = (date_to - date_from).days + 1
    filled_days = len(diary_entries)

    logger.info(f"Skickar analys till Claude: {period_days} dagar, {filled_days} ifyllda")

    response = await client.messages.create(
        model=MODEL,
        max_tokens=4096,
        system=[
            {
                "type": "text",
                "text": SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},  # prompt caching
            }
        ],
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": user_message_content,
                        "cache_control": {"type": "ephemeral"},  # cache data block too
                    }
                ],
            }
        ],
    )

    raw_text = response.content[0].text
    report = _parse_response(raw_text)
    report.period_days = period_days
    report.filled_days = filled_days

    usage = response.usage
    cached_tokens = getattr(usage, "cache_read_input_tokens", 0) or 0
    input_tokens = getattr(usage, "input_tokens", 0) or 0
    output_tokens = getattr(usage, "output_tokens", 0) or 0

    logger.info(
        f"Analys klar. Tokens — input: {input_tokens}, output: {output_tokens}, "
        f"cache read: {cached_tokens}"
    )

    return AnalysisResponse(
        report=report,
        model_used=MODEL,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cached_tokens=cached_tokens,
        from_cache=False,
        generated_at=datetime.utcnow(),
    )
