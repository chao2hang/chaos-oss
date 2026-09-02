#!/usr/bin/env python3
"""chaos-oss · manifest.json patcher

Merges chaos-oss theme customizations (theme_color, background_color,
name, short_name, description, icons) into the existing manifest.json
emitted by OpenList-Frontend. We never replace the whole file so any
vendor-specific keys stay intact.

The fragment file uses the same JSON shape as a manifest; we just deep-
merge its top-level keys into the existing manifest, with the fragment
winning on conflict.
"""

import json
import sys
from pathlib import Path


def deep_merge(dst: dict, src: dict) -> None:
    for k, v in src.items():
        if isinstance(v, dict) and isinstance(dst.get(k), dict):
            deep_merge(dst[k], v)
        else:
            dst[k] = v


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: patch_manifest.py <manifest.json> <fragment.json>", file=sys.stderr)
        return 2
    target = Path(sys.argv[1])
    fragment = Path(sys.argv[2])
    if not target.exists():
        # Nothing to merge into; just write the fragment.
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(fragment.read_text(encoding="utf-8"), encoding="utf-8")
        return 0
    manifest = json.loads(target.read_text(encoding="utf-8"))
    frag = json.loads(fragment.read_text(encoding="utf-8"))
    deep_merge(manifest, frag)
    target.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
