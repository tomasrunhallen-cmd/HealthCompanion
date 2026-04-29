from typing import List

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_auth
from app.database import get_db
from app.models import DiaryEntry
from app.parsers.mood_csv import parse_csv
from app.schemas import CSVImportResult, CSVPreviewResponse, CSVPreviewRow

router = APIRouter()

MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # 5 MB


@router.post("/preview", response_model=CSVPreviewResponse)
async def preview_csv(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _auth: dict = Depends(require_auth),
):
    """Parse CSV and return a preview without writing to the database."""
    raw = await file.read()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Filen är för stor (max 5 MB)")

    rows, header_errors = parse_csv(raw)

    # Fetch existing dates for duplicate detection
    existing_dates_result = await db.execute(select(DiaryEntry.date))
    existing_dates = {d for d in existing_dates_result.scalars().all()}

    parse_errors = [{"row": r.row_number, "error": r.error} for r in rows if not r.ok]
    parse_errors = header_errors + parse_errors

    good_rows = [r for r in rows if r.ok and not r.is_empty()]
    preview: List[CSVPreviewRow] = [
        CSVPreviewRow(
            row_number=r.row_number,
            date=r.date,  # type: ignore[arg-type]
            already_exists=r.date in existing_dates,
            data={k: str(v) if v is not None else None for k, v in r.fields.items()},
        )
        for r in good_rows[:50]  # cap preview at 50 rows
    ]

    return CSVPreviewResponse(
        total_rows=len(rows),
        parseable_rows=len(good_rows),
        parse_errors=parse_errors,
        preview=preview,
    )


@router.post("/commit", response_model=CSVImportResult)
async def commit_csv(
    file: UploadFile = File(...),
    on_conflict: str = Form(default="skip"),
    db: AsyncSession = Depends(get_db),
    _auth: dict = Depends(require_auth),
):
    """
    Import CSV into the database.
    on_conflict: "skip" | "overwrite" | "abort"
    """
    if on_conflict not in ("skip", "overwrite", "abort"):
        raise HTTPException(status_code=400, detail="on_conflict måste vara skip, overwrite eller abort")

    raw = await file.read()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Filen är för stor (max 5 MB)")

    rows, _ = parse_csv(raw)
    good_rows = [r for r in rows if r.ok and not r.is_empty()]

    # Fetch existing entries as a dict {date: DiaryEntry}
    existing_result = await db.execute(select(DiaryEntry))
    existing: dict = {e.date: e for e in existing_result.scalars().all()}

    inserted = updated = skipped = 0
    errors: list[dict] = []

    for r in good_rows:
        try:
            if r.date in existing:
                if on_conflict == "abort":
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=f"Datum {r.date} finns redan. Avbryter import.",
                    )
                if on_conflict == "skip":
                    skipped += 1
                    continue
                # overwrite
                entry = existing[r.date]
                for k, v in r.fields.items():
                    setattr(entry, k, v)
                updated += 1
            else:
                entry = DiaryEntry(date=r.date, **r.fields)
                db.add(entry)
                inserted += 1
        except HTTPException:
            raise
        except Exception as e:
            errors.append({"row": r.row_number, "date": str(r.date), "error": str(e)})

    await db.commit()
    return CSVImportResult(inserted=inserted, updated=updated, skipped=skipped, errors=errors)
