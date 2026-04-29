"""
SQLAlchemy models. Column names use snake_case Python names;
the CSV Swedish column mapping lives in parsers/mood_csv.py.
"""
from __future__ import annotations

import enum
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, Enum, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class MoodLevel(str, enum.Enum):
    balanserad = "Balanserad"
    lite = "Lite"
    mycket = "Mycket"


class DiaryEntry(Base):
    __tablename__ = "diary_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    date: Mapped[date] = mapped_column(Date, unique=True, nullable=False, index=True)

    # Humör
    mood_high: Mapped[Optional[MoodLevel]] = mapped_column(Enum(MoodLevel), nullable=True)
    mood_low: Mapped[Optional[MoodLevel]] = mapped_column(Enum(MoodLevel), nullable=True)

    # Skyddande beteenden
    medicin: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    mindfulness: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    traning: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    bad_kallbad: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    utomhus_pa_lunchen: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    sluta_jobb_i_tid: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    jobba_30min_timer: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    anvant_sork: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    ekonomiskt_hallbart_val: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    psykolog: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    kanner_mig_mindful: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)

    # Risk & avvikelse
    somnavvikelse: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    alkohol: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    handlat_mer_an_vanligt: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)

    # Depression / ångest
    stress_symptom: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    angest: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    stor_oro: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)

    # Mani-indikatorer
    hogt_engagemang: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    allt_bara_funkar: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    hog_energi: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    jag_mar_antligen_bra: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    hogt_sjalvfortroende: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    lyssnar_hetsig_musik: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    upplevd_bradska: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    upplevt_magstodd: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    energi_flodar: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    manga_ideer: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    svart_att_vanta: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    ser_sammanhang: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    handlat_ovanligt: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    jag_ar_smartare: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    spontan_inlagg: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    dofter_tydligare: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    maste_bromsa_hjarnan: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)

    # Kontextuellt
    nat_bra_hant: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    nat_daligt_hant: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    lakarbesok: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    social_aktivitet: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    leta_efter_information: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)

    # Fritext
    anteckningar: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Metadata
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    garmin_data: Mapped[Optional["GarminData"]] = relationship(
        "GarminData", back_populates="diary_entry", uselist=False, cascade="all, delete-orphan"
    )

    @property
    def mania_score(self) -> int:
        """Sum of all mania indicators (0–17)."""
        fields = [
            self.hog_energi, self.allt_bara_funkar, self.manga_ideer,
            self.energi_flodar, self.jag_ar_smartare, self.spontan_inlagg,
            self.dofter_tydligare, self.handlat_mer_an_vanligt, self.handlat_ovanligt,
            self.lyssnar_hetsig_musik, self.svart_att_vanta, self.ser_sammanhang,
            self.upplevd_bradska, self.maste_bromsa_hjarnan, self.hogt_sjalvfortroende,
            self.hogt_engagemang, self.jag_mar_antligen_bra,
        ]
        return sum(1 for f in fields if f is True)

    @property
    def depression_score(self) -> int:
        """Sum of depression/anxiety indicators (0–4)."""
        fields = [self.angest, self.stor_oro, self.stress_symptom]
        low = self.mood_low in (MoodLevel.lite, MoodLevel.mycket)
        return sum(1 for f in fields if f is True) + (1 if low else 0)


class GarminData(Base):
    __tablename__ = "garmin_data"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    date: Mapped[date] = mapped_column(Date, unique=True, nullable=False, index=True)
    diary_entry_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("diary_entries.id", ondelete="SET NULL"), nullable=True
    )

    # Sömn
    total_sleep_minutes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    deep_sleep_minutes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    rem_sleep_minutes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    light_sleep_minutes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    sleep_score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    sleep_start: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    sleep_end: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)

    # Fysiologi
    hrv_last_night: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    resting_heart_rate: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    avg_stress: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    max_stress: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    body_battery_start: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    body_battery_end: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    steps: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Träning (JSON-sträng med lista av träningspass)
    workouts_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    synced_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    diary_entry: Mapped[Optional["DiaryEntry"]] = relationship(
        "DiaryEntry", back_populates="garmin_data"
    )


class GarminCredentials(Base):
    """Stores Fernet-encrypted Garmin credentials."""
    __tablename__ = "garmin_credentials"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username_enc: Mapped[str] = mapped_column(Text, nullable=False)
    password_enc: Mapped[str] = mapped_column(Text, nullable=False)
    session_token_enc: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    last_sync: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class AnalysisReport(Base):
    """Cached AI analysis reports."""
    __tablename__ = "analysis_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    date_from: Mapped[date] = mapped_column(Date, nullable=False)
    date_to: Mapped[date] = mapped_column(Date, nullable=False)
    report_json: Mapped[str] = mapped_column(Text, nullable=False)
    model_used: Mapped[str] = mapped_column(String(64), nullable=False)
    input_tokens: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
