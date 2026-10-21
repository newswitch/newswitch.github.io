from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import jwt
from fastapi import HTTPException


@dataclass(frozen=True)
class Principal:
    subject: str
    tenant: str
    permissions: frozenset[str]


def issue_local(key, tenant, *, permissions=("jobs:read", "jobs:write")):
    """Controlled lab issuer, not a public login endpoint."""
    if not 1 <= len(tenant) <= 80:
        raise ValueError("invalid tenant")
    now = datetime.now(UTC)
    return jwt.encode({"sub": "local-student", "tenant": tenant,
                       "permissions": list(permissions), "iss": "task-lab",
                       "aud": "task-api", "iat": now, "nbf": now,
                       "exp": now + timedelta(minutes=15)}, key, algorithm="HS256")


def authenticate(token, key):
    failure = HTTPException(401, "invalid credentials",
                            headers={"WWW-Authenticate": "Bearer"})
    try:
        claims = jwt.decode(token, key, algorithms=["HS256"], issuer="task-lab",
                            audience="task-api", options={"require": [
                                "sub", "tenant", "permissions", "iat", "nbf", "exp"]})
    except jwt.InvalidTokenError:
        raise failure from None
    if (not isinstance(claims["sub"], str) or not claims["sub"]
            or not isinstance(claims["tenant"], str)
            or not 1 <= len(claims["tenant"]) <= 80
            or not isinstance(claims["permissions"], list)
            or not all(isinstance(item, str) for item in claims["permissions"])):
        raise failure
    return Principal(claims["sub"], claims["tenant"], frozenset(claims["permissions"]))


def permit(user, permission):
    if permission not in user.permissions:
        raise HTTPException(403, "operation not permitted")
