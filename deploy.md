# deploy

发版 = 改 `VERSION` + 改 `CHANGELOG.md` → commit → push main → 打 tag → push tag.

```sh
git add VERSION CHANGELOG.md <其他改动>
git commit -m "X.Y.Z: <一句话>"
git push origin main
git tag vX.Y.Z && git push origin vX.Y.Z
```

tag 名 = `v` + VERSION 内容. 推 tag 后 CI 自动部署 Worker + 上传 binary. 不要用 workflow_dispatch.
