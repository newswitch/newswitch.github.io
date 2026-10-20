from threading import Lock, Thread

def main():
    state = {"count": 0}
    lock = Lock()

    def increment():
        for _ in range(1000):
            with lock:
                state["count"] += 1

    workers = [Thread(target=increment) for _ in range(4)]
    for worker in workers:
        worker.start()
    for worker in workers:
        worker.join(timeout=5)
    if any(worker.is_alive() for worker in workers):
        raise RuntimeError("worker did not stop")
    print(state["count"])

if __name__ == "__main__":
    main()
