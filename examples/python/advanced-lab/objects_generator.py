def values():
    print("start")
    try:
        yield 10
        print("resume")
        yield 20
    finally:
        print("cleanup")

def main():
    stream = values()
    print("created")
    print(next(stream))
    stream.close()
    print(list(stream))
    print(list(value * 2 for value in range(3)))

if __name__ == "__main__":
    main()
