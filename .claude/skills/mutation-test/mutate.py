#!/usr/bin/env python3
"""テストやガードが「壊れたら落ちる」ことを確かめる変異テストのハーネス。

    mutate.py run <spec.json>
    mutate.py extract-step <workflow.yml> <step name>

手作業の変異テストで実際に起きた失敗を、ここで機械的に防ぐ。

- 次の変異は HARNESS_ERROR にして、コマンドを走らせない
  - 置換対象がちょうど指定の箇所数（既定1）でない
  - 何も変えない（old と new が同じ、count が1未満、適用しても中身が元と同じ）
  - UTF-8 として読めない、リポジトリの外、既にあるファイルの作成、親がファイル
- 最初に変異なしで走らせ、落ちたら止まる。変異が1件も無くても止まる
- 毎回元に戻し、変更したファイルの中身（sha256）と git status の両方が元と一致することを
  確かめる。git status だけだと .gitignore 対象のファイルの戻し損ねに気づけない。
  git status の基準は変異なしの実行の後に取る（コマンド自身が作るファイルを復元の失敗と
  取り違えないため）。書き戻しに失敗したファイルがあっても残りは戻し、戻せなかったものを
  列挙して止める。中断されても戻す
- 改行コードを保つ（バイト列で読み書きする）
- コマンドは新しいプロセスグループで動かし、時間切れや中断ではグループごと止める
- 全件が変異なしと同じ結果なら警告する（変異がテストに届いていない疑い）
- message_pattern を指定したとき、検知したのにメッセージが出ていなければ警告する

終了コード: 0 全件が期待どおりで警告なし / 1 期待と違う結果か警告がある /
2 変異なしで落ちた・変異が無い・復元に失敗・中断・想定外のエラー

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
import traceback
from pathlib import Path
from typing import Dict, List, Optional, Tuple

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
        # 作ったファイルとディレクトリを作った順に持つ。戻すときは逆順に消す
        self.created: List[Path] = []
        # restore() とは別に持つ。restore() が書き戻した後に、書き戻しが正しかったかを
        # 独立に確かめるため
        self.expected_digests: Dict[Path, str] = {}
        self.must_not_exist: List[Path] = []

    def _path(self, rel: str) -> Path:
        path = (self.root / rel).resolve()
        if self.root not in path.parents:
            raise HarnessError(f"リポジトリの外は変更できない: {rel}")
        return path

    def _rel(self, path: Path) -> str:
        return str(path.relative_to(self.root))

    @staticmethod
    def _decode(rel: str, data: bytes) -> str:
        try:
            return data.decode("utf-8")
        except UnicodeDecodeError:
            raise HarnessError(f"UTF-8 として読めない: {rel}") from None

    def check(self, mutation: dict) -> None:
        """適用できるかを、何も書き換えずに確かめる。"""
        edits = mutation.get("edits", [])
        creates = mutation.get("create", [])
        if not edits and not creates:
            raise HarnessError("edits も create も無い")

        pending: Dict[Path, str] = {}
        original_text: Dict[Path, str] = {}
        for edit in edits:
            path = self._path(edit["file"])
            if edit["old"] == edit["new"]:
                raise HarnessError(f"old と new が同じで何も変わらない: {edit['file']}")
            expected = edit.get("count", 1)
            if not isinstance(expected, int) or expected < 1:
                raise HarnessError(f"count は1以上の整数にする: {edit['file']}")
            if path not in pending:
                if not path.is_file():
                    raise HarnessError(f"ファイルが無い: {edit['file']}")
                text = self._decode(edit["file"], path.read_bytes())
                pending[path] = text
                original_text[path] = text
            # 同じファイルへの edit は順に積み上げて数える。前の edit で対象が消えたら
            # ここで気づける
            found = pending[path].count(edit["old"])
            if found != expected:
                raise HarnessError(
                    f"{edit['file']} で置換対象が {found} 箇所見つかった（期待 {expected}）: "
                    f"{edit['old'][:60]!r}"
                )
            pending[path] = pending[path].replace(edit["old"], edit["new"])
        for path, text in pending.items():
            if text == original_text[path]:
                raise HarnessError(f"変異を適用しても中身が変わらない: {self._rel(path)}")

        for create in creates:
            path = self._path(create["file"])
            if path.exists() or path.is_symlink():
                raise HarnessError(f"既にある: {create['file']}")
            parent = path.parent
            while not parent.exists():
                parent = parent.parent
            if not parent.is_dir():
                raise HarnessError(f"親がディレクトリではない: {create['file']}")

    def apply(self, mutation: dict) -> None:
        for edit in mutation.get("edits", []):
            path = self._path(edit["file"])
            if path not in self.originals:
                data = path.read_bytes()
                # 期待値を先に記録する。記録の途中でシグナルが来ても、未変更の
                # ファイルの中身と一致するので誤検出しない
                self.expected_digests[path] = hashlib.sha256(data).hexdigest()
                self.originals[path] = data
            text = path.read_bytes().decode("utf-8")
            path.write_bytes(text.replace(edit["old"], edit["new"]).encode("utf-8"))
        for create in mutation.get("create", []):
            path = self._path(create["file"])
            missing = []
            parent = path.parent
            while not parent.exists():
                missing.append(parent)
                parent = parent.parent
            # 作る前に記録する。作った直後にシグナルが来ても消し損ねない
            for d in reversed(missing):
                self.created.append(d)
                self.must_not_exist.append(d)
                d.mkdir()
            self.created.append(path)
            self.must_not_exist.append(path)
            path.write_bytes(create["content"].encode("utf-8"))

    def restore(self) -> List[str]:
        """書き戻して、戻せなかったものを返す。1つ失敗しても残りは試す。"""
        failures = []
        for path, data in self.originals.items():
            try:
                # コマンドがディレクトリごと消していても戻せるようにする
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
            except OSError as e:
                failures.append(f"書き戻せない: {self._rel(path)}（{type(e).__name__}）")
        for path in reversed(self.created):
            try:
                if path.is_dir() and not path.is_symlink():
                    shutil.rmtree(path)
                elif path.exists() or path.is_symlink():
                    path.unlink()
            except OSError as e:
                failures.append(f"消せない: {self._rel(path)}（{type(e).__name__}）")
        self.originals.clear()
        self.created.clear()
        return failures

    def verify_restored(self) -> List[str]:
        """元に戻っていないものを列挙する。確かめた記録はここで捨てる。"""
        problems = []
        for path, digest in self.expected_digests.items():
            if not path.is_file():
                problems.append(f"消えている: {self._rel(path)}")
            elif hashlib.sha256(path.read_bytes()).hexdigest() != digest:
                problems.append(f"中身が元と違う: {self._rel(path)}")
        for path in self.must_not_exist:
            if path.exists() or path.is_symlink():
                problems.append(f"作ったものが残っている: {self._rel(path)}")
        self.expected_digests.clear()
        self.must_not_exist.clear()
        return problems

    def restore_and_verify(self) -> List[str]:
        return self.restore() + self.verify_restored()


def _stop_group(proc: subprocess.Popen) -> None:
    """コマンドのプロセスグループごと止める。孫プロセスを残さない。"""
    for sig, wait in ((signal.SIGTERM, 2), (signal.SIGKILL, 2)):
        try:
            os.killpg(proc.pid, sig)
        except ProcessLookupError:
            return
        try:
            proc.wait(timeout=wait)
        except subprocess.TimeoutExpired:
            pass


def _collect(proc: subprocess.Popen) -> bytes:
    try:
        out, _ = proc.communicate(timeout=5)
        return out or b""
    except subprocess.TimeoutExpired:
        return "（グループの外に逃げたプロセスが出力を握っているため読めなかった）".encode("utf-8")


def run_command(spec: dict, root: Path) -> dict:
    env = dict(os.environ)
    for name in spec.get("unset_env", []):
        env.pop(name, None)
    cwd = root / spec.get("cwd", ".")
    proc = subprocess.Popen(
        ["bash", "-c", spec["command"]],
        cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    code: Optional[int] = None
    try:
        out, _ = proc.communicate(timeout=spec.get("timeout", 600))
        code = proc.returncode
    except subprocess.TimeoutExpired:
        _stop_group(proc)
        out = _collect(proc)
    except BaseException:
        _stop_group(proc)
        _collect(proc)
        raise
    output = (out or b"").decode("utf-8", errors="replace")

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


def _ignore_signals() -> None:
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    signal.signal(signal.SIGTERM, signal.SIG_IGN)


def cmd_run(spec_path: str) -> int:
    spec = json.loads(Path(spec_path).read_text())
    if not spec.get("mutations"):
        print("mutations が空。試す変異が無いので止める。")
        return EXIT_ABORTED
    root = repo_root()
    workspace = Workspace(root)

    def on_signal(signum, _frame):
        raise Interrupted(signal.Signals(signum).name)

    signal.signal(signal.SIGINT, on_signal)
    signal.signal(signal.SIGTERM, on_signal)

    results: List[dict] = []
    try:
        print(f"$ {spec['command']}")
        baseline = run_command(spec, root)
        if baseline["code"] != 0:
            print("\n変異なしで落ちた（または時間切れ）。テストかハーネスが最初から壊れているので、変異は試さない。")
            print(baseline["tail"])
            return EXIT_ABORTED
        # 変異なしの実行の後に取る。コマンド自身がビルド成果物などを作る場合、
        # 実行前に取ると、それを復元の失敗と取り違える
        status_before = git_status(root)
        if spec.get("summary_pattern") and not baseline["summary"]:
            print(f"警告: summary_pattern が変異なしの出力に一致しない: {spec['summary_pattern']!r}")
        print(f"変異なし: 通過 {baseline['summary']}\n")

        for mutation in spec["mutations"]:
            label = mutation["label"]
            expect = mutation.get("expect", "fail")
            try:
                workspace.check(mutation)
            except HarnessError as e:
                results.append({"label": label, "verdict": "HARNESS_ERROR",
                                "note": str(e), "expect": expect})
                continue

            outcome = None
            apply_error: Optional[BaseException] = None
            try:
                try:
                    workspace.apply(mutation)
                except (OSError, UnicodeError) as e:
                    apply_error = e
                else:
                    outcome = run_command(spec, root)
            finally:
                problems = workspace.restore_and_verify()
            status_now = git_status(root)
            if status_now != status_before:
                problems.append("git status が実行前と違う:\n" + status_now)
            if problems:
                print(f"\n復元に失敗した（{label} のあと）。ここで止める。")
                print("\n".join(problems))
                return EXIT_ABORTED
            if apply_error is not None:
                results.append({"label": label, "verdict": "HARNESS_ERROR",
                                "note": f"適用に失敗した: {apply_error}", "expect": expect})
                continue

            v = verdict(expect, outcome["code"])
            note = outcome["message"] or outcome["summary"]
            if v == "KILLED" and spec.get("message_pattern") and not outcome["message"]:
                note = "検知したがメッセージが出ていない"
            results.append({"label": label, "verdict": v, "note": note,
                            "outcome": outcome, "expect": expect})
    except Interrupted as e:
        _ignore_signals()
        problems = workspace.restore_and_verify()
        print(f"\n中断された（{e}）。変異を元に戻した。")
        if problems:
            print("ただし戻せなかったものがある:\n" + "\n".join(problems))
        return EXIT_ABORTED
    except Exception:
        _ignore_signals()
        problems = workspace.restore_and_verify()
        print("\n想定外のエラーで止まった。変異を元に戻した。")
        if problems:
            print("ただし戻せなかったものがある:\n" + "\n".join(problems))
        traceback.print_exc()
        return EXIT_ABORTED
    finally:
        workspace.restore()

    return report(results, baseline)


def _key(outcome: dict) -> Tuple[Optional[int], str, str]:
    return (outcome["code"], outcome["summary"], outcome["message"])


def report(results: List[dict], baseline: dict) -> int:
    width = max(len(r["verdict"]) for r in results) if results else 0
    for r in results:
        print(f"{r['verdict']:<{width}}  {r['label']}  {r.get('note', '')}".rstrip())

    problems = [r for r in results if r["verdict"] not in GOOD]
    warnings = []
    notes = []

    ran = [r for r in results if "outcome" in r]
    if len(ran) >= 2 and all(_key(r["outcome"]) == _key(baseline) for r in ran):
        warnings.append(
            "全件が変異なしと同じ結果になった。変異がテストに届いていない（コマンドが別のファイルを"
            "見ている、パスの差し替え漏れ）か、テストに本当に穴があるかのどちらか。"
            "確実に落ちる変異（テストが直接読む値を壊す）を1件足して区別すること"
        )
    elif (len(ran) >= 2 and all(r["verdict"] == "KILLED" for r in ran)
          and len({_key(r["outcome"]) for r in ran}) == 1):
        notes.append(
            "全件が同じ出力で落ちた。変異と無関係な理由（構文エラーなど）で落ちていないか、"
            "1件の出力を確かめること（結果の判定には影響しない）"
        )
    for r in results:
        if r.get("note") == "検知したがメッセージが出ていない":
            warnings.append(
                f"{r['label']}: 落ちたが message_pattern に一致する出力が無い。"
                "エラーメッセージに到達する前に死んでいないか（set -e 下の代入など）"
            )

    for r in problems:
        if "outcome" in r:
            print(f"\n--- {r['verdict']}: {r['label']} の出力（末尾）---\n{r['outcome']['tail']}")
    for w in warnings:
        print(f"\n警告: {w}")
    for n in notes:
        print(f"\n注意: {n}")

    killed = sum(r["verdict"] == "KILLED" for r in results)
    expected_fail = sum(r["expect"] == "fail" for r in results)
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
