"""mutate.py のテスト。

実行: python3 .claude/skills/mutation-test/test_mutate.py

一時ディレクトリに git リポジトリを作り、その中で mutate.py を実際に起動する。
ここに並んでいるケースの多くは、手作業の変異テストで実際に起きた失敗を再現したもの。
"""

import json
import os
import signal
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "mutate.py"


def git(repo, *args):
    subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True)


class RepoTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self._tmp.name)
        git(self.repo, "init", "-q")
        git(self.repo, "config", "user.email", "t@example.com")
        git(self.repo, "config", "user.name", "t")
        (self.repo / "target.txt").write_text("alpha\nbeta\n")
        (self.repo / "other.txt").write_text("keep\n")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-q", "-m", "init")

    def tearDown(self):
        self._tmp.cleanup()

    def run_spec(self, spec, *extra, **popen):
        spec_path = Path(self._tmp.name).parent / f"mutate-spec-{os.getpid()}-{id(spec)}.json"
        spec_path.write_text(json.dumps(spec, ensure_ascii=False))
        self.addCleanup(lambda: spec_path.unlink(missing_ok=True))
        return subprocess.run(
            [sys.executable, str(SCRIPT), "run", str(spec_path), *extra],
            cwd=self.repo,
            capture_output=True,
            text=True,
            **popen,
        )

    def git_status(self):
        return subprocess.run(
            ["git", "status", "--porcelain=v1", "--untracked-files=all"],
            cwd=self.repo, capture_output=True, text=True, check=True,
        ).stdout


class BaselineTest(RepoTestCase):
    def test_変異なしで落ちるなら変異を1件も試さずに止まる(self):
        result = self.run_spec({
            "command": "exit 1",
            "mutations": [{"label": "m", "edits": [
                {"file": "target.txt", "old": "alpha", "new": "ALPHA"}]}],
        })
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("変異なし", result.stdout + result.stderr)
        self.assertEqual((self.repo / "target.txt").read_text(), "alpha\nbeta\n")


class VerdictTest(RepoTestCase):
    def test_検知した変異と素通りした変異を区別する(self):
        result = self.run_spec({
            "command": "grep -q alpha target.txt",
            "mutations": [
                {"label": "検知される", "edits": [
                    {"file": "target.txt", "old": "alpha", "new": "ALPHA"}]},
                {"label": "素通りする", "edits": [
                    {"file": "other.txt", "old": "keep", "new": "kept"}]},
            ],
        })
        out = result.stdout
        self.assertEqual(result.returncode, 1, out + result.stderr)
        self.assertRegex(out, r"KILLED\s+検知される")
        self.assertRegex(out, r"SURVIVED\s+素通りする")

    def test_落ちないのが正解の変異(self):
        result = self.run_spec({
            "command": "grep -q alpha target.txt",
            "mutations": [
                {"label": "無関係", "expect": "pass", "edits": [
                    {"file": "other.txt", "old": "keep", "new": "kept"}]},
                {"label": "壊れる", "expect": "pass", "edits": [
                    {"file": "target.txt", "old": "alpha", "new": "ALPHA"}]},
            ],
        })
        self.assertRegex(result.stdout, r"PASSED\s+無関係")
        self.assertRegex(result.stdout, r"FALSE_ALARM\s+壊れる")
        self.assertEqual(result.returncode, 1)

    def test_すべて期待どおりなら終了コード0(self):
        result = self.run_spec({
            "command": "grep -q alpha target.txt",
            "mutations": [{"label": "m", "edits": [
                {"file": "target.txt", "old": "alpha", "new": "ALPHA"}]}],
        })
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


