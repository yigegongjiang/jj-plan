# 部署流程

push `v*` tag 触发 Actions: 部署 Worker + 编译 CLI 二进制 (jjplan + jjask × x64/arm64) 附 release.

## 1. 验证

```sh
cd cli && bun run typecheck && bun run build && ./dist/jjplan-macos-arm64 --version
```

`--version` 输出应等于根 `VERSION`. typecheck / build / version 任一失败直接退回.

## 2. 写版本

- 版本号: 默认 PATCH; 新功能 → MINOR; 不兼容 → MAJOR.
- 改 `VERSION` 文件 (唯一来源, CI 校验 `VERSION == tag (去 v)`, 不一致 fail).
- `CHANGELOG.md` 顶部加 `## [X.Y.Z] - YYYY-MM-DD` 段, 按 Added / Changed / Fixed 分组写**面向用户**的精简摘要 (commit 详情由 Actions `generate_release_notes` 自动汇总). 底部补 `[X.Y.Z]: https://github.com/yigegongjiang/jj-plan/compare/vX.Y.Z-1...vX.Y.Z`.

## 3. 发布

```sh
git commit -m "X.Y.Z: <一句话>"
git push origin main
git tag vX.Y.Z -m "X.Y.Z"   # tag.gpgsign=true, 必须带 message
git push origin vX.Y.Z
```

## 4. amend 修上版

刚 push 的 tag 发现 bug / 文档冗余 / 改动指向同版本 → amend 同版本 retag, 不发新版:

```sh
git commit -a --amend --no-edit
git push --force-with-lease origin main
git tag -d vX.Y.Z
git push origin :refs/tags/vX.Y.Z
git tag vX.Y.Z -m "X.Y.Z"
git push origin vX.Y.Z
```

Release 会被覆写, 旧二进制不可恢复.
