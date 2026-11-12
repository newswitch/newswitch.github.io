"""Render trusted DataX JSON templates without shell interpolation or overwrites."""
import argparse
import json
import os
from pathlib import Path
from string import Template

from sync_contract import parse_time

VARIABLES = {
    "input_file": "DATAX_INPUT_FILE",
    "output_dir": "DATAX_OUTPUT_DIR",
    "source_username": "DATAX_SOURCE_USERNAME",
    "source_password": "DATAX_SOURCE_PASSWORD",
    "source_jdbc_url": "DATAX_SOURCE_JDBC_URL",
    "target_username": "DATAX_TARGET_USERNAME",
    "target_password": "DATAX_TARGET_PASSWORD",
    "target_jdbc_url": "DATAX_TARGET_JDBC_URL",
    "window_start": "DATAX_WINDOW_START",
    "window_end": "DATAX_WINDOW_END",
}


def render(template, environment):
    used = set()

    def collect(value):
        if isinstance(value, str):
            for match in Template.pattern.finditer(value):
                if match.group("invalid") is not None:
                    raise ValueError("Invalid template placeholder")
                name = match.group("named") or match.group("braced")
                if name:
                    used.add(name)
        elif isinstance(value, list):
            for item in value:
                collect(item)
        elif isinstance(value, dict):
            for item in value.values():
                collect(item)

    collect(template)
    if used - VARIABLES.keys():
        raise ValueError("Template contains an unapproved variable")
    values = {}
    for name in used:
        key = VARIABLES[name]
        if key not in environment or environment[key] == "":
            raise ValueError("Missing required variable: " + key)
        values[name] = environment[key]
    if "window_start" in used or "window_end" in used:
        if not {"window_start", "window_end"}.issubset(used):
            raise ValueError("A window needs both bounds")
        if parse_time(values["window_start"]) >= parse_time(values["window_end"]):
            raise ValueError("Window end must be after start")

    def replace(value):
        if isinstance(value, str):
            return Template(value).substitute(values)
        if isinstance(value, list):
            return [replace(item) for item in value]
        if isinstance(value, dict):
            return {key: replace(item) for key, item in value.items()}
        return value

    return replace(template)


def write_new_json(destination, document):
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
        json.dump(document, stream, ensure_ascii=False, indent=2)
        stream.write("\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("template", type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    try:
        template = json.loads(args.template.read_text(encoding="utf-8"))
        rendered = render(template, os.environ)
        write_new_json(args.out, rendered)
    except (ValueError, OSError) as error:
        # Do not print config contents or environment values in failures.
        parser.exit(2, "Render failed: " + type(error).__name__ + "\n")
    print("Created a new job configuration. Protect its permissions and logs.")


if __name__ == "__main__":
    main()