class HarnessErrorTest(RepoTestCase):
    # sed のインデント違いで置換が効かず、変異が一度も適用されないまま
    # 「通った」と読んでしまったことがある
    def test_置換対象が見つからなければコマンドを走らせずエラー(self):
        marker = self.repo / "ran.txt"
        result = self.run_spec({
            "command": f"grep -q alpha target.txt; echo x >> {marker}",
            "mutations": [{"label": "ずれた置換", "edits": [
                {"file": "target.txt", "old": "    alpha", "new": "ALPHA"}]}],
        })
        self.assertRegex(result.stdout, r"HARNESS_ERROR\s+ずれた置換")
        self.assertEqual(result.returncode, 1)
        # 変異なしの1回だけ走り、変異では走っていない
        self.assertEqual(marker.read_text().count("x"), 1)

    def test_置換対象が複数あればエラー(self):
        (self.repo / "target.txt").write_text("dup\ndup\n")
        git(self.repo, "commit", "-qam", "dup")
        result = self.run_spec({
            "command": "true",
            "mutations": [{"label": "曖昧", "edits": [
                {"file": "target.txt", "old": "dup", "new": "x"}]}],
        })
        self.assertRegex(result.stdout, r"HARNESS_ERROR\s+曖昧")

    def test_count_を指定すれば複数箇所を置換できる(self):
        (self.repo / "target.txt").write_text("dup\ndup\n")
        git(self.repo, "commit", "-qam", "dup")
        result = self.run_spec({
            "command": "grep -q dup target.txt",
            "mutations": [{"label": "全部", "edits": [
                {"file": "target.txt", "old": "dup", "new": "x", "count": 2}]}],
        })
        self.assertRegex(result.stdout, r"KILLED\s+全部")

    def test_既存ファイルを作ろうとしたらエラー(self):
        result = self.run_spec({
            "command": "true",
            "mutations": [{"label": "上書き", "create": [
                {"file": "target.txt", "content": "x"}]}],
        })
        self.assertRegex(result.stdout, r"HARNESS_ERROR\s+上書き")
        self.assertEqual((self.repo / "target.txt").read_text(), "alpha\nbeta\n")


