import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.analysis.ai_insights import run_analysis
from app.auth import require_auth
from app.database import get_db
from app.models import AnalysisReport as AnalysisReportModel
from app.models import DiaryEntry, GarminData
from app.schemas import AnalysisReport, AnalysisRequest, AnalysisResponse

router = APIRouter()

MIN_DAYS_FOR_ANALYSIS = 7


def _entry_to_dict(entry: DiaryEntry) -> dict:
    d = {
        "date": str(entry.date),
        "mood_high": entry.mood_high.value if entry.mood_high else None,
        "mood_low": entry.mood_low.value if entry.mood_low else None,
        "mania_score": entry.mania_score,
        "depression_score": entry.depression_score,
        "medicin": entry.medicin,
        "mindfulness": entry.mindfulness,
        "traning": entry.traning,
        "bad_kallbad": entry.bad_kallbad,
        "utomhus_pa_lunchen": entry.utomhus_pa_lunchen,
        "sluta_jobb_i_tid": entry.sluta_jobb_i_tid,
        "jobba_30min_timer": entry.jobba_30min_timer,
        "anvant_sork": entry.anvant_sork,
        "ekonomiskt_hallbart_val": entry.ekonomiskt_hallbart_val,
        "psykolog": entry.psykolog,
        "kanner_mig_mindful": entry.kanner_mig_mindful,
        "somnavvikelse": entry.somnavvikelse,
        "alkohol": entry.alkohol,
        "handlat_mer_an_vanligt": entry.handlat_mer_an_vanligt,
        "stress_symptom": entry.stress_symptom,
        "angest": entry.angest,
        "stor_oro": entry.stor_oro,
        "hogt_engagemang": entry.hogt_engagemang,
        "allt_bara_funkar": entry.allt_bara_funkar,
        "hog_energi": entry.hog_energi,
        "jag_mar_antligen_bra": entry.jag_mar_antligen_bra,
        "hogt_sjalvfortroende": entry.hogt_sjalvfortroende,
        "lyssnar_hetsig_musik": entry.lyssnar_hetsig_musik,
        "upplevd_bradska": entry.upplevd_bradska,
        "upplevt_magstodd": entry.upplevt_magstodd,
        "energi_flodar": entry.energi_flodar,
        "manga_ideer": entry.manga_ideer,
        "svart_att_vanta": entry.svart_att_vanta,
        "ser_sammanhang": entry.ser_sammanhang,
        "handlat_ovanligt": entry.handlat_ovanligt,
        "jag_ar_smartare": entry.jag_ar_smartare,
        "spontan_inlagg": entry.spontan_inlagg,
        "dofter_tydligare": entry.dofter_tydligare,
        "maste_bromsa_hjarnan": entry.maste_bromsa_hjarnan,
        "nat_bra_hant": entry.nat_bra_hant,
        "nat_daligt_hant": entry.nat_daligt_hant,
        "lakarbesok": entry.lakarbesok,
        "social_aktivitet": entry.social_aktivitet,
        "leta_efter_information": entry.leta_efter_information,
        "anteckningar": entry.anteckningar,
    }
    return d


def _garmin_to_dict(gd: GarminData) -> dict:
    return {
        "date": str(gd.date),
        "total_sleep_minutes": gd.total_sleep_minutes,
        "deep_sleep_minutes": gd.deep_sleep_minutes,
        "rem_sleep_minutes": gd.rem_sleep_minutes,
        "sleep_score": gd.sleep_score,
        "hrv_last_night": gd.hrv_last_night,
        "resting_heart_rate": gd.resting_heart_rate,
        "avg_stress": gd.avg_stress,
        "body_battery_start": gd.body_battery_start,
        "body_battery_end": gd.body_battery_end,
        "steps": gd.steps,
        "workouts": json.loads(gd.workouts_json) if gd.workouts_json else [],
    }


@router.post("/", response_model=AnalysisResponse)
async def analyze(
    body: AnalysisRequest,
    db: AsyncSession = Depends(get_db),
    _auth: dict = Depends(require_auth),
):
    # Check for cached report (unless force_refresh)
    if not body.force_refresh:
        cached_result = await db.execute(
            select(AnalysisReportModel)
            .where(AnalysisReportModel.date_from == body.date_from)
            .where(AnalysisReportModel.date_to == body.date_to)
            .order_by(AnalysisReportModel.created_at.desc())
            .limit(1)
        )
        cached = cached_result.scalar_one_or_none()
        if cached:
            report_data = json.loads(cached.report_json)
            return AnalysisResponse(
                report=AnalysisReport(**report_data),
                model_used=cached.model_used,
                input_tokens=cached.input_tokens or 0,
                output_tokens=cached.output_tokens or 0,
                cached_tokens=0,
                from_cache=True,
                generated_at=cached.created_at,
            )

    # Fetch diary entries
    diary_result = await db.execute(
        select(DiaryEntry)
        .where(DiaryEntry.date >= body.date_from)
        .where(DiaryEntry.date <= body.date_to)
        .order_by(DiaryEntry.date)
    )
    diary_entries = diary_result.scalars().all()

    if len(diary_entries) < MIN_DAYS_FOR_ANALYSIS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Minst {MIN_DAYS_FOR_ANALYSIS} ifyllda dagar krävs för analys. "
                   f"Hittade {len(diary_entries)} i valt intervall.",
        )

    # Fetch Garmin data
    garmin_result = await db.execute(
        select(GarminData)
        .where(GarminData.date >= body.date_from)
        .where(GarminData.date <= body.date_to)
        .order_by(GarminData.date)
    )
    garmin_data = garmin_result.scalars().all()

    diary_dicts = [_entry_to_dict(e) for e in diary_entries]
    garmin_dicts = [_garmin_to_dict(g) for g in garmin_data]

    try:
        response = await run_analysis(diary_dicts, garmin_dicts, body.date_from, body.date_to)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Claude API-fel: {str(e)[:300]}",
        )

    # Persist report to DB
    report_model = AnalysisReportModel(
        date_from=body.date_from,
        date_to=body.date_to,
        report_json=response.report.model_dump_json(),
        model_used=response.model_used,
        input_tokens=response.input_tokens,
        output_tokens=response.output_tokens,
    )
    db.add(report_model)
    await db.commit()

    return response


@router.get("/history")
async def analysis_history(
    db: AsyncSession = Depends(get_db),
    _auth: dict = Depends(require_auth),
):
    """List past analysis reports."""
    result = await db.execute(
        select(
            AnalysisReportModel.id,
            AnalysisReportModel.date_from,
            AnalysisReportModel.date_to,
            AnalysisReportModel.model_used,
            AnalysisReportModel.input_tokens,
            AnalysisReportModel.output_tokens,
            AnalysisReportModel.created_at,
        ).order_by(AnalysisReportModel.created_at.desc()).limit(50)
    )
    rows = result.all()
    return [
        {
            "id": r.id,
            "date_from": str(r.date_from),
            "date_to": str(r.date_to),
            "model_used": r.model_used,
            "input_tokens": r.input_tokens,
            "output_tokens": r.output_tokens,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]
