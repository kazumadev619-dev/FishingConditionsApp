#!/usr/bin/env node
import { execSync } from 'node:child_process';
// Markdown ファイル内の相対リンク切れを検出する。
// 対象: リポジトリ直下の *.md と docs/ k8s/ 配下の *.md（node_modules 等は除外）
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// git 管理下の Markdown を対象にする（未追跡ファイルも含める）
const files = execSync('git ls-files --cached --others --exclude-standard "*.md"', {
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean)
  .filter((f) => !f.startsWith('node_modules/'));

// [text](link) 形式のリンクを拾う。画像 ![...](...) も同じ形なので併せて検査する。
const LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;

// ``` で囲まれたコードブロックを取り除く。
// 設計書や実装計画は「編集後のMarkdown」をコードブロックに含むため、
// これを除かないと実在しないパスを大量に誤検出する。
function stripCodeBlocks(text) {
  return text.replace(/^```[\s\S]*?^```/gm, '');
}

const broken = [];

for (const file of files) {
  const content = stripCodeBlocks(readFileSync(file, 'utf8'));
  for (const match of content.matchAll(LINK_RE)) {
    const raw = match[1].trim();

    // 外部 URL・ページ内アンカー・mailto は対象外
    if (/^(https?:|mailto:|#)/.test(raw)) continue;

    // リンク先のアンカー部分を落とす: ./foo.md#section -> ./foo.md
    const target = raw.split('#')[0];
    if (!target) continue;

    const resolved = target.startsWith('/')
      ? resolve(process.cwd(), `.${target}`)
      : resolve(dirname(file), target);

    if (!existsSync(resolved)) {
      broken.push(`${file}: ${raw}`);
    }
  }
}

if (broken.length > 0) {
  console.error(`リンク切れ ${broken.length} 件:`);
  for (const b of broken) console.error(`  ${b}`);
  process.exit(1);
}

console.log(`リンク切れなし（${files.length} ファイル検査）`);
