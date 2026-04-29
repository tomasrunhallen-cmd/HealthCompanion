import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address

from app.auth import create_token
from app.config import get_settings
from app.database import init_db
from app.routes import analysis, diary, garmin, import_csv
from app.schemas import LoginRequest, TokenResponse


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


settings = get_settings()

limiter = Limiter(key_func=get_remote_address, default_limits=[f"{settings.rate_limit_per_minute}/minute"])

app = FastAPI(
    title="HealthCompanion API",
    description="Personlig bipolär stämnings- & hälsoanalys",
    version="1.0.0",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(diary.router, prefix="/api/diary", tags=["diary"])
app.include_router(import_csv.router, prefix="/api/import", tags=["import"])
app.include_router(garmin.router, prefix="/api/garmin", tags=["garmin"])
app.include_router(analysis.router, prefix="/api/analysis", tags=["analysis"])


@app.post("/api/auth/login", response_model=TokenResponse)
async def login(body: LoginRequest):
    if body.password != settings.app_password:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Fel lösenord")
    token = create_token({"sub": "user"})
    return TokenResponse(access_token=token)


@app.get("/api/health")
async def health():
    return {"status": "ok"}
