from uvicorn import Config

def main():
    config = Config("api_health:app", workers=2, limit_concurrency=100,
                    timeout_keep_alive=5, timeout_graceful_shutdown=30)
    print(config.workers, config.limit_concurrency)
    print(config.timeout_keep_alive, config.timeout_graceful_shutdown)
    print(config.reload)

if __name__ == "__main__":
    main()
