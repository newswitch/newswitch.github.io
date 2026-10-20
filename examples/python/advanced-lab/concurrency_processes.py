from concurrent.futures import ProcessPoolExecutor
from multiprocessing import get_context

def square(value):
    return value * value

def main():
    with ProcessPoolExecutor(max_workers=2,
                             mp_context=get_context("spawn")) as pool:
        results = list(pool.map(square, range(4), chunksize=1))
    print(results)

if __name__ == "__main__":
    main()
