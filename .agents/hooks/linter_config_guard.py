#!/usr/bin/env python3
"""リンター設定ファイル（biome.json / .oxlintrc.json / eslint.config.*）の直接編集を止める PreToolUse hook。

Claude Code（.claude/settings.json）と Antigravity（.agents/hooks.json）の双方から呼ばれる。
"""

import json
import os
import re
import sys
from typing import Optional

BLOCK_MESSAGE = "BLOCKED: リンター設定ファイルは直接編集禁止。変更が必要な場合はユーザーに確認してください。"
PARSE_ERROR_MESSAGE = "BLOCKED: hook がツール入力を読めなかった"
PROTECTED_FILE_RE = re.compile(r"^(biome\.json|\.oxlintrc\.json|eslint\.config(\..*)?)$")


def extract_file_path(payload: dict) -> Optional[str]:
    if "toolCall" in payload or "hookEventName" in payload:
        args = (payload.get("toolCall") or {}).get("args") or {}
        return args.get("Path") or args.get("TargetFile") or args.get("AbsolutePath") or args.get("file_path")
    tool_input = payload.get("tool_input") or {}
    return tool_input.get("file_path")


def is_protected_linter_config(path: Optional[str]) -> bool:
    if not path:
        return False
    base = os.path.basename(path.strip().rstrip("/"))
    return bool(PROTECTED_FILE_RE.match(base))


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        payload = None

    if not isinstance(payload, dict):
        print(PARSE_ERROR_MESSAGE, file=sys.stderr)
        return 2

    is_antigravity = "toolCall" in payload or "hookEventName" in payload
    path = extract_file_path(payload)
    if is_protected_linter_config(path):
        if is_antigravity:
            print(json.dumps({"decision": "deny", "reason": BLOCK_MESSAGE}, ensure_ascii=False))
            return 0
        print(BLOCK_MESSAGE, file=sys.stderr)
        return 2

    if is_antigravity:
        print("{}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
