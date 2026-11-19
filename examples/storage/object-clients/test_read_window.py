import io
import unittest

from read_window import MAX_WINDOW, read_window


class FakeFS:
    def __init__(self):
        self.calls = []
        self.stream = None

    def open(self, key, mode, **kwargs):
        self.calls.append((key, mode, kwargs))
        self.stream = io.BytesIO(b"0123456789abcdef")
        return self.stream


class ReadWindowTests(unittest.TestCase):
    def setUp(self):
        self.fs = FakeFS()

    def test_first_bytes(self):
        self.assertEqual(read_window(self.fs, "bucket/key", 0, 4), b"0123")

    def test_middle_window(self):
        self.assertEqual(read_window(self.fs, "bucket/key", 4, 6), b"456789")

    def test_last_byte(self):
        self.assertEqual(read_window(self.fs, "bucket/key", 15, 1), b"f")

    def test_short_read(self):
        with self.assertRaises(EOFError):
            read_window(self.fs, "bucket/key", 15, 2)
        self.assertTrue(self.fs.stream.closed)

    def test_negative_offset(self):
        with self.assertRaises(ValueError):
            read_window(self.fs, "bucket/key", -1, 1)
        self.assertEqual(self.fs.calls, [])

    def test_zero_length(self):
        with self.assertRaises(ValueError):
            read_window(self.fs, "bucket/key", 0, 0)

    def test_oversized_window(self):
        with self.assertRaises(ValueError):
            read_window(self.fs, "bucket/key", 0, MAX_WINDOW + 1)

    def test_invalid_block(self):
        with self.assertRaises(ValueError):
            read_window(self.fs, "bucket/key", 0, 1, block_size=0)

    def test_version_is_forwarded(self):
        read_window(self.fs, "bucket/key", 0, 1, version_id="v1")
        self.assertEqual(self.fs.calls[0][2]["version_id"], "v1")

    def test_stream_is_closed(self):
        read_window(self.fs, "bucket/key", 0, 1)
        self.assertTrue(self.fs.stream.closed)

    def test_binary_mode_and_cache_options(self):
        read_window(self.fs, "bucket/key", 0, 1)
        self.assertEqual(self.fs.calls[0][1], "rb")
        self.assertEqual(self.fs.calls[0][2],
                         {"block_size": 8 * 1024 * 1024, "cache_type": "readahead"})

    def test_invalid_identifier(self):
        with self.assertRaises(ValueError):
            read_window(self.fs, "bucket", 0, 1)


if __name__ == "__main__":
    unittest.main()
