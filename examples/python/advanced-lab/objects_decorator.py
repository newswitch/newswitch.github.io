from functools import wraps

def traced(label):
    def decorate(function):
        @wraps(function)
        def wrapper(*args, **kwargs):
            print("enter", label)
            try:
                return function(*args, **kwargs)
            finally:
                print("exit", label)
        return wrapper
    return decorate

@traced("outer")
@traced("inner")
def add(first, second):
    """Add two values."""
    return first + second

def main():
    print(add(2, 3))
    print(add.__name__)
    print(add.__wrapped__.__name__)

if __name__ == "__main__":
    main()
