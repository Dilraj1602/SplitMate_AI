from pydantic import BaseModel, EmailStr, Field, model_validator


class RegisterRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=100)
    username: str = Field(min_length=3, max_length=30, pattern=r"^[A-Za-z0-9_]+$")
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)


class EmailOtpRequest(BaseModel):
    email: EmailStr
    code: str = Field(pattern=r"^\d{6}$")


class EmailRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirm(BaseModel):
    new_password: str = Field(min_length=6, max_length=128)
    confirm_password: str = Field(min_length=6, max_length=128)

    @model_validator(mode="after")
    def passwords_match(self) -> "PasswordResetConfirm":
        if self.new_password != self.confirm_password:
            raise ValueError("Passwords do not match.")
        return self


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
