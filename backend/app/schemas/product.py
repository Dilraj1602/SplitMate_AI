from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator


def validate_money_scale(value: Decimal) -> Decimal:
    if value.as_tuple().exponent < -2:
        raise ValueError("Amounts support at most two decimal places.")
    return value


class GroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    currency: Literal["INR"] = "INR"

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Group name is required.")
        return value


class GroupPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    status: Literal["active", "archived"] | None = None
    join_approval_required: bool | None = None

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("Group name is required.")
        return value


class JoinByCode(BaseModel):
    code: str = Field(min_length=6, max_length=6, pattern=r"^[0-9]{6}$")

    @field_validator("code")
    @classmethod
    def normalize_join_code(cls, value: str) -> str:
        value = value.strip()
        if len(value) != 6 or not value.isdigit():
            raise ValueError("Enter the 6-digit numeric join code.")
        return value


class InviteLinkPatch(BaseModel):
    expiration_option: Literal["1_hour", "5_hours", "24_hours", "7_days", "never"]

class InvitationCreate(BaseModel):
    email: EmailStr | None = None
    username: str | None = Field(default=None, min_length=3, max_length=30, pattern=r"^[A-Za-z0-9_]+$")

    @model_validator(mode="after")
    def exactly_one_recipient(self):
        if bool(self.email) == bool(self.username):
            raise ValueError("Provide exactly one of email or username.")
        return self


class ExpenseShareInput(BaseModel):
    user_id: UUID
    amount: Decimal = Field(ge=0)

    @field_validator("amount")
    @classmethod
    def amount_scale(cls, value: Decimal) -> Decimal:
        return validate_money_scale(value)


class PercentageInput(BaseModel):
    user_id: UUID
    value: Decimal = Field(ge=0, le=100)

    @field_validator("value")
    @classmethod
    def percentage_scale(cls, value: Decimal) -> Decimal:
        if value.as_tuple().exponent < -2:
            raise ValueError("Percentages support at most two decimal places.")
        return value


class ExpenseCreate(BaseModel):
    description: str = Field(min_length=1, max_length=255)
    expense_date: date
    currency: Literal["INR"]
    total_amount: Decimal = Field(gt=0)
    paid_by_user_id: UUID
    split_type: Literal["equal", "exact", "percentage"]
    splits: list[ExpenseShareInput] = Field(min_length=1, max_length=100)
    percentages: list[PercentageInput] | None = None
    idempotency_key: str | None = Field(default=None, max_length=64)

    @field_validator("total_amount")
    @classmethod
    def total_scale(cls, value: Decimal) -> Decimal:
        return validate_money_scale(value)


class AutopayCreate(BaseModel):
    description: str = Field(min_length=1, max_length=255)
    amount: Decimal = Field(gt=0)
    currency: Literal["INR"] = "INR"
    payer_user_id: UUID
    split_type: Literal["equal", "exact", "percentage"]
    splits: list[ExpenseShareInput] = Field(min_length=1, max_length=100)
    percentages: list[PercentageInput] | None = None
    frequency: Literal["daily", "weekly", "monthly", "yearly"]
    repeat_interval: int = Field(default=1, ge=1, le=365)
    start_date: date
    end_date: date | None = None
    timezone: str = Field(default="Asia/Kolkata", min_length=1, max_length=64)

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("Provide a valid IANA timezone.") from exc
        return value


class ExpensePatch(BaseModel):
    description: str | None = Field(default=None, min_length=1, max_length=255)
    total_amount: Decimal | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def require_update(self):
        if self.description is None and self.total_amount is None:
            raise ValueError("Provide a new description or amount.")
        return self

    @field_validator("total_amount")
    @classmethod
    def total_scale(cls, value: Decimal | None) -> Decimal | None:
        return validate_money_scale(value) if value is not None else None


class SettlementCreate(BaseModel):
    recipient_user_id: UUID
    amount: Decimal = Field(gt=0)
    currency: Literal["INR"] = "INR"
    idempotency_key: str | None = Field(default=None, max_length=64)

    @field_validator("amount")
    @classmethod
    def amount_scale(cls, value: Decimal) -> Decimal:
        return validate_money_scale(value)


class ProfilePatch(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=100)
    username: str | None = Field(default=None, min_length=3, max_length=30, pattern=r"^[A-Za-z0-9_]+$")
    timezone: str | None = Field(default=None, min_length=1, max_length=64)

    @field_validator("timezone")
    @classmethod
    def profile_timezone(cls, value: str | None) -> str | None:
        if value is not None:
            try: ZoneInfo(value)
            except (ZoneInfoNotFoundError, ValueError) as exc: raise ValueError("Provide a valid IANA timezone.") from exc
        return value


class ChangePassword(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=6, max_length=128)
