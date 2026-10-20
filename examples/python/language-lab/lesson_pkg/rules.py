def normalize_name(value):
    normalized = value.strip().casefold()
    if not normalized:
        raise ValueError("name must not be empty")
    return normalized
