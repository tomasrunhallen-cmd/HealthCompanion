from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_auth
from app.database import get_db
from app.garmin.auth import save_credentials
from app.garmin.sync import sync_range, update_last_sync
from app.models import GarminCredentials, GarminData
from app.schemas import GarminDataOut, GarminSyncStatus

router = APIRouter()


class GarminSetupRequest(BaseModel):
    username: str
    password: str


class SyncRequest(BaseModel):
    date_from: Optional[date] = None
    date_to: Optional[date] = None


@router.get("/status", response_model=GarminSyncStatus)
async def garmin_status(
    db: AsyncSession = Depends(get_db),
    _auth: dict = Depends(require_auth),
):
    result = await db.execute(select(GarminCredentials))
    cred = result.scalar_one_or_none()
    return GarminSyncStatus(
        last_sync=cred.last_sync if cred else None,
        credentials_configured=cred is not None,
        message="Klart" if cred else "Garmin-credentials ej konfigurerade",
    )


@router.post("/setup")
async def setup_garmin(
    body: GarminSetupRequest,
    db: AsyncSession = Depends(get_db),
    _auth: dict = Depends(require_auth),
):
    await save_credentials(db, body.username, body.password)
    return {"message": "Garmin-credentials sparade"}


@router.post("/sync")
async def trigger_sync(
    body: SyncRequest,
    db: AsyncSession = Depends(get_db),
    _auth: dict = Depends(require_auth),
):
    """
    Trigger a Garmin sync for a date range.
    Defaults to the last 7 days if no range is provided.
    """
    today = date.today()
    date_to = body.date_to or today
    date_from = body.date_from or (today - timedelta(days=7))

    if (date_to - date_from).days > 365:
        raise HTTPException(status_code=400, detail="Max 365 dagar per sync-körning")

    try:
        results = await sync_range(db, date_from, date_to)
        await update_last_sync(db)
        return {
            "message": f"Synkade {len(results)} dagar ({date_from} – {date_to})",
            "synced_count": len(results),
        }
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Garmin-fel: {str(e)[:200]}",
        )


@router.get("/data", response_model=list[GarminDataOut])
async def list_garmin_data(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    db: AsyncSession = Depends(get_db),
    _auth: dict = Depends(require_auth),
):
    q = select(GarminData).order_by(GarminData.date.desc())
    if date_from:
        q = q.where(GarminData.date >= date_from)
    if date_to:
        q = q.where(GarminData.date <= date_to)
    result = await db.execute(q)
    return result.scalars().all()
