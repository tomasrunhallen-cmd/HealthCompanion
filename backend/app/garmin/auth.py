"""
Fernet-encrypted Garmin credential storage.
The master key comes from GARMIN_ENCRYPTION_KEY in .env.
If no key exists, one is generated and printed — save it to .env.
"""
from __future__ import annotations

import base64
import os
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import GarminCredentials


def _get_fernet() -> Fernet:
    settings = get_settings()
    key = settings.garmin_encryption_key
    if not key:
        new_key = Fernet.generate_key().decode()
        print(
            f"\n[VARNING] GARMIN_ENCRYPTION_KEY saknas i .env.\n"
            f"Genererad nyckel (lägg till i .env):\n  GARMIN_ENCRYPTION_KEY={new_key}\n"
        )
        return Fernet(new_key.encode())
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt(plaintext: str) -> str:
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    try:
        return _get_fernet().decrypt(ciphertext.encode()).decode()
    except InvalidToken as e:
        raise ValueError("Kunde inte dekryptera Garmin-credentials — fel nyckel?") from e


async def save_credentials(db: AsyncSession, username: str, password: str) -> GarminCredentials:
    result = await db.execute(select(GarminCredentials))
    cred = result.scalar_one_or_none()
    if cred:
        cred.username_enc = encrypt(username)
        cred.password_enc = encrypt(password)
        cred.session_token_enc = None
    else:
        cred = GarminCredentials(
            username_enc=encrypt(username),
            password_enc=encrypt(password),
        )
        db.add(cred)
    await db.commit()
    await db.refresh(cred)
    return cred


async def load_credentials(db: AsyncSession) -> Optional[tuple[str, str]]:
    """Returns (username, password) or None if not configured."""
    result = await db.execute(select(GarminCredentials))
    cred = result.scalar_one_or_none()
    if not cred:
        return None
    return decrypt(cred.username_enc), decrypt(cred.password_enc)


async def save_session_token(db: AsyncSession, token: str) -> None:
    result = await db.execute(select(GarminCredentials))
    cred = result.scalar_one_or_none()
    if cred:
        cred.session_token_enc = encrypt(token)
        await db.commit()
