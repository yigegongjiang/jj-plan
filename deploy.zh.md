# 部署流程

AI 改完代码后自行执行. push `v*` tag 触发 Actions: 部署 Worker + 编译 CLI 二进制 (jjplan + jjask × x64/arm64) 附 release. 文档写法 → [llm-doc-style.md](./llm-doc-style.md). 英文主版 → [deploy.md](./deploy.md).

## TL;DR

1. `cd cli && bun run typecheck && bun run build` 验证; `--version` 须等于根 `VERSION`
2. bump `VERSION` + 把版本同步写进 `CHANGELOG.md` (用户向) **和** `CHANGELOG` (开发向) → [llm-doc-style.md](./llm-doc-style.md)
3. commit + push 分支 + tag (`-m`, 兼容签名) + push tag
4. 刚发版有 bug → amend + 删远端 tag + 重打 tag + force push

## 1. 验证

```sh
cd cli && bun run typecheck && bun run build && ./dist/jjplan-macos-arm64 --version
```

`--version` 输出应等于根 `VERSION`. typecheck / build / version 任一失败直接退回.

## 2. 写版本

- 版本号: 默认 PATCH; 新功能 → MINOR; 不兼容 → MAJOR.
- 改 `VERSION` 文件 (唯一来源, CI 校验 `VERSION == tag (去 v)`, 不一致 fail).
- **`CHANGELOG.md`** 顶部加 `## [X.Y.Z] - YYYY-MM-DD` 段, 按 Added / Changed / Fixed 分组写**面向用户**的精简摘要 (commit 详情由 Actions `generate_release_notes` 自动汇总). 底部补 `[X.Y.Z]:` compare 链接.
- 把该段镜像进 **`CHANGELOG`** (面向开发者): 每条 1:1 + 一条缩进子项承载技术变更 (路径 / 函数 / 机制). 两文件同步推进 → [llm-doc-style.md](./llm-doc-style.md).

## 3. 发布

```sh
git commit -m "X.Y.Z: <一句话>"
git push origin main
git tag vX.Y.Z -m "X.Y.Z"   # tag.gpgsign=true, 必须带 message
git push origin vX.Y.Z
```

> tag 必须带 message (`-m`): `tag.gpgsign=true` 会把 lightweight tag 强制升为签名 tag 但缺 message → fail.

## 4. amend 修上版

刚 push 的 tag 发现 bug / 文档冗余 / 改动指向同版本 → amend 同版本 retag, 不发新版:

> **commit + tag 必须一起更新**: amend 后 commit hash 变, 但远端 tag 仍指旧 hash → Release 产物与 main HEAD 偏离. 只 force push commit 不够, 远端 tag MUST 删除重建, 否则 Actions 不会重跑.

```sh
git commit -a --amend --no-edit
git push --force-with-lease origin main
git tag -d vX.Y.Z
git push origin :refs/tags/vX.Y.Z
git tag vX.Y.Z -m "X.Y.Z"
git push origin vX.Y.Z
```

> Release 会被覆写, 旧二进制不可恢复.
