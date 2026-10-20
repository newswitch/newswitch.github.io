import sys

def greet(name):
    return f"Hello, {name}!"

def main():
    name = sys.argv[1] if len(sys.argv) > 1 else "Python"
    print("entry:", __name__)
    print(greet(name))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
