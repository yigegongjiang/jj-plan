# jjplan

个人 Spec / Task 追踪。数据存 Cloudflare D1, 通过 Worker 暴露; 本地一个 CLI 二进制访问。

## 安装

```sh
curl -fsSL https://raw.githubusercontent.com/yangfan-elestyle/jj-plan/main/install.sh | bash
```

写 `~/.jjplan/config.json`:

```json
{ "endpoint": "https://jjplan.<acct>.workers.dev", "token": "<password>" }
```

`token` 是字符串密码, 长短随意。用 `wrangler secret put JJPLAN_TOKEN` 把同一个值塞进 Worker, 同值写入 config.json。

## 用

1. `jjplan --help`
2. 浏览器打开 `endpoint`, 输入密码进入。

## 卸载

```sh
jjplan uninstall
```

## 换密码

```sh
echo -n '<password>' | wrangler secret put JJPLAN_TOKEN
# 同步更新 ~/.jjplan/config.json 与浏览器 localStorage
```

## 版本号

仓库根目录 `VERSION` 是唯一来源。发版前先改它, 再打同名 tag (`v<VERSION>`); CI 会校验 tag 与 `VERSION` 一致才放行 release。CLI build 注入到二进制, `jjplan --version` 输出。
