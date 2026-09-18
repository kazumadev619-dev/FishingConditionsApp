#!/usr/bin/env python3
"""秘密の値を会話ログに出すツール呼び出しを止める PreToolUse hook。

.claude/settings.json から Bash / Read / Grep の直前に呼ばれる。stdin に hook の入力（JSON）を受け取り、
止めるときは理由を stderr に書いて終了コード 2 を返す。Claude Code はツールを実行せず、理由を Claude に渡す。
サブエージェントのツール呼び出しにも同じ hook がかかる。

うっかり出すのを防ぐための網であって、境界ではない。シェルを完全には解釈しないので、
書き方を変えれば通り抜けられる（別名でコピーしてから読む、スクリプトファイルの中で出力する、など）。
止められたら迂回せず、値を出さない方法に切り替えること。

テスト: python3 .claude/hooks/test_secret_guard.py
"""

import fnmatch
import glob as globlib
import json
import os
import re
import shlex
import sys
from typing import List, Optional, Set, Tuple

MAX_DEPTH = 5
OPERATOR_CHARS = ";&|()<>\n"
ASSIGNMENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")

# ---------------------------------------------------------------------------
# 秘密のファイルと変数

SAFE_ENV_SUFFIX = re.compile(r"\.(example|sample|template|dist)$")
KEY_SUFFIXES = (".key", ".pem", ".p12", ".pfx", ".agekey")
SSH_PRIVATE_KEY = re.compile(r"^id_(rsa|dsa|ecdsa|ed25519)(_sk)?$|_rsa$")
# sops で暗号化する前の平文。.sops.yaml の path_regex と .gitignore の k8s/**/*secret*.y*ml に合わせる
PLAIN_K8S_SECRET = re.compile(r"secret[^/]*\.ya?ml$", re.IGNORECASE)
SECRET_PATH_SUFFIXES = (
    "rancher/k3s/k3s.yaml", "sops/age/keys.txt", "gh/hosts.yml",
    ".docker/config.json", ".aws/credentials", ".aws/config",
)
SECRET_BASENAMES = (".npmrc", ".netrc", "_netrc", ".pgpass", "credentials")
# 中に鍵やトークンが入るディレクトリ。Read や Grep はディレクトリごと読める
SECRET_DIRECTORIES = (".ssh", ".kube", ".gnupg", "age")
# ~/.kube/ の下は config 以外の名前の接続ファイルもある（fishing-ci.yaml など）。cache は API の一覧だけ
KUBE_DIR = re.compile(r"(^|/)\.kube/(?!cache/|http-cache/)")
KUBECONFIG_EXTENSIONS = ("", ".yaml", ".yml", ".conf", ".json")

SECRET_VAR = re.compile(r"SECRET|PASSWORD|PASSWD|TOKEN|API_KEY|APIKEY|PRIVATE_KEY|CREDENTIAL|DATABASE_URL|REDIS_URL")


def is_secret_file(path: str) -> bool:
    p = path.strip().rstrip("/")
    if not p:
        return False
    base = p.rsplit("/", 1)[-1]
    if base == ".env" or (base.startswith(".env.") and not SAFE_ENV_SUFFIX.search(base)):
        return True
    if base.endswith(KEY_SUFFIXES) or SSH_PRIVATE_KEY.search(base) or base in SECRET_BASENAMES:
        return True
    stem, extension = os.path.splitext(base.lower())
    if "kubeconfig" in stem and extension in KUBECONFIG_EXTENSIONS:
        return True
    if KUBE_DIR.search(p):
        return True
    if PLAIN_K8S_SECRET.search(base) and ".enc." not in base:
        return True
    return p.endswith(SECRET_PATH_SUFFIXES)


def is_secret_directory(path: str) -> bool:
    p = path.strip().rstrip("/")
    return bool(p) and (p.rsplit("/", 1)[-1] in SECRET_DIRECTORIES or p.endswith("sops/age"))


def secret_files_in(tokens: List[str], cwd: Optional[str]) -> List[str]:
    """引数のうち秘密のファイルを指すもの。グロブは cwd で展開して調べる。"""
    found = []
    for token in tokens:
        if cwd is not None and any(ch in token for ch in "*?["):
            # シェルと同じく * はドットファイルに当たらない（glob も同じ）
            pattern = os.path.expanduser(token)
            if not os.path.isabs(pattern):
                pattern = os.path.join(cwd, pattern)
            try:
                candidates = globlib.glob(pattern)
            except re.error:
                # `[g-c]` のような範囲は Python 3.9 の fnmatch が正規表現にできない。展開せず字面で判定する
                candidates = [token]
        else:
            candidates = [token]
        found.extend(c for c in candidates if is_secret_file(c))
    return found


