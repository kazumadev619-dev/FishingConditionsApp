"""deps.py のテスト。

実行: python3 .agents/skills/updating-dependencies/test_deps.py

ここに並ぶケースは、依存更新で実際に踏んだ罠を再現したもの（#110 / PR #158）。
"""

import json
import os
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


def run(*args, cwd, env=None):
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args], cwd=cwd, capture_output=True, text=True,
        env={**os.environ, **env} if env else None,
    )


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


class PlatformTest(unittest.TestCase):
    """Node と Python で綴りが違う（x86_64 → x64 など）。lock の cpu は Node の綴り。"""

    def test_アーキテクチャの綴りを_Node_に合わせる(self):
        self.assertEqual(deps.node_arch("x86_64"), "x64")
        self.assertEqual(deps.node_arch("AMD64"), "x64")
        self.assertEqual(deps.node_arch("aarch64"), "arm64")
        self.assertEqual(deps.node_arch("arm64"), "arm64")
        self.assertEqual(deps.node_arch("i686"), "ia32")

    def test_除外指定を読む(self):
        self.assertFalse(deps.runs_here({"os": ["!" + deps.node_platform()]}))
        self.assertTrue(deps.runs_here({"os": ["!plan9"]}))


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

    # workspace などの link は node_modules/<name>/package.json が実体ではない
    def test_link_のエントリは見ない(self):
        (self.root / "package-lock.json").write_text(json.dumps(lock({
            "node_modules/ws-a": {"resolved": "packages/ws-a", "link": True},
        })))
        result = run("check-install", cwd=self.root)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    # sharp の linux 用バイナリなど、別プラットフォーム向けの optional は入らないのが普通
    def test_別プラットフォーム向けの_optional_は無視する(self):
        (self.root / "package-lock.json").write_text(json.dumps(lock({
            "node_modules/@img/sharp-linux-arm64": entry(
                "0.35.4", "@img/sharp-linux-arm64", optional=True, os=["linux"], cpu=["arm64"],
            ),
        })))
        result = run("check-install", cwd=self.root)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    # この環境向けの optional が欠けていれば、npm ci が途中で失敗している
    def test_この環境向けの_optional_が欠けていれば落ちる(self):
        (self.root / "package-lock.json").write_text(json.dumps(lock({
            "node_modules/@tailwindcss/oxide-here": entry(
                "4.3.3", "@tailwindcss/oxide-here", optional=True,
                os=[deps.node_platform()], cpu=[deps.node_arch()],
            ),
        })))
        result = run("check-install", cwd=self.root)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("oxide-here", result.stdout)

    # os も cpu も無い optional は、プラットフォーム固定の親の依存であることが多く
    # （子は親の os/cpu を継承しない）、親ごと入らないのが正しい。npm 11.19.0 は
    # @img/sharp-wasm32 と @emnapi/runtime を入れないので、必須にすると誤検知になる
    def test_os_も_cpu_も無い_optional_は無視する(self):
        (self.root / "package-lock.json").write_text(json.dumps(lock({
            "node_modules/@img/sharp-wasm32": entry("0.35.4", "@img/sharp-wasm32", optional=True),
        })))
        self.assertEqual(run("check-install", cwd=self.root).returncode, 0)

    # libc の指定は判定できないことがあるので、欠けていても言わない
    def test_この環境と違う_cpu_向けの_optional_は無視する(self):
        other = "ia32" if deps.node_arch() != "ia32" else "arm64"
        (self.root / "package-lock.json").write_text(json.dumps(lock({
            "node_modules/other-cpu": entry(
                "1.0.0", "other-cpu", optional=True, os=[deps.node_platform()], cpu=[other],
            ),
        })))
        self.assertEqual(run("check-install", cwd=self.root).returncode, 0)

    def test_libc_の指定がある_optional_は無視する(self):
        (self.root / "package-lock.json").write_text(json.dumps(lock({
            "node_modules/musl-only": entry(
                "1.0.0", "musl-only", optional=True,
                os=[deps.node_platform()], cpu=[deps.node_arch()], libc=["musl"],
            ),
        })))
        self.assertEqual(run("check-install", cwd=self.root).returncode, 0)

    def test_lock_に無いパッケージが入っていれば落ちる(self):
        (self.root / "package-lock.json").write_text(json.dumps(lock({
            "node_modules/zod": entry("4.6.5", "zod"),
        })))
        self.install("node_modules/zod", "4.6.5")
        self.install("node_modules/not-in-lock", "1.0.0")
        self.install("node_modules/@scope/also-extra", "2.0.0")
        self.install("node_modules/zod/node_modules/nested-extra", "3.0.0")
        result = run("check-install", cwd=self.root)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        for name in ("not-in-lock", "@scope/also-extra", "nested-extra"):
            self.assertIn(name, result.stdout)

    def test_bin_や_package_lock_の隠しファイルは余分としない(self):
        (self.root / "package-lock.json").write_text(json.dumps(lock({
            "node_modules/zod": entry("4.6.5", "zod"),
        })))
        self.install("node_modules/zod", "4.6.5")
        (self.root / "node_modules" / ".bin").mkdir(parents=True)
        (self.root / "node_modules" / ".package-lock.json").write_text("{}")
        (self.root / "node_modules" / ".cache").mkdir()
        # pnpm の store のような、隠しディレクトリの下にパッケージがある形
        self.install("node_modules/.pnpm/node_modules/ghost", "1.0.0")
        result = run("check-install", cwd=self.root)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    # npm は node_modules/<name> を packages/<name> への symlink にする。その先の
    # node_modules は lock では packages/... のキーになるので、辿ると名前が合わない
    def test_workspace_の_symlink_の先は辿らない(self):
        (self.root / "package-lock.json").write_text(json.dumps(lock({
            "node_modules/ws-a": {"resolved": "packages/ws-a", "link": True},
            "packages/ws-a": {"name": "ws-a", "version": "1.0.0"},
            "packages/ws-a/node_modules/dep": entry("1.0.0", "dep"),
        })))
        self.install("packages/ws-a", "1.0.0")
        self.install("packages/ws-a/node_modules/dep", "1.0.0")
        (self.root / "node_modules").mkdir(exist_ok=True)
        (self.root / "node_modules" / "ws-a").symlink_to(self.root / "packages" / "ws-a")
        result = run("check-install", cwd=self.root)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    # 抽出が途中で止まった残骸や .vite のような作業用ディレクトリを拾わないため、
    # package.json が無いディレクトリは数えない
    def test_package_json_が無いディレクトリは余分としない(self):
        (self.root / "package-lock.json").write_text(json.dumps(lock({})))
        (self.root / "node_modules" / "half-extracted" / "lib").mkdir(parents=True)
        self.assertEqual(run("check-install", cwd=self.root).returncode, 0)

    def test_壊れた_package_json_は_traceback_にせず出す(self):
        (self.root / "package-lock.json").write_text(json.dumps(lock({
            "node_modules/zod": entry("4.6.5", "zod"),
        })))
        (self.root / "node_modules" / "zod").mkdir(parents=True)
        (self.root / "node_modules" / "zod" / "package.json").write_text('{"version": ')
        result = run("check-install", cwd=self.root)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("package.json を読めない", result.stdout)
        self.assertNotIn("Traceback", result.stderr)


