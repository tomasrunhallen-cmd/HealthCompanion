"""
Garmin Connect sync module.
Uses python-garminconnect (unofficial wrapper) to fetch daily health data.

Rate limiting: max 1 req/s with exponential backoff on errors.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import date, datetime, timedelta
from typing import Optional

from garminconnect import Garmin, GarminConnectAuthenticationError, GarminConnectTooManyRequestsError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.garmin.auth import load_credentials
from app.models import DiaryEntry, GarminCredentials, GarminData

logger = logging.getLogger(__name__)

_MIN_DELAY = 1.0  # seconds between requests


async def _sleep(seconds: float) -> None:
    await asyncio.sleep(seconds)


def _make_client(username: str, password: str) -> Garmin:
    client = Garmin(username, password)
    client.login()
    return client


async def get_or_create_client(db: AsyncSession) -> Garmin:
    creds = await load_credentials(db)
    if not creds:
        raise ValueError("Garmin-credentials ej konfigurerade. Gå till Inställningar och ange användarnamn/lösenord.")
    username, password = creds
    # Login runs in a thread since garminconnect is sync
    loop = asyncio.get_event_loop()
    client = await loop.run_in_executor(None, _make_client, username, password)
    return client


async def _fetch_with_backoff(fn, *args, max_retries: int = 4, **kwargs):
    """Call a sync garminconnect method with retry on rate-limit errors."""
    delay = 1.0
    for attempt in range(max_retries + 1):
        try:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, lambda: fn(*args, **kwargs))
            await _sleep(_MIN_DELAY)
            return result
        except GarminConnectTooManyRequestsError:
            if attempt == max_retries:
                raise
            logger.warning(f"Rate limited by Garmin. Waiting {delay}s (attempt {attempt + 1})")
            await _sleep(delay)
            delay = min(delay * 2, 60)
        except Exception as e:
            if attempt == max_retries:
                raise
            logger.warning(f"Garmin fetch error: {e}. Retrying in {delay}s")
            await _sleep(delay)
            delay = min(delay * 2, 60)


def _safe_int(val) -> Optional[int]:
    try:
        return int(val) if val is not None else None
    except (TypeError, ValueError):
        return None


def _safe_float(val) -> Optional[float]:
    try:
        return float(val) if val is not None else None
    except (TypeError, ValueError):
        return None


async def sync_date(client: Garmin, db: AsyncSession, target_date: date) -> GarminData:
    """Fetch all Garmin data for a single date and upsert into the DB."""
    date_str = target_date.isoformat()

    # Sleep result
    sleep_raw = await _fetch_with_backoff(client.get_sleep_data, date_str)
    # HRV
    hrv_raw = await _fetch_with_backoff(client.get_hrv_data, date_str)
    # Daily stats (stress, body battery, steps, resting HR)
    stats_raw = await _fetch_with_backoff(client.get_stats, date_str)
    # Activities
    activities_raw = await _fetch_with_backoff(client.get_activities_by_date, date_str, date_str)

    # --- Parse sleep ---
    total_sleep = deep_sleep = rem_sleep = light_sleep = sleep_score = None
    sleep_start = sleep_end = None
    if sleep_raw and isinstance(sleep_raw, dict):
        daily = sleep_raw.get("dailySleepDTO", {}) or {}
        total_sleep = _safe_int(daily.get("sleepTimeSeconds", 0) or 0) // 60 if daily.get("sleepTimeSeconds") else None
        deep_sleep = _safe_int(daily.get("deepSleepSeconds", 0) or 0) // 60 if daily.get("deepSleepSeconds") else None
        rem_sleep = _safe_int(daily.get("remSleepSeconds", 0) or 0) // 60 if daily.get("remSleepSeconds") else None
        light_sleep = _safe_int(daily.get("lightSleepSeconds", 0) or 0) // 60 if daily.get("lightSleepSeconds") else None
        sleep_score = _safe_int(daily.get("sleepScores", {}).get("overall", {}).get("value") if isinstance(daily.get("sleepScores"), dict) else None)
        sleep_start = str(daily.get("sleepStartTimestampLocal", "")) or None
        sleep_end = str(daily.get("sleepEndTimestampLocal", "")) or None

    # --- Parse HRV ---
    hrv = None
    if hrv_raw and isinstance(hrv_raw, dict):
        hrv = _safe_float(hrv_raw.get("lastNight") or hrv_raw.get("hrvSummary", {}).get("lastNight"))

    # --- Parse daily stats ---
    avg_stress = max_stress = resting_hr = body_bat_start = body_bat_end = steps = None
    if stats_raw and isinstance(stats_raw, dict):
        avg_stress = _safe_int(stats_raw.get("averageStressLevel"))
        max_stress = _safe_int(stats_raw.get("maxStressLevel"))
        resting_hr = _safe_int(stats_raw.get("restingHeartRate"))
        body_bat_start = _safe_int(stats_raw.get("bodyBatteryHighestValue"))
        body_bat_end = _safe_int(stats_raw.get("bodyBatteryLowestValue"))
        steps = _safe_int(stats_raw.get("totalSteps"))

    # --- Parse activities ---
    workouts = []
    if activities_raw and isinstance(activities_raw, list):
        for act in activities_raw:
            workouts.append({
                "type": act.get("activityType", {}).get("typeKey", "unknown"),
                "name": act.get("activityName", ""),
                "duration_minutes": _safe_int((act.get("duration") or 0) / 60),
                "calories": _safe_int(act.get("calories")),
                "avg_hr": _safe_int(act.get("averageHR")),
            })

    # --- Upsert ---
    existing_result = await db.execute(select(GarminData).where(GarminData.date == target_date))
    gd = existing_result.scalar_one_or_none()

    # Link to diary entry if it exists
    diary_result = await db.execute(select(DiaryEntry).where(DiaryEntry.date == target_date))
    diary_entry = diary_result.scalar_one_or_none()

    data = dict(
        date=target_date,
        diary_entry_id=diary_entry.id if diary_entry else None,
        total_sleep_minutes=total_sleep,
        deep_sleep_minutes=deep_sleep,
        rem_sleep_minutes=rem_sleep,
        light_sleep_minutes=light_sleep,
        sleep_score=sleep_score,
        sleep_start=sleep_start,
        sleep_end=sleep_end,
        hrv_last_night=hrv,
        resting_heart_rate=resting_hr,
        avg_stress=avg_stress,
        max_stress=max_stress,
        body_battery_start=body_bat_start,
        body_battery_end=body_bat_end,
        steps=steps,
        workouts_json=json.dumps(workouts, ensure_ascii=False) if workouts else None,
    )

    if gd:
        for k, v in data.items():
            setattr(gd, k, v)
    else:
        gd = GarminData(**data)
        db.add(gd)

    await db.commit()
    await db.refresh(gd)
    return gd


async def sync_range(
    db: AsyncSession,
    date_from: date,
    date_to: date,
    progress_callback=None,
) -> list[GarminData]:
    """Sync a date range. Returns list of GarminData records."""
    client = await get_or_create_client(db)
    results = []
    current = date_from
    total = (date_to - date_from).days + 1
    done = 0
    while current <= date_to:
        try:
            gd = await sync_date(client, db, current)
            results.append(gd)
            logger.info(f"Garmin sync OK: {current}")
        except Exception as e:
            logger.error(f"Garmin sync failed for {current}: {e}")
        done += 1
        if progress_callback:
            await progress_callback(done, total, current)
        current += timedelta(days=1)
    return results


async def update_last_sync(db: AsyncSession) -> None:
    from sqlalchemy import select
    result = await db.execute(select(GarminCredentials))
    cred = result.scalar_one_or_none()
    if cred:
        cred.last_sync = datetime.utcnow()
        await db.commit()
