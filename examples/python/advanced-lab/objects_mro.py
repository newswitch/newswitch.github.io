class A:
    def run(self):
        return ["A"]

class B(A):
    def run(self):
        return ["B"] + super().run()

class C(A):
    def run(self):
        return ["C"] + super().run()

class D(B, C):
    def run(self):
        return ["D"] + super().run()

def main():
    value = D()
    print(" -> ".join(cls.__name__ for cls in D.__mro__))
    print(value.run())

if __name__ == "__main__":
    main()
