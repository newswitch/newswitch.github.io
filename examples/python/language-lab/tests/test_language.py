"""Executable checks for the language articles; standard library only."""
from copy import deepcopy
from decimal import Decimal, ROUND_HALF_UP
import io
import math
from pathlib import Path
import subprocess
import sys
import unittest
import unicodedata
from contextlib import redirect_stdout

import control_demo
import execution_demo
import functions_demo
import scope_demo
from lesson_pkg.rules import normalize_name


class ObjectTests(unittest.TestCase):
    def test_alias_is_same(self):
        original = []
        alias = original
        self.assertIs(alias, original)

    def test_rebind_is_separate(self):
        original = [1]
        alias = original
        original = original + [2]
        self.assertEqual(alias, [1])
        self.assertIsNot(alias, original)

    def test_inplace_list_is_shared(self):
        original = [1]
        alias = original
        original += [2]
        self.assertEqual(alias, [1, 2])
        self.assertIs(alias, original)

    def test_shallow_inner_is_shared(self):
        original = {"ports": [80]}
        copy = original.copy()
        self.assertIsNot(original, copy)
        self.assertIs(original["ports"], copy["ports"])

    def test_deep_inner_is_separate(self):
        original = {"ports": [80]}
        copy = deepcopy(original)
        copy["ports"].append(443)
        self.assertEqual(original["ports"], [80])

    def test_repeated_rows_alias(self):
        rows = [[]] * 3
        rows[0].append(1)
        self.assertEqual(rows, [[1], [1], [1]])

    def test_comprehension_rows_separate(self):
        rows = [[] for _ in range(3)]
        rows[0].append(1)
        self.assertEqual(rows, [[1], [], []])

    def test_tuple_can_contain_mutable(self):
        record = ("api", [])
        record[1].append(80)
        self.assertEqual(record, ("api", [80]))
        with self.assertRaises(TypeError):
            hash(record)

    def test_value_and_identity(self):
        a, b = [1], [1]
        self.assertEqual(a, b)
        self.assertIsNot(a, b)


