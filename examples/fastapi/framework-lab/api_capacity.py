def mean_inflight(rate_per_second, mean_seconds):
    return rate_per_second * mean_seconds

def main():
    print("mean inflight:", mean_inflight(100, 0.12))
    workers = 2
    pool_per_worker = 10
    pods = 3
    print("connection budget:", workers * pool_per_worker * pods)
    cpu_capacity = 400
    db_capacity = 200
    print("illustrative ceiling:", min(cpu_capacity, db_capacity))

if __name__ == "__main__":
    main()
