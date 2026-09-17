"""deps.py のテスト。

実行: python3 .claude/skills/updating-dependencies/test_deps.py

ここに並ぶケースは、依存更新で実際に踏んだ罠を再現したもの（#110 / PR #158）。
"""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "deps.py"

import importlib.util

_spec = importlib.util.spec_from_file_location("deps", SCRIPT)
deps = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(deps)


def lock(packages: dict, root_deps=None, root_dev=None) -> dict:
    root = {"name": "app", "version": "1.0.0"}
    if root_deps is not None:
        root["dependencies"] = root_deps
    if root_dev is not None:
        root["devDependencies"] = root_dev
    return {"name": "app", "lockfileVersion": 3, "packages": {"": root, **packages}}


def entry(version, name=None, **extra):
    name = name or "x"
    e = {
        "version": version,
        "resolved": f"https://registry.npmjs.org/{name}/-/{name.split('/')[-1]}-{version}.tgz",
        "integrity": "sha512-AAAA",
    }
    e.update(extra)
    return e


def run(*args, cwd):
    return subprocess.run([sys.executable, str(SCRIPT), *args], cwd=cwd, capture_output=True, text=True)


class VersionTest(unittest.TestCase):
    def test_prerelease_は正式版より小さい(self):
        self.assertLess(deps.parse("5.0.0-beta.32"), deps.parse("5.0.0"))
        self.assertLess(deps.parse("8.0.0-rc.9"), deps.parse("8.0.0-rc.15"))
        self.assertLess(deps.parse("4.24.15"), deps.parse("5.0.0-beta.32"))

    def test_破壊的な変更とみなす境界(self):
        self.assertTrue(deps.breaking("7.10.0", "8.0.0"))
        self.assertFalse(deps.breaking("7.9.1", "7.10.0"))
        # 0.x は minor が上がると壊れうる（npm の ^ もそう扱う）
        self.assertTrue(deps.breaking("0.553.0", "0.600.0"))
        self.assertFalse(deps.breaking("0.553.0", "0.553.1"))


class CheckInstallTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def install(self, path, version):
        d = self.root / path
        d.mkdir(parents=True, exist_ok=True)
        (d / "package.json").write_text(json.dumps({"version": version}))

    def test_lock_どおりに入っていれば通る(self):
        (self.root / "package-lock.json").write_text(json.dumps(lock({
            "node_modules/prisma": entry("7.10.0", "prisma"),
        })))
        self.install("node_modules/prisma", "7.10.0")
        result = run("check-install", cwd=self.root)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    # 別ブランチで npm ci したまま切り替えていて、lock は 7.10.0 なのに 7.9.1 が入っていた
    def test_入っている版が_lock_と違えば落ちる(self):
        (self.root / "package-lock.json").write_text(json.dumps(lock({
            "node_modules/prisma": entry("7.10.0", "prisma"),
            "node_modules/next": entry("16.3.5", "next"),
        })))
        self.install("node_modules/prisma", "7.9.1")
        self.install("node_modules/next", "16.3.5")
        result = run("check-install", cwd=self.root)
        self.assertEqual(result.returncode, 1)
        self.assertIn("prisma", result.stdout)
        self.assertIn("7.9.1", result.stdout)
        self.assertIn("npm ci", result.stdout)

    def test_入っていない必須パッケージは落ちる(self):
        (self.root / "package-lock.json").write_text(json.dumps(lock({
            "node_modules/zod": entry("4.6.5", "zod"),
        })))
        result = run("check-install", cwd=self.root)
        self.assertEqual(result.returncode, 1)
        self.assertIn("zod", result.stdout)

    # sharp の linux 用バイナリなど、別プラットフォーム向けの optional は入らないのが普通
    def test_入っていない_optional_は無視する(self):
        (self.root / "package-lock.json").write_text(json.dumps(lock({
            "node_modules/@img/sharp-linux-arm64": entry("0.35.4", "@img/sharp-linux-arm64", optional=True),
        })))
        result = run("check-install", cwd=self.root)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


class LockDiffTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        for args in (["init", "-q"], ["config", "user.email", "t@example.com"], ["config", "user.name", "t"]):
            subprocess.run(["git", *args], cwd=self.root, check=True)

    def tearDown(self):
        self._tmp.cleanup()

    def commit_lock(self, data):
        (self.root / "package-lock.json").write_text(json.dumps(data))
        subprocess.run(["git", "add", "."], cwd=self.root, check=True)
        subprocess.run(["git", "commit", "-qm", "lock"], cwd=self.root, check=True)

    def base(self):
        return lock({
            "node_modules/next": entry("16.3.1", "next"),
            "node_modules/prisma": entry("7.9.1", "prisma", hasInstallScript=True),
            "node_modules/zod": entry("4.4.3", "zod"),
        }, root_deps={"next": "^16.3.1", "zod": "^4.4.3"}, root_dev={"prisma": "^7.9.1"})

    def test_レンジ内の更新だけなら通る(self):
        self.commit_lock(self.base())
        head = self.base()
        head["packages"]["node_modules/next"] = entry("16.3.5", "next")
        head["packages"]["node_modules/zod"] = entry("4.6.5", "zod")
        (self.root / "package-lock.json").write_text(json.dumps(head))
        result = run("lockdiff", "HEAD", cwd=self.root)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("16.3.1 → 16.3.5", result.stdout)

    def test_新しく_install_script_を持つパッケージが増えたら落ちる(self):
        self.commit_lock(self.base())
        head = self.base()
        head["packages"]["node_modules/evil"] = entry("1.0.0", "evil", hasInstallScript=True)
        (self.root / "package-lock.json").write_text(json.dumps(head))
        result = run("lockdiff", "HEAD", cwd=self.root)
        self.assertEqual(result.returncode, 1)
        self.assertRegex(result.stdout, r"install script.*evil")

    def test_既存のパッケージが_install_script_を持つようになったら落ちる(self):
        self.commit_lock(self.base())
        head = self.base()
        head["packages"]["node_modules/zod"] = entry("4.6.5", "zod", hasInstallScript=True)
        (self.root / "package-lock.json").write_text(json.dumps(head))
        result = run("lockdiff", "HEAD", cwd=self.root)
        self.assertEqual(result.returncode, 1)
        self.assertRegex(result.stdout, r"install script.*zod")

    def test_公式レジストリ以外から取るエントリがあれば落ちる(self):
        self.commit_lock(self.base())
        head = self.base()
        e = entry("4.6.5", "zod")
        e["resolved"] = "https://evil.example.com/zod-4.6.5.tgz"
        head["packages"]["node_modules/zod"] = e
        (self.root / "package-lock.json").write_text(json.dumps(head))
        result = run("lockdiff", "HEAD", cwd=self.root)
        self.assertEqual(result.returncode, 1)
        self.assertRegex(result.stdout, r"レジストリ.*zod")

    def test_integrity_が無いエントリがあれば落ちる(self):
        self.commit_lock(self.base())
        head = self.base()
        e = entry("4.6.5", "zod")
        del e["integrity"]
        head["packages"]["node_modules/zod"] = e
        (self.root / "package-lock.json").write_text(json.dumps(head))
        result = run("lockdiff", "HEAD", cwd=self.root)
        self.assertEqual(result.returncode, 1)
        self.assertRegex(result.stdout, r"integrity.*zod")

    # 直接の依存はレンジ内でも、推移的な依存が大きく動くことがある
    def test_推移的な依存のメジャーが上がったら落ちる(self):
        base = self.base()
        base["packages"]["node_modules/next/node_modules/deep"] = entry("1.2.0", "deep")
        self.commit_lock(base)
        head = json.loads(json.dumps(base))
        head["packages"]["node_modules/next/node_modules/deep"] = entry("2.0.0", "deep")
        (self.root / "package-lock.json").write_text(json.dumps(head))
        result = run("lockdiff", "HEAD", cwd=self.root)
        self.assertEqual(result.returncode, 1)
        self.assertRegex(result.stdout, r"メジャー.*deep.*1\.2\.0 → 2\.0\.0")

    # PR #158 の実データ: react 19.3 に連れられた scheduler 0.27 → 0.28 のような推移的な 0.x の
    # minor 更新は、親の指定範囲に従っている。要確認にすると正しい更新で毎回落ち、警告を
    # 読み飛ばす癖がつく
    def test_推移的な依存の_0x_minor_更新は一覧に出すだけ(self):
        base = self.base()
        base["packages"]["node_modules/scheduler"] = entry("0.27.0", "scheduler")
        self.commit_lock(base)
        head = json.loads(json.dumps(base))
        head["packages"]["node_modules/scheduler"] = entry("0.28.0", "scheduler")
        (self.root / "package-lock.json").write_text(json.dumps(head))
        result = run("lockdiff", "HEAD", cwd=self.root)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertRegex(result.stdout, r"0\.x の minor 更新（推移的）.*\n  scheduler: 0\.27\.0 → 0\.28\.0")

    # 直接の依存の 0.x は ^ でも minor を越えないので、越えているなら意図した破壊的更新
    def test_直接の依存の_0x_minor_更新は要確認(self):
        base = self.base()
        base["packages"]["node_modules/lucide-react"] = entry("0.553.0", "lucide-react")
        base["packages"][""]["dependencies"]["lucide-react"] = "^0.553.0"
        self.commit_lock(base)
        head = json.loads(json.dumps(base))
        head["packages"]["node_modules/lucide-react"] = entry("0.600.0", "lucide-react")
        head["packages"][""]["dependencies"]["lucide-react"] = "^0.600.0"
        (self.root / "package-lock.json").write_text(json.dumps(head))
        result = run("lockdiff", "HEAD", cwd=self.root)
        self.assertEqual(result.returncode, 1)
        self.assertRegex(result.stdout, r"メジャー.*lucide-react.*0\.553\.0 → 0\.600\.0")

    # メジャーを上げる PR では、狙ったパッケージのメジャーアップは意図どおり
    def test_allow_major_で狙ったメジャーアップは通す(self):
        self.commit_lock(self.base())
        head = self.base()
        head["packages"]["node_modules/prisma"] = entry("8.0.0", "prisma", hasInstallScript=True)
        head["packages"][""]["devDependencies"] = {"prisma": "^8.0.0"}
        (self.root / "package-lock.json").write_text(json.dumps(head))
        self.assertEqual(run("lockdiff", "HEAD", cwd=self.root).returncode, 1)
        result = run("lockdiff", "HEAD", "--allow-major", "prisma", cwd=self.root)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_追加と削除と直接の依存のレンジ変更を一覧にする(self):
        self.commit_lock(self.base())
        head = self.base()
        del head["packages"]["node_modules/zod"]
        head["packages"]["node_modules/confbox"] = entry("0.3.1", "confbox")
        head["packages"][""]["dependencies"] = {"next": "^16.3.5"}
        (self.root / "package-lock.json").write_text(json.dumps(head))
        result = run("lockdiff", "HEAD", cwd=self.root)
        self.assertIn("confbox", result.stdout)
        self.assertRegex(result.stdout, r"削除（1 件）\n  zod 4\.4\.3")
        self.assertIn("^16.3.1 → ^16.3.5", result.stdout)


