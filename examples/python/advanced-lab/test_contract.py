import pytest

def parse_port(text):
    port = int(text)
    if not 1 <= port <= 65535:
        raise ValueError("invalid port")
    return port

@pytest.mark.parametrize("text,expected", [("1", 1), ("8000", 8000)])
def test_valid_port(text, expected):
    assert parse_port(text) == expected

@pytest.mark.parametrize("text", ["0", "65536", "bad"])
def test_invalid_port(text):
    with pytest.raises(ValueError):
        parse_port(text)

def test_file_isolated(tmp_path):
    target = tmp_path / "state.txt"
    target.write_text("ready", encoding="utf-8")
    assert target.read_text(encoding="utf-8") == "ready"
