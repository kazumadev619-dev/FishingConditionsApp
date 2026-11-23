"""linter_config_guard.py と post_edit_check.py のテスト。

実行: python3 -m unittest discover -s .agents/hooks
"""

import json
import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import linter_config_guard  # noqa: E402
import post_edit_check  # noqa: E402

LINTER_GUARD_SCRIPT = HERE / "linter_config_guard.py"
POST_EDIT_SCRIPT = HERE / "post_edit_check.py"


class LinterConfigGuardTest(unittest.TestCase):
    def run_hook(self, stdin: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            [sys.executable, str(LINTER_GUARD_SCRIPT)],
            input=stdin,
            capture_output=True,
            text=True,
            timeout=30,
        )

    def test_blocks_protected_configs_in_claude_format(self):
        for path in [
            "biome.json",
            "/repo/.oxlintrc.json",
            "eslint.config.mts",
            "eslint.config.js",
            "eslint.config",
        ]:
            with self.subTest(path=path):
                payload = {"tool_name": "Edit", "tool_input": {"file_path": path}}
                result = self.run_hook(json.dumps(payload))
                self.assertEqual(result.returncode, 2)
                self.assertIn("BLOCKED", result.stderr)
                self.assertEqual(result.stdout, "")

    def test_allows_normal_files_in_claude_format(self):
        for path in ["src/app/page.tsx", "package.json", "docs/biome-notes.md"]:
            with self.subTest(path=path):
                payload = {"tool_name": "Write", "tool_input": {"file_path": path}}
                result = self.run_hook(json.dumps(payload))
                self.assertEqual((result.returncode, result.stdout, result.stderr), (0, "", ""))

    def test_broken_json_exits_2_on_claude(self):
        result = self.run_hook("not json")
        self.assertEqual(result.returncode, 2)
        self.assertIn("BLOCKED", result.stderr)

    def test_blocks_protected_configs_in_antigravity_format(self):
        for tool_name, arg_key in [("edit_file", "Path"), ("write_file", "Path"), ("replace_file_content", "TargetFile")]:
            with self.subTest(tool_name=tool_name):
                payload = {
                    "hookEventName": "PreToolUse",
                    "toolCall": {"name": tool_name, "args": {arg_key: "/repo/eslint.config.mts"}},
                }
                result = self.run_hook(json.dumps(payload))
                self.assertEqual(result.returncode, 0)
                body = json.loads(result.stdout)
                self.assertEqual(body["decision"], "deny")
                self.assertIn("BLOCKED", body["reason"])

    def test_allows_normal_files_in_antigravity_format(self):
        payload = {
            "hookEventName": "PreToolUse",
            "toolCall": {"name": "edit_file", "args": {"Path": "/repo/src/index.ts"}},
        }
        result = self.run_hook(json.dumps(payload))
        self.assertEqual((result.returncode, result.stdout, result.stderr), (0, "", ""))


class PostEditCheckTest(unittest.TestCase):
    def run_hook(self, stdin: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            [sys.executable, str(POST_EDIT_SCRIPT)],
            input=stdin,
            capture_output=True,
            text=True,
            timeout=30,
        )

    def test_ignores_non_js_ts_files_in_both_formats(self):
        claude_payload = {"tool_name": "Write", "tool_input": {"file_path": "README.md"}}
        claude_res = self.run_hook(json.dumps(claude_payload))
        self.assertEqual((claude_res.returncode, claude_res.stdout, claude_res.stderr), (0, "", ""))

        agy_payload = {
            "hookEventName": "PostToolUse",
            "toolCall": {"name": "write_file", "args": {"Path": "README.md"}},
        }
        agy_res = self.run_hook(json.dumps(agy_payload))
        self.assertEqual(agy_res.returncode, 0)
        self.assertEqual(json.loads(agy_res.stdout), {})

    def test_extracts_file_path_from_tool_response_fallback(self):
        payload = {"tool_name": "Edit", "tool_input": {}, "tool_response": {"filePath": "src/a.tsx"}}
        self.assertEqual(post_edit_check.extract_file_path(payload), "src/a.tsx")

    def test_antigravity_outputs_empty_json_to_stdout_and_diagnostics_to_stderr(self):
        payload = {
            "hookEventName": "PostToolUse",
            "cwd": "/tmp",
            "toolCall": {"name": "edit_file", "args": {"Path": "src/a.ts"}},
        }
        stdout_buf = mock.MagicMock()
        stderr_buf = mock.MagicMock()
        with mock.patch("sys.stdin", mock.MagicMock(read=lambda: json.dumps(payload))):
            with mock.patch.object(post_edit_check, "run_checks", return_value="oxlint warning"):
                with mock.patch("sys.stdout", stdout_buf), mock.patch("sys.stderr", stderr_buf):
                    code = post_edit_check.main()
        self.assertEqual(code, 0)
        stdout_text = "".join(call.args[0] for call in stdout_buf.write.call_args_list)
        stderr_text = "".join(call.args[0] for call in stderr_buf.write.call_args_list)
        self.assertEqual(json.loads(stdout_text), {})
        self.assertIn("oxlint warning", stderr_text)


if __name__ == "__main__":
    unittest.main()