class NumericTests(unittest.TestCase):
    def test_negative_floor_division(self):
        self.assertEqual(divmod(-7, 2), (-4, 1))
        self.assertEqual((-7 // 2) * 2 + (-7 % 2), -7)

    def test_float_approximation(self):
        self.assertNotEqual(0.1 + 0.2, 0.3)
        self.assertTrue(math.isclose(0.1 + 0.2, 0.3))

    def test_decimal_input(self):
        self.assertEqual(Decimal("0.10") + Decimal("0.20"), Decimal("0.30"))
        self.assertNotEqual(Decimal(0.1), Decimal("0.1"))

    def test_decimal_rounding(self):
        self.assertEqual(Decimal("2.345").quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP), Decimal("2.35"))

    def test_truth_is_not_config_parser(self):
        self.assertTrue(bool("false"))
        self.assertFalse(bool(""))
        self.assertEqual(0 or 30, 30)

    def test_boolean_is_integer_subclass(self):
        self.assertIsInstance(True, int)
        self.assertIsNot(type(True), int)

    def test_conversion_needs_validation(self):
        self.assertEqual(int(27.9), 27)
        with self.assertRaises(ValueError):
            int("27.9")
        self.assertFalse(math.isfinite(float("nan")))
        self.assertFalse(math.isfinite(float("inf")))

    def test_zero_tolerance(self):
        self.assertFalse(math.isclose(0.0, 1e-10))
        self.assertTrue(math.isclose(0.0, 1e-10, abs_tol=1e-9))


class TextTests(unittest.TestCase):
    def test_utf8_lengths(self):
        self.assertEqual(len("中文"), 2)
        self.assertEqual(len("中文".encode("utf-8")), 6)

    def test_roundtrip(self):
        self.assertEqual("中文".encode("utf-8").decode("utf-8"), "中文")

    def test_bytes_index_and_slice(self):
        payload = "中文".encode("utf-8")
        self.assertEqual(payload[0], 228)
        self.assertIsInstance(payload[:1], bytes)
        with self.assertRaises(UnicodeDecodeError):
            payload[:2].decode("utf-8")

    def test_normalization(self):
        a, b = "\u00e9", "e\u0301"
        self.assertNotEqual(a, b)
        self.assertEqual(a, unicodedata.normalize("NFC", b))

    def test_repr_is_not_decode(self):
        self.assertEqual(str(b"abc"), "b'abc'")
        self.assertEqual(b"abc".decode("utf-8"), "abc")

    def test_strip_is_character_set(self):
        self.assertEqual("abbaXba".strip("ab"), "X")
        self.assertEqual("abbaXba".removeprefix("ab"), "baXba")

    def test_split_preserves_explicit_empty_fields(self):
        self.assertEqual(" a  b ".split(), ["a", "b"])
        self.assertEqual("a,,b".split(","), ["a", "", "b"])


class ControlAndContainerTests(unittest.TestCase):
    def test_find_present_and_empty(self):
        self.assertEqual(control_demo.find_first([1, 2, 2], 2), "found:1")
        self.assertEqual(control_demo.find_first([], 2), "missing")

    def test_match_range_and_type(self):
        for port in (1, 65535):
            with self.subTest(port=port):
                self.assertEqual(control_demo.describe(
                    {"kind": "start", "port": port}), f"start:{port}")
        for port in (0, 65536, "8000", True):
            with self.subTest(port=port):
                # bool is an int subclass; this illustrative guard accepts True.
                expected = "start:True" if port is True else "invalid"
                self.assertEqual(control_demo.describe(
                    {"kind": "start", "port": port}), expected)

    def test_mapping_pattern_accepts_extra_key(self):
        self.assertEqual(control_demo.describe({"kind": "stop", "extra": 1}), "stop")

    def test_zip_strict_is_lazy(self):
        pairs = zip([1, 2], ["a"], strict=True)
        self.assertEqual(next(pairs), (1, "a"))
        with self.assertRaises(ValueError):
            next(pairs)

    def test_empty_loop_else(self):
        completed = False
        for _ in []:
            break
        else:
            completed = True
        self.assertTrue(completed)

    def test_ordered_unique(self):
        self.assertEqual(list(dict.fromkeys(["b", "a", "b"])), ["b", "a"])

    def test_dict_live_view(self):
        data = {"a": 1}
        keys = data.keys()
        data["b"] = 2
        self.assertEqual(list(keys), ["a", "b"])

    def test_missing_and_none(self):
        data = {"a": None}
        self.assertIsNone(data.get("a"))
        self.assertIsNone(data.get("b"))
        self.assertIn("a", data)
        self.assertNotIn("b", data)

    def test_equal_numeric_keys(self):
        self.assertEqual(len({1: "a", 1.0: "b", True: "c"}), 1)

    def test_sort_mutates_and_returns_none(self):
        values = [3, 1, 2]
        self.assertIsNone(values.sort())
        self.assertEqual(values, [1, 2, 3])

    def test_sort_is_stable(self):
        values = [("a", 1), ("b", 1), ("c", 0)]
        self.assertEqual(sorted(values, key=lambda item: item[1]),
                         [("c", 0), ("a", 1), ("b", 1)])


class FunctionAndScopeTests(unittest.TestCase):
    def test_mutable_default_reused(self):
        bucket = functions_demo.append_bad.__defaults__[0]
        previous = bucket.copy()
        bucket.clear()
        try:
            self.assertEqual(functions_demo.append_bad("a"), ["a"])
            self.assertEqual(functions_demo.append_bad("b"), ["a", "b"])
        finally:
            bucket[:] = previous

    def test_safe_default_is_separate(self):
        first = functions_demo.append_good("a")
        second = functions_demo.append_good("b")
        self.assertEqual(first, ["a"])
        self.assertEqual(second, ["b"])
        self.assertIsNot(first, second)

    def test_parameter_binding(self):
        self.assertEqual(functions_demo.configure("api", timeout=1.0), ("api", 443, 1.0))
        with self.assertRaises(TypeError):
            functions_demo.configure(host="api")
        with self.assertRaises(TypeError):
            functions_demo.configure("api", 443, 1.0)

    def test_mutation_and_rebind(self):
        original = []
        result = functions_demo.change(original)
        self.assertEqual(original, ["shared"])
        self.assertEqual(result, ["local"])

    def test_unbound_local(self):
        with self.assertRaises(UnboundLocalError):
            scope_demo.broken()
        self.assertEqual(scope_demo.VALUE, 10)

    def test_counter_closures(self):
        first, second = scope_demo.make_counter(), scope_demo.make_counter()
        self.assertEqual([first(), first(), second()], [1, 2, 1])

    def test_late_and_early_binding(self):
        late = [lambda: i for i in range(3)]
        early = [lambda i=i: i for i in range(3)]
        self.assertEqual([fn() for fn in late], [2, 2, 2])
        self.assertEqual([fn() for fn in early], [0, 1, 2])

    def test_annotations_do_not_enforce(self):
        def triple(value: int) -> int:
            return value * 3
        self.assertEqual(triple("x"), "xxx")


class EntryAndImportTests(unittest.TestCase):
    def test_greeting(self):
        self.assertEqual(execution_demo.greet("Ada"), "Hello, Ada!")

    def test_normalize(self):
        self.assertEqual(normalize_name(" API "), "api")
        with self.assertRaises(ValueError):
            normalize_name("  ")

    def test_import_is_silent_in_fresh_process(self):
        result = subprocess.run(
            [sys.executable, "-c", "import execution_demo; import lesson_pkg.rules"],
            cwd=Path(__file__).resolve().parents[1],
            text=True, capture_output=True, timeout=10, check=True)
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.stderr, "")

    def test_cli_function_returns_error_without_exiting(self):
        from lesson_pkg.__main__ import main
        with redirect_stdout(io.StringIO()) as output:
            self.assertEqual(main([" API "]), 0)
        self.assertEqual(output.getvalue(), "api\n")


if __name__ == "__main__":
    unittest.main()
