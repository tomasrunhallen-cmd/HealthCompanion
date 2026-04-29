from __future__ import annotations

from datetime import date, datetime
from typing import Any, Optional

from pydantic import BaseModel, Field

from app.models import MoodLevel


# ── Diary ──────────────────────────────────────────────────────────────────────

class DiaryEntryBase(BaseModel):
    date: date
    mood_high: Optional[MoodLevel] = None
    mood_low: Optional[MoodLevel] = None
    medicin: Optional[bool] = None
    mindfulness: Optional[bool] = None
    traning: Optional[bool] = None
    bad_kallbad: Optional[bool] = None
    utomhus_pa_lunchen: Optional[bool] = None
    sluta_jobb_i_tid: Optional[bool] = None
    jobba_30min_timer: Optional[bool] = None
    anvant_sork: Optional[bool] = None
    ekonomiskt_hallbart_val: Optional[bool] = None
    psykolog: Optional[bool] = None
    kanner_mig_mindful: Optional[bool] = None
    somnavvikelse: Optional[bool] = None
    alkohol: Optional[bool] = None
    handlat_mer_an_vanligt: Optional[bool] = None
    stress_symptom: Optional[bool] = None
    angest: Optional[bool] = None
    stor_oro: Optional[bool] = None
    hogt_engagemang: Optional[bool] = None
    allt_bara_funkar: Optional[bool] = None
    hog_energi: Optional[bool] = None
    jag_mar_antligen_bra: Optional[bool] = None
    hogt_sjalvfortroende: Optional[bool] = None
    lyssnar_hetsig_musik: Optional[bool] = None
    upplevd_bradska: Optional[bool] = None
    upplevt_magstodd: Optional[bool] = None
    energi_flodar: Optional[bool] = None
    manga_ideer: Optional[bool] = None
    svart_att_vanta: Optional[bool] = None
    ser_sammanhang: Optional[bool] = None
    handlat_ovanligt: Optional[bool] = None
    jag_ar_smartare: Optional[bool] = None
    spontan_inlagg: Optional[bool] = None
    dofter_tydligare: Optional[bool] = None
    maste_bromsa_hjarnan: Optional[bool] = None
    nat_bra_hant: Optional[bool] = None
    nat_daligt_hant: Optional[bool] = None
    lakarbesok: Optional[bool] = None
    social_aktivitet: Optional[bool] = None
    leta_efter_information: Optional[bool] = None
    anteckningar: Optional[str] = None


class DiaryEntryCreate(DiaryEntryBase):
    pass


class DiaryEntryUpdate(DiaryEntryBase):
    date: Optional[date] = None  # type: ignore[assignment]


class DiaryEntryOut(DiaryEntryBase):
    id: int
    mania_score: int
    depression_score: int
    created_at: datetime
    updated_at: datetime
    garmin_data: Optional["GarminDataOut"] = None

    model_config = {"from_attributes": True}


# ── Garmin ─────────────────────────────────────────────────────────────────────

class GarminDataBase(BaseModel):
    date: date
    total_sleep_minutes: Optional[int] = None
    deep_sleep_minutes: Optional[int] = None
    rem_sleep_minutes: Optional[int] = None
    light_sleep_minutes: Optional[int] = None
    sleep_score: Optional[int] = None
    sleep_start: Optional[str] = None
    sleep_end: Optional[str] = None
    hrv_last_night: Optional[float] = None
    resting_heart_rate: Optional[int] = None
    avg_stress: Optional[int] = None
    max_stress: Optional[int] = None
    body_battery_start: Optional[int] = None
    body_battery_end: Optional[int] = None
    steps: Optional[int] = None
    workouts_json: Optional[str] = None


class GarminDataOut(GarminDataBase):
    id: int
    synced_at: datetime

    model_config = {"from_attributes": True}


class GarminSyncStatus(BaseModel):
    last_sync: Optional[datetime]
    credentials_configured: bool
    message: str


# ── Import ─────────────────────────────────────────────────────────────────────

class CSVPreviewRow(BaseModel):
    row_number: int
    date: date
    already_exists: bool
    data: dict[str, Any]


class CSVPreviewResponse(BaseModel):
    total_rows: int
    parseable_rows: int
    parse_errors: list[dict[str, Any]]
    preview: list[CSVPreviewRow]


class CSVImportRequest(BaseModel):
    on_conflict: str = Field(default="skip", pattern="^(skip|overwrite|abort)$")


class CSVImportResult(BaseModel):
    inserted: int
    updated: int
    skipped: int
    errors: list[dict[str, Any]]


# ── Analysis ───────────────────────────────────────────────────────────────────

class AnalysisRequest(BaseModel):
    date_from: date
    date_to: date
    force_refresh: bool = False


class AnalysisPattern(BaseModel):
    title: str
    description: str
    supporting_dates: list[str] = []


class AnalysisWarning(BaseModel):
    severity: str  # "low" | "medium" | "high"
    description: str
    recommendation: str


class AnalysisReport(BaseModel):
    summary: str
    period_days: int
    filled_days: int
    patterns: list[AnalysisPattern]
    garmin_correlations: list[AnalysisPattern]
    early_warning_signals: list[AnalysisPattern]
    protective_factors: list[AnalysisPattern]
    recommendations: list[str]
    warnings: list[AnalysisWarning]
    disclaimer: str


class AnalysisResponse(BaseModel):
    report: AnalysisReport
    model_used: str
    input_tokens: int
    output_tokens: int
    cached_tokens: int
    from_cache: bool
    generated_at: datetime


# ── Auth ───────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


DiaryEntryOut.model_rebuild()
