"""secret_guard.py のテスト。

実行: python3 .claude/hooks/test_secret_guard.py

BLOCK は止めるべきコマンド、ALLOW はこのリポジトリのスキルやエージェントが実際に使っているコマンド。
ALLOW の多くは .claude/skills/ と .claude/agents/ に書かれている形そのままで、
止めてしまうと手順が回らなくなる。
"""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import secret_guard  # noqa: E402

SCRIPT = HERE / "secret_guard.py"

BLOCK = [
    # sops はどの形でも Claude から実行しない
    "sops -d k8s/secret.enc.yaml",
    "sops --version",
    "cd k8s && sops secret.enc.yaml",
    "/usr/local/bin/sops -d k8s/secret.enc.yaml",
    "sudo sops -d k8s/secret.enc.yaml",
    "bash -c 'sops -d k8s/secret.enc.yaml'",
    'echo "$(sops -d k8s/secret.enc.yaml)"',
    "x=`sops -d k8s/secret.enc.yaml`",
    "sops -d k8s/secret.enc.yaml | kubectl apply -f -",
    # 秘密ファイルの中身を出す
    "cat .env.local",
    "cat ../.env.local",
    "cat .env",
    "head -n 3 .env",
    "tail .env.production.local",
    "less /Users/someone/proj/.env.local",
    "grep AUTH_SECRET .env.local",
    "grep -E '^DATABASE_URL=' .env.local",
    "grep -A2 DATABASE .env.local",
    "rg DATABASE .env.local",
    "sed -n 1,5p .env.local",
    "awk -F= '{print $2}' .env.local",
    "sort < .env.local",
    "tr -d x < .env.local",
    "while read -r l; do echo \"$l\"; done < .env.local",
    "cat .env.local | head",
    'echo "$(cat .env.local)"',
    "cat <(cat .env.local)",
    "sudo cat .env.local",
    "npx dotenv -e .env.local -- cat .env.local",
    "cat .env.local 2>&1",
    "cat 2>/dev/null .env.local",
    "printenv AUTH_SECRET 2> /dev/null",
    "head -n 2 >/dev/null .env.local | cat",
    "sops -d k8s/secret.enc.yaml > /dev/null",
    "bash -c 'sops -d k8s/secret.enc.yaml' > /dev/null",
    "cat ~/.kube/config",
    "cat ~/.kube/fishing-ci.yaml",
    "grep -e AUTH .env.local",
    "grep -iE AUTH -- .env.local",
    "grep -- -v .env.local",
    "grep --regexp=AUTH .env.local",
    "awk -f prog.awk .env.local",
    "jq . ~/.config/gh/hosts.yml",
    "cat kubeconfig",
    "cat ~/.ssh/id_ed25519",
    "cat deploy_rsa",
    "cat server.key",
    "openssl rsa -in tls.pem -text",
    "cat ~/.config/sops/age/keys.txt",
    "cat k8s/secret.yaml",
    "cat k8s/db-secret.yaml",
    "cat ~/.config/gh/hosts.yml",
    "cat ~/.docker/config.json",
    "cat ~/.npmrc",
    "cat ~/.netrc",
    "cat ~/.aws/credentials",
    "cat ~/.pgpass",
    # 別のホストで出しても会話ログに出るのは同じ
    "ssh pi@raspberrypi.local cat /home/pi/.kube/config",
    "ssh -p 2222 pi 'cat /etc/rancher/k3s/k3s.yaml'",
    "env -u NODE_OPTIONS cat .env.local",
    "perl -ne 'print' .env.local",
    "find . -name '.env*' -exec head -5 {} +",
    'cat <<< "$AUTH_SECRET"',
    "k get secret x -o yaml",
    "kubectl apply -f k8s/secret.yaml --dry-run=client -o yaml",
    "base64 .env.local",
    "xxd .env.local",
    "diff .env.example .env.local",
    "docker compose exec app cat /app/.env.local",
    "python3 -c \"print(open('.env.local').read())\"",
    "node -p \"require('fs').readFileSync('.env.local', 'utf8')\"",
    "cat <<EOF\n$(cat .env.local)\nEOF",
    "if true; then cat .env.local; fi",
    "timeout 5 cat .env.local",
    'eval "cat .env.local"',
    "grep -eclass .env.local",
    "curl -s http://localhost:3000/#top; cat .env.local",
    # 入れ子が深すぎるものは判定しきれないので止める
    'echo "$(echo "$(echo "$(echo "$(echo "$(echo "$(echo ok)")")")")")"',
    # 環境変数として持っている秘密を出す
    "env",
    "printenv",
    "env | sort",
    "env -u NODE_OPTIONS",
    "printenv AUTH_SECRET",
    "echo $DATABASE_URL",
    'echo "${AUTH_GOOGLE_SECRET}"',
    "printf '%s\\n' \"$RESEND_API_KEY\"",
    "export -p",
    "export",
    "set",
    "declare -p",
    "npx dotenv -e .env.local -- node -e 'console.log(process.env.DATABASE_URL)'",
    "npx dotenv -e .env.local -- node -e 'console.log(process.env)'",
    "node -e 'console.log(JSON.stringify(process.env))'",
    "python3 -c 'import os; print(os.environ)'",
    "python3 -c 'import os; print(os.environ[\"AUTH_SECRET\"])'",
    "python3 -c 'import os; print(os.getenv(\"POSTGRES_PASSWORD\"))'",
    "docker compose exec app env",
    "docker compose exec app printenv AUTH_SECRET",
    "kubectl exec deploy/fishing-app -- env",
    "npx dotenv -e .env.local -p AUTH_SECRET",
    # Kubernetes の Secret の値や接続情報を出す
    "kubectl get secret fishing-app-secret -o yaml",
    "kubectl -n fishing get secrets -ojson",
    "kubectl get secret x --output=jsonpath='{.data}'",
    "kubectl get secret x -o=json",
    "kubectl get secrets,configmaps -o yaml",
    "kubectl get secret/fishing-app-secret -o go-template='{{.data}}'",
    "kubectl get secret x --template='{{.data}}'",
    "k3s kubectl get secret x -o yaml",
    "sudo k3s kubectl get secret x -o yaml",
    "kubectl config view --raw",
    "kubectl config view --flatten",
    "kubectl create secret generic x --from-literal=AUTH_SECRET=abc",
    "kubectl create secret generic x --from-env-file=.env.local --dry-run=client -o yaml",
    # Docker が .env.local の値を展開して出す
    "docker compose config",
    "cd docker && docker compose --env-file ../.env.local config",
    "docker-compose config",
    "docker compose config --services --environment",
    "docker inspect fishing-app",
    "docker container inspect fishing-app",
    "docker inspect -f '{{.Config.Env}}' fishing-app",
    "docker inspect --format '{{json .Config}}' fishing-app",
    # GitHub のトークン
    "gh auth token",
    "gh auth status --show-token",
    "gh auth status -t",
    "gh auth status --show-token=true",
    # 閉じていないクォートでも素通りさせない
    'cat .env.local "oops',
]

