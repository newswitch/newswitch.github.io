from copy import deepcopy

def main():
    original = {"ports": [80]}
    alias = original
    shallow = original.copy()
    deep = deepcopy(original)

    alias["ports"].append(443)
    shallow["name"] = "copy"
    print("original:", original)
    print("shallow:", shallow)
    print("deep:", deep)
    print("same outer:", original is shallow)
    print("same inner:", original["ports"] is shallow["ports"])

    rows_bad = [[]] * 2
    rows_good = [[] for _ in range(2)]
    rows_bad[0].append(1)
    rows_good[0].append(1)
    print("repeat:", rows_bad)
    print("separate:", rows_good)

if __name__ == "__main__":
    main()
