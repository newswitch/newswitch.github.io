"""Intentional static errors for the negative type-check exercise. Do not execute."""
from typing_good import Job, MemoryStore, roundtrip

wrong: str = roundtrip(MemoryStore(), Job("import"))
MemoryStore().save("not a Job")
