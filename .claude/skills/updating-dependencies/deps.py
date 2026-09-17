#!/usr/bin/env python3
"""依存更新で実際に踏んだ罠を、機械的に見つけるスクリプト。

    deps.py check-install              入っている版が package-lock.json と一致するか
    deps.py outdated                   npm outdated を、Latest 列の罠を踏まない形で読む
    deps.py lockdiff <base-ref> [--allow-major NAME ...]
                                       package-lock.json の差分を検査する

終了コード: 0 問題なし / 1 要確認がある / 2 前提が満たされていない
（outdated は調べるためのコマンドなので、前提が満たされていれば常に 0）

標準ライブラリだけで動く。
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

EXIT_OK = 0
EXIT_ATTENTION = 1
EXIT_PRECONDITION = 2

REGISTRY = "https://registry.npmjs.org/"
MAX_LIST = 20


# ---------------------------------------------------------------- semver

_VERSION_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$")


def parse(version: str) -> Tuple:
    """比較できる形にする。prerelease は正式版より小さい。"""
    m = _VERSION_RE.match(version.strip())
    if not m:
        return (0, 0, 0, 0, ())
    major, minor, patch, pre = int(m.group(1)), int(m.group(2)), int(m.group(3)), m.group(4)
    if pre is None:
        return (major, minor, patch, 1, ())
    ids = tuple((0, int(x), "") if x.isdigit() else (1, 0, x) for x in pre.split("."))
    return (major, minor, patch, 0, ids)


def is_prerelease(version: str) -> bool:
    return parse(version)[3] == 0


def breaking(old: str, new: str) -> bool:
    """壊れうる更新か。0.x は minor が上がると壊れうる（npm の ^ と同じ扱い）。"""
    a, b = parse(old), parse(new)
    if a[0] != b[0]:
        return True
    return a[0] == 0 and a[1] != b[1]


def major_changed(old: str, new: str) -> bool:
    return parse(old)[0] != parse(new)[0]


# ---------------------------------------------------------------- helpers

def package_name(path: str) -> str:
    """lock のキー（node_modules/a/node_modules/@b/c）からパッケージ名を取り出す。"""
    return path.rsplit("node_modules/", 1)[-1]


class PreconditionError(Exception):
    """前提が満たされていない。main が終了コード 2 にする。"""


def load_lock(text: str) -> dict:
    data = json.loads(text)
    if data.get("lockfileVersion", 0) < 2 or "packages" not in data:
        raise PreconditionError("lockfileVersion 2 以上の package-lock.json が必要")
    return data


def print_list(title: str, items: List[str]) -> None:
    if not items:
        return
    print(f"\n{title}（{len(items)} 件）")
    for item in items[:MAX_LIST]:
        print(f"  {item}")
    if len(items) > MAX_LIST:
        print(f"  … ほか {len(items) - MAX_LIST} 件")


# ---------------------------------------------------------------- check-install

def install_drift(root: Path) -> List[str]:
    lock = load_lock((root / "package-lock.json").read_text())
    drift = []
    for path, meta in lock["packages"].items():
        if not path or meta.get("link"):
            continue
        manifest = root / path / "package.json"
        if not manifest.is_file():
            # 別プラットフォーム向けの optional（sharp の linux 用など）は入らないのが普通
            if meta.get("optional"):
                continue
            drift.append(f"{package_name(path)}: 入っていない（lock は {meta.get('version')}）  [{path}]")
            continue
        installed = json.loads(manifest.read_text()).get("version")
        if installed != meta.get("version"):
            drift.append(f"{package_name(path)}: 入っているのは {installed}、lock は {meta.get('version')}  [{path}]")
    return drift


def cmd_check_install(root: Path) -> int:
    drift = install_drift(root)
    if not drift:
        print("node_modules は package-lock.json どおり")
        return EXIT_OK
    print_list("node_modules が package-lock.json と違う", drift)
    print("\nnpm ci を流してから続けること。lock ファイル同士を比べても、この食い違いは分からない"
          "（別ブランチで npm ci したまま切り替えると起きる）")
    return EXIT_ATTENTION


# ---------------------------------------------------------------- outdated

def classify(current: str, wanted: str, latest: str, versions: List[str]) -> dict:
    """npm outdated の1行を、Latest 列に釣られない形で読む。"""
    flags = []
    if latest and parse(latest) < parse(current):
        flags.append("latest-behind")
    if latest and is_prerelease(latest):
        flags.append("latest-prerelease")
    stable = [v for v in versions if not is_prerelease(v)]
    newest = max(stable, key=parse) if stable else None
    newer_major = None
    if newest and parse(newest) > parse(current) and breaking(current, newest):
        newer_major = newest
    return {
        "flags": flags,
        "newer_major": newer_major,
        "in_range": bool(wanted) and parse(wanted) > parse(current),
        "wanted": wanted,
    }


FLAG_TEXT = {
    "latest-behind": "Latest 列が今より古い（dist-tag の latest が別の系統に付いている）。Latest に合わせると下がる",
    "latest-prerelease": "Latest 列が prerelease。安定版ではない",
}


def npm_json(args: List[str], root: Path) -> dict:
    out = subprocess.run(["npm", *args, "--json"], cwd=root, capture_output=True, text=True)
    # npm outdated は古いものがあると exit 1 を返すので、終了コードでは判断しない
    try:
        data = json.loads(out.stdout or "{}")
    except json.JSONDecodeError:
        raise PreconditionError(f"npm {' '.join(args)} の出力を読めない:\n{out.stderr[-500:]}")
    # レジストリに届かないときなどは {"error": {"code": ..., "summary": ...}} が返る
    error = data.get("error") if isinstance(data, dict) else None
    if isinstance(error, dict):
        raise PreconditionError(f"npm {' '.join(args)} が失敗した: {error.get('code')} {error.get('summary', '')}".rstrip())
    return data


def cmd_outdated(root: Path) -> int:
    drift = install_drift(root)
    if drift:
        print_list("node_modules が package-lock.json と違う", drift)
        print("\nこの状態の npm outdated は Current 列が実際の lock とずれる。npm ci を流してから実行すること")
        return EXIT_PRECONDITION

    outdated = npm_json(["outdated"], root)
    missing = [f"{name}: package.json は {info.get('wanted')} を求めている"
               for name, info in sorted(outdated.items()) if not info.get("current")]
    if missing:
        print_list("入っていない依存（package.json にあって lock に無い）", missing)
        print("\nnpm install で lock を更新してから実行すること")
        return EXIT_PRECONDITION

    rows = []
    for name, info in sorted(outdated.items()):
        versions = npm_json(["view", name, "versions"], root)
        if isinstance(versions, str):
            versions = [versions]
        rows.append((name, info, classify(info.get("current", ""), info.get("wanted", ""),
                                          info.get("latest", ""), versions)))

    in_range = [f"{n}: {i['current']} → {c['wanted']}" for n, i, c in rows if c["in_range"]]
    majors = [f"{n}: {i['current']} → {c['newer_major']}" for n, i, c in rows if c["newer_major"]]
    traps = [f"{n}: Current {i['current']} / Latest {i.get('latest')} — " + "。".join(FLAG_TEXT[f] for f in c["flags"])
             for n, i, c in rows if c["flags"]]

    print(f"npm outdated: {len(rows)} 件")
    print_list("レンジ内で上げられる（npm update）", in_range)
    print_list("新しいメジャーがある（1件ずつ PR にする）", majors)
    print_list("Latest 列を信じてはいけない", traps)
    # 調べるためのコマンドなので、罠があっても 0 にする（next-auth の beta のように
    # ずっと出続ける罠で毎回落ちると、後続のコマンドにつなげられない）
    return EXIT_OK


# ---------------------------------------------------------------- lockdiff

def registry_url(name: str, version: str) -> str:
    return f"{REGISTRY}{name}/-/{name.split('/')[-1]}-{version}.tgz"


def cmd_lockdiff(root: Path, base_ref: str, allow_major: List[str]) -> int:
    shown = subprocess.run(["git", "show", f"{base_ref}:package-lock.json"],
                           cwd=root, capture_output=True, text=True)
    if shown.returncode != 0:
        print(f"{base_ref} の package-lock.json を読めない: {shown.stderr.strip()}")
        return EXIT_PRECONDITION
    old = load_lock(shown.stdout)["packages"]
    new = load_lock((root / "package-lock.json").read_text())["packages"]

    added, removed, changed, zero_minor = [], [], [], []
    attention: List[str] = []
    root_meta = new.get("", {})
    direct_names = set()
    for field in ("dependencies", "devDependencies", "optionalDependencies"):
        direct_names |= set(root_meta.get(field, {}))

    # 別の場所にある同じパッケージ（npm の別名は name が実体の名前）
    old_by_name: Dict[str, List[dict]] = {}
    for path, meta in old.items():
        if path and not meta.get("link"):
            old_by_name.setdefault(meta.get("name") or package_name(path), []).append(meta)

    for path in sorted(set(new) - set(old)):
        if path:
            added.append(f"{package_name(path)} {new[path].get('version')}  [{path}]")
    for path in sorted(set(old) - set(new)):
        if path:
            removed.append(f"{package_name(path)} {old[path].get('version')}  [{path}]")

    def judge(name: str, old_v: str, new_v: str, path: str, where: str = "") -> None:
        is_direct = path == f"node_modules/{name}" and name in direct_names
        if name in allow_major:
            return
        if major_changed(old_v, new_v):
            attention.append(f"メジャー（壊れうる）更新{where}: {name} {old_v} → {new_v}  [{path}]")
        elif breaking(old_v, new_v):
            # 0.x の minor。直接の依存なら ^ でも越えないので意図した破壊的更新。
            # 推移的なものは親の指定範囲に従っているので、一覧に出すだけにする
            if is_direct:
                attention.append(f"メジャー（壊れうる）更新{where}: {name} {old_v} → {new_v}  [{path}]")
            else:
                zero_minor.append(f"{name}: {old_v} → {new_v}  [{path}]")
        elif is_direct and parse(new_v) < parse(old_v):
            attention.append(f"直接の依存が後退した: {name} {old_v} → {new_v}  [{path}]")
        elif is_direct and is_prerelease(new_v) and not is_prerelease(old_v):
            attention.append(f"直接の依存が prerelease になった: {name} {old_v} → {new_v}  [{path}]")

    for path in sorted(new):
        if not path:
            continue
        meta = new[path]
        # link は実体が別の場所、inBundle は親の tarball に入っていて resolved も integrity も持たない
        if meta.get("link") or meta.get("inBundle"):
            continue
        name = package_name(path)
        real_name = meta.get("name") or name
        version = meta.get("version", "")
        before = old.get(path)
        if before is not None and all(before.get(k) == meta.get(k)
                                      for k in ("version", "resolved", "integrity", "hasInstallScript")):
            continue  # base の時点で受け入れている

        # 場所が移っただけ・版を上げただけのものは増えたとみなさない（同じパッケージが前から持っていた）
        had_script = any(m.get("hasInstallScript") for m in old_by_name.get(real_name, []))
        if meta.get("hasInstallScript") and not had_script:
            attention.append(f"install script を持つパッケージが増えた: {name} {version}  [{path}]")
        resolved = meta.get("resolved")
        if resolved and not resolved.startswith(REGISTRY):
            attention.append(f"公式レジストリ以外から取る: {name} {resolved}  [{path}]")
        elif resolved and resolved != registry_url(real_name, version):
            # 公式レジストリ上の別パッケージを指すように書き換えられると、npm ci はそれを入れる
            attention.append(f"resolved の URL が名前か版と合わない: {name} {version} {resolved}  [{path}]")
        if "integrity" not in meta:
            attention.append(f"integrity が無い: {name} {version}  [{path}]")

        # 版が同じなら resolved の URL は1つに決まるので、書き換えは上の2つで捕まる。integrity は別に見る
        if before is not None and before.get("version") == version:
            if before.get("integrity") != meta.get("integrity"):
                attention.append(f"版が同じなのに integrity が変わった: {name} {version}  [{path}]")
        elif before is not None:
            old_v = before.get("version", "")
            changed.append(f"{name}: {old_v} → {version}  [{path}]")
            judge(name, old_v, version, path)
        else:
            # 他の依存元が旧版を使い続けていると、新しい版はネストした場所に「追加」される。
            # 同じパッケージの旧版のどれとも互換でなければ、その版からの更新として扱う
            siblings = [m.get("version", "") for m in old_by_name.get(real_name, [])]
            if siblings and all(breaking(v, version) for v in siblings):
                judge(name, max(siblings, key=parse), version, path, where="（新しい場所に入った）")

    direct = []
    for field in ("dependencies", "devDependencies", "optionalDependencies"):
        a, b = old.get("", {}).get(field, {}), new.get("", {}).get(field, {})
        for dep in sorted(set(a) | set(b)):
            if a.get(dep) != b.get(dep):
                direct.append(f"{dep}: {a.get(dep, '（無し）')} → {b.get(dep, '（無し）')}  ({field})")

    print(f"{base_ref} と作業ツリーの package-lock.json を比べた")
    print_list("直接の依存のレンジ", direct)
    print_list("版が変わった", changed)
    print_list("0.x の minor 更新（推移的）。親の指定範囲に従った更新なので要確認にはしない", zero_minor)
    print_list("追加", added)
    print_list("削除", removed)
    print_list("要確認", attention)
    if not attention:
        print("\n要確認なし")
        return EXIT_OK
    return EXIT_ATTENTION


# ---------------------------------------------------------------- main

def main(argv: List[str]) -> int:
    try:
        return dispatch(argv)
    except PreconditionError as error:
        print(error, file=sys.stderr)
        return EXIT_PRECONDITION


def dispatch(argv: List[str]) -> int:
    root = Path.cwd()
    if argv[:1] == ["check-install"]:
        return cmd_check_install(root)
    if argv[:1] == ["outdated"]:
        return cmd_outdated(root)
    if argv[:1] == ["lockdiff"] and len(argv) >= 2:
        allow = []
        rest = argv[2:]
        while rest:
            if rest[0] == "--allow-major" and len(rest) >= 2:
                allow.append(rest[1])
                rest = rest[2:]
            else:
                print(f"知らない引数: {rest[0]}", file=sys.stderr)
                return EXIT_PRECONDITION
        return cmd_lockdiff(root, argv[1], allow)
    print(__doc__, file=sys.stderr)
    return EXIT_PRECONDITION


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
