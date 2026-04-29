"""Tests for the PII scrubber."""
from app.utils.pii_scrub import scrub


def test_known_name_replaced():
    result = scrub("Träffade Anna idag")
    assert "Anna" not in result
    assert "[NAMN]" in result


def test_unknown_name_not_replaced():
    # Arbitrary non-Swedish name not in the list
    result = scrub("Träffade Zyrtyx idag")
    assert "Zyrtyx" in result


def test_email_replaced():
    result = scrub("Skicka till user@example.com")
    assert "user@example.com" not in result
    assert "[EPOST]" in result


def test_phone_replaced():
    result = scrub("Ring mig på 070-123 45 67")
    assert "070-123 45 67" not in result
    assert "[TELEFON]" in result


def test_none_input():
    assert scrub(None) is None


def test_empty_string():
    assert scrub("") == ""


def test_no_pii_unchanged():
    text = "Sov bra ikväll, kände mig lugn"
    assert scrub(text) == text
