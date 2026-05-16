# jjplan

为 AI 设计的 Spec/Task/Ask 跟踪. 数据在 Cloudflare D1, 通过 Worker 暴露; 本地两个 CLI (`jjplan` + `jjask`).

## 安装

```sh
curl -fsSL https://raw.githubusercontent.com/yigegongjiang/jj-plan/main/install.sh | bash
```

一条命令同时装 `jjplan` + `jjask` (不支持单独安装). 共用配置 `~/.jjplan/config.json`:

```json
{ "endpoint": "https://jjplan.<acct>.workers.dev", "token": "<password>" }
```

`wrangler secret put JJPLAN_TOKEN` 把同一个值塞进 Worker.

## 用

`jjplan --help` / `jjask --help`. 浏览器开 `endpoint` 看 dashboard.

## 更新 / 卸载 / 换密码

`jjplan self-update` 与 `jjask self-update` 等价, 都会同时更新 `jjplan` + `jjask`; `uninstall` 同理两个都卸. 换密码: `echo -n '<password>' | wrangler secret put JJPLAN_TOKEN`, 同步 config.json 与浏览器 localStorage.

## 版本号

仓库根 `VERSION` 是唯一来源, Worker / Web / `jjplan` / `jjask` 共用同一版本号, 每次发版统一 bump 即使无代码改动. 发版: 改 VERSION + CHANGELOG → commit → 打 tag `v<VERSION>` → CI 部署 Worker + 上传 binary 到 release.
