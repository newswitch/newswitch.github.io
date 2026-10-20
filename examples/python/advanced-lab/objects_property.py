class Endpoint:
    def __init__(self, port):
        self.port = port

    @property
    def port(self):
        return self._port

    @port.setter
    def port(self, value):
        if type(value) is not int or not 1 <= value <= 65535:
            raise ValueError("invalid port")
        self._port = value

def main():
    endpoint = Endpoint(8000)
    print(endpoint.port)
    endpoint.port = 9000
    print(endpoint.port)
    endpoint.__dict__["port"] = -1
    print(endpoint.port)
    try:
        endpoint.port = True
    except ValueError as error:
        print(error)

if __name__ == "__main__":
    main()
