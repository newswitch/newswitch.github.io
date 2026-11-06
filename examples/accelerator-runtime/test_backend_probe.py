"""Control-flow tests only; these tests do not execute a GPU or NPU kernel."""

import argparse
import contextlib
import io
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import backend_probe


class BackendProbeTests(unittest.TestCase):
    def test_explicit_device_names(self):
        for value in ("cpu", "cuda:0", "cuda:12", "npu:0", "npu:7"):
            with self.subTest(value=value):
                self.assertEqual(backend_probe.device_name(value), value)

    def test_invalid_device_names(self):
        for value in ("auto", "cuda", "npu:-1", "cuda:01", "cpu:0", "cuda:1x"):
            with self.subTest(value=value):
                with self.assertRaises(argparse.ArgumentTypeError):
                    backend_probe.device_name(value)

    def test_help_does_not_import_torch(self):
        with patch.object(backend_probe.importlib, "import_module") as load:
            with contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(SystemExit) as result:
                    backend_probe.main(["--help"])
            self.assertEqual(result.exception.code, 0)
            load.assert_not_called()

    def test_missing_torch_is_not_silently_ignored(self):
        with patch.object(backend_probe.importlib, "import_module", side_effect=ModuleNotFoundError("torch")):
            with self.assertRaises(ModuleNotFoundError):
                backend_probe.run_probe("cuda:0")

    def test_unavailable_cuda_never_falls_back(self):
        fake = SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: False))
        with patch.object(backend_probe.importlib, "import_module", return_value=fake):
            with self.assertRaisesRegex(RuntimeError, "cuda backend is unavailable"):
                backend_probe.run_probe("cuda:0")

    def test_unavailable_npu_imports_plugin_then_fails(self):
        fake = SimpleNamespace(npu=SimpleNamespace(is_available=lambda: False))
        with patch.object(backend_probe.importlib, "import_module", side_effect=[fake, object()]) as load:
            with self.assertRaisesRegex(RuntimeError, "npu backend is unavailable"):
                backend_probe.run_probe("npu:0")
            self.assertEqual([call.args[0] for call in load.call_args_list], ["torch", "torch_npu"])

    def test_device_index_is_bounded_by_visible_count(self):
        fake = SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: True, device_count=lambda: 1))
        with patch.object(backend_probe.importlib, "import_module", return_value=fake):
            with self.assertRaisesRegex(RuntimeError, "exceeds the visible"):
                backend_probe.run_probe("cuda:1")


if __name__ == "__main__":
    unittest.main()
