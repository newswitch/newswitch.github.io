from importlib.metadata import version
from packaging.version import Version

def main():
    installed = Version(version("httpx"))
    print("httpx baseline:", installed == Version("0.28.1"))
    print("compatible major:", installed.major == 0)

if __name__ == "__main__":
    main()