ALLOW = [
    # 値を出さずに存在だけ確かめる
    "grep -c '^AUTH_SECRET=' .env.local",
    "grep -qE '^AUTH_SECRET=.+' .env.local && echo set",
    "grep -l AUTH .env.local",
    "grep --count AUTH .env.local",
    "grep -c AUTH < .env.local",
    "for v in DATABASE_URL REDIS_URL AUTH_SECRET AUTH_URL; do printf '%s %s\\n' \"$v\" \"$(grep -c \"^$v=\" .env.local)\"; done",
    'echo "$(grep -c AUTH .env.local)"',
    "wc -l .env.local",
    "wc -l < .env.local",
    # 標準出力を捨てていれば値は出ない
    "printenv GITHUB_PERSONAL_ACCESS_TOKEN >/dev/null && echo set",
    "grep AUTH_SECRET .env.local > /dev/null && echo found",
    "cat .env.local &>/dev/null",
    "ls -la .env.local",
    "test -f .env.local && echo ok",
    "git check-ignore -v .env.local",
    "echo ${AUTH_SECRET:+set}",
    "echo ${#AUTH_SECRET}",
    "node -e 'process.exit(process.env.AUTH_SECRET ? 0 : 1)'",
    "node -e 'console.log(Object.keys(process.env).length)'",
    # .env.local を読み込んで使うだけ（中身は出さない）
    "cd docker && docker compose --env-file ../.env.local up -d postgres redis && cd ..",
    "npx dotenv -e .env.local -- prisma migrate status",
    "npx dotenv -e .env.local -- node .claude/skills/run-app-locally/session-cookie.mjs \"$J\" a@example.invalid",
    "npx dotenv -e .env.local -- node --import tsx/esm check.ts",
    "APP_PORT=3100 docker compose --env-file ../.env.local up -d --build app",
    "docker compose --env-file ../.env.local --profile tools run --rm migrator",
    "node --env-file=.env.local script.mjs",
    "cp .env.example .env && npx prisma generate",
    # 秘密ではないファイル
    "cat .env.example",
    "cat k8s/secret.enc.yaml",
    "cat k8s/config.env",
    "cat src/lib/env.ts",
    "cat ~/.ssh/id_ed25519.pub",
    "cat ~/.ssh/known_hosts",
    "ssh pi uptime",
    "ssh -i ~/.ssh/id_ed25519 pi 'systemctl status k3s'",
    "find . -name '*.ts' -exec head -5 {} +",
    "cat scripts/make-kubeconfig.sh",
    "cat ~/.kube/cache/discovery/x.json",
    "openssl genrsa -out server.key 2048",
    "openssl rsa -in server.key -out server-nopass.key",
    "openssl req -new -key server.key -out server.csr -subj /CN=x",
    # grep / sed / awk / jq の最初の引数はファイルではなくパターンやプログラム
    "git ls-files | grep -iE '(\\.env|\\.key$|kubeconfig|_rsa)'",
    "git log --format=%s | grep '^\\.env'",
    "grep -n kubeconfig README.md",
    "grep -m 1 kubeconfig README.md",
    "yq e '.env' k8s/kustomization.yaml",
    "openssl x509 -in server.pem -noout -subject",
    "sed -n '/\\.env/p' README.md",
    "awk '/.env.local/' README.md",
    "jq -r '.env' .claude/settings.json",
    'grep -q "^sops:" k8s/secret.enc.yaml',
    "grep -c 'ENC\\[AES256_GCM' k8s/secret.enc.yaml",
    "grep -rn AUTH_SECRET src",
    # 値を出さない kubectl / docker / gh
    "kubectl get secrets",
    "k get pods -o wide",
    "kubectl get secret fishing-app-secret -o name",
    "kubectl describe secret fishing-app-secret",
    "kubectl -n fishing get pods -o wide",
    "kubectl get configmap fishing-app-config -o yaml",
    "kubectl config view",
    "kubectl logs job/db-migrate --tail=50",
    "docker compose config --services",
    "docker compose config -q",
    "docker compose config --help",
    "docker inspect -f '{{.State.Health.Status}}' fishing-postgres",
    "docker image inspect fishing-app:latest",
    "gh auth status",
    "gh pr create --title x --body-file /tmp/body.md",
    "gh pr comment 1 --body 'cat .env.local や sops -d はしないこと'",
    "gh issue list --search sops",
    # 環境変数でも秘密ではないもの
    "env -u NODE_OPTIONS npm ci",
    "set -euo pipefail; npm test",
    "export FOO=bar",
    "printenv NODE_OPTIONS",
    "echo $PATH",
    'echo "$v"',
    # 秘密の話をしているだけの文字列
    "echo 'sops は使わない'",
    "git commit -F /tmp/msg.txt",
    "cat > /tmp/x.md <<'EOF'\nsops -d k8s/secret.enc.yaml と cat .env.local はしない\nEOF",
    "git log --oneline | head -5",
    "which sops",
    "command -v sops",
    # その他の普段のコマンド
    "npm run dev",
    "curl -s http://localhost:3000/api/healthz",
    "python3 -m unittest discover -s .claude/hooks",
    "echo 'unterminated",
]


