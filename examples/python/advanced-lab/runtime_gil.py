import platform
import sys
import sysconfig

def main():
    print(platform.python_implementation())
    print("version:", ".".join(map(str, sys.version_info[:2])))
    print("gil:", sys._is_gil_enabled())
    print("free-threaded build:", bool(
        sysconfig.get_config_var("Py_GIL_DISABLED")))

if __name__ == "__main__":
    main()
