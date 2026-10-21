from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Lock


def lost_update():
    state = {"count": 0}
    rendezvous = Barrier(2, timeout=3)

    def change():
        old = state["count"]
        rendezvous.wait()
        state["count"] = old + 1

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(change) for _ in range(2)]
        for future in futures:
            future.result(timeout=5)
    return state["count"]


def protected_update():
    state = {"count": 0}
    lock = Lock()
    rendezvous = Barrier(2, timeout=3)

    def change():
        rendezvous.wait()
        with lock:
            old = state["count"]
            state["count"] = old + 1

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(change) for _ in range(2)]
        for future in futures:
            future.result(timeout=5)
    return state["count"]


if __name__ == "__main__":
    print("unprotected:", lost_update())
    print("protected:", protected_update())
