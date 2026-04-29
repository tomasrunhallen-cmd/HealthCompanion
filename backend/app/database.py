import os
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings


def _get_engine():
    settings = get_settings()
    db_url = settings.database_url
    # Ensure the data directory exists
    if db_url.startswith("sqlite"):
        path = db_url.replace("sqlite+aiosqlite:///", "")
        dir_ = os.path.dirname(path)
        if dir_:
            os.makedirs(dir_, exist_ok=True)
    return create_async_engine(db_url, echo=False, connect_args={"check_same_thread": False})


engine = _get_engine()
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:  # type: ignore[return]
    async with AsyncSessionLocal() as session:
        yield session


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
