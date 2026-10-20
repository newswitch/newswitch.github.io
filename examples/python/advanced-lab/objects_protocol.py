class JobKey:
    def __init__(self, tenant, name):
        self._value = (tenant, name)

    def __eq__(self, other):
        if not isinstance(other, JobKey):
            return NotImplemented
        return self._value == other._value

    def __hash__(self):
        return hash(self._value)

    def __repr__(self):
        return f"JobKey{self._value!r}"

def main():
    first = JobKey("a", "import")
    second = JobKey("a", "import")
    mapping = {first: "ready"}
    print(first == second, first is second)
    print(mapping[second])
    print(len({first, second}))
    print(first == "import")

if __name__ == "__main__":
    main()
