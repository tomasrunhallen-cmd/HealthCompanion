import csv
import io
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import require_auth
from app.database import get_db
from app.models import DiaryEntry, MoodLevel
from app.schemas import DiaryEntryCreate, DiaryEntryOut, DiaryEntryUpdate

router = APIRouter()


def _entry_or_404(entry: Optional[DiaryEntry]) -> DiaryEntry:
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dagbokspost saknas")
    return entry


@router.get("/", response_model=List[DiaryEntryOut])
async def list_entries(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    limit: int = Query(100, le=1000),
    offset: int = Query(0),
    db: AsyncSession = Depends(get_db),
    _auth: dict = Depends(require_auth),
):
    q = select(DiaryEntry).options(selectinload(DiaryEntry.garmin_data)).order_by(DiaryEntry.date.desc())
    if date_from:
        q = q.where(DiaryEntry.date >= date_from)
    if date_to:
        q = q.where(DiaryEntry.date <= date_to)
    q = q.limit(limit).offset(offset)
    result = await db.execute(q)
    return result.scalars().all()


@router.get("/export")
async def export_csv(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    db: AsyncSession = Depends(get_db),
    _auth: dict = Depends(require_auth),
):
    """Export all diary entries as CSV in the original Swedish format."""
    q = select(DiaryEntry).order_by(DiaryEntry.date)
    if date_from:
        q = q.where(DiaryEntry.date >= date_from)
    if date_to:
        q = q.where(DiaryEntry.date <= date_to)
    result = await db.execute(q)
    entries = result.scalars().all()

    SWEDISH_MONTHS = [
        "", "januari", "februari", "mars", "april", "maj", "juni",
        "juli", "augusti", "september", "oktober", "november", "december",
    ]
    WEEKDAYS_SV = ["måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag", "söndag"]

    def _mood(v: Optional[MoodLevel]) -> str:
        return v.value if v else "-"

    def _bool(v: Optional[bool]) -> str:
        if v is True: return "JA"
        if v is False: return "NEJ"
        return "-"

    def _date_sv(d: date) -> str:
        return f"{d.day} {SWEDISH_MONTHS[d.month]} {d.year}"

    output = io.StringIO()
    writer = csv.writer(output, lineterminator="\r\n")
    writer.writerow([
        "Datum", "Dag", "Högt Humör", "Lågt Humör", "Medicin", "Sömnavvikelse",
        "Stress-symptom", "Högt Engagemang", "Nåt BRA har hänt", "Nåt DÅLIGT har hänt",
        "Stor oro", "Ett ekonomiskt hållbart val", "Sluta jobb i tid", "Utomhus på lunchen",
        "Jobba med 30 min timer", "Använt SORK", "Träning", "Mindfulness", "Bad/Kallbad",
        "Psykolog", "Läkarbesök", "Alkohol", "Social Aktivitet", "Ångest",
        "Leta Efter Information", "Allt Bara Funkar", "Hög Energi", "Handlat Mer Än Vanligt",
        "Jag mår äntligen bra", "Känner mig mindful", "Högt självförtroende",
        "Lyssnar på hetsig och hög musik", "Upplevd brådska för något",
        "Upplevt starkt magstöd vid prat och sång", "Energi flödar i kroppen",
        "Många ideer på jobbet", "Svårt att vänta när andra pratar",
        "Ser sammanhang tydligt", "Handlat något ovanligt",
        "Jag är smartare än andra", "Spontan ex inlägg på sociala medier",
        "Dofter och färger är tydligare", "Upplever att jag måste bromsa hjärnan",
        "Anteckningar",
    ])
    for e in entries:
        writer.writerow([
            _date_sv(e.date), WEEKDAYS_SV[e.date.weekday()],
            _mood(e.mood_high), _mood(e.mood_low),
            _bool(e.medicin), _bool(e.somnavvikelse), _bool(e.stress_symptom),
            _bool(e.hogt_engagemang), _bool(e.nat_bra_hant), _bool(e.nat_daligt_hant),
            _bool(e.stor_oro), _bool(e.ekonomiskt_hallbart_val), _bool(e.sluta_jobb_i_tid),
            _bool(e.utomhus_pa_lunchen), _bool(e.jobba_30min_timer), _bool(e.anvant_sork),
            _bool(e.traning), _bool(e.mindfulness), _bool(e.bad_kallbad),
            _bool(e.psykolog), _bool(e.lakarbesok), _bool(e.alkohol),
            _bool(e.social_aktivitet), _bool(e.angest), _bool(e.leta_efter_information),
            _bool(e.allt_bara_funkar), _bool(e.hog_energi), _bool(e.handlat_mer_an_vanligt),
            _bool(e.jag_mar_antligen_bra), _bool(e.kanner_mig_mindful), _bool(e.hogt_sjalvfortroende),
            _bool(e.lyssnar_hetsig_musik), _bool(e.upplevd_bradska), _bool(e.upplevt_magstodd),
            _bool(e.energi_flodar), _bool(e.manga_ideer), _bool(e.svart_att_vanta),
            _bool(e.ser_sammanhang), _bool(e.handlat_ovanligt), _bool(e.jag_ar_smartare),
            _bool(e.spontan_inlagg), _bool(e.dofter_tydligare), _bool(e.maste_bromsa_hjarnan),
            e.anteckningar or "",
        ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue().encode("utf-8-sig")]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=dagbok_export.csv"},
    )


