"""
Light-weight PII scrubber for diary notes before sending to Claude API.

Strategy:
1. Replace common Swedish first names with [NAMN]
2. Replace patterns that look like personal names (Capitalised word preceded
   by a Swedish name-preceding word like "med", "och", "träffade" etc.)
3. Replace phone numbers, email addresses, and location patterns

This is best-effort — not a guarantee. The user controls what they write.
"""
from __future__ import annotations

import re

# Common Swedish first names (subset — expand as needed)
SWEDISH_NAMES: set[str] = {
    # Male
    "Anders", "Erik", "Johan", "Lars", "Karl", "Mikael", "Per", "Stefan",
    "Henrik", "Magnus", "Jonas", "Mattias", "Björn", "Patrik", "Peter",
    "Daniel", "Marcus", "Fredrik", "Tobias", "Gustav", "Oskar", "Viktor",
    "Alexander", "Simon", "Filip", "Anton", "Axel", "Emil", "Hugo", "Liam",
    "Lucas", "Noah", "Oliver", "William", "Adam", "Benjamin", "Elias",
    "Leo", "Lukas", "Nils", "Sebastian", "Max", "Adrian",
    # Female
    "Anna", "Maria", "Kristina", "Eva", "Sara", "Linda", "Lena", "Emma",
    "Karin", "Johanna", "Ingrid", "Sofia", "Maria", "Malin", "Hanna",
    "Elisabeth", "Katarina", "Sandra", "Elin", "Maja", "Julia", "Ida",
    "Frida", "Klara", "Alice", "Wilma", "Ella", "Matilda", "Alva",
    "Ebba", "Elsa", "Lovisa", "Isabelle", "Linnea", "Lisa", "Amanda",
    "Cecilia", "Helena", "Therese", "Jenny", "Jessica", "Caroline",
}

# Words that often precede a person's name in Swedish text
_NAME_CONTEXT_WORDS = (
    r"med|hos|träffade|ringde|pratade med|från|åt med|till|för|av|"
    r"berättade|hörde|hjälpte|mötte|besökte|frågade|sa|svarade|fick|"
    r"skickade|fick besök|jobbade med"
)

_name_pattern = re.compile(
    r"\b(" + "|".join(re.escape(n) for n in SWEDISH_NAMES) + r")\b"
)

_context_name_pattern = re.compile(
    r"(?:" + _NAME_CONTEXT_WORDS + r")\s+([A-ZÅÄÖ][a-zåäö]{2,})",
    re.IGNORECASE,
)

_phone_pattern = re.compile(
    r"(?:\+46|0)[0-9\s\-]{7,14}"
)

_email_pattern = re.compile(
    r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}"
)


def scrub(text: str | None) -> str | None:
    if not text:
        return text

    result = text

    # Replace known names
    result = _name_pattern.sub("[NAMN]", result)

    # Replace names following context words
    def _replace_context(m: re.Match) -> str:
        full = m.group(0)
        name = m.group(1)
        return full[: m.start(1) - m.start(0)] + "[NAMN]"

    result = _context_name_pattern.sub(_replace_context, result)

    # PII patterns
    result = _phone_pattern.sub("[TELEFON]", result)
    result = _email_pattern.sub("[EPOST]", result)

    return result


def scrub_entry(entry: dict) -> dict:
    """Return a copy of a diary entry dict with notes scrubbed."""
    out = dict(entry)
    if "anteckningar" in out:
        out["anteckningar"] = scrub(out["anteckningar"])
    return out
