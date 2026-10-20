import pytest
from fastapi.testclient import TestClient
from api_database import app

@pytest.fixture
def client():
    with TestClient(app) as value:
        yield value

def test_create_job(client):
    response = client.post("/jobs", json={"name": "import"})
    assert response.status_code == 201
    assert response.json() == {"id": 1, "name": "import"}

@pytest.mark.parametrize("name", ["", "x" * 81])
def test_invalid_name(client, name):
    response = client.post("/jobs", json={"name": name})
    assert response.status_code == 422
