import asyncio
from contextlib import asynccontextmanager
import os

from fastapi import FastAPI
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import ConsoleMetricExporter, PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource


def create_app():
    resource = Resource.create({"service.name": "task-otel-lab"})
    endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "").rstrip("/")
    if endpoint:
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
        spans = OTLPSpanExporter(endpoint=endpoint + "/v1/traces", timeout=2)
        metrics = OTLPMetricExporter(endpoint=endpoint + "/v1/metrics", timeout=2)
    else:
        spans, metrics = ConsoleSpanExporter(), ConsoleMetricExporter()
    traces = TracerProvider(resource=resource)
    traces.add_span_processor(BatchSpanProcessor(
        spans, max_queue_size=256, max_export_batch_size=64, schedule_delay_millis=500))
    meters = MeterProvider(resource=resource, metric_readers=[PeriodicExportingMetricReader(
        metrics, export_interval_millis=1000, export_timeout_millis=2000)])

    @asynccontextmanager
    async def lifespan(_):
        try:
            yield
        finally:
            # SDK shutdown is synchronous: do not block the event loop directly.
            await asyncio.to_thread(meters.shutdown)
            await asyncio.to_thread(traces.shutdown)

    app = FastAPI(lifespan=lifespan, telemetry={
        "tracer_provider": traces, "meter_provider": meters, "logs": False})

    @app.get("/jobs/{job_id}")
    async def job(job_id: int):
        with traces.get_tracer("task-lab").start_as_current_span("prepare-job"):
            await asyncio.sleep(0.01)
            return {"id": job_id}

    return app
