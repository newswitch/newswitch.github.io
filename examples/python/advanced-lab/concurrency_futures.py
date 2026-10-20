from concurrent.futures import Future, ThreadPoolExecutor

def square(value):
    return value * value

def main():
    with ThreadPoolExecutor(max_workers=2) as pool:
        result = list(pool.map(square, range(5), buffersize=2))
    print(result)
    pending = Future()
    print(pending.cancel(), pending.cancelled())
    try:
        pending.result()
    except Exception as error:
        print(type(error).__name__)

if __name__ == "__main__":
    main()
