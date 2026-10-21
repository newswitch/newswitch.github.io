from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="APP_", env_file=".env", extra="ignore")
    database_url: str = Field(default="sqlite+aiosqlite:///./tasks.db", repr=False)
    jwt_secret: SecretStr
    lease_seconds: float = Field(default=15, ge=1, le=300)
    max_attempts: int = Field(default=3, ge=1, le=10)

    @field_validator("jwt_secret")
    @classmethod
    def strong_key(cls, value):
        if (len(value.get_secret_value().encode()) < 32
                or value.get_secret_value().startswith("replace-with-")):
            raise ValueError("APP_JWT_SECRET must contain at least 32 bytes")
        return value

    @field_validator("database_url")
    @classmethod
    def supported_driver(cls, value):
        if not value.startswith(("sqlite+aiosqlite://", "postgresql+asyncpg://")):
            raise ValueError("use an explicit asynchronous database driver")
        return value
