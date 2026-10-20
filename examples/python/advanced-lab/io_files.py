from pathlib import Path
from tempfile import TemporaryDirectory
import os

def main():
    with TemporaryDirectory() as folder:
        target = Path(folder) / "state.txt"
        temporary = target.with_suffix(".tmp")
        with temporary.open("w", encoding="utf-8", newline="\n") as stream:
            stream.write("ready\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
        print(target.read_text(encoding="utf-8").strip())
        print(temporary.exists(), target.exists())

if __name__ == "__main__":
    main()
