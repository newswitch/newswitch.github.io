import json
import tomllib

def load_config(environment):
    raw = tomllib.loads('[server]\nport = 8000\n')
    port_text = environment.get("APP_PORT")
    port = raw["server"]["port"] if port_text is None else int(port_text)
    if type(port) is not int or not 1 <= port <= 65535:
        raise ValueError("invalid port")
    return {"port": port}

def main():
    print(json.dumps(load_config({}), sort_keys=True))
    print(json.dumps(load_config({"APP_PORT": "9000"}), sort_keys=True))
    try:
        load_config({"APP_PORT": "0"})
    except ValueError as error:
        print(error)

if __name__ == "__main__":
    main()
