from datetime import UTC, datetime, timedelta
import secrets
import jwt
from pwdlib import PasswordHash

def main():
    passwords = PasswordHash.recommended()
    stored = passwords.hash("lesson-password")
    print("password:", passwords.verify("lesson-password", stored))
    key = secrets.token_bytes(32)
    now = datetime.now(UTC)
    token = jwt.encode({
        "sub": "user-1", "iss": "lesson-issuer", "aud": "jobs-api",
        "iat": now, "exp": now + timedelta(minutes=2),
    }, key, algorithm="HS256")
    claims = jwt.decode(
        token, key, algorithms=["HS256"], issuer="lesson-issuer",
        audience="jobs-api", options={"require": ["sub", "iss", "aud", "exp"]})
    print("subject:", claims["sub"])
    try:
        jwt.decode(token, key, algorithms=["HS256"], audience="other",
                   issuer="lesson-issuer")
    except jwt.InvalidAudienceError:
        print("wrong audience rejected")

if __name__ == "__main__":
    main()
