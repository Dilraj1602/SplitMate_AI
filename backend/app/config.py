
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str | None = None
    cors_origins: list[str] = Field(default_factory=list)
    environment: str = "development"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
        enable_decoding=False,
    )

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @property
    def effective_cors_origins(self) -> list[str]:
        if self.cors_origins:
            return self.cors_origins
        if self.environment.lower() == "development":
            return ["http://localhost:5173", "http://127.0.0.1:5173"]
        return []


settings = Settings()