class RestoreTest(RepoTestCase):
    def test_変更したファイルと作ったディレクトリを元に戻す(self):
        before = self.git_status()
        self.run_spec({
            "command": "test ! -e nested/deep/new.txt",
            "mutations": [
                {"label": "編集", "edits": [
                    {"file": "target.txt", "old": "alpha", "new": "ALPHA"}]},
                {"label": "作成", "create": [
                    {"file": "nested/deep/new.txt", "content": "x"}]},
            ],
        })
        self.assertEqual((self.repo / "target.txt").read_text(), "alpha\nbeta\n")
        self.assertFalse((self.repo / "nested").exists())
        self.assertEqual(self.git_status(), before)

    def test_Ctrl_C_で中断されても元に戻す(self):
        self._assert_restored_after(signal.SIGINT)

    # SIGINT は Python が KeyboardInterrupt にするので finally だけでも戻るが、
    # SIGTERM は既定だと finally を通らずに即死する。ハンドラが効くのはこちら
    def test_SIGTERM_で止められても元に戻す(self):
        self._assert_restored_after(signal.SIGTERM)

    def _assert_restored_after(self, sig):
        spec_path = Path(self._tmp.name).parent / f"mutate-spec-sig-{os.getpid()}-{sig}.json"
        spec_path.write_text(json.dumps({
            "command": "if grep -q ALPHA target.txt; then sleep 30; fi",
            "mutations": [{"label": "遅い", "edits": [
                {"file": "target.txt", "old": "alpha", "new": "ALPHA"}]}],
        }))
        self.addCleanup(lambda: spec_path.unlink(missing_ok=True))
        proc = subprocess.Popen(
            [sys.executable, str(SCRIPT), "run", str(spec_path)],
            cwd=self.repo, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        deadline = time.time() + 20
        while "ALPHA" not in (self.repo / "target.txt").read_text():
            if time.time() > deadline:
                proc.kill()
                self.fail("変異が適用されなかった")
            time.sleep(0.05)
        proc.send_signal(sig)
        proc.communicate(timeout=20)
        self.assertNotEqual(proc.returncode, 0)
        self.assertEqual((self.repo / "target.txt").read_text(), "alpha\nbeta\n")


class VerifyRestoredTest(unittest.TestCase):
    """git status だけでは .gitignore 対象のファイルの戻し損ねに気づけない。
    中身そのものを比べていることを、Workspace を直接使って確かめる。"""

    def setUp(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("mutate", SCRIPT)
        self.mutate = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.mutate)
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        (self.root / "ignored.txt").write_text("original\n")

    def tearDown(self):
        self._tmp.cleanup()

    def test_正しく戻せば問題なし(self):
        ws = self.mutate.Workspace(self.root)
        ws.apply({"edits": [{"file": "ignored.txt", "old": "original", "new": "mutated"}]})
        ws.restore()
        self.assertEqual(ws.verify_restored(), [])

    def test_戻した後に中身が違えば検出する(self):
        ws = self.mutate.Workspace(self.root)
        ws.apply({"edits": [{"file": "ignored.txt", "old": "original", "new": "mutated"}]})
        ws.restore()
        (self.root / "ignored.txt").write_text("broken\n")
        self.assertTrue(ws.verify_restored())

    def test_作ったファイルが残っていれば検出する(self):
        ws = self.mutate.Workspace(self.root)
        ws.apply({"create": [{"file": "new/leftover.txt", "content": "x"}]})
        ws.restore()
        (self.root / "new").mkdir()
        (self.root / "new" / "leftover.txt").write_text("x")
        self.assertTrue(ws.verify_restored())


class WarningTest(RepoTestCase):
    # ハーネスが壊れていて全件同じ結果になったのに、テストの結果だと読んだことがある
    def test_全件同じ結果なら警告する(self):
        result = self.run_spec({
            "command": "true",
            "mutations": [
                {"label": "a", "edits": [{"file": "target.txt", "old": "alpha", "new": "A"}]},
                {"label": "b", "edits": [{"file": "other.txt", "old": "keep", "new": "K"}]},
            ],
        })
        self.assertIn("全件", result.stdout)
        # 本当にテスト側の穴で全件素通りすることもあるので、ハーネスだと断定しない
        self.assertIn("確実に落ちる", result.stdout)

    # set -e で代入の時点で死に、書いたエラーメッセージが出ていなかったのを見逃したことがある
    def test_検知したがメッセージが出ていなければ警告する(self):
        result = self.run_spec({
            "command": "grep -q alpha target.txt || { echo 'ERROR: alpha が無い'; exit 1; }; grep -q beta target.txt",
            "message_pattern": r"ERROR: (.*)",
            "mutations": [
                {"label": "メッセージあり", "edits": [
                    {"file": "target.txt", "old": "alpha", "new": "A"}]},
                {"label": "メッセージなし", "edits": [
                    {"file": "target.txt", "old": "beta", "new": "B"}]},
            ],
        })
        out = result.stdout
        self.assertRegex(out, r"KILLED\s+メッセージあり.*alpha が無い")
        self.assertRegex(out, r"メッセージなし.*(メッセージが出ていない)")
        self.assertEqual(result.returncode, 1)


class ExtractStepTest(unittest.TestCase):
    # run: ブロックの抜き出しが最初の空行で止まり、set -euo pipefail の1行だけを
    # 実行していたことがある
    def test_空行を含む_run_ブロックを最後まで抜き出す(self):
        workflow = textwrap.dedent("""\
            jobs:
              manifests:
                steps:
                  - name: Other
                    run: echo other
                  - name: Guard
                    run: |
                      set -euo pipefail

                      first
                      if true; then
                        nested
                      fi

                      last
                  - name: After
                    run: echo after
            """)
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "ci.yml"
            path.write_text(workflow)
            result = subprocess.run(
                [sys.executable, str(SCRIPT), "extract-step", str(path), "Guard"],
                capture_output=True, text=True,
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            result.stdout,
            "set -euo pipefail\n\nfirst\nif true; then\n  nested\nfi\n\nlast\n",
        )

    def test_見つからないステップはエラー(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "ci.yml"
            path.write_text("jobs:\n  a:\n    steps:\n      - name: X\n        run: echo\n")
            result = subprocess.run(
                [sys.executable, str(SCRIPT), "extract-step", str(path), "Missing"],
                capture_output=True, text=True,
            )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")


if __name__ == "__main__":
    unittest.main(verbosity=2)
