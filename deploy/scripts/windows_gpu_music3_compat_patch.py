"""Install the isolated Music3 Flash-Attention compatibility guard."""
from __future__ import annotations

import argparse
from pathlib import Path


IMPORT_NEEDLE = "import math\n"
IMPORT_REPLACEMENT = "import math\nimport os\n"
LINE_NEEDLE = (
    "        fixed_kv = self.fixed_kv and "
    "comfy_kitchen.flash_attention_decode_is_available(device)\n"
)
LINE_REPLACEMENT = (
    "        fixed_kv = (\n"
    "            self.fixed_kv\n"
    "            and os.environ.get(\"OSTORY_MUSIC3_DISABLE_FLASH_DECODE\") != \"1\"\n"
    "            and comfy_kitchen.flash_attention_decode_is_available(device)\n"
    "        )\n"
)


def patch(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    if "OSTORY_MUSIC3_DISABLE_FLASH_DECODE" in text:
        return "already-patched"
    if IMPORT_NEEDLE not in text or LINE_NEEDLE not in text:
        raise RuntimeError("reviewed MiniMax Music3 compatibility anchors are missing")
    backup = path.with_suffix(path.suffix + ".ostory-original")
    if not backup.exists():
        backup.write_text(text, encoding="utf-8", newline="\n")
    patched = text.replace(IMPORT_NEEDLE, IMPORT_REPLACEMENT, 1).replace(
        LINE_NEEDLE, LINE_REPLACEMENT, 1
    )
    path.write_text(patched, encoding="utf-8", newline="\n")
    return "patched"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    print(patch(args.path))


if __name__ == "__main__":
    main()
