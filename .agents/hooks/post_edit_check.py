#!/usr/bin/env python3
"""編集後に oxlint と biome check --write を実行する PostToolUse hook。

Claude Code（.claude/settings.json）と Antigravity（.agents/hooks.json）の双方から呼ばれる。
"""

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Optional

TARGET_EXTENSIONS = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs")
MAX_OXLINT_LINES = 50


def extract_file_path(payload: dict) -> Optional[str]:
    if "toolCall" in payload or "hookEventName" in payload:
        args = (payload.get("toolCall") or {}).get("args") or {}
        return args.get("Path") or args.get("TargetFile") or args.get("AbsolutePath") or args.get("file_path")
    tool_input = payload.get("tool_input") or {}
    tool_response = payload.get("tool_response") or {}
    return tool_input.get("file_path") or tool_response.get("filePath")


def is_target_file(path: Optional[str]) -> bool:
    return bool(path) and path.endswith(TARGET_EXTENSIONS)


def resolve_project_dir(payload: dict) -> str:
    env_dir = os.environ.get("CLAUDE_PROJECT_DIR")
    if env_dir:
        return env_dir
    cwd = payload.get("cwd")
    if isinstance(cwd, str) and cwd and os.path.isdir(cwd):
        return cwd
    return str(Path(__file__).resolve().parents[2])


def run_checks(file_path: str, project_dir: str) -> str:
    outputs = []
    oxlint = subprocess.run(
        ["npx", "oxlint", "--format=json", file_path],
        cwd=project_dir,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        check=False,
    )
    if oxlint.stdout:
        lines = oxlint.stdout.splitlines()[:MAX_OXLINT_LINES]
        outputs.append("\n".join(lines))

    biome = subprocess.run(
        ["npx", "biome", "check", "--write", file_path],
        cwd=project_dir,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        check=False,
    )
    if biome.stdout:
        outputs.append(biome.stdout.rstrip("\n"))

    return "\n".join(part for part in outputs if part)


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return 0
    if not isinstance(payload, dict):
        return 0

    is_antigravity = "toolCall" in payload or "hookEventName" in payload
    file_path = extract_file_path(payload)
    if not is_target_file(file_path):
        if is_antigravity:
            print("{}")
        return 0

    project_dir = resolve_project_dir(payload)
    output = run_checks(file_path, project_dir)
    if is_antigravity:
        if output:
            print(output, file=sys.stderr)
        print("{}")
    elif output:
        print(output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
