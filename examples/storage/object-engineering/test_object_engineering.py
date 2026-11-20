import copy
import hashlib
from pathlib import Path
import tempfile
import unittest

from event_order import parse_events, is_newer
from sdk_read import download_checked


class Body:
    def __init__(self, chunks):
        self.chunks, self.closed = chunks, False

    def iter_chunks(self, chunk_size):
        for chunk in self.chunks:
            if isinstance(chunk, Exception):
                raise chunk
            yield chunk

    def close(self):
        self.closed = True


class Client:
    def __init__(self, chunks, size=4, version="v1"):
        self.body, self.size, self.version, self.calls = Body(chunks), size, version, []

    def get_object(self, **kwargs):
        self.calls.append(kwargs)
        return {"Body": self.body, "ContentLength": self.size, "VersionId": self.version}


class DownloadTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.target = Path(self.directory.name) / "result.bin"
        self.digest = hashlib.sha256(b"ABCD").hexdigest()

    def run_read(self, client, **kwargs):
        return download_checked(client, "lab", "key", self.target,
                                kwargs.pop("size", 4), kwargs.pop("digest", self.digest), **kwargs)

    def assert_clean(self, client):
        self.assertTrue(client.body.closed)
        self.assertFalse(self.target.exists())
        self.assertEqual(list(Path(self.directory.name).iterdir()), [])

    def test_success(self):
        client = Client([b"AB", b"CD"])
        self.assertEqual(self.run_read(client)["bytes"], 4)
        self.assertEqual(self.target.read_bytes(), b"ABCD")
        self.assertTrue(client.body.closed)

    def test_empty_chunks(self):
        self.run_read(Client([b"", b"ABCD", b""]))
        self.assertEqual(self.target.read_bytes(), b"ABCD")

    def test_short_read(self):
        client = Client([b"ABC"])
        with self.assertRaises(EOFError): self.run_read(client)
        self.assert_clean(client)

    def test_overrun(self):
        client = Client([b"ABCDE"])
        with self.assertRaises(ValueError): self.run_read(client)
        self.assert_clean(client)

    def test_bad_hash(self):
        client = Client([b"ABCE"])
        with self.assertRaises(ValueError): self.run_read(client)
        self.assert_clean(client)

    def test_bad_header(self):
        client = Client([b"ABCD"], size=5)
        with self.assertRaises(ValueError): self.run_read(client)
        self.assert_clean(client)

    def test_version_forwarded(self):
        client = Client([b"ABCD"])
        self.run_read(client, version_id="v1")
        self.assertEqual(client.calls[0]["VersionId"], "v1")

    def test_version_mismatch(self):
        client = Client([b"ABCD"], version="v2")
        with self.assertRaises(ValueError): self.run_read(client, version_id="v1")
        self.assert_clean(client)

    def test_invalid_digest_before_request(self):
        client = Client([])
        with self.assertRaises(ValueError): self.run_read(client, digest="wrong")
        self.assertEqual(client.calls, [])

    def test_invalid_size_before_request(self):
        client = Client([])
        for size in [-1, True, 1.5]:
            with self.assertRaises(ValueError): self.run_read(client, size=size)
        self.assertEqual(client.calls, [])

    def test_no_overwrite(self):
        self.target.write_bytes(b"keep")
        client = Client([b"ABCD"])
        with self.assertRaises(FileExistsError): self.run_read(client)
        self.assertEqual(self.target.read_bytes(), b"keep")
        self.assertEqual(client.calls, [])

    def test_body_exception(self):
        client = Client([b"AB", OSError("simulated")])
        with self.assertRaises(OSError): self.run_read(client)
        self.assert_clean(client)


def payload(sequence="0010", key="input/red+flower.json", version="v1"):
    return {"Records": [{"eventVersion": "2.1", "eventSource": "aws:s3",
            "eventName": "ObjectCreated:Put", "s3": {"bucket": {"name": "lab"},
            "object": {"key": key, "versionId": version, "sequencer": sequence}}}]}


class EventTests(unittest.TestCase):
    def test_decode_space(self):
        self.assertEqual(parse_events(payload())[0].key, "input/red flower.json")

    def test_decode_real_plus(self):
        self.assertEqual(parse_events(payload(key="input/a%2Bb.json"))[0].key, "input/a+b.json")

    def test_hex_not_lexical(self):
        self.assertTrue(is_newer(parse_events(payload("10"))[0], parse_events(payload("F"))[0]))

    def test_canonical_duplicate(self):
        self.assertEqual(parse_events(payload("000f"))[0].event_id, parse_events(payload("F"))[0].event_id)

    def test_same_sequence_not_newer(self):
        event = parse_events(payload())[0]
        self.assertFalse(is_newer(event, event))

    def test_version_changes_identity(self):
        self.assertNotEqual(parse_events(payload(version="v1"))[0].event_id,
                            parse_events(payload(version="v2"))[0].event_id)

    def test_reject_global_order(self):
        with self.assertRaises(ValueError):
            is_newer(parse_events(payload())[0], parse_events(payload(key="other"))[0])

    def test_compatible_minor_version(self):
        value = payload()
        value["Records"][0]["eventVersion"] = "2.6"
        self.assertEqual(len(parse_events(value)), 1)

    def test_reject_major_source_and_operation(self):
        for field, value in [("eventVersion", "3.0"), ("eventSource", "minio:s3"), ("eventName", "ObjectRestore:Completed")]:
            record = copy.deepcopy(payload())
            record["Records"][0][field] = value
            with self.assertRaises(ValueError): parse_events(record)

    def test_bad_encoding_and_sequence(self):
        with self.assertRaises(ValueError): parse_events(payload(key="a%ZZ"))
        with self.assertRaises(ValueError): parse_events(payload(sequence="not-hex"))

    def test_test_message_is_not_records(self):
        with self.assertRaises(ValueError): parse_events({"Event": "s3:TestEvent"})


if __name__ == "__main__":
    unittest.main()
