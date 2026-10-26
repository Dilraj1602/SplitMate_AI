
from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str | None = None
    brevo_api_key: str | None = None
    brevo_sender_email: str = "wolfstrix360@gmail.com"
    brevo_sender_name: str = "SplitMateAi"
    secret_key: str | None = None
    otp_expiry_minutes: int = 5
    otp_max_attempts: int = 5
    otp_resend_cooldown_seconds: int = 60
    otp_rate_limit_per_hour: int = 5
    access_token_expiry_minutes: int = 15
    username_change_cooldown_days: int = Field(default=30, ge=0, le=3650)
    dev_otp_bypass: bool = Field(
        default=False,
        validation_alias="DEV_OTP_BYPASS",
    )
    dev_otp_code: str | None = None
    cors_origins: list[str] = Field(default_factory=list)
    frontend_base_url: str = "http://localhost:5173"
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

    @field_validator("secret_key")
    @classmethod
    def validate_secret_key(cls, value: str | None) -> str | None:
        if value and len(value) < 32:
            raise ValueError("SECRET_KEY must contain at least 32 characters")
        return value

    @model_validator(mode="after")
    def validate_dev_otp(self) -> "Settings":
        if self.dev_otp_bypass:
            if self.environment.lower() != "development":
                raise ValueError("DEV_OTP_BYPASS is only allowed when ENVIRONMENT=development")
            if not self.dev_otp_code or len(self.dev_otp_code) != 6 or not self.dev_otp_code.isdigit():
                raise ValueError("DEV_OTP_CODE must be a six-digit value when DEV_OTP_BYPASS is enabled")
        return self

    @property
    def effective_cors_origins(self) -> list[str]:
        if self.cors_origins:
            return self.cors_origins
        if self.environment.lower() == "development":
            return ["http://localhost:5173", "http://127.0.0.1:5173"]
        return []


settings = Settings()
