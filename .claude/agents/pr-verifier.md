---
name: pr-verifier
description: Use when a pull request in this repository needs review before merge and the findings must be backed by actually running things (tests, builds, containers, kustomize renders, the local database), not by reading the diff. Call with isolation "worktree" and pass the PR number, the claims the PR body makes, and the angle to focus on.
tools: ["Read", "Grep", "Glob", "Bash", "WebFetch", "WebSearch"]
---

最初に `.agents/agents/pr-verifier.md` を Read し、frontmatter より下の本文すべてに従って検証を行うこと。
