"""Run one finite, result-checked matmul on an explicitly selected device."""

import argparse
import importlib
import json
import re


def device_name(value):
    if value == "cpu" or re.fullmatch(r"(?:cuda|npu):(?:0|[1-9][0-9]*)", value):
        return value
    raise argparse.ArgumentTypeError("use cpu, cuda:N or npu:N (N is a non-negative integer)")


def run_probe(selected):
    torch = importlib.import_module("torch")
    kind = selected.split(":", 1)[0]
    backend = None
    if kind == "npu":
        importlib.import_module("torch_npu")
    if kind != "cpu":
        backend = getattr(torch, kind, None)
        if backend is None or not backend.is_available():
            raise RuntimeError(f"{kind} backend is unavailable")
        index = int(selected.split(":", 1)[1])
        if index >= backend.device_count():
            raise RuntimeError(f"device index {index} exceeds the visible {kind} device count")

    device = torch.device(selected)
    left = torch.tensor([[1.0, 2.0], [3.0, 4.0]], dtype=torch.float32, device=device)
    right = torch.tensor([[5.0, 6.0], [7.0, 8.0]], dtype=torch.float32, device=device)
    result = left @ right
    if backend is not None:
        backend.synchronize(device)
    actual = result.cpu()
    expected = torch.tensor([[19.0, 22.0], [43.0, 50.0]], dtype=torch.float32)
    torch.testing.assert_close(actual, expected, rtol=0, atol=0)
    return {"device": str(result.device), "result": actual.tolist(), "status": "passed"}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", type=device_name, required=True)
    args = parser.parse_args(argv)
    print(json.dumps(run_probe(args.device), ensure_ascii=False))


if __name__ == "__main__":
    main()
