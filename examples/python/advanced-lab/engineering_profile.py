import cProfile
import pstats
import tracemalloc

def work():
    return sum(value * value for value in range(1000))

def main():
    profiler = cProfile.Profile()
    result = profiler.runcall(work)
    stats = pstats.Stats(profiler)
    print(result)
    print("calls recorded:", stats.total_calls > 0)
    tracemalloc.start()
    values = [bytearray(100) for _ in range(20)]
    current, peak = tracemalloc.get_traced_memory()
    print("memory recorded:", current > 0 and peak >= current)
    del values
    tracemalloc.stop()

if __name__ == "__main__":
    main()
