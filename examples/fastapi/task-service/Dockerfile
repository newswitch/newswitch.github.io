# Teaching image. Resolve and pin a verified digest for the target platform.
FROM python:3.14.8-slim
WORKDIR /app
COPY framework-lab/requirements.lock framework-lab/requirements.lock
COPY deepening.lock .
RUN python -m pip install --no-cache-dir -r deepening.lock
COPY task-service/ .
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
USER 10001:10001
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "task_service.main:create_from_env", "--factory", "--host", "0.0.0.0", "--port", "8000", "--timeout-graceful-shutdown", "35"]