SECRET_GLOB_SAMPLES = (
    ".env", ".env.local", ".env.production.local", "id_rsa", "id_ed25519",
    "server.key", "tls.pem", "kubeconfig", "secret.yaml",
)


def glob_hits_secret(pattern: str, samples=SECRET_GLOB_SAMPLES) -> bool:
    """グロブが秘密のファイル名に当たりうるか。展開せずに名前だけで見る。"""
    base = pattern.rsplit("/", 1)[-1]
    if not base:
        return False
    if is_secret_file(base):
        return True
    try:
        return any(fnmatch.fnmatchcase(sample, base) for sample in samples)
    except re.error:
        # `[g-c]` のような範囲は Python 3.9 の fnmatch が正規表現にできない
        return False


def secret_expansion(token: str) -> Optional[str]:
    """`$NAME` / `${NAME}` で秘密らしい変数を展開していれば、その名前。

    `${NAME:+set}` と `${#NAME}` は値そのものを出さないので除く。
    """
    for m in re.finditer(r"\$(\{)?(#)?([A-Za-z_][A-Za-z0-9_]*)(:?\+)?", token):
        brace, length, name, plus = m.groups()
        if length or (brace and plus):
            continue
        if SECRET_VAR.search(name):
            return name
    return None


# ---------------------------------------------------------------------------
# シェルのコマンド文字列を、判定できる単位まで分ける


class SimpleCommand:
    def __init__(self) -> None:
        self.args: List[str] = []
        self.inputs: List[str] = []  # `<` で読ませるファイル
        self.stdout_discarded = False  # `>/dev/null` / `&>/dev/null`
        self.here_strings: List[str] = []  # `<<<` の右辺（ファイルではなく文字列）


HEREDOC = re.compile(r"(?<!<)<<(-?)[ \t]*(?:'([^'\n]+)'|\"([^\"\n]+)\"|(\\?)([A-Za-z_][\w.-]*))")


