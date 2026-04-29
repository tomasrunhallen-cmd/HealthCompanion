"""Tests for the Swedish mood CSV parser."""
import pytest
from datetime import date

from app.parsers.mood_csv import parse_csv, _parse_swedish_date, _parse_mood, _parse_bool
from app.models import MoodLevel


def test_parse_swedish_date_basic():
    assert _parse_swedish_date("30 april 2025") == date(2025, 4, 30)
    assert _parse_swedish_date("1 januari 2024") == date(2024, 1, 1)
    assert _parse_swedish_date("15 december 2023") == date(2023, 12, 15)


def test_parse_swedish_date_all_months():
    months = [
        ("januari", 1), ("februari", 2), ("mars", 3), ("april", 4),
        ("maj", 5), ("juni", 6), ("juli", 7), ("augusti", 8),
        ("september", 9), ("oktober", 10), ("november", 11), ("december", 12),
    ]
    for name, num in months:
        d = _parse_swedish_date(f"1 {name} 2024")
        assert d.month == num


def test_parse_swedish_date_invalid():
    with pytest.raises(ValueError):
        _parse_swedish_date("30 april")
    with pytest.raises(ValueError):
        _parse_swedish_date("30 aprill 2025")


def test_parse_mood():
    assert _parse_mood("Balanserad") == MoodLevel.balanserad
    assert _parse_mood("Lite") == MoodLevel.lite
    assert _parse_mood("Mycket") == MoodLevel.mycket
    assert _parse_mood("-") is None
    assert _parse_mood("") is None
    with pytest.raises(ValueError):
        _parse_mood("Jättebra")


def test_parse_bool():
    assert _parse_bool("JA") is True
    assert _parse_bool("NEJ") is False
    assert _parse_bool("-") is None
    assert _parse_bool("") is None
    with pytest.raises(ValueError):
        _parse_bool("kanske")


SAMPLE_CSV = (
    "Datum,Dag,Högt Humör,Lågt Humör,Medicin,Sömnavvikelse,Stress-symptom,"
    "Högt Engagemang,Nåt BRA har hänt,Nåt DÅLIGT har hänt,Stor oro,"
    "Ett ekonomiskt hållbart val,Sluta jobb i tid,Utomhus på lunchen,"
    "Jobba med 30 min timer,Använt SORK,Träning,Mindfulness,Bad/Kallbad,"
    "Psykolog,Läkarbesök,Alkohol,Social Aktivitet,Ångest,"
    "Leta Efter Information,Allt Bara Funkar,Hög Energi,Handlat Mer Än Vanligt,"
    "Jag mår äntligen bra,Känner mig mindful,Högt självförtroende,"
    "Lyssnar på hetsig och hög musik,Upplevd brådska för något,"
    "Upplevt starkt magstöd vid prat och sång,Energi flödar i kroppen,"
    "Många ideer på jobbet,Svårt att vänta när andra pratar,"
    "Ser sammanhang tydligt,Handlat något ovanligt,"
    "Jag är smartare än andra,Spontan ex inlägg på sociala medier,"
    "Dofter och färger är tydligare,Upplever att jag måste bromsa hjärnan,"
    "Anteckningar\r\n"
    "1 april 2025,tisdag,Balanserad,-,JA,NEJ,NEJ,"
    "NEJ,JA,NEJ,NEJ,"
    "JA,JA,JA,"
    "NEJ,NEJ,JA,JA,NEJ,"
    "NEJ,NEJ,NEJ,JA,NEJ,"
    "NEJ,NEJ,NEJ,NEJ,"
    "NEJ,JA,NEJ,"
    "NEJ,NEJ,"
    "NEJ,NEJ,"
    "NEJ,NEJ,"
    "NEJ,NEJ,"
    "NEJ,NEJ,"
    "NEJ,NEJ,"
    "Bra dag idag\r\n"
    "2 april 2025,onsdag,-,-,-,-,-,"
    "-,-,-,-,"
    "-,-,-,"
    "-,-,-,-,-,"
    "-,-,-,-,-,"
    "-,-,-,-,"
    "-,-,-,"
    "-,-,"
    "-,-,"
    "-,-,"
    "-,-,"
    "-,-,"
    "-,-,"
    "\r\n"
)


