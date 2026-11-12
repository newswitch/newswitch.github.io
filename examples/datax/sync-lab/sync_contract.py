"""Offline checks for the fixed orders contract; never connects to a database."""
import argparse
import csv
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json
from pathlib import Path
import re

FIELDS = ["order_id", "customer_id", "amount", "status", "updated_at"]
STATUSES = {"paid", "pending", "cancelled"}
CENT = Decimal("0.01")
MAX_AMOUNT = Decimal("9999999999999999.99")


def parse_time(value):
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}", value):
        raise ValueError("Expected UTC YYYY-MM-DD HH:MM:SS")
    return datetime.strptime(value, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)


def parse_amount(value):
    if value == "\\N":
        return None
    if not value or value.strip() != value:
        raise ValueError("Empty or padded amount")
    try:
        number = Decimal(value)
        if not number.is_finite() or number.copy_abs() > MAX_AMOUNT:
            raise ValueError("Amount outside DECIMAL(18,2)")
        normalized = number.quantize(CENT)
        if number != normalized:
            raise ValueError("Amount has a fractional cent")
        return Decimal("0.00") if normalized.is_zero() else normalized
    except InvalidOperation as error:
        raise ValueError("Invalid amount") from error


@dataclass(frozen=True)
class Row:
    order_id: int
    customer_id: str
    amount: Decimal | None
    status: str
    updated_at: datetime

    def canonical(self):
        return [self.order_id, self.customer_id,
                None if self.amount is None else format(self.amount, ".2f"),
                self.status, self.updated_at.strftime("%Y-%m-%d %H:%M:%S")]


def parse_row(record):
    if set(record) != set(FIELDS) or any(value is None for value in record.values()):
        raise ValueError("Wrong CSV column count")
    if not re.fullmatch(r"[1-9]\d*", record["order_id"]):
        raise ValueError("order_id must be a positive integer")
    if int(record["order_id"]) > 9223372036854775807:
        raise ValueError("order_id outside signed BIGINT")
    if not record["customer_id"] or len(record["customer_id"]) > 32 or record["customer_id"] == "\\N":
        raise ValueError("customer_id is required")
    if record["status"] not in STATUSES:
        raise ValueError("Unexpected status")
    return Row(int(record["order_id"]), record["customer_id"],
               parse_amount(record["amount"]), record["status"],
               parse_time(record["updated_at"]))


def ensure_unique(rows):
    keys = [row.order_id for row in rows]
    if len(keys) != len(set(keys)):
        raise ValueError("Duplicate order_id")
    return rows


def load_rows(files):
    rows = []
    for file in files:
        with Path(file).open(encoding="utf-8", newline="") as stream:
            reader = csv.DictReader(stream, strict=True)
            if reader.fieldnames != FIELDS:
                raise ValueError("CSV header differs from the contract")
            rows.extend(parse_row(record) for record in reader)
    return ensure_unique(rows)


def select_window(rows, lower, upper):
    start, end = parse_time(lower), parse_time(upper)
    if start >= end:
        raise ValueError("Invalid time window")
    return [row for row in rows if start <= row.updated_at < end]


def summarize(rows):
    ensure_unique(rows)
    ordered = sorted(rows, key=lambda row: row.order_id)
    amounts = [row.amount for row in rows if row.amount is not None]
    encoded = json.dumps([row.canonical() for row in ordered], ensure_ascii=False,
                         separators=(",", ":")).encode("utf-8")
    return {
        "rows_total": len(rows),
        "keys_total": len({row.order_id for row in rows}),
        "amount_total": format(sum(amounts, Decimal("0.00")), ".2f") if amounts else None,
        "amount_nulls": sum(row.amount is None for row in rows),
        "ids": [row.order_id for row in ordered],
        "fingerprint": hashlib.sha256(encoded).hexdigest(),
    }


def compare_rows(expected, actual):
    ensure_unique(expected)
    ensure_unique(actual)
    left = {row.order_id: row.canonical() for row in expected}
    right = {row.order_id: row.canonical() for row in actual}
    return {
        "missing": sorted(left.keys() - right.keys()),
        "unexpected": sorted(right.keys() - left.keys()),
        "changed": sorted(key for key in left.keys() & right.keys() if left[key] != right[key]),
    }


def advance_watermark(current, upper, *, exit_code, validated, published):
    """Pure transition example, not durable state, locking, or distributed commit."""
    if parse_time(current) >= parse_time(upper):
        raise ValueError("Watermark must advance forward")
    return upper if exit_code == 0 and validated and published else current


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    summary = commands.add_parser("summarize")
    summary.add_argument("files", nargs="+", type=Path)
    comparison = commands.add_parser("compare")
    comparison.add_argument("reference", type=Path)
    comparison.add_argument("outputs", nargs="+", type=Path)
    args = parser.parse_args()
    try:
        if args.command == "summarize":
            result = summarize(load_rows(args.files))
            status = 0
        else:
            result = compare_rows(load_rows([args.reference]), load_rows(args.outputs))
            status = int(any(result.values()))
    except (ValueError, csv.Error, OSError) as error:
        parser.exit(2, "Validation failed: " + type(error).__name__ + "\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return status


if __name__ == "__main__":
    raise SystemExit(main())
