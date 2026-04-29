"""
Parse the Swedish mood-diary CSV format produced by the external app.

Expected columns (kommaseparerade, \r\n line endings):
  Datum, Dag, Högt Humör, Lågt Humör, Medicin, Sömnavvikelse, Stress-symptom,
  Högt Engagemang, Nåt BRA har hänt, Nåt DÅLIGT har hänt, Stor oro,
  Ett ekonomiskt hållbart val, Sluta jobb i tid, Utomhus på lunchen,
  Jobba med 30 min timer, Använt SORK, Träning, Mindfulness, Bad/Kallbad,
  Psykolog, Läkarbesök, Alkohol, Social Aktivitet, Ångest,
  Leta Efter Information, Allt Bara Funkar, Hög Energi, Handlat Mer Än Vanligt,
  Jag mår äntligen bra, Känner mig mindful, Högt självförtroende,
  Lyssnar på hetsig och hög musik, Upplevd brådska för något,
  Upplevt starkt magstöd vid prat och sång, Energi flödar i kroppen,
  Många ideer på jobbet, Svårt att vänta när andra pratar,
  Ser sammanhang tydligt, Handlat något ovanligt,
  Jag är smartare än andra, Spontan ex inlägg på sociala medier,
  Dofter och färger är tydligare, Upplever att jag måste bromsa hjärnan,
  Anteckningar
"""
from __future__ import annotations

import csv
import io
from dataclasses import dataclass, field
from datetime import date
from typing import Optional

from app.models import MoodLevel

SWEDISH_MONTHS = {
    "januari": 1, "februari": 2, "mars": 3, "april": 4,
    "maj": 5, "juni": 6, "juli": 7, "augusti": 8,
    "september": 9, "oktober": 10, "november": 11, "december": 12,
}

# Maps CSV column header (stripped) → DiaryEntry field name
COLUMN_MAP: dict[str, str] = {
    "Datum": "_date_raw",
    "Dag": "_dag",
    "Högt Humör": "mood_high",
    "Lågt Humör": "mood_low",
    "Medicin": "medicin",
    "Sömnavvikelse": "somnavvikelse",
    "Stress-symptom": "stress_symptom",
    "Högt Engagemang": "hogt_engagemang",
    "Nåt BRA har hänt": "nat_bra_hant",
    "Nåt DÅLIGT har hänt": "nat_daligt_hant",
    "Stor oro": "stor_oro",
    "Ett ekonomiskt hållbart val": "ekonomiskt_hallbart_val",
    "Sluta jobb i tid": "sluta_jobb_i_tid",
    "Utomhus på lunchen": "utomhus_pa_lunchen",
    "Jobba med 30 min timer": "jobba_30min_timer",
    "Använt SORK": "anvant_sork",
    "Träning": "traning",
    "Mindfulness": "mindfulness",
    "Bad/Kallbad": "bad_kallbad",
    "Psykolog": "psykolog",
    "Läkarbesök": "lakarbesok",
    "Alkohol": "alkohol",
    "Social Aktivitet": "social_aktivitet",
    "Ångest": "angest",
    "Leta Efter Information": "leta_efter_information",
    "Allt Bara Funkar": "allt_bara_funkar",
    "Hög Energi": "hog_energi",
    "Handlat Mer Än Vanligt": "handlat_mer_an_vanligt",
    "Jag mår äntligen bra": "jag_mar_antligen_bra",
    "Känner mig mindful": "kanner_mig_mindful",
    "Högt självförtroende": "hogt_sjalvfortroende",
    "Lyssnar på hetsig och hög musik": "lyssnar_hetsig_musik",
    "Upplevd brådska för något": "upplevd_bradska",
    "Upplevt starkt magstöd vid prat och sång": "upplevt_magstodd",
    "Energi flödar i kroppen": "energi_flodar",
    "Många ideer på jobbet": "manga_ideer",
    "Svårt att vänta när andra pratar": "svart_att_vanta",
    "Ser sammanhang tydligt": "ser_sammanhang",
    "Handlat något ovanligt": "handlat_ovanligt",
    "Jag är smartare än andra": "jag_ar_smartare",
    "Spontan ex inlägg på sociala medier": "spontan_inlagg",
    "Dofter och färger är tydligare": "dofter_tydligare",
    "Upplever att jag måste bromsa hjärnan": "maste_bromsa_hjarnan",
    "Anteckningar": "anteckningar",
}