@router.get("/dates", response_model=List[str])
async def filled_dates(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    db: AsyncSession = Depends(get_db),
    _auth: dict = Depends(require_auth),
):
    """Return list of ISO date strings that have diary entries (for calendar view)."""
    q = select(DiaryEntry.date).order_by(DiaryEntry.date)
    if date_from:
        q = q.where(DiaryEntry.date >= date_from)
    if date_to:
        q = q.where(DiaryEntry.date <= date_to)
    result = await db.execute(q)
    return [str(d) for d in result.scalars().all()]


@router.get("/{entry_date}", response_model=DiaryEntryOut)
async def get_entry(
    entry_date: date,
    db: AsyncSession = Depends(get_db),
    _auth: dict = Depends(require_auth),
):
    result = await db.execute(
        select(DiaryEntry)
        .options(selectinload(DiaryEntry.garmin_data))
        .where(DiaryEntry.date == entry_date)
    )
    return _entry_or_404(result.scalar_one_or_none())


@router.put("/{entry_date}", response_model=DiaryEntryOut)
async def upsert_entry(
    entry_date: date,
    body: DiaryEntryCreate,
    db: AsyncSession = Depends(get_db),
    _auth: dict = Depends(require_auth),
):
    """Create or fully replace a diary entry for a given date."""
    result = await db.execute(select(DiaryEntry).where(DiaryEntry.date == entry_date))
    entry = result.scalar_one_or_none()
    data = body.model_dump(exclude={"date"})
    if entry:
        for k, v in data.items():
            setattr(entry, k, v)
    else:
        entry = DiaryEntry(date=entry_date, **data)
        db.add(entry)
    await db.commit()
    # Reload with eager garmin_data to avoid async lazy-load crash
    result2 = await db.execute(
        select(DiaryEntry).options(selectinload(DiaryEntry.garmin_data)).where(DiaryEntry.date == entry_date)
    )
    return result2.scalar_one()


@router.patch("/{entry_date}", response_model=DiaryEntryOut)
async def patch_entry(
    entry_date: date,
    body: DiaryEntryUpdate,
    db: AsyncSession = Depends(get_db),
    _auth: dict = Depends(require_auth),
):
    """Partial update — only fields present in the request body are changed."""
    result = await db.execute(select(DiaryEntry).where(DiaryEntry.date == entry_date))
    entry = result.scalar_one_or_none()
    if not entry:
        # Auto-create on first partial save (common during live diary fill)
        entry = DiaryEntry(date=entry_date)
        db.add(entry)
    data = body.model_dump(exclude_unset=True, exclude={"date"})
    for k, v in data.items():
        setattr(entry, k, v)
    await db.commit()
    result2 = await db.execute(
        select(DiaryEntry).options(selectinload(DiaryEntry.garmin_data)).where(DiaryEntry.date == entry_date)
    )
    return result2.scalar_one()


@router.delete("/{entry_date}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_entry(
    entry_date: date,
    db: AsyncSession = Depends(get_db),
    _auth: dict = Depends(require_auth),
):
    result = await db.execute(select(DiaryEntry).where(DiaryEntry.date == entry_date))
    entry = _entry_or_404(result.scalar_one_or_none())
    await db.delete(entry)
    await db.commit()