def test_parse_csv_basic():
    rows, errors = parse_csv(SAMPLE_CSV)
    good = [r for r in rows if r.ok and not r.is_empty()]
    assert len(good) == 1  # row 2 is all dashes → empty
    assert good[0].date == date(2025, 4, 1)
    assert good[0].fields["mood_high"] == MoodLevel.balanserad
    assert good[0].fields["mood_low"] is None
    assert good[0].fields["medicin"] is True
    assert good[0].fields["anteckningar"] == "Bra dag idag"


def test_parse_csv_empty_row_skipped():
    rows, _ = parse_csv(SAMPLE_CSV)
    # Row 2 (2 april) should parse but is_empty()
    april_2 = next((r for r in rows if r.date and r.date.day == 2), None)
    assert april_2 is not None
    assert april_2.is_empty()


def test_parse_csv_bytes_input():
    rows, errors = parse_csv(SAMPLE_CSV.encode("utf-8"))
    assert any(r.ok for r in rows)


def test_parse_csv_bom():
    bom = b"\xef\xbb\xbf" + SAMPLE_CSV.encode("utf-8")
    rows, errors = parse_csv(bom)
    assert any(r.ok for r in rows)


def test_parse_csv_quoted_notes():
    csv_with_quotes = (
        "Datum,Dag,Högt Humör,Lågt Humör,Medicin,Sömnavvikelse,Stress-symptom,"
        "Högt Engagemang,Nåt BRA har hänt,Nåt DÅLIGT har hänt,Stor oro,"
        "Ett ekonomiskt hållbart val,Sluta jobb i tid,Utomhus på lunchen,"
        "Jobba med 30 min timer,Använt SORK,Träning,Mindfulness,Bad/Kallbad,"
        "Psykolog,Läkarbesök,Alkohol,Social Aktivitet,Ångest,"
        "Leta Efter Information,Allt Bara Funkar,Hög Energi,Handlat Mer Än Vanligt,"
        "Jag mår äntligen bra,Känner mig mindful,Högt självförtroende,"
        "Lyssnar på hetsig och hög musik,Upplevd brådska för något,"
        "Upplevt starkt magstöd vid prat och sång,Energi flödar i kroppen,"
        "Många ideer på jobbet,Svårt att vänta när andra pratar,"
        "Ser sammanhang tydligt,Handlat något ovanligt,"
        "Jag är smartare än andra,Spontan ex inlägg på sociala medier,"
        "Dofter och färger är tydligare,Upplever att jag måste bromsa hjärnan,"
        "Anteckningar\r\n"
        '3 april 2025,torsdag,Balanserad,-,JA,NEJ,NEJ,'
        'NEJ,NEJ,NEJ,NEJ,'
        'NEJ,NEJ,NEJ,'
        'NEJ,NEJ,NEJ,NEJ,NEJ,'
        'NEJ,NEJ,NEJ,NEJ,NEJ,'
        'NEJ,NEJ,NEJ,NEJ,'
        'NEJ,NEJ,NEJ,'
        'NEJ,NEJ,'
        'NEJ,NEJ,'
        'NEJ,NEJ,'
        'NEJ,NEJ,'
        'NEJ,NEJ,'
        'NEJ,NEJ,'
        '"Träffade Anna, pratade om jobbet"\r\n'
    )
    rows, _ = parse_csv(csv_with_quotes)
    good = [r for r in rows if r.ok and not r.is_empty()]
    assert len(good) == 1
    assert "Anna" in good[0].fields["anteckningar"]
