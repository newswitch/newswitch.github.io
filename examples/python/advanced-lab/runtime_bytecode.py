import dis
import sys

def add(first, second):
    frame = sys._getframe()
    return first + second, frame.f_code.co_name

def main():
    code = compile("value = 2 + 3", "<lesson>", "exec")
    namespace = {}
    exec(code, namespace)
    print(namespace["value"])
    print(add(2, 3))
    print(add.__code__.co_argcount)
    print(any(item.opname == "RETURN_VALUE"
              for item in dis.get_instructions(add)))

if __name__ == "__main__":
    main()