class LockRepoCase(unittest.TestCase):
    """一時ディレクトリの git リポジトリに base の lock をコミットして比べる。"""

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


class LockDiffTest(LockRepoCase):
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


class LockDiffSupplyChainTest(LockRepoCase):
    """レビュー（PR #174）で見つかった見逃しと誤検知。"""

    def write_head(self, head):
        (self.root / "package-lock.json").write_text(json.dumps(head))

    # 版を変えずに resolved と integrity を別パッケージのものにすると、npm ci は別物を入れる
    def test_同じ版のまま取得元が別パッケージに変わったら落ちる(self):
        self.commit_lock(self.base())
        head = self.base()
        head["packages"]["node_modules/zod"]["resolved"] = "https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz"
        head["packages"]["node_modules/zod"]["integrity"] = "sha512-BBBB"
        self.write_head(head)
        result = run("lockdiff", "HEAD", cwd=self.root)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertRegex(result.stdout, r"要確認.*\n.*zod")

    def test_同じ版のまま_integrity_だけ変わったら落ちる(self):
        self.commit_lock(self.base())
        head = self.base()
        head["packages"]["node_modules/zod"]["integrity"] = "sha512-BBBB"
        self.write_head(head)
        result = run("lockdiff", "HEAD", cwd=self.root)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertRegex(result.stdout, r"integrity が変わった.*zod")

    def test_resolved_の_URL_が名前と版に合わなければ落ちる(self):
        self.commit_lock(self.base())
        head = self.base()
        head["packages"]["node_modules/next"] = entry("16.3.5", "next")
        head["packages"]["node_modules/next"]["resolved"] = "https://registry.npmjs.org/next-evil/-/next-evil-16.3.5.tgz"
        self.write_head(head)
        result = run("lockdiff", "HEAD", cwd=self.root)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertRegex(result.stdout, r"名前か版と合わない.*next")

    def test_npm_の別名は_name_で_URL_を照らし合わせる(self):
        self.commit_lock(self.base())
        head = self.base()
        alias = entry("4.2.3", "string-width")
        alias["name"] = "string-width"
        head["packages"]["node_modules/string-width-cjs"] = alias
        self.write_head(head)
        result = run("lockdiff", "HEAD", cwd=self.root)
        self.assertEqual(result.returncode, 0, result.stdout)

    # 他の依存元が旧メジャーを使い続けていると、新メジャーはネストして「追加」になる
    def test_推移的な新メジャーがネストして追加されたら落ちる(self):
        base = self.base()
        base["packages"]["node_modules/tinyexec"] = entry("1.3.0", "tinyexec")
        self.commit_lock(base)
        head = json.loads(json.dumps(base))
        head["packages"]["node_modules/next/node_modules/tinyexec"] = entry("2.0.0", "tinyexec")
        self.write_head(head)
        result = run("lockdiff", "HEAD", cwd=self.root)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertRegex(result.stdout, r"メジャー.*tinyexec.*1\.3\.0 → 2\.0\.0")

    # PR #158 の実データ: pkg-types が confbox を ^0.3.1 に上げ、c12 用の 0.2.4 はトップに残った
    def test_推移的な_0x_minor_がネストして追加されたら一覧に出す(self):
        base = self.base()
        base["packages"]["node_modules/confbox"] = entry("0.2.4", "confbox")
        self.commit_lock(base)
        head = json.loads(json.dumps(base))
        head["packages"]["node_modules/pkg-types/node_modules/confbox"] = entry("0.3.1", "confbox")
        self.write_head(head)
        result = run("lockdiff", "HEAD", cwd=self.root)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertRegex(result.stdout, r"0\.x の minor 更新（推移的）.*\n  confbox: 0\.2\.4 → 0\.3\.1")

    def test_同じメジャーが既にあるパッケージのネスト追加は通す(self):
        base = self.base()
        base["packages"]["node_modules/tinyexec"] = entry("1.3.0", "tinyexec")
        self.commit_lock(base)
        head = json.loads(json.dumps(base))
        head["packages"]["node_modules/next/node_modules/tinyexec"] = entry("1.1.0", "tinyexec")
        self.write_head(head)
        self.assertEqual(run("lockdiff", "HEAD", cwd=self.root).returncode, 0)

    def test_旧版のどれかと互換なネスト追加は通す(self):
        base = self.base()
        base["packages"]["node_modules/tinyexec"] = entry("3.0.0", "tinyexec")
        base["packages"]["node_modules/next/node_modules/tinyexec"] = entry("2.0.0", "tinyexec")
        self.commit_lock(base)
        head = json.loads(json.dumps(base))
        head["packages"]["node_modules/zod/node_modules/tinyexec"] = entry("2.1.0", "tinyexec")
        self.write_head(head)
        self.assertEqual(run("lockdiff", "HEAD", cwd=self.root).returncode, 0)

    # 変わっていないエントリは base の時点で受け入れている。bundled / file / git の形で毎回落ちないように
    def test_変わっていないエントリの_integrity_欠落やレジストリ外は問わない(self):
        base = self.base()
        base["packages"]["node_modules/localdir"] = {"version": "1.0.0", "resolved": "file:localdir"}
        base["packages"]["node_modules/npm/node_modules/abbrev"] = {"version": "3.0.1", "inBundle": True}
        self.commit_lock(base)
        self.write_head(base)
        result = run("lockdiff", "HEAD", cwd=self.root)
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_bundle_の中身は_integrity_が無くても問わない(self):
        self.commit_lock(self.base())
        head = self.base()
        head["packages"]["node_modules/npm/node_modules/abbrev"] = {"version": "3.0.1", "inBundle": True}
        self.write_head(head)
        self.assertEqual(run("lockdiff", "HEAD", cwd=self.root).returncode, 0)

    def test_install_script_を持つ同じ版が場所を移っただけなら通す(self):
        self.commit_lock(self.base())
        head = self.base()
        head["packages"]["node_modules/next/node_modules/prisma"] = head["packages"].pop("node_modules/prisma")
        self.write_head(head)
        result = run("lockdiff", "HEAD", cwd=self.root)
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_直接の依存が後退したら落ちる(self):
        self.commit_lock(self.base())
        head = self.base()
        head["packages"]["node_modules/next"] = entry("16.3.0", "next")
        self.write_head(head)
        result = run("lockdiff", "HEAD", cwd=self.root)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertRegex(result.stdout, r"後退.*next.*16\.3\.1 → 16\.3\.0")

    def test_直接の依存が_prerelease_になったら落ちる(self):
        self.commit_lock(self.base())
        head = self.base()
        head["packages"]["node_modules/next"] = entry("16.4.0-canary.3", "next")
        self.write_head(head)
        result = run("lockdiff", "HEAD", cwd=self.root)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertRegex(result.stdout, r"prerelease.*next")

    def test_推移的な依存の後退は問わない(self):
        base = self.base()
        base["packages"]["node_modules/next/node_modules/deep"] = entry("1.2.0", "deep")
        self.commit_lock(base)
        head = json.loads(json.dumps(base))
        head["packages"]["node_modules/next/node_modules/deep"] = entry("1.1.0", "deep")
        self.write_head(head)
        self.assertEqual(run("lockdiff", "HEAD", cwd=self.root).returncode, 0)

    # 直接の依存と同じ名前でも、ネストした場所のものは推移的
    def test_直接の依存と同名でもネストしたものは推移的に扱う(self):
        base = self.base()
        base["packages"]["node_modules/next/node_modules/zod"] = entry("0.5.0", "zod")
        self.commit_lock(base)
        head = json.loads(json.dumps(base))
        head["packages"]["node_modules/next/node_modules/zod"] = entry("0.6.0", "zod")
        self.write_head(head)
        result = run("lockdiff", "HEAD", cwd=self.root)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("zod: 0.5.0 → 0.6.0", result.stdout)

    def test_link_のエントリは見ない(self):
        self.commit_lock(self.base())
        head = self.base()
        head["packages"]["node_modules/ws-a"] = {"resolved": "packages/ws-a", "link": True}
        self.write_head(head)
        self.assertEqual(run("lockdiff", "HEAD", cwd=self.root).returncode, 0)

    def test_比べる_ref_が無ければ終了コード_2(self):
        self.commit_lock(self.base())
        result = run("lockdiff", "no-such-ref", cwd=self.root)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)

    def test_lockfileVersion_1_は終了コード_2(self):
        old = self.base()
        old["lockfileVersion"] = 1
        self.commit_lock(old)
        result = run("lockdiff", "HEAD", cwd=self.root)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("lockfileVersion", result.stderr)


