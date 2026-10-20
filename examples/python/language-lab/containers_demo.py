def main():
    names = ["api", "worker", "api"]
    ordered_unique = list(dict.fromkeys(names))
    print("unique:", ordered_unique)

    counts = {}
    for name in names:
        counts[name] = counts.get(name, 0) + 1
    print("counts:", counts)

    by_name = {"api": 8000, "worker": 9000}
    keys = by_name.keys()
    by_name["metrics"] = 9100
    print("live keys:", list(keys))
    print("missing:", by_name.get("admin"))
    print("present:", "admin" in by_name)

    required = {"api", "worker"}
    actual = {"api", "metrics"}
    print("missing services:", sorted(required - actual))
    print("common:", sorted(required & actual))
    ports = [443, 80, 8080]
    print("sorted:", sorted(ports))
    print("original:", ports)
    print("sort return:", ports.sort())
    print("in place:", ports)

if __name__ == "__main__":
    main()
