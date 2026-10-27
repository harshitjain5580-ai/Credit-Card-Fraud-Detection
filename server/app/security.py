from datetime import datetime, timedelta, timezone
import os

import bcrypt
import jwt
from fastapi import Depends, Header, HTTPException, Request


def jwt_secret() -> str:
    secret = os.getenv("JWT_SECRET", "")
    if len(secret) < 32:
        raise RuntimeError("JWT_SECRET must contain at least 32 characters.")
    return secret


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except (ValueError, TypeError):
        return False


def issue_token(user_id: str, role: str) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {"sub": user_id, "role": role, "iat": now, "exp": now + timedelta(days=7)},
        jwt_secret(),
        algorithm="HS256",
    )


def current_user(
    request: Request,
    authorization: str | None = Header(default=None),
) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail={"message": "Authentication is required.", "code": "UNAUTHORIZED"})
    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = jwt.decode(token, jwt_secret(), algorithms=["HS256"])
        user_id = payload.get("sub")
    except jwt.PyJWTError:
        user_id = None
    if not user_id:
        raise HTTPException(status_code=401, detail={"message": "The login session is invalid or expired.", "code": "UNAUTHORIZED"})
    from bson import ObjectId

    user = (
        request.app.state.db.users.find_one({"_id": ObjectId(user_id)})
        if ObjectId.is_valid(user_id)
        else None
    )
    if not user:
        raise HTTPException(status_code=401, detail={"message": "User account was not found.", "code": "UNAUTHORIZED"})
    return user


def public_user(user: dict) -> dict:
    return {
        "id": str(user.get("_id", user.get("id"))),
        "name": user["name"],
        "email": user["email"],
        "role": user.get("role", "merchant"),
    }
