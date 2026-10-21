class Port:
    def __set_name__(self, owner, name):
        self.storage = "_" + name

    def __get__(self, instance, owner=None):
        if instance is None:
            return self
        return instance.__dict__[self.storage]

    def __set__(self, instance, value):
        if type(value) is not int or not 1 <= value <= 65535:
            raise ValueError("invalid port")
        instance.__dict__[self.storage] = value


class Endpoint:
    port = Port()

    def __init__(self, port):
        self.port = port


def main():
    first, second = Endpoint(8000), Endpoint(9000)
    first.__dict__["port"] = -1
    print(first.port, second.port)
    print(Endpoint.port is Endpoint.__dict__["port"])
    print(first.__dict__)


if __name__ == "__main__":
    main()