def strip_heredocs(command: str) -> Tuple[str, List[str]]:
    """ヒアドキュメントの本文を取り除く。

    本文はコマンドではなく文字列なので、そこに `sops` や `cat .env.local` と書いてあっても止めない。
    ただし区切りをクォートしていない本文ではシェルが `$(...)` を実行するので、それだけは返して調べる。
    終わりの行が見つからないものは `<<` が文字列の中にあっただけとみなし、何もしない。
    """
    lines = command.split("\n")
    kept: List[str] = []
    substitutions: List[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        kept.append(line)
        i += 1
        for m in HEREDOC.finditer(line):
            dash, single, double, backslash, bare = m.groups()
            delimiter = single or double or bare
            end = next(
                (j for j in range(i, len(lines)) if (lines[j].lstrip("\t") if dash else lines[j]) == delimiter),
                None,
            )
            if end is None:
                continue
            if bare and not backslash:
                substitutions.extend(extract_substitutions("\n".join(lines[i:end]))[1])
            i = end + 1
    return "\n".join(kept), substitutions


def closing_paren(s: str, start: int) -> int:
    depth = 1
    single = double = False
    i = start
    while i < len(s):
        c = s[i]
        if single:
            if c == "'":
                single = False
        elif c == "\\":
            i += 1
        elif c == "'" and not double:
            single = True
        elif c == '"':
            double = not double
        elif not double:
            if c == "(":
                depth += 1
            elif c == ")":
                depth -= 1
                if depth == 0:
                    return i
        i += 1
    return len(s)


def extract_substitutions(command: str) -> Tuple[str, List[str]]:
    """`$(...)`・バッククォート・`<(...)` の中身を取り出し、外側では `_` に置き換える。

    shlex はダブルクォートの中の `$(...)` を1つの文字列として扱うので、先に取り出しておかないと
    `echo "$(cat .env.local)"` を見逃す。
    """
    out: List[str] = []
    inners: List[str] = []
    single = double = False
    i, n = 0, len(command)
    while i < n:
        c = command[i]
        if single:
            out.append(c)
            single = c != "'"
            i += 1
        elif c == "\\":
            out.append(command[i : i + 2])
            i += 2
        elif c == "'" and not double:
            single = True
            out.append(c)
            i += 1
        elif c == '"':
            double = not double
            out.append(c)
            i += 1
        elif command.startswith("$(", i) or (not double and command.startswith(("<(", ">("), i)):
            end = closing_paren(command, i + 2)
            inners.append(command[i + 2 : end])
            out.append("_")
            i = end + 1
        elif c == "`":
            end = i + 1
            while end < n and command[end] != "`":
                end += 2 if command[end] == "\\" else 1
            inners.append(command[i + 1 : end])
            out.append("_")
            i = end + 1
        else:
            out.append(c)
            i += 1
    return "".join(out), inners


def tokenize(command: str) -> List[str]:
    lexer = shlex.shlex(command, posix=True, punctuation_chars=OPERATOR_CHARS)
    lexer.whitespace = " \t\r"
    lexer.whitespace_split = True
    # shlex は語の途中の # からも捨てるので、コメントとして扱わない（捨てた部分を見逃さないため）
    lexer.commenters = ""
    try:
        return list(lexer)
    except ValueError:
        # 閉じていないクォートなど。シェルでも失敗するが、判定は素通りさせずに粗く分けて続ける
        return re.findall(r"[;&|()<>\n]+|[^\s;&|()<>'\"]+", command)


def split_commands(tokens: List[str]) -> List[SimpleCommand]:
    commands: List[SimpleCommand] = []
    current = SimpleCommand()
    redirect: Optional[str] = None
    for token in tokens:
        if token and all(ch in OPERATOR_CHARS for ch in token):
            if ("<" in token or ">" in token) and "(" not in token and ")" not in token:
                # `<` と `<>` の先は読むファイル。`>` と `&>` の先は標準出力の行き先。
                # `2>` は shlex では `2` と `>` に分かれる。直前の引数が 2 なら標準エラーとみなす（数値の引数だった場合も安全側）
                if token in ("<", "<>"):
                    redirect = "input"
                elif token == "<<<":
                    redirect = "here-string"
                elif token in (">", ">>", "&>", "&>>", ">|") and current.args[-1:] != ["2"]:
                    redirect = "stdout"
                else:
                    redirect = "other"
                continue
            if current.args or current.inputs:
                commands.append(current)
            current = SimpleCommand()
            redirect = None
            continue
        if redirect == "input":
            current.inputs.append(token)
        elif redirect == "here-string":
            current.here_strings.append(token)
        elif redirect == "stdout":
            current.stdout_discarded = current.stdout_discarded or token == "/dev/null"
        elif redirect is None:
            current.args.append(token)
        redirect = None
    if current.args or current.inputs:
        commands.append(current)
    return commands


def program(token: str) -> str:
    return token.rsplit("/", 1)[-1]


# 後ろに別のコマンドを取るもの。値を取るオプションは値ごと読み飛ばす
WRAPPERS = {
    "sudo": {"-u", "-g", "-C", "-D", "-h", "-p", "-r", "-t", "-U"},
    "nice": {"-n"},
    "timeout": {"-s", "-k", "--signal", "--kill-after"},
    "xargs": {"-I", "-n", "-P", "-L", "-d", "-E", "-s", "-a"},
    "npx": {"-p", "--package", "-c", "--call"},
    "bunx": set(),
    "pnpx": set(),
    "time": set(),
    "nohup": set(),
    "exec": {"-a"},
    "command": set(),
    "builtin": set(),
    "watch": {"-n", "-d"},
}
SHELL_KEYWORDS = {"if", "then", "else", "elif", "while", "until", "do", "!", "{"}


def skip_env_options(args: List[str], i: int) -> int:
    while i < len(args):
        a = args[i]
        if a in ("-u", "--unset", "-C", "--chdir", "-S", "--split-string"):
            i += 2
        elif a.startswith("-") or ASSIGNMENT.match(a):
            i += 1
        else:
            break
    return i


def command_positions(args: List[str]) -> Tuple[Set[int], Optional[int]]:
    """コマンド名として実行されうる位置と、本体のコマンドの位置。

    sudo や npx などのラッパーの後ろ、`--` の後ろ（dotenv -- cmd、kubectl exec pod -- cmd）、
    `exec` / `run` の後ろ（docker compose exec app cmd）を含める。最後のものは位置を特定しきれないので、
    `exec` / `run` より後ろをすべて候補にする。
    """
    chain: List[int] = []
    i = 0
    while i < len(args) and ASSIGNMENT.match(args[i]):
        i += 1
    while i < len(args):
        chain.append(i)
        name = program(args[i])
        if name == "env":
            i = skip_env_options(args, i + 1)
        elif name in SHELL_KEYWORDS:
            i += 1
        elif name in WRAPPERS:
            if name == "command" and args[i + 1 : i + 2] in (["-v"], ["-V"]):
                break
            j = i + 1
            while j < len(args) and args[j].startswith("-"):
                j += 2 if args[j] in WRAPPERS[name] else 1
            if name == "timeout":
                j += 1
            i = j
        elif name == "k3s" and args[i + 1 : i + 2] == ["kubectl"]:
            i += 1
        else:
            break
    positions = set(chain)
    for k, a in enumerate(args):
        if a == "--":
            positions.add(k + 1)
        elif a in ("exec", "run"):
            positions.update(range(k + 1, len(args)))
    positions = {k for k in positions if k < len(args)}
    return positions, (chain[-1] if chain else None)


# ---------------------------------------------------------------------------
# 規則。どれも「止める理由」か None を返す

DUMPERS = {
    "cat", "tac", "less", "more", "most", "head", "tail", "bat", "batcat", "nl", "xxd", "od", "hexdump",
    "strings", "sed", "awk", "gawk", "mawk", "cut", "sort", "uniq", "paste", "column", "fold", "base64",
    "base32", "jq", "yq", "diff", "sdiff", "zcat", "perl", "ruby", "rev", "expand", "unexpand", "pr",
}  # fmt: skip
# 最初の引数がファイルではなくパターンやプログラムのもの: {名前: (値を取る短いオプション, パターンを別に渡す短いオプション)}
# パターンを -e / -f で渡したときは、最初の引数もファイルになる
PATTERN_FIRST = {
    **{name: ("efmABCdDgtTM", "ef") for name in ("grep", "egrep", "fgrep", "zgrep", "rg", "ag", "ack")},
    "sed": ("efl", "ef"),
    **{name: ("Ffv", "f") for name in ("awk", "gawk", "mawk")},
    "jq": ("fL", "f"),
    "yq": ("fI", "f"),
}
PATTERN_LONG_FLAGS = {"--regexp", "--file", "--expression", "--from-file"}
# openssl のうち、鍵の中身を標準出力に出しうるサブコマンド（-out を付ければファイルに書く）
OPENSSL_KEY_PRINTERS = {"rsa", "pkey", "ec", "pkcs8", "pkcs12"}
# 行を出さずに件数や有無だけを出すオプション（rg の -L は --follow なので含めない）
GREP_QUIET_FLAGS = {"grep": "cqlL", "egrep": "cqlL", "fgrep": "cqlL", "zgrep": "cqlL", "rg": "cql", "ag": "clL", "ack": "clL"}
GREP_QUIET_LONG = {"--count", "--count-matches", "--quiet", "--silent", "--files-with-matches", "--files-without-match"}
GREP_VALUE_FLAGS = set("efmABCdD")


def grep_prints_no_lines(name: str, rest: List[str]) -> bool:
    for a in rest:
        if a == "--":
            break
        if a in GREP_QUIET_LONG:
            return True
        if a.startswith("-") and not a.startswith("--"):
            for ch in a[1:]:
                if ch in GREP_QUIET_FLAGS[name]:
                    return True
                if ch in GREP_VALUE_FLAGS:
                    break
    return False


def file_operands(name: str, rest: List[str]) -> List[str]:
    """ファイルとして読まれうる引数。パターンやプログラムを取るコマンドでは、その引数を除く。"""
    if name not in PATTERN_FIRST:
        return rest
    value_letters, pattern_letters = PATTERN_FIRST[name]
    operands: List[str] = []
    pattern_given = skip = options_ended = False
    for a in rest:
        if skip:
            skip = False
        elif options_ended or a == "-" or not a.startswith("-"):
            operands.append(a)
        elif a == "--":
            options_ended = True
        elif a.startswith("--"):
            pattern_given = pattern_given or a.split("=", 1)[0] in PATTERN_LONG_FLAGS
        else:
            for i, ch in enumerate(a[1:], start=1):
                pattern_given = pattern_given or ch in pattern_letters
                if ch in value_letters:
                    skip = i == len(a) - 1  # 値が続けて書かれていなければ次の引数が値
                    break
    if name == "yq" and operands[:1] in (["e"], ["eval"]):
        operands = operands[1:]
    return operands if pattern_given else operands[1:]


def rule_secret_files(cmd: SimpleCommand, positions: Set[int], main: Optional[int], cwd: Optional[str]) -> Optional[str]:
    args = cmd.args
    for k in sorted(positions):
        name = program(args[k])
        if name == "openssl":
            rest = args[k + 1 :]
            files = secret_files_in(rest, cwd)
            if rest[:1] and rest[0] in OPENSSL_KEY_PRINTERS and "-out" not in rest and files:
                return f"`openssl {rest[0]}` で {files[0]} の中身を出そうとしている"
            continue
        if name not in DUMPERS and name not in GREP_QUIET_FLAGS:
            continue
        files = secret_files_in(file_operands(name, args[k + 1 :]), cwd)
        if not files:
            continue
        if name in GREP_QUIET_FLAGS and grep_prints_no_lines(name, args[k + 1 :]):
            continue
        return f"`{name}` で {files[0]} の中身を出そうとしている"
    inputs = secret_files_in(cmd.inputs, cwd)
    if inputs:
        name = program(args[main]) if main is not None else ""
        if name == "wc" or (name in GREP_QUIET_FLAGS and grep_prints_no_lines(name, args[main + 1 :])):
            return None
        return f"{inputs[0]} を `<` で読ませている"
    return None


FIND_NAME_FLAGS = ("-name", "-iname", "-path", "-ipath", "-wholename")


def rule_find(cmd: SimpleCommand) -> Optional[str]:
    args = cmd.args
    if not any(program(a) == "find" for a in args):
        return None
    patterns = [args[i + 1] for i, a in enumerate(args) if a in FIND_NAME_FLAGS and i + 1 < len(args)]
    dumpers = [program(a) for a in args if program(a) in DUMPERS or program(a) in GREP_QUIET_FLAGS]
    if dumpers and any(glob_hits_secret(p) for p in patterns):
        return f"`find ... -exec {dumpers[0]}` で秘密のファイルの中身を出そうとしている"
    return None


def rule_sops(cmd: SimpleCommand, positions: Set[int]) -> Optional[str]:
    if any(program(cmd.args[k]) == "sops" for k in positions):
        return "`sops` を実行しようとしている（TTY が無くエディタが異常終了し、復号した内容が会話ログに出る）"
    return None


def rule_environment(cmd: SimpleCommand, positions: Set[int], main: Optional[int]) -> Optional[str]:
    args = cmd.args
    for k in sorted(positions):
        name = program(args[k])
        rest = args[k + 1 :]
        if name == "env" and skip_env_options(args, k + 1) >= len(args):
            return "`env` で環境変数をすべて出そうとしている"
        if name == "printenv":
            names = [a for a in rest if not a.startswith("-")]
            if not names:
                return "`printenv` で環境変数をすべて出そうとしている"
            secret = [a for a in names if SECRET_VAR.search(a)]
            if secret:
                return f"`printenv` で {secret[0]} の値を出そうとしている"
        if name in ("echo", "printf", "print"):
            for a in rest:
                var = secret_expansion(a)
                if var:
                    return f"`{name}` で {var} の値を出そうとしている"
        for a in cmd.here_strings:
            var = secret_expansion(a)
            if var:
                return f"`<<<` で {var} の値を `{name}` に渡して出そうとしている"
        if name == "dotenv" and "-p" in (rest[: rest.index("--")] if "--" in rest else rest):
            return "`dotenv -p` で変数の値を出そうとしている"
        if k == main and name in ("export", "declare", "typeset"):
            names = [a.split("=", 1)[0] for a in rest if not a.startswith("-")]
            if not names:
                return f"`{name}` で変数をすべて出そうとしている"
            secret = [a for a in names if SECRET_VAR.search(a)]
            if secret:
                return f"`{name}` で {secret[0]} を扱おうとしている"
        if k == main and name == "set" and not rest:
            return "`set` でシェル変数をすべて出そうとしている"
    return None


INTERPRETER = re.compile(r"^(python[0-9.]*|node|nodejs|bun|deno|ruby|perl|php)$")
CODE_FLAGS = {"-c", "-e", "-E", "-p", "-r", "--eval", "--print", "-pe", "-ne", "-le", "-lne", "-lpe"}
PRINTING_CODE_FLAGS = {"-p", "--print", "-pe", "-lpe"}
OUTPUT_CALL = re.compile(
    r"\b(print|printf|puts|echo|say|var_dump|print_r)\b|console\.(log|error|warn|info|dir|table)"
    r"|(process|sys)\.(stdout|stderr)\.write"
)
ENV_KEYS_ONLY = re.compile(r"Object\.(keys|getOwnPropertyNames)\(\s*process\.env\s*\)|\bin\s+(os\.environ|process\.env)\b")
ENV_WHOLE = re.compile(r"process\.env(?![\w.\[])|os\.environ(?![\w.\[])")
ENV_NAMED = re.compile(
    r"(?:process\.env(?:\.|\[\s*['\"])|os\.environ(?:\[\s*|\.get\(\s*)['\"]|getenv\(\s*['\"]|ENV\[\s*['\"]|\$ENV\{\s*['\"]?)"
    r"([A-Za-z_][A-Za-z0-9_]*)"
)


def inline_code_reason(code: str, prints_result: bool) -> Optional[str]:
    if not (prints_result or OUTPUT_CALL.search(code)):
        return None
    for literal in re.findall(r"['\"`]([^'\"`\n]+)['\"`]", code):
        if is_secret_file(literal):
            return f"インラインのコードで {literal} の中身を出そうとしている"
    stripped = ENV_KEYS_ONLY.sub("", code)
    if ENV_WHOLE.search(stripped):
        return "インラインのコードで環境変数をすべて出そうとしている"
    for name in ENV_NAMED.findall(stripped):
        if SECRET_VAR.search(name):
            return f"インラインのコードで {name} の値を出そうとしている"
    return None


def rule_inline_code(cmd: SimpleCommand, positions: Set[int]) -> Optional[str]:
    args = cmd.args
    for k in sorted(positions):
        if not INTERPRETER.match(program(args[k])):
            continue
        rest = args[k + 1 :]
        codes: List[Tuple[str, str]] = []
        for i, a in enumerate(rest):
            if a in CODE_FLAGS and i + 1 < len(rest):
                codes.append((a, rest[i + 1]))
            elif a.startswith(("--eval=", "--print=")):
                flag, code = a.split("=", 1)
                codes.append((flag, code))
        if program(args[k]) == "deno" and rest[:1] == ["eval"] and len(rest) > 1:
            codes.append(("eval", rest[1]))
        for flag, code in codes:
            reason = inline_code_reason(code, flag in PRINTING_CODE_FLAGS)
            if reason:
                return reason
    return None


SHELLS = {"sh", "bash", "zsh", "dash", "ksh"}
# 値を取る ssh のオプション（この後ろに続く最初の語が接続先、その後ろがリモートのコマンド）
SSH_VALUE_FLAGS = {"-p", "-i", "-o", "-l", "-F", "-J", "-L", "-R", "-D", "-b", "-c", "-E", "-I", "-m", "-S", "-W", "-w"}


def rule_nested_shell(cmd: SimpleCommand, positions: Set[int], cwd: Optional[str], depth: int) -> Optional[str]:
    args = cmd.args
    for k in sorted(positions):
        name = program(args[k])
        rest = args[k + 1 :]
        if name in SHELLS:
            for i, a in enumerate(rest):
                if a.startswith("-") and not a.startswith("--") and "c" in a[1:] and i + 1 < len(rest):
                    reason = check_bash(rest[i + 1], cwd, depth + 1)
                    if reason:
                        return reason
                    break
        if name in ("ssh", "doas") and rest:
            # 別のホストで出しても、出力は会話ログに残る
            remote = list(rest)
            if name == "ssh":
                while remote and remote[0].startswith("-"):
                    remote = remote[2:] if remote[0] in SSH_VALUE_FLAGS else remote[1:]
                remote = remote[1:]  # 接続先
            reason = check_bash(" ".join(remote), cwd, depth + 1) if remote else None
            if reason:
                return reason
        if name == "eval" and rest:
            reason = check_bash(" ".join(rest), cwd, depth + 1)
            if reason:
                return reason
    return None


def non_flag_words(rest: List[str], value_flags: Set[str]) -> List[str]:
    words = []
    skip = False
    for a in rest:
        if skip:
            skip = False
        elif a in value_flags:
            skip = True
        elif not a.startswith("-"):
            words.append(a)
    return words


def output_formats(rest: List[str]) -> List[str]:
    values = []
    for i, a in enumerate(rest):
        if a in ("-o", "--output") and i + 1 < len(rest):
            values.append(rest[i + 1])
        elif a.startswith("--output="):
            values.append(a.split("=", 1)[1])
        elif a.startswith("-o") and not a.startswith("--") and len(a) > 2:
            values.append(a[2:].lstrip("="))
    return values


KUBECTL_VALUE_FLAGS = {"-n", "--namespace", "--context", "--kubeconfig", "--cluster", "--user", "-l", "--selector", "-o", "--output"}


def rule_kubectl(cmd: SimpleCommand, positions: Set[int], cwd: Optional[str]) -> Optional[str]:
    args = cmd.args
    for k in sorted(positions):
        if program(args[k]) not in ("kubectl", "k"):
            continue
        rest = args[k + 1 :]
        words = non_flag_words(rest, KUBECTL_VALUE_FLAGS)
        prints_values = any(f not in ("name", "wide") for f in output_formats(rest)) or any(
            a == "--template" or a.startswith("--template=") for a in rest
        )
        names_secret = any(
            part.split("/")[0].split(".")[0] in ("secret", "secrets") for w in words for part in w.split(",")
        )
        if words[:1] == ["get"] and names_secret and prints_values:
            return "`kubectl get secret` で Secret の値を出そうとしている（件数や名前だけなら -o を付けない）"
        if words[:2] == ["config", "view"] and any(a.split("=", 1)[0] in ("--raw", "--flatten") for a in rest):
            return "`kubectl config view --raw` で接続用の証明書やトークンを出そうとしている"
        if prints_values and secret_files_in(rest, cwd):
            return "`kubectl -o` で平文の Secret マニフェストの中身を出そうとしている"
        if words[:2] == ["create", "secret"]:
            if any(a.startswith("--from-literal") for a in rest):
                return "`--from-literal` で秘密の値をコマンドラインに渡している"
            if prints_values:
                return "`kubectl create secret -o` で Secret の値を出そうとしている"
    return None


DOCKER_VALUE_FLAGS = {"--context", "-c", "--config", "-H", "--host", "-l", "--log-level"}
COMPOSE_VALUE_FLAGS = {"-f", "--file", "-p", "--project-name", "--profile", "--env-file", "--project-directory", "--ansi", "--progress", "--parallel"}
COMPOSE_CONFIG_QUIET = {"-q", "--quiet", "--services", "--volumes", "--profiles", "--images", "--networks", "--hash", "-h", "--help"}


def rule_docker(cmd: SimpleCommand, positions: Set[int]) -> Optional[str]:
    args = cmd.args
    for k in sorted(positions):
        name = program(args[k])
        rest = args[k + 1 :]
        if name == "docker-compose":
            compose_rest: Optional[List[str]] = rest
        elif name in ("docker", "podman"):
            words = non_flag_words(rest, DOCKER_VALUE_FLAGS)
            if words[:1] == ["compose"]:
                compose_rest = rest[rest.index("compose") + 1 :]
            else:
                compose_rest = None
                if words[:1] == ["inspect"] or words[:2] == ["container", "inspect"]:
                    formats = [rest[i + 1] for i, a in enumerate(rest) if a in ("-f", "--format") and i + 1 < len(rest)]
                    formats += [a.split("=", 1)[1] for a in rest if a.startswith("--format=")]
                    if not formats or any(re.search(r"Env|json\s+\.(Config)?\s*\}\}", f) for f in formats):
                        return "`docker inspect` でコンテナの環境変数（.env.local の値）を出そうとしている"
        else:
            continue
        if compose_rest is not None:
            words = non_flag_words(compose_rest, COMPOSE_VALUE_FLAGS)
            if words[:1] == ["config"]:
                flags = {a.split("=", 1)[0] for a in compose_rest}
                if "--environment" in flags or not flags & COMPOSE_CONFIG_QUIET:
                    return "`docker compose config` で .env.local の値を展開して出そうとしている（--services なら出さない）"
    return None


def rule_gh(cmd: SimpleCommand, positions: Set[int]) -> Optional[str]:
    args = cmd.args
    for k in sorted(positions):
        if program(args[k]) != "gh":
            continue
        rest = args[k + 1 :]
        words = [a for a in rest if not a.startswith("-")]
        if words[:2] == ["auth", "token"]:
            return "`gh auth token` で GitHub のトークンを出そうとしている"
        if words[:2] == ["auth", "status"] and any(a.split("=", 1)[0] in ("-t", "--show-token") for a in rest):
            return "`gh auth status --show-token` で GitHub のトークンを出そうとしている"
    return None


# ---------------------------------------------------------------------------
# 入口


def check_bash(command: str, cwd: Optional[str] = None, _depth: int = 0) -> Optional[str]:
    """止める理由を返す。止めないなら None。cwd を渡すとグロブをそこで展開して調べる。"""
    if _depth > MAX_DEPTH:
        return "コマンド置換やシェルの入れ子が深すぎて判定しきれない"
    main_part, heredoc_substitutions = strip_heredocs(command)
    outer, substitutions = extract_substitutions(main_part)
    for inner in heredoc_substitutions + substitutions:
        reason = check_bash(inner, cwd, _depth + 1)
        if reason:
            return reason
    for cmd in split_commands(tokenize(outer)):
        positions, main = command_positions(cmd.args)
        if cmd.stdout_discarded:
            # 出力を捨てていても sops は TTY の問題で止める。入れ子のシェルの中も調べる
            reason = rule_sops(cmd, positions) or rule_nested_shell(cmd, positions, cwd, _depth)
            if reason:
                return reason
            continue
        reason = (
            rule_sops(cmd, positions)
            or rule_find(cmd)
            or rule_secret_files(cmd, positions, main, cwd)
            or rule_environment(cmd, positions, main)
            or rule_inline_code(cmd, positions)
            or rule_nested_shell(cmd, positions, cwd, _depth)
            or rule_kubectl(cmd, positions, cwd)
            or rule_docker(cmd, positions)
            or rule_gh(cmd, positions)
        )
        if reason:
            return reason
    return None


def check_read(tool_input: dict) -> Optional[str]:
    path = tool_input.get("file_path") or ""
    if is_secret_file(path) or is_secret_directory(path):
        return f"Read で {path} を読もうとしている"
    return None


def check_grep(tool_input: dict) -> Optional[str]:
    # 既定の output_mode は files_with_matches で、行は出さない
    if tool_input.get("output_mode") != "content":
        return None
    path = tool_input.get("path") or ""
    if is_secret_file(path) or is_secret_directory(path):
        return f"Grep で {path} の行を出そうとしている"
    glob_pattern = tool_input.get("glob") or ""
    if glob_pattern and glob_hits_secret(glob_pattern, (".env", ".env.local", ".env.production.local")):
        return f"Grep で glob {glob_pattern} に当たる秘密のファイルの行を出そうとしている"
    return None


MESSAGE = """secret_guard: {reason}。
秘密の値を会話ログに残さないため、このツール呼び出しを止めた（.claude/hooks/secret_guard.py）。
- 変数があるかだけ知りたいなら `grep -c '^NAME=' .env.local`（値は出ない）
- 秘密を要するコマンドは `npx dotenv -e .env.local -- <cmd>` で動かし、値を出力しない
- sops の復号や本番の Secret の中身が本当に要るなら、ユーザーに自分のターミナルで実行してもらう（`!` で実行すると出力が会話に残る）
書き方を変えて通り抜けようとしないこと。"""


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as error:
        payload = error
    if not isinstance(payload, dict):
        # 終了コード 2 は「止める」の意味になるので 1 にする。Claude Code は非ブロッキングのエラーとして表示する
        print(f"secret_guard: hook の入力を JSON のオブジェクトとして読めなかった（{payload}）。判定せずに通す", file=sys.stderr)
        return 1
    tool_input = payload.get("tool_input") or {}
    tool = payload.get("tool_name")
    if tool == "Bash":
        reason = check_bash(tool_input.get("command") or "", payload.get("cwd") or os.getcwd())
    elif tool == "Read":
        reason = check_read(tool_input)
    elif tool == "Grep":
        reason = check_grep(tool_input)
    else:
        reason = None
    if reason is None:
        return 0
    print(MESSAGE.format(reason=reason), file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