class BashTest(unittest.TestCase):
    def test_block(self):
        for command in BLOCK:
            with self.subTest(command=command):
                self.assertIsNotNone(secret_guard.check_bash(command))

    def test_allow(self):
        for command in ALLOW:
            with self.subTest(command=command):
                self.assertIsNone(secret_guard.check_bash(command))


class GlobTest(unittest.TestCase):
    """シェルのグロブは cwd で実際に展開して判断する。"""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.cwd = Path(self._tmp.name)
        (self.cwd / ".env.local").write_text("X=1\n")
        (self.cwd / ".env.example").write_text("X=\n")
        (self.cwd / "k8s").mkdir()
        (self.cwd / "k8s" / "secret.enc.yaml").write_text("sops:\n")
        (self.cwd / "k8s" / "config.env").write_text("A=1\n")

    def tearDown(self):
        self._tmp.cleanup()

    def test_glob_matching_a_secret_file_is_blocked(self):
        self.assertIsNotNone(secret_guard.check_bash("cat .env*", cwd=str(self.cwd)))

    def test_glob_matching_only_safe_files_is_allowed(self):
        self.assertIsNone(secret_guard.check_bash("cat k8s/*", cwd=str(self.cwd)))
        self.assertIsNone(secret_guard.check_bash("cat .env.ex*", cwd=str(self.cwd)))

    def test_star_does_not_match_dotfiles(self):
        self.assertIsNone(secret_guard.check_bash("cat *", cwd=str(self.cwd)))

    def test_pattern_that_glob_cannot_compile_does_not_crash(self):
        # Python 3.9 の fnmatch は逆順の範囲で re.error を投げる。過去に実際に流れた grep で起きた
        self.assertIsNone(secret_guard.check_bash("grep -rn '[g-c]' k8s", cwd=str(self.cwd)))
        self.assertIsNotNone(secret_guard.check_bash("cat '[g-c]' .env.local", cwd=str(self.cwd)))


