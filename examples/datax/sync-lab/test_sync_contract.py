from dataclasses import replace
from decimal import Decimal
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest

from render_job import render, write_new_json
from sync_contract import (FIELDS, advance_watermark, compare_rows, ensure_unique,
                           load_rows, parse_amount, parse_row, parse_time,
                           select_window, summarize)

BASE = Path(__file__).resolve().parent
FIXTURE = BASE / "fixtures/orders.csv"
LOWER = "2026-11-01 00:00:00"
UPPER = "2026-11-01 01:00:00"


class ContractTests(unittest.TestCase):
    def setUp(self):
        self.rows = load_rows([FIXTURE])

    def test_control_totals(self):
        result = summarize(self.rows)
        self.assertEqual((result["rows_total"], result["keys_total"],
                          result["amount_total"], result["amount_nulls"]),
                         (4, 4, "30.30", 1))

    def test_customer_leading_zeroes_are_preserved(self):
        self.assertEqual(self.rows[0].customer_id, "0007")

    def test_null_is_distinct_from_zero(self):
        actual = [replace(row, amount=Decimal("0.00")) if row.amount is None else row for row in self.rows]
        self.assertEqual(compare_rows(self.rows, actual)["changed"], [103])
        self.assertEqual(summarize(actual)["amount_total"], "30.30")

    def test_all_null_amounts_keep_unknown_aggregate(self):
        actual = [replace(row, amount=None) for row in self.rows]
        self.assertIsNone(summarize(actual)["amount_total"])

    def test_order_does_not_change_fingerprint(self):
        self.assertEqual(summarize(self.rows)["fingerprint"], summarize(self.rows[::-1])["fingerprint"])

    def test_duplicate_key_rejected(self):
        with self.assertRaises(ValueError):
            ensure_unique(self.rows + [self.rows[0]])

    def test_signed_bigint_boundary(self):
        record = dict(zip(FIELDS, ["9223372036854775808", "0007", "1.00", "paid", LOWER]))
        with self.assertRaises(ValueError):
            parse_row(record)

    def test_negative_zero_is_normalized(self):
        self.assertEqual(str(parse_amount("-0.00")), "0.00")

    def test_missing_and_unexpected_keys(self):
        actual = self.rows[1:] + [replace(self.rows[0], order_id=105)]
        result = compare_rows(self.rows, actual)
        self.assertEqual(result, {"missing": [101], "unexpected": [105], "changed": []})

    def test_field_change_detected(self):
        actual = [replace(self.rows[0], customer_id="7")] + self.rows[1:]
        self.assertEqual(compare_rows(self.rows, actual)["changed"], [101])

    def test_half_open_window(self):
        self.assertEqual([row.order_id for row in select_window(self.rows, LOWER, UPPER)], [101, 102])

    def test_boundary_belongs_only_to_next_window(self):
        boundary = replace(self.rows[0], updated_at=parse_time(UPPER))
        self.assertEqual(select_window([boundary], LOWER, UPPER), [])
        self.assertEqual(select_window([boundary], UPPER, "2026-11-01 02:00:00"), [boundary])

    def test_window_must_move_forward(self):
        with self.assertRaises(ValueError):
            select_window(self.rows, UPPER, LOWER)

    def test_invalid_times_rejected(self):
        for value in ["2026-11-01", "2026-02-30 00:00:00", "2026-11-01 00:00:00Z", "bad-time"]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse_time(value)

    def test_amount_precision_and_range(self):
        for value in ["", "1.001", "NaN", "Infinity", "10000000000000000.00"]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse_amount(value)
        self.assertEqual(parse_amount("9999999999999999.99"), Decimal("9999999999999999.99"))

    def test_wrong_header_rejected(self):
        with tempfile.TemporaryDirectory(prefix="datax-contract-") as directory:
            file = Path(directory) / "wrong.csv"
            file.write_text("order_id,amount\n101,10.10\n", encoding="utf-8")
            with self.assertRaises(ValueError):
                load_rows([file])

    def test_wrong_column_count_rejected(self):
        with self.assertRaises(ValueError):
            parse_row(dict(zip(FIELDS, ["101", "0007", "10.10", "paid", None])))

    def test_watermark_only_advances_after_all_gates(self):
        for code, validated, published in [(1, True, True), (0, False, True), (0, True, False)]:
            self.assertEqual(advance_watermark(LOWER, UPPER, exit_code=code, validated=validated, published=published), LOWER)
        self.assertEqual(advance_watermark(LOWER, UPPER, exit_code=0, validated=True, published=True), UPPER)

    def test_cli_summary(self):
        result = subprocess.run([sys.executable, "-B", str(BASE / "sync_contract.py"), "summarize", str(FIXTURE)], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["amount_total"], "30.30")

    def test_cli_mismatch_is_failure(self):
        with tempfile.TemporaryDirectory(prefix="datax-contract-") as directory:
            file = Path(directory) / "partial.csv"
            file.write_text("\n".join(FIXTURE.read_text(encoding="utf-8").splitlines()[:3]) + "\n", encoding="utf-8")
            result = subprocess.run([sys.executable, "-B", str(BASE / "sync_contract.py"), "compare", str(FIXTURE), str(file)], capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 1, result.stderr)
            self.assertEqual(json.loads(result.stdout)["missing"], [103, 104])

    def test_cli_repeated_output_is_invalid(self):
        result = subprocess.run([sys.executable, "-B", str(BASE / "sync_contract.py"), "compare", str(FIXTURE), str(FIXTURE), str(FIXTURE)], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 2)


