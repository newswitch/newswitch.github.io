import io
import logging

def main():
    output = io.StringIO()
    handler = logging.StreamHandler(output)
    handler.setFormatter(logging.Formatter(
        "%(levelname)s %(name)s request=%(request_id)s %(message)s"))
    logger = logging.getLogger("lesson.worker")
    logger.handlers.clear()
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False
    try:
        logger.info("job=%s state=%s", "import", "ready",
                    extra={"request_id": "r-1"})
        print(output.getvalue().strip())
    finally:
        logger.removeHandler(handler)
        handler.close()

if __name__ == "__main__":
    main()
