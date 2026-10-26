from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID

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

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("Group name is required.")
        return value


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


class ExpensePatch(BaseModel):
    description: str = Field(min_length=1, max_length=255)
    total_amount: Decimal = Field(gt=0)

    @field_validator("total_amount")
    @classmethod
    def total_scale(cls, value: Decimal) -> Decimal:
        return validate_money_scale(value)


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


class ChangePassword(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=6, max_length=128)
