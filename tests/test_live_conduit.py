import contextlib
import json
import os
import sys
import tempfile
import unittest
from io import StringIO
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / ".agents/skills/live-table/scripts"
sys.path.insert(0, str(SCRIPTS))

import conduit_client
import encode_live
from tests.test_live_table import FAKE_REPLAY


class FakeResponse:
    def __init__(self, body=b"", status=200, headers=None):
        self.body = body
        self.status = status
        self.headers = headers or {}

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return self.body


def fake_bins():
    return {
        label: {"read": f"{label}-read", "write": f"{label}-write"}
        for label in conduit_client.BIN_LABELS
    }


class ConduitClientTests(unittest.TestCase):
    def test_env_file_fills_missing_process_env(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "live-conduit.env"
            path.write_text(
                "LIVE_CONDUIT_API_KEY=from-file\nLIVE_CONDUIT_URL=https://file.test/\n",
                encoding="utf-8",
            )
            with patch.dict(os.environ, {}, clear=False):
                os.environ.pop("LIVE_CONDUIT_API_KEY", None)
                os.environ.pop("LIVE_CONDUIT_URL", None)
                self.assertEqual(
                    conduit_client.env_value("LIVE_CONDUIT_API_KEY", path),
                    "from-file",
                )
                self.assertEqual(
                    conduit_client.env_value("LIVE_CONDUIT_URL", path),
                    "https://file.test/",
                )
                os.environ["LIVE_CONDUIT_API_KEY"] = "from-process"
                self.assertEqual(
                    conduit_client.env_value("LIVE_CONDUIT_API_KEY", path),
                    "from-process",
                )

    def test_url_builders(self):
        private = conduit_client.conduit_private_url(
            "https://example.test/live/",
            host_read="host read",
            you="p2",
            seat_read="seat read",
            inbox_write="inbox write",
        )
        parsed = urlparse(private)
        self.assertEqual(
            parse_qs(parsed.query),
            {
                "host": ["host read"],
                "you": ["p2"],
                "seat": ["seat read"],
                "inbox": ["inbox write"],
            },
        )
        self.assertNotIn("c", parse_qs(parsed.query))

        public = conduit_client.conduit_public_url(
            "https://example.test/live",
            host_read="host",
            origin="https://local.test/",
        )
        self.assertEqual(
            parse_qs(urlparse(public).query),
            {"host": ["host"], "c": ["https://local.test"]},
        )

    @patch.object(conduit_client, "urlopen")
    def test_mint(self, urlopen):
        response = {"ttlSeconds": 3600, "bins": fake_bins()}
        urlopen.return_value = FakeResponse(json.dumps(response).encode("utf-8"))

        result = conduit_client.mint("https://conduit.test/", "secret")

        self.assertEqual(result, response)
        request = urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "https://conduit.test/v1/mint")
        self.assertEqual(request.method, "POST")
        self.assertEqual(json.loads(request.data), {"bins": list(conduit_client.BIN_LABELS)})
        self.assertEqual(request.get_header("Authorization"), "Bearer secret")
        self.assertEqual(request.get_header("X-api-key"), "secret")

    @patch.object(conduit_client, "urlopen")
    def test_append_and_get_latest(self, urlopen):
        generation = {"X-Live-Conduit-Generation": "7"}
        urlopen.side_effect = [
            FakeResponse(headers=generation),
            FakeResponse(b"v2.payload", headers=generation),
            FakeResponse(status=204),
        ]

        headers = conduit_client.append(
            "https://conduit.test",
            "write/key",
            b"v2.payload",
        )
        status, body, latest_headers = conduit_client.get_latest(
            "https://conduit.test",
            "read/key",
        )
        empty_status, empty_body, _ = conduit_client.get_latest(
            "https://conduit.test",
            "empty",
        )

        append_request = urlopen.call_args_list[0].args[0]
        self.assertEqual(append_request.full_url, "https://conduit.test/v1/bins/write%2Fkey")
        self.assertEqual(append_request.method, "POST")
        self.assertEqual(append_request.data, b"v2.payload")
        self.assertEqual(
            append_request.get_header("X-live-conduit-kind"),
            "snapshot",
        )
        self.assertEqual(headers["X-Live-Conduit-Generation"], "7")
        self.assertEqual((status, body), (200, b"v2.payload"))
        self.assertEqual(latest_headers["X-Live-Conduit-Generation"], "7")
        self.assertEqual((empty_status, empty_body), (204, b""))


class EncodeConduitTests(unittest.TestCase):
    def test_cli_mints_publishes_and_writes_keys(self):
        bins = fake_bins()
        with tempfile.TemporaryDirectory() as tmp:
            replay_path = Path(tmp) / "game.json"
            keys_path = Path(tmp) / "game.conduit.json"
            replay_path.write_text(json.dumps(FAKE_REPLAY), encoding="utf-8")
            stdout = StringIO()

            with (
                patch.object(
                    encode_live.conduit,
                    "origin_from_env",
                    return_value="https://conduit.test",
                ),
                patch.object(
                    encode_live.conduit,
                    "mint",
                    return_value={"ttlSeconds": 3600, "bins": bins},
                ) as mint,
                patch.object(encode_live.conduit, "append") as append,
                contextlib.redirect_stdout(stdout),
            ):
                code = encode_live.main(
                    [
                        str(replay_path),
                        "--you",
                        "p2",
                        "--conduit",
                        "--conduit-keys",
                        str(keys_path),
                    ]
                )

            self.assertEqual(code, 0)
            mint.assert_called_once()
            self.assertEqual(append.call_count, 2)
            private_call, public_call = append.call_args_list
            self.assertEqual(private_call.args[:2], ("https://conduit.test", "p2-write"))
            self.assertTrue(private_call.args[2].decode("utf-8").startswith("v2."))
            self.assertEqual(public_call.args[:2], ("https://conduit.test", "host-write"))
            self.assertTrue(public_call.args[2].decode("utf-8").startswith("v2."))
            self.assertEqual(
                json.loads(keys_path.read_text(encoding="utf-8")),
                {"origin": "https://conduit.test", "bins": bins},
            )
            lines = stdout.getvalue().strip().splitlines()
            self.assertIn("host=host-read", lines[0])
            self.assertIn("you=p2", lines[0])
            self.assertIn("seat=p2-read", lines[0])
            self.assertIn("inbox=p2-inbox-write", lines[0])
            self.assertIn("c=https%3A%2F%2Fconduit.test", lines[0])
            self.assertNotIn("you=", lines[1])
            self.assertNotIn("seat=", lines[1])
            self.assertNotIn("inbox=", lines[1])

    def test_cli_reuses_existing_keys_without_minting(self):
        bins = fake_bins()
        with tempfile.TemporaryDirectory() as tmp:
            replay_path = Path(tmp) / "game.json"
            keys_path = Path(tmp) / "game.conduit.json"
            replay_path.write_text(json.dumps(FAKE_REPLAY), encoding="utf-8")
            keys_path.write_text(
                json.dumps({"origin": conduit_client.DEFAULT_ORIGIN, "bins": bins}),
                encoding="utf-8",
            )

            with (
                patch.object(encode_live.conduit, "mint") as mint,
                patch.object(encode_live.conduit, "append"),
                contextlib.redirect_stdout(StringIO()),
            ):
                code = encode_live.main(
                    [
                        str(replay_path),
                        "--you",
                        "p1",
                        "--game",
                        "fallback",
                        "--conduit",
                    ]
                )

            self.assertEqual(code, 0)
            mint.assert_not_called()


if __name__ == "__main__":
    unittest.main()
