from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import require_auth
from app.database import get_db
from app.models import DiaryEntry
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
    await db.refresh(entry)
    return entry


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
    await db.refresh(entry)
    return entry


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
