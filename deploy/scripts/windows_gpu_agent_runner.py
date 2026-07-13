"""Run the MECHA ComfyUI Agent without exposing its token in process arguments."""
from __future__ import annotations

import os
import sys
from pathlib import Path


ROOT = Path(os.environ.get("MECHA_GPU_ROOT", r"E:\MECHA-GPU"))
AGENT_DIR = ROOT / "agent"
TOKEN_FILE = ROOT / "config" / "agent-token.txt"

sys.path.insert(0, str(AGENT_DIR))

from comfyui_agent import ComfyUIAgent  # noqa: E402


def main() -> None:
    token = TOKEN_FILE.read_text(encoding="utf-8").strip()
    if not token:
        raise RuntimeError(f"Agent token is empty: {TOKEN_FILE}")

    server_url = os.environ.get("MECHA_SERVER_URL", "https://mecha.one")
    ports = [
        int(value.strip())
        for value in os.environ.get("MECHA_COMFYUI_PORTS", "8188").split(",")
        if value.strip()
    ]
    ComfyUIAgent(server_url, token, ports).run()


if __name__ == "__main__":
    main()
