"""End-to-end fixtures: the real mock Head Device (packages/mock-server), strict mode.

Each test gets a fresh device — new key pair, no credentials, a known setup
code — on its own port, so tests exercise the actual TLS pinning, auth,
pairing and single-connection rules rather than a stubbed client.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import time
import urllib.request

import pytest

ROOT = Path(__file__).resolve().parent.parent
MOCK_DIR = ROOT / "packages" / "mock-server"
SETUP_CODE = "7K2M-Q9XD-4HTR-8WCN"


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    yield


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@dataclass
class MockDevice:
    port: int
    control_port: int
    setup_code: str = SETUP_CODE

    def control(self, method: str, path: str) -> dict:
        req = urllib.request.Request(f"http://127.0.0.1:{self.control_port}{path}", method=method)
        with urllib.request.urlopen(req, timeout=5) as resp:
            return json.load(resp)

    def status(self) -> dict:
        return self.control("GET", "/status")

    def press_button(self) -> dict:
        return self.control("POST", "/button/short")

    def factory_reset(self) -> dict:
        return self.control("POST", "/button/long")


@pytest.fixture
def mock_device(tmp_path: Path, socket_enabled) -> Iterator[MockDevice]:
    device = MockDevice(port=_free_port(), control_port=_free_port())
    env = {
        **os.environ,
        "PORT": str(device.port),
        "OFL_CONTROL_PORT": str(device.control_port),
        "OFL_DATA_DIR": str(tmp_path / "device"),
        "OFL_SETUP_CODE": SETUP_CODE,
    }
    # The repo pins Node 20 via nvm (see AGENTS.md: a stray Node 16 may shadow it).
    proc = subprocess.Popen(
        ["bash", "-c", "source ~/.nvm/nvm.sh >/dev/null && nvm use 20 >/dev/null && exec npx tsx src/index.ts"],
        cwd=MOCK_DIR,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        # npx → tsx → node: signal the whole group, or node outlives the test.
        start_new_session=True,
    )
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        try:
            device.status()
            break
        except OSError:
            if proc.poll() is not None:
                raise RuntimeError(f"mock server exited:\n{proc.stdout.read()}")
            time.sleep(0.2)
    else:
        os.killpg(proc.pid, signal.SIGKILL)
        raise RuntimeError("mock server did not start")
    yield device
    os.killpg(proc.pid, signal.SIGTERM)
    try:
        proc.wait(5)
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
