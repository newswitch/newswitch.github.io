def find_first(values, target):
    for index, value in enumerate(values):
        if value == target:
            break
    else:
        return "missing"
    return f"found:{index}"

def describe(event):
    match event:
        case {"kind": "start", "port": int(port)} if 1 <= port <= 65535:
            return f"start:{port}"
        case {"kind": "stop"}:
            return "stop"
        case _:
            return "invalid"

def main():
    print("range:", list(range(1, 6, 2)))
    print(find_first([4, 8, 9], 8))
    print(find_first([], 8))
    print(describe({"kind": "start", "port": 8000}))
    print(describe({"kind": "start", "port": 70000}))
    print("filtered:", [x * x for x in range(5) if x % 2 == 0])
    try:
        print(list(zip([1, 2], ["a"], strict=True)))
    except ValueError:
        print("zip: length mismatch")

if __name__ == "__main__":
    main()
