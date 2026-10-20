VALUE = 10

def broken():
    result = VALUE
    VALUE = 20
    return result

def make_counter():
    count = 0

    def increment():
        nonlocal count
        count += 1
        return count

    return increment

def main():
    try:
        broken()
    except UnboundLocalError:
        print("local: UnboundLocalError")
    counter = make_counter()
    print("counter:", counter(), counter())
    late = [lambda: i for i in range(3)]
    fixed = [lambda i=i: i for i in range(3)]
    print("late:", [function() for function in late])
    print("fixed:", [function() for function in fixed])
    another = make_counter()
    print("another:", another())

if __name__ == "__main__":
    main()
