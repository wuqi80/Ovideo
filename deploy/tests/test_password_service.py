import hashlib

from services.password_service import hash_password, verify_password_hash


def test_new_passwords_use_bcrypt():
    encoded = hash_password("a-secure-password")

    assert encoded.startswith(("$2a$", "$2b$", "$2y$"))
    assert verify_password_hash("a-secure-password", encoded) == (True, False)
    assert verify_password_hash("wrong-password", encoded) == (False, False)


def test_legacy_sha256_password_requests_upgrade():
    legacy = hashlib.sha256("legacy-password".encode()).hexdigest()

    assert verify_password_hash("legacy-password", legacy) == (True, True)
    assert verify_password_hash("wrong-password", legacy) == (False, False)