FAKE_NPM = """#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
if args[:1] == ["outdated"]:
    print(os.environ["FAKE_OUTDATED"])
    sys.exit(1)
if args[:1] == ["view"]:
    print(json.dumps(json.loads(os.environ["FAKE_VIEW"])[args[1]]))
    sys.exit(0)
sys.exit(3)
"""


class OutdatedTest(unittest.TestCase):
    """PATH に偽の npm を置いて cmd_outdated を通す。"""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name) / "app"
        self.bin = Path(self._tmp.name) / "bin"
        self.root.mkdir()
        self.bin.mkdir()
        npm = self.bin / "npm"
        npm.write_text(FAKE_NPM)
        npm.chmod(0o755)
        (self.root / "package-lock.json").write_text(json.dumps(lock({
            "node_modules/next-auth": entry("5.0.0-beta.32", "next-auth"),
        })))
        d = self.root / "node_modules" / "next-auth"
        d.mkdir(parents=True)
        (d / "package.json").write_text(json.dumps({"version": "5.0.0-beta.32"}))

    def tearDown(self):
        self._tmp.cleanup()

    def outdated(self, outdated, view=None):
        env = {
            "PATH": f"{self.bin}{os.pathsep}{os.environ['PATH']}",
            "FAKE_OUTDATED": json.dumps(outdated),
            "FAKE_VIEW": json.dumps(view or {}),
        }
        return run("outdated", cwd=self.root, env=env)

    def test_罠があっても終了コード_0(self):
        result = self.outdated(
            {"next-auth": {"current": "5.0.0-beta.32", "wanted": "5.0.0-beta.32", "latest": "4.24.15"}},
            {"next-auth": ["4.24.15", "5.0.0-beta.32"]},
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertRegex(result.stdout, r"Latest 列を信じてはいけない.*\n  next-auth")

    def test_node_modules_が_lock_と違えば_npm_を呼ばずに終了コード_2(self):
        (self.root / "node_modules" / "next-auth" / "package.json").write_text(json.dumps({"version": "4.24.15"}))
        result = self.outdated({"next-auth": {"current": "4.24.15", "wanted": "4.24.15", "latest": "4.24.15"}})
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertNotIn("npm outdated:", result.stdout)

    # レジストリに届かないと npm outdated --json は {"error": {...}} を返す
    def test_npm_がエラーを返したら終了コード_2(self):
        result = self.outdated({"error": {"code": "ECONNREFUSED", "summary": "request to http://127.0.0.1:9/ failed"}})
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("ECONNREFUSED", result.stderr)

    def test_npm_view_がエラーを返したら終了コード_2(self):
        result = self.outdated(
            {"next-auth": {"current": "5.0.0-beta.32", "wanted": "5.0.0-beta.32", "latest": "4.24.15"}},
            {"next-auth": {"error": {"code": "E404", "summary": "Not Found"}}},
        )
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("E404", result.stderr)

    # package.json にあって lock に無い依存は Current が無い
    def test_入っていない依存があれば終了コード_2(self):
        result = self.outdated({"left-pad": {"wanted": "1.3.0", "latest": "1.3.0"}}, {"left-pad": ["1.3.0"]})
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("left-pad", result.stdout)


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
