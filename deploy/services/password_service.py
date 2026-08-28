"""Password hashing with transparent migration from the legacy SHA-256 format."""
from __future__ import annotations

import hashlib
import hmac

import bcrypt


BCRYPT_PREFIXES = ("$2a$", "$2b$", "$2y$")


def hash_password(password: str) -> str:
    if not password or len(password) < 8:
        raise ValueError("password must be at least 8 characters")
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("ascii")


def verify_password_hash(password: str, stored_hash: str) -> tuple[bool, bool]:
    """Return ``(valid, needs_upgrade)`` without exposing hash-format details upstream."""
    if not password or not stored_hash:
        return False, False
    if stored_hash.startswith(BCRYPT_PREFIXES):
        try:
            return bcrypt.checkpw(password.encode("utf-8"), stored_hash.encode("ascii")), False
        except (ValueError, TypeError):
            return False, False

    legacy = hashlib.sha256(password.encode("utf-8")).hexdigest()
    valid = hmac.compare_digest(legacy, stored_hash)
    return valid, valid
