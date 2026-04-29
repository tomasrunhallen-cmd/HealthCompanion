from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    app_password: str = "changeme"
    secret_key: str = "insecure-dev-key-replace-in-production"
    database_url: str = "sqlite+aiosqlite:///./data/mood.db"

    anthropic_api_key: str = ""
    garmin_username: str = ""
    garmin_password: str = ""
    garmin_encryption_key: str = ""

    allowed_origins: str = "http://localhost:3000"
    rate_limit_per_minute: int = 60

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()
