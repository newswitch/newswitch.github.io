def append_bad(value, bucket=[]):
    bucket.append(value)
    return bucket

def append_good(value, bucket=None):
    if bucket is None:
        bucket = []
    bucket.append(value)
    return bucket

def configure(host, /, port=443, *, timeout=3.0):
    return host, port, timeout

def change(values):
    values.append("shared")
    values = ["local"]
    return values

def main():
    print("bad1:", append_bad("a"))
    print("bad2:", append_bad("b"))
    print("good1:", append_good("a"))
    print("good2:", append_good("b"))
    print("signature:", configure("api", timeout=1.0))
    original = []
    result = change(original)
    print("caller:", original)
    print("result:", result)

if __name__ == "__main__":
    main()
