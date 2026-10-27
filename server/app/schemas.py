from pydantic import BaseModel, ConfigDict, EmailStr, Field, FiniteFloat, field_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class RegisterInput(StrictModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr = Field(max_length=254)
    password: str = Field(min_length=8)


class LoginInput(StrictModel):
    email: EmailStr = Field(max_length=254)
    password: str = Field(min_length=1)


class SimulateInput(StrictModel):
    count: int = Field(ge=1, le=50)
    mode: str

    @field_validator("mode")
    @classmethod
    def valid_mode(cls, value: str) -> str:
        if value not in {"random", "fraud"}:
            raise ValueError("mode must be random or fraud.")
        return value


class ReviewInput(StrictModel):
    decision: str

    @field_validator("decision")
    @classmethod
    def valid_decision(cls, value: str) -> str:
        if value not in {"confirmed_fraud", "legit"}:
            raise ValueError("decision must be confirmed_fraud or legit.")
        return value


FEATURES = ["Time", *[f"V{i}" for i in range(1, 29)], "Amount"]


class TransactionFeatures(StrictModel):
    Time: FiniteFloat
    V1: FiniteFloat
    V2: FiniteFloat
    V3: FiniteFloat
    V4: FiniteFloat
    V5: FiniteFloat
    V6: FiniteFloat
    V7: FiniteFloat
    V8: FiniteFloat
    V9: FiniteFloat
    V10: FiniteFloat
    V11: FiniteFloat
    V12: FiniteFloat
    V13: FiniteFloat
    V14: FiniteFloat
    V15: FiniteFloat
    V16: FiniteFloat
    V17: FiniteFloat
    V18: FiniteFloat
    V19: FiniteFloat
    V20: FiniteFloat
    V21: FiniteFloat
    V22: FiniteFloat
    V23: FiniteFloat
    V24: FiniteFloat
    V25: FiniteFloat
    V26: FiniteFloat
    V27: FiniteFloat
    V28: FiniteFloat
    Amount: FiniteFloat = Field(ge=0)


class BatchInput(StrictModel):
    transactions: list[TransactionFeatures] = Field(min_length=1, max_length=100)


class CheckoutInput(StrictModel):
    amount: FiniteFloat = Field(ge=1, le=999999.99)
    currency: str = "inr"
    mode: str

    @field_validator("currency")
    @classmethod
    def valid_currency(cls, value: str) -> str:
        value = value.lower()
        if len(value) != 3 or not value.isalpha():
            raise ValueError("currency must be a three-letter code.")
        return value

    @field_validator("mode")
    @classmethod
    def valid_mode(cls, value: str) -> str:
        if value not in {"normal", "fraud-demo"}:
            raise ValueError("mode must be normal or fraud-demo.")
        return value


class PaymentVerification(StrictModel):
    sessionToken: str = Field(min_length=1)
    razorpay_payment_id: str = Field(min_length=1)
    razorpay_order_id: str = Field(min_length=1)
    razorpay_signature: str = Field(min_length=1)
