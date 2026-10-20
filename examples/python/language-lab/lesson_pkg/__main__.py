import sys

from .rules import normalize_name

def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 1:
        print("usage: python -m lesson_pkg NAME", file=sys.stderr)
        return 2
    try:
        result = normalize_name(args[0])
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 2
    print(result)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
