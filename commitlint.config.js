module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'subject-case': [0],
    'type-enum': [
      2,
      'always',
      [
        'feat', // 新機能
        'fix', // バグ修正
        'docs', // ドキュメント
        'style', // フォーマット
        'refactor', // リファクタリング
        'perf', // パフォーマンス改善
        'test', // テスト
        'chore', // その他
        'ci', // CI/CD
        'build', // ビルド
      ],
    ],
  },
};
