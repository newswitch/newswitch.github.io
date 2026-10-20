from dataclasses import dataclass, field
from enum import StrEnum
from typing import Protocol

class State(StrEnum):
    READY = "ready"
    DONE = "done"

@dataclass(frozen=True)
class Job:
    name: str
    state: State = State.READY

@dataclass
class Batch:
    jobs: list[Job] = field(default_factory=list)

class Store(Protocol):
    def save(self, job: Job) -> str: ...

class MemoryStore:
    def save(self, job: Job) -> str:
        return f"{job.name}:{job.state.value}"

def persist(store: Store, job: Job) -> str:
    return store.save(job)

def main():
    first, second = Batch(), Batch()
    first.jobs.append(Job("import"))
    print(persist(MemoryStore(), first.jobs[0]))
    print(len(first.jobs), len(second.jobs))
    print(Job("import") == Job("import"))

if __name__ == "__main__":
    main()