MOOD_FIELDS = {"mood_high", "mood_low"}
BOOL_FIELDS = set(COLUMN_MAP.values()) - MOOD_FIELDS - {"_date_raw", "_dag", "anteckningar"}


def _parse_swedish_date(raw: str) -> date:
    parts = raw.strip().split()
    if len(parts) != 3:
        raise ValueError(f"Oväntat datumformat: {raw!r}")
    day = int(parts[0])
    month = SWEDISH_MONTHS.get(parts[1].lower())
    if month is None:
        raise ValueError(f"Okänd månad: {parts[1]!r}")
    year = int(parts[2])
    return date(year, month, day)


def _parse_mood(raw: str) -> Optional[MoodLevel]:
    v = raw.strip()
    if v in ("-", ""):
        return None
    try:
        return MoodLevel(v)
    except ValueError:
        raise ValueError(f"Ogiltigt humörsvärde: {v!r}")


def _parse_bool(raw: str) -> Optional[bool]:
    v = raw.strip().upper()
    if v in ("-", ""):
        return None
    if v == "JA":
        return True
    if v == "NEJ":
        return False
    raise ValueError(f"Ogiltigt JA/NEJ-värde: {raw!r}")


@dataclass
class ParsedRow:
    row_number: int
    date: Optional[date]
    fields: dict = field(default_factory=dict)
    error: Optional[str] = None

    @property
    def ok(self) -> bool:
        return self.error is None and self.date is not None

    def is_empty(self) -> bool:
        """Row with only '-' values = unfilled day."""
        mood_vals = [self.fields.get("mood_high"), self.fields.get("mood_low")]
        bool_vals = [v for k, v in self.fields.items() if k in BOOL_FIELDS]
        return all(v is None for v in mood_vals + bool_vals)


def parse_csv(content: str | bytes) -> tuple[list[ParsedRow], list[dict]]:
    """
    Parse a CSV string/bytes.
    Returns (parsed_rows, header_errors).
    Only rows where ok=True and not is_empty() are meaningful.
    """
    if isinstance(content, bytes):
        content = content.decode("utf-8-sig")  # handle BOM

    reader = csv.DictReader(io.StringIO(content, newline=""))
    if reader.fieldnames is None:
        return [], [{"error": "Tom fil eller saknad header-rad"}]

    # Normalize headers (strip whitespace)
    normalized = {h.strip(): h for h in reader.fieldnames if h}

    header_errors: list[dict] = []
    unknown_headers = [h for h in normalized if h not in COLUMN_MAP]
    if unknown_headers:
        header_errors.append({"warning": f"Okända kolumner ignoreras: {unknown_headers}"})

    rows: list[ParsedRow] = []
    for row_num, raw_row in enumerate(reader, start=2):
        # Normalize keys
        row = {k.strip(): v for k, v in raw_row.items() if k}

        # Skip completely empty rows
        if all(v.strip() in ("", "-") for v in row.values()):
            continue

        parsed = ParsedRow(row_number=row_num, date=None)

        # Parse date
        date_raw = row.get("Datum", "").strip()
        if not date_raw or date_raw == "-":
            parsed.error = "Saknat datum"
            rows.append(parsed)
            continue
        try:
            parsed.date = _parse_swedish_date(date_raw)
        except ValueError as e:
            parsed.error = str(e)
            rows.append(parsed)
            continue

        # Parse all fields
        for csv_col, field_name in COLUMN_MAP.items():
            if field_name in ("_date_raw", "_dag"):
                continue
            raw_val = row.get(csv_col, "").strip()
            try:
                if field_name == "anteckningar":
                    parsed.fields[field_name] = raw_val if raw_val and raw_val != "-" else None
                elif field_name in MOOD_FIELDS:
                    parsed.fields[field_name] = _parse_mood(raw_val)
                else:
                    parsed.fields[field_name] = _parse_bool(raw_val)
            except ValueError as e:
                parsed.error = f"Kolumn {csv_col!r}: {e}"
                break

        rows.append(parsed)

    return rows, header_errors
