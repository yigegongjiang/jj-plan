# jjplan

为 AI 设计的 Spec/Task/Ask 跟踪. 数据在 Cloudflare D1, 通过 Worker 暴露; 本地两个 CLI (`jjplan` + `jjask`).

## 安装

```sh
curl -fsSL https://raw.githubusercontent.com/yigegongjiang/jj-plan/main/install.sh | bash
```

共用配置 `~/.jjplan/config.json`:

```json
{ "endpoint": "https://jjplan.<acct>.workers.dev", "token": "<password>" }
```

`wrangler secret put JJPLAN_TOKEN` 把同一个值塞进 Worker.

## 用

`jjplan --help` / `jjask --help`. 浏览器开 `endpoint` 看 dashboard.

## 卸载 / 换密码

`jjplan uninstall` 同时移除两 binary. 换密码: `echo -n '<password>' | wrangler secret put JJPLAN_TOKEN`, 同步 config.json 与浏览器 localStorage.

## 版本号

仓库根 `VERSION` 是唯一来源. 发版: 改 VERSION → 打 tag `v<VERSION>` → CI 部署 Worker + 上传双 binary 到 release.
