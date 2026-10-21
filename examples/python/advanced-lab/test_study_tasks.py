import json
import pytest
from study_tasks import add, complete, load, main, save


def test_file_project(tmp_path, capsys):
    path = tmp_path / "tasks.json"
    assert main(["--store", str(path), "add", " import "]) == 0
    assert json.loads(capsys.readouterr().out)["name"] == "import"
    main(["--store", str(path), "complete", "1"])
    assert load(path) == [{"id": 1, "name": "import", "state": "done"}]
    main(["--store", str(path), "complete", "1"])
    assert len(load(path)) == 1


def test_failure_preserves_state(tmp_path):
    path = tmp_path / "tasks.json"
    rows, _ = add([], "one")
    save(path, rows)
    with pytest.raises(ValueError):
        complete(rows, 2)
    assert load(path) == rows
    assert len(list(tmp_path.iterdir())) == 1


@pytest.mark.parametrize("content", ["{}", "[1]", '[{"id": true}]', "not json"])
def test_store_validation(tmp_path, content):
    path = tmp_path / "tasks.json"
    path.write_text(content, encoding="utf-8")
    with pytest.raises(ValueError):
        load(path)
