import gc
import tracemalloc
import weakref

class Node:
    pass

def main():
    node = Node()
    node.self_reference = node
    observed = weakref.ref(node)
    del node
    gc.collect()
    print("collected:", observed() is None)
    tracemalloc.start()
    values = [bytearray(1024) for _ in range(10)]
    current, peak = tracemalloc.get_traced_memory()
    print("tracked:", current > 0, peak >= current)
    del values
    tracemalloc.stop()

if __name__ == "__main__":
    main()
