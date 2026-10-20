class Worker:
    category = "batch"

    def __init__(self, name, capacity=1):
        if capacity < 1:
            raise ValueError("capacity must be positive")
        self.name = name
        self.capacity = capacity
        self.jobs = []

    def submit(self, job):
        if len(self.jobs) >= self.capacity:
            raise RuntimeError("worker is full")
        self.jobs.append(job)

    @classmethod
    def single(cls, name):
        return cls(name, capacity=1)

def main():
    first = Worker.single("a")
    second = Worker.single("b")
    first.submit("job-1")
    print(first.name, first.jobs)
    print(second.name, second.jobs)
    print(first.category, second.category)
    print(first.submit.__self__ is first)
    try:
        first.submit("job-2")
    except RuntimeError as error:
        print(error)

if __name__ == "__main__":
    main()
