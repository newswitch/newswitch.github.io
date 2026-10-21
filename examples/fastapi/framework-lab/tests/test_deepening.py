from api_telemetry_export import capture
from fastapi.testclient import TestClient
from api_bottlenecks import app


def test_native_telemetry_exports_real_data():
    result = capture()
    assert result["business_span"] and result["one_trace"]
    assert result["metric_names"]


def test_bounded_load_routes():
    with TestClient(app) as client:
        for route in ("blocking", "threaded", "asynchronous"):
            assert client.get(f"/{route}?delay=0.001").json() == {"ok": True}
            assert client.get(f"/{route}?delay=1").status_code == 422
