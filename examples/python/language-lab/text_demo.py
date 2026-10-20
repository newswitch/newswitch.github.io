import unicodedata

def main():
    text = "中文"
    payload = text.encode("utf-8")
    print("lengths:", len(text), len(payload))
    print("hex:", payload.hex())
    print("roundtrip:", payload.decode("utf-8"))
    print("byte index:", payload[0])
    try:
        payload[:2].decode("utf-8")
    except UnicodeDecodeError:
        print("partial: UnicodeDecodeError")

    composed = "\u00e9"
    combined = "e\u0301"
    print("code points:", len(composed), len(combined))
    print("equal:", composed == combined)
    print("normalized:", composed == unicodedata.normalize("NFC", combined))
    print("lines:", "a\r\nb\n".splitlines())
    print("url:", "https://example.test".removeprefix("https://"))

if __name__ == "__main__":
    main()
