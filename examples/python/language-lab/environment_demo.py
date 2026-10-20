from pathlib import Path
import sys

def main():
    print("python:", ".".join(map(str, sys.version_info[:2])))
    print("venv:", sys.prefix != sys.base_prefix)
    print("executable exists:", Path(sys.executable).is_file())
    print("prefix exists:", Path(sys.prefix).is_dir())

if __name__ == "__main__":
    main()
