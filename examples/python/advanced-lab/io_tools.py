from collections import Counter, defaultdict, deque
from functools import lru_cache, partial
from itertools import groupby

@lru_cache(maxsize=4)
def square(value):
    return value * value

def main():
    print(Counter(["a", "b", "a"]).most_common())
    groups = defaultdict(list)
    groups["a"].append(1)
    print(dict(groups))
    window = deque(maxlen=2)
    window.extend([1, 2, 3])
    print(list(window))
    print([(key, list(values)) for key, values in groupby("aabba")])
    print(partial(pow, 2)(3))
    square.cache_clear()
    square(3)
    square(3)
    print(square.cache_info().hits)

if __name__ == "__main__":
    main()