class ReadTest(unittest.TestCase):
    def test_block(self):
        for path in ["/Users/someone/proj/.env.local", ".env", "/home/pi/.kube/config", "k8s/secret.yaml"]:
            with self.subTest(path=path):
                self.assertIsNotNone(secret_guard.check_read({"file_path": path}))

    # ディレクトリを指すと、その下の鍵やトークンの中身を読める
    def test_秘密のファイルが入るディレクトリも止める(self):
        for path in ["/Users/someone/.kube", "/Users/someone/.ssh/", "/Users/someone/.config/sops/age"]:
            with self.subTest(path=path):
                self.assertIsNotNone(secret_guard.check_read({"file_path": path}))

    def test_allow(self):
        for path in [".env.example", "/Users/someone/proj/src/lib/env.ts", "k8s/secret.enc.yaml"]:
            with self.subTest(path=path):
                self.assertIsNone(secret_guard.check_read({"file_path": path}))


class GrepTest(unittest.TestCase):
    def test_content_of_a_secret_file_is_blocked(self):
        self.assertIsNotNone(
            secret_guard.check_grep({"pattern": "AUTH", "path": ".env.local", "output_mode": "content"})
        )
        self.assertIsNotNone(
            secret_guard.check_grep({"pattern": "AUTH", "path": ".", "glob": ".env*", "output_mode": "content"})
        )
        self.assertIsNotNone(
            secret_guard.check_grep({"pattern": "AUTH", "glob": "**/.env.local", "output_mode": "content"})
        )

    def test_秘密のファイルが入るディレクトリも止める(self):
        self.assertIsNotNone(
            secret_guard.check_grep({"pattern": "server", "path": "/Users/someone/.kube", "output_mode": "content"})
        )

    # Python 3.9 の fnmatch は逆順の範囲で re.error を投げる。例外で素通りさせない
    def test_glob_that_cannot_compile_does_not_crash(self):
        self.assertIsNone(secret_guard.check_grep({"pattern": "A", "glob": "[g-c]", "output_mode": "content"}))

    def test_counts_and_file_names_are_allowed(self):
        for mode in ["count", "files_with_matches", None]:
            tool_input = {"pattern": "AUTH", "path": ".env.local"}
            if mode:
                tool_input["output_mode"] = mode
            with self.subTest(mode=mode):
                self.assertIsNone(secret_guard.check_grep(tool_input))

    def test_content_of_normal_files_is_allowed(self):
        self.assertIsNone(
            secret_guard.check_grep({"pattern": "AUTH_SECRET", "path": "src", "output_mode": "content"})
        )


class HookProtocolTest(unittest.TestCase):
    """Claude Code から呼ばれる形（stdin の JSON と終了コード）で動かす。"""

    def run_hook(self, stdin):
        return subprocess.run(
            [sys.executable, str(SCRIPT)], input=stdin, capture_output=True, text=True, timeout=30
        )

    def test_blocked_command_exits_2_with_reason_on_stderr(self):
        payload = {"tool_name": "Bash", "tool_input": {"command": "cat .env.local"}, "cwd": "/tmp"}
        result = self.run_hook(json.dumps(payload))
        self.assertEqual(result.returncode, 2)
        self.assertIn("secret_guard", result.stderr)
        self.assertIn(".env.local", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_allowed_command_exits_0_silently(self):
        payload = {"tool_name": "Bash", "tool_input": {"command": "npm test"}, "cwd": "/tmp"}
        result = self.run_hook(json.dumps(payload))
        self.assertEqual((result.returncode, result.stdout, result.stderr), (0, "", ""))

    def test_read_and_grep_are_checked(self):
        read = {"tool_name": "Read", "tool_input": {"file_path": "/x/.env.local"}}
        self.assertEqual(self.run_hook(json.dumps(read)).returncode, 2)
        grep = {"tool_name": "Grep", "tool_input": {"pattern": "A", "path": ".env", "output_mode": "content"}}
        self.assertEqual(self.run_hook(json.dumps(grep)).returncode, 2)

    def test_other_tools_are_ignored(self):
        payload = {"tool_name": "Write", "tool_input": {"file_path": ".env.local", "content": "X=1"}}
        self.assertEqual(self.run_hook(json.dumps(payload)).returncode, 0)

    def test_broken_input_is_a_visible_non_blocking_error(self):
        # 2 は「止める」の意味になるので、入力が壊れているときは 1 で知らせる
        result = self.run_hook("not json")
        self.assertEqual(result.returncode, 1)
        self.assertIn("secret_guard", result.stderr)


if __name__ == "__main__":
    unittest.main()
