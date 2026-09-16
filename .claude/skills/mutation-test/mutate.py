#!/usr/bin/env python3
"""テストやガードが「壊れたら落ちる」ことを確かめる変異テストのハーネス。

    mutate.py run <spec.json>
    mutate.py extract-step <workflow.yml> <step name>

手作業の変異テストで実際に起きた失敗を、ここで機械的に防ぐ。

- 置換対象が見つからない／複数ある変異は、コマンドを走らせずに HARNESS_ERROR にする
  （置換が効かないまま「通った」と読んでしまうのを防ぐ）
- 最初に変異なしで走らせ、落ちたら何も試さずに止まる
- 毎回元に戻し、変更したファイルの中身（sha256）と git status の両方が元と一致することを確かめる。
  git status だけだと .gitignore 対象のファイルの戻し損ねに気づけない。中断されても戻す
- 全件が同じ結果になったら、テストではなくハーネスを疑うよう警告する
- message_pattern を指定したとき、検知したのにメッセージが出ていなければ警告する

標準ライブラリだけで動く（node が使えない環境でも動かせるように）。
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, Optional

EXIT_OK = 0
EXIT_UNEXPECTED = 1
EXIT_ABORTED = 2

TAIL_LINES = 15


class HarnessError(Exception):
    pass


class Interrupted(Exception):
    pass


def repo_root() -> Path:
    out = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True
    )
    if out.returncode != 0:
        raise SystemExit("git リポジトリの中で実行すること")
    return Path(out.stdout.strip())


def git_status(root: Path) -> str:
    return subprocess.run(
        ["git", "status", "--porcelain=v1", "--untracked-files=all"],
        cwd=root, capture_output=True, text=True, check=True,
    ).stdout


class Workspace:
    """変異の適用と復元。適用したものはすべて記録し、restore() で必ず戻す。"""

    def __init__(self, root: Path):
        # _path() がシンボリックリンクを解決するので、root も解決しておく。
        # macOS の一時ディレクトリは /var → /private/var のリンクで、揃えないと
        # relative_to() が失敗する
        self.root = root.resolve()
        self.originals: Dict[Path, bytes] = {}
        self.created_files: List[Path] = []
        self.created_dirs: List[Path] = []
        # restore() とは別に持つ。restore() が書き戻した後に、書き戻しが正しかったかを
        # 独立に確かめるため
        self.expected_digests: Dict[Path, str] = {}
        self.must_not_exist: List[Path] = []

    def _path(self, rel: str) -> Path:
        path = (self.root / rel).resolve()
        if self.root not in path.parents and path != self.root:
            raise HarnessError(f"リポジトリの外は変更できない: {rel}")
        return path

    def check(self, mutation: dict) -> None:
        """適用できるかを、何も書き換えずに確かめる。"""
        edits = mutation.get("edits", [])
        creates = mutation.get("create", [])
        if not edits and not creates:
            raise HarnessError("edits も create も無い")
        pending: Dict[Path, str] = {}
        for edit in edits:
            path = self._path(edit["file"])
            if path not in pending:
                if not path.is_file():
                    raise HarnessError(f"ファイルが無い: {edit['file']}")
                pending[path] = path.read_text()
            expected = edit.get("count", 1)
            found = pending[path].count(edit["old"])
            if found != expected:
                raise HarnessError(
                    f"{edit['file']} で置換対象が {found} 箇所見つかった（期待 {expected}）: "
                    f"{edit['old'][:60]!r}"
                )
            pending[path] = pending[path].replace(edit["old"], edit["new"])
        for create in creates:
            path = self._path(create["file"])
            if path.exists():
                raise HarnessError(f"既にある: {create['file']}")

    def apply(self, mutation: dict) -> None:
        for edit in mutation.get("edits", []):
            path = self._path(edit["file"])
            if path not in self.originals:
                self.originals[path] = path.read_bytes()
                self.expected_digests[path] = hashlib.sha256(self.originals[path]).hexdigest()
            text = path.read_text()
            path.write_text(text.replace(edit["old"], edit["new"]))
        for create in mutation.get("create", []):
            path = self._path(create["file"])
            missing = []
            parent = path.parent
            while not parent.exists():
                missing.append(parent)
                parent = parent.parent
            for d in reversed(missing):
                d.mkdir()
                self.created_dirs.append(d)
                self.must_not_exist.append(d)
            path.write_text(create["content"])
            self.created_files.append(path)
            self.must_not_exist.append(path)

    def restore(self) -> None:
        for path, data in self.originals.items():
            path.write_bytes(data)
        for path in reversed(self.created_files):
            if path.exists():
                path.unlink()
        for d in reversed(self.created_dirs):
            if d.exists():
                shutil.rmtree(d)
        self.originals.clear()
        self.created_files.clear()
        self.created_dirs.clear()

    def verify_restored(self) -> List[str]:
        """元に戻っていないものを列挙する。確かめた記録はここで捨てる。"""
        problems = []
        for path, digest in self.expected_digests.items():
            if not path.is_file():
                problems.append(f"消えている: {path.relative_to(self.root)}")
            elif hashlib.sha256(path.read_bytes()).hexdigest() != digest:
                problems.append(f"中身が元と違う: {path.relative_to(self.root)}")
        for path in self.must_not_exist:
            if path.exists():
                problems.append(f"作ったものが残っている: {path.relative_to(self.root)}")
        self.expected_digests.clear()
        self.must_not_exist.clear()
        return problems


def run_command(spec: dict, root: Path) -> dict:
    env = dict(os.environ)
    for name in spec.get("unset_env", []):
        env.pop(name, None)
    cwd = root / spec.get("cwd", ".")
    try:
        proc = subprocess.run(
            ["bash", "-c", spec["command"]],
            cwd=cwd, env=env, capture_output=True, text=True,
            timeout=spec.get("timeout", 600),
        )
        output = proc.stdout + proc.stderr
        code: Optional[int] = proc.returncode
    except subprocess.TimeoutExpired as e:
        output = (e.stdout or "") + (e.stderr or "") if isinstance(e.stdout, str) else ""
        code = None

    summary = ""
    if spec.get("summary_pattern"):
        m = re.search(spec["summary_pattern"], output, re.MULTILINE)
        summary = m.group(0).strip() if m else ""
    message = ""
    if spec.get("message_pattern"):
        m = re.search(spec["message_pattern"], output, re.MULTILINE)
        if m:
            message = (m.group(1) if m.groups() else m.group(0)).strip()
    tail = "\n".join(output.rstrip().splitlines()[-TAIL_LINES:])
    return {"code": code, "summary": summary, "message": message, "tail": tail}


def verdict(expect: str, code: Optional[int]) -> str:
    if code is None:
        return "TIMEOUT"
    failed = code != 0
    if expect == "fail":
        return "KILLED" if failed else "SURVIVED"
    return "FALSE_ALARM" if failed else "PASSED"


GOOD = {"KILLED", "PASSED"}


def cmd_run(spec_path: str) -> int:
    spec = json.loads(Path(spec_path).read_text())
    root = repo_root()
    workspace = Workspace(root)
    status_before = git_status(root)

    def on_signal(signum, _frame):
        raise Interrupted(signal.Signals(signum).name)

    signal.signal(signal.SIGINT, on_signal)
    signal.signal(signal.SIGTERM, on_signal)

    try:
        print(f"$ {spec['command']}")
        baseline = run_command(spec, root)
        if baseline["code"] != 0:
            print("\n変異なしで落ちた（または時間切れ）。テストかハーネスが最初から壊れているので、変異は試さない。")
            print(baseline["tail"])
            return EXIT_ABORTED
        if spec.get("summary_pattern") and not baseline["summary"]:
            print(f"警告: summary_pattern が変異なしの出力に一致しない: {spec['summary_pattern']!r}")
        print(f"変異なし: 通過 {baseline['summary']}\n")

        results = []
        for mutation in spec["mutations"]:
            label = mutation["label"]
            expect = mutation.get("expect", "fail")
            try:
                workspace.check(mutation)
            except HarnessError as e:
                results.append({"label": label, "verdict": "HARNESS_ERROR", "note": str(e)})
                continue
            try:
                workspace.apply(mutation)
                outcome = run_command(spec, root)
            finally:
                workspace.restore()
            problems = workspace.verify_restored()
            if git_status(root) != status_before:
                problems.append("git status が実行前と違う:\n" + git_status(root))
            if problems:
                print(f"\n復元に失敗した（{label} のあと）。ここで止める。")
                print("\n".join(problems))
                return EXIT_ABORTED
            v = verdict(expect, outcome["code"])
            note = outcome["message"] or outcome["summary"]
            if v == "KILLED" and spec.get("message_pattern") and not outcome["message"]:
                note = "検知したがメッセージが出ていない"
            results.append({"label": label, "verdict": v, "note": note,
                            "outcome": outcome, "expect": expect})
    except Interrupted as e:
        workspace.restore()
        print(f"\n中断された（{e}）。変異は元に戻した。")
        return EXIT_ABORTED
    finally:
        workspace.restore()

    return report(spec, results)


def report(spec: dict, results: List[dict]) -> int:
    width = max(len(r["verdict"]) for r in results) if results else 0
    for r in results:
        print(f"{r['verdict']:<{width}}  {r['label']}  {r.get('note', '')}".rstrip())

    problems = [r for r in results if r["verdict"] not in GOOD]
    warnings = []

    ran = [r for r in results if "outcome" in r]
    if len(ran) >= 2:
        keys = {(r["outcome"]["code"], r["outcome"]["summary"], r["outcome"]["message"]) for r in ran}
        if len(keys) == 1:
            warnings.append(
                "全件が同じ結果になった。テスト側に本当に穴があるか、ハーネスが変異を届けていない"
                "（コマンドが別のファイルを見ている、パスの差し替え漏れ）かのどちらか。"
                "確実に落ちる変異（テストが直接読む値を壊す）を1件足して区別すること"
            )
    silent = [r for r in results if r.get("note") == "検知したがメッセージが出ていない"]
    for r in silent:
        warnings.append(
            f"{r['label']}: 落ちたが message_pattern に一致する出力が無い。"
            "エラーメッセージに到達する前に死んでいないか（set -e 下の代入など）"
        )

    for r in problems:
        if "outcome" in r:
            print(f"\n--- {r['verdict']}: {r['label']} の出力（末尾）---\n{r['outcome']['tail']}")
    for w in warnings:
        print(f"\n警告: {w}")

    killed = sum(r["verdict"] == "KILLED" for r in results)
    expected_fail = sum(r.get("expect", "fail") == "fail" for r in results)
    print(f"\n検知 {killed}/{expected_fail}、期待と違う {len(problems)} 件、警告 {len(warnings)} 件")
    return EXIT_OK if not problems and not warnings else EXIT_UNEXPECTED


def cmd_extract_step(workflow: str, step_name: str) -> int:
    lines = Path(workflow).read_text().splitlines()
    name_re = re.compile(r"^(\s*)-\s+name:\s*(.+?)\s*$")
    for i, line in enumerate(lines):
        m = name_re.match(line)
        if not m or m.group(2).strip("'\"") != step_name:
            continue
        item_indent = len(m.group(1))
        for j in range(i + 1, len(lines)):
            here = lines[j]
            if here.strip() and len(here) - len(here.lstrip()) <= item_indent:
                break
            run = re.match(r"^(\s*)run:\s*(.*)$", here)
            if not run:
                continue
            run_indent = len(run.group(1))
            inline = run.group(2).strip()
            if inline and inline[0] not in "|>":
                print(inline)
                return EXIT_OK
            body = []
            for k in range(j + 1, len(lines)):
                text = lines[k]
                if text.strip() and len(text) - len(text.lstrip()) <= run_indent:
                    break
                body.append(text)
            while body and not body[-1].strip():
                body.pop()
            content = [b for b in body if b.strip()]
            if not content:
                print(f"{step_name} の run が空", file=sys.stderr)
                return EXIT_UNEXPECTED
            indent = min(len(b) - len(b.lstrip()) for b in content)
            sys.stdout.write("\n".join(b[indent:] if b.strip() else "" for b in body) + "\n")
            print(f"{len(content)} 行を抜き出した", file=sys.stderr)
            return EXIT_OK
        print(f"{step_name} に run が無い", file=sys.stderr)
        return EXIT_UNEXPECTED
    print(f"ステップが見つからない: {step_name}", file=sys.stderr)
    return EXIT_UNEXPECTED


def main(argv: List[str]) -> int:
    if len(argv) >= 2 and argv[0] == "run":
        return cmd_run(argv[1])
    if len(argv) >= 3 and argv[0] == "extract-step":
        return cmd_extract_step(argv[1], argv[2])
    print(__doc__, file=sys.stderr)
    return EXIT_ABORTED


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