class RenderingTests(unittest.TestCase):
    def environment(self):
        return {
            "DATAX_INPUT_FILE": "/work/input/orders.csv",
            "DATAX_OUTPUT_DIR": "/work/output/batch-1",
            "DATAX_SOURCE_USERNAME": "lab_reader",
            "DATAX_SOURCE_PASSWORD": 'fake-quote"-backslash\\-${not_reexpanded}',
            "DATAX_SOURCE_JDBC_URL": "jdbc:mysql://source.example.invalid/datax_lab",
            "DATAX_TARGET_USERNAME": "lab_writer",
            "DATAX_TARGET_PASSWORD": "fake-target-secret",
            "DATAX_TARGET_JDBC_URL": "jdbc:mysql://target.example.invalid/datax_lab",
            "DATAX_WINDOW_START": LOWER,
            "DATAX_WINDOW_END": UPPER,
        }

    def test_all_templates_render_as_json(self):
        for file in (BASE / "jobs").glob("*.template.json"):
            with self.subTest(file=file.name):
                result = render(json.loads(file.read_text(encoding="utf-8")), self.environment())
                self.assertEqual(json.loads(json.dumps(result)), result)

    def test_secret_is_literal_not_reexpanded(self):
        result = render({"password": "${source_password}"}, self.environment())
        self.assertEqual(result["password"], self.environment()["DATAX_SOURCE_PASSWORD"])

    def test_missing_variable_fails(self):
        with self.assertRaises(ValueError):
            render({"password": "${source_password}"}, {})

    def test_unknown_variable_fails(self):
        with self.assertRaises(ValueError):
            render({"password": "${unapproved}"}, self.environment())

    def test_invalid_window_fails(self):
        environment = self.environment()
        environment["DATAX_WINDOW_END"] = LOWER
        with self.assertRaises(ValueError):
            render({"start": "${window_start}", "end": "${window_end}"}, environment)

    def test_one_window_bound_fails(self):
        with self.assertRaises(ValueError):
            render({"start": "${window_start}"}, self.environment())

    def test_existing_output_never_overwritten(self):
        with tempfile.TemporaryDirectory(prefix="datax-render-") as directory:
            output = Path(directory) / "job.json"
            write_new_json(output, {"first": True})
            with self.assertRaises(FileExistsError):
                write_new_json(output, {"second": True})
            self.assertEqual(json.loads(output.read_text(encoding="utf-8")), {"first": True})

    @unittest.skipUnless(os.name == "posix", "POSIX mode bits do not prove Windows ACLs")
    def test_new_output_is_private(self):
        with tempfile.TemporaryDirectory(prefix="datax-render-") as directory:
            output = Path(directory) / "job.json"
            write_new_json(output, {"private": True})
            self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o600)

    def test_render_cli_does_not_print_secret(self):
        with tempfile.TemporaryDirectory(prefix="datax-render-") as directory:
            output = Path(directory) / "job.json"
            environment = {**os.environ, **self.environment()}
            result = subprocess.run([sys.executable, "-B", str(BASE / "render_job.py"), str(BASE / "jobs/mysql-to-mysql.template.json"), "--out", str(output)], capture_output=True, text=True, env=environment, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotIn(environment["DATAX_SOURCE_PASSWORD"], result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
