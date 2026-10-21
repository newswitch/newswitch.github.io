"""Export real FastAPI spans and metrics without a network backend."""
from fastapi import FastAPI
from fastapi.testclient import TestClient
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import InMemoryMetricReader
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter


def capture():
    exporter = InMemorySpanExporter()
    traces = TracerProvider()
    traces.add_span_processor(SimpleSpanProcessor(exporter))
    reader = InMemoryMetricReader()
    meters = MeterProvider(metric_readers=[reader])
    app = FastAPI(telemetry={"tracer_provider": traces, "meter_provider": meters,
                             "logs": False})

    @app.get("/jobs/{job_id}")
    async def job(job_id: int):
        with traces.get_tracer("task-lab").start_as_current_span("load-job"):
            return {"id": job_id}

    try:
        with TestClient(app) as client:
            assert client.get("/jobs/1").status_code == 200
        spans = exporter.get_finished_spans()
        metrics = reader.get_metrics_data()
        return {
            "business_span": any(span.name == "load-job" for span in spans),
            "one_trace": len({span.context.trace_id for span in spans}) == 1,
            "metric_names": sorted({metric.name
                for resource in metrics.resource_metrics
                for scope in resource.scope_metrics for metric in scope.metrics}),
        }
    finally:
        meters.shutdown()
        traces.shutdown()


def main():
    captured = capture()
    print("business span:", captured["business_span"])
    print("same trace:", captured["one_trace"])
    print("metrics exported:", bool(captured["metric_names"]))


if __name__ == "__main__":
    main()
