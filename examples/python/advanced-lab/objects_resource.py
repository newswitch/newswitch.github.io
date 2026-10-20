from contextlib import contextmanager, ExitStack

@contextmanager
def resource(name):
    print("open", name)
    try:
        yield name
    finally:
        print("close", name)

def parse_count(text):
    try:
        return int(text)
    except ValueError as error:
        raise ValueError("invalid count") from error

def main():
    try:
        with ExitStack() as stack:
            stack.enter_context(resource("first"))
            stack.enter_context(resource("second"))
            parse_count("bad")
    except ValueError as error:
        print(error)
        print(type(error.__cause__).__name__)

if __name__ == "__main__":
    main()
