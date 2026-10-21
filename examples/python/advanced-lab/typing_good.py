from dataclasses import dataclass
from typing import Protocol, TypedDict


@dataclass(frozen=True)
class Job:
    name: str


class JobInput(TypedDict):
    name: str


class Store[T](Protocol):
    def save(self, item: T) -> str: ...
    def load(self, key: str) -> T: ...


class MemoryStore:
    def __init__(self) -> None:
        self.rows: dict[str, Job] = {}

    def save(self, item: Job) -> str:
        self.rows[item.name] = item
        return item.name

    def load(self, key: str) -> Job:
        return self.rows[key]


def roundtrip[T](store: Store[T], item: T) -> T:
    return store.load(store.save(item))


def main() -> None:
    incoming: JobInput = {"name": "import"}
    stored: Job = roundtrip(MemoryStore(), Job(incoming["name"]))
    print(stored.name)


if __name__ == "__main__":
    main()