class ClassifyTest(unittest.TestCase):
    """npm outdated の Latest 列に釣られないための判定。値は 2026-09 に実際に見たもの。"""

    def test_next_auth_は_Latest_列が現在より古い(self):
        notes = deps.classify(
            current="5.0.0-beta.32", wanted="5.0.0-beta.32", latest="4.24.15",
            versions=["4.24.15", "5.0.0-beta.30", "5.0.0-beta.32"],
        )
        self.assertIn("latest-behind", notes["flags"])
        self.assertIsNone(notes["newer_major"])

    def test_prisma_は_Latest_列が_prerelease(self):
        notes = deps.classify(
            current="7.10.0", wanted="7.10.0", latest="8.0.0-rc.15",
            versions=["7.9.1", "7.10.0", "8.0.0-rc.14", "8.0.0-rc.15"],
        )
        self.assertIn("latest-prerelease", notes["flags"])
        self.assertIsNone(notes["newer_major"])

    def test_types_node_は_Latest_列が古い系統で_新しいメジャーが別にある(self):
        notes = deps.classify(
            current="24.13.4", wanted="24.13.5", latest="22.20.3",
            versions=["22.20.3", "24.13.4", "24.13.5", "26.6.1"],
        )
        self.assertIn("latest-behind", notes["flags"])
        self.assertEqual(notes["newer_major"], "26.6.1")
        self.assertTrue(notes["in_range"])

    def test_素直なメジャーアップ(self):
        notes = deps.classify(
            current="5.11.1", wanted="5.11.1", latest="6.0.0",
            versions=["5.11.1", "6.0.0"],
        )
        self.assertEqual(notes["flags"], [])
        self.assertEqual(notes["newer_major"], "6.0.0")
        self.assertFalse(notes["in_range"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
