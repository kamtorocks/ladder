# ladder

Clash 订阅配置服务，基于 [PocketBase](https://pocketbase.io) 单容器部署（替代原 Supabase Functions 方案）。

- `GET /clash` —— 输出 Clash YAML 订阅（proxies / proxy-groups / rules / rule-providers）
- `GET /clash-rules/xxx.txt` —— 规则文件下载；`/` 为目录索引页；`/healthz` 为同步状态（原 sync-oss 服务）
- `/_/` —— PocketBase 后台，可视化增删改 proxies / rules / rule_providers / sync_resources
- 数据存放在 SQLite（`pb_data/`），表结构由 `pb_migrations/` 版本化管理

## Hysteria2 节点一键安装

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/kamtorocks/ladder/main/hysteria-install.sh)"
```

需 root 运行。交互输入：域名、Cloudflare API Token（Zone:Read + DNS:Edit）、ACME 邮箱、可选的伪装反代地址、ladder 后台账号。脚本会：

1. 在 Cloudflare 创建/更新 A 记录指向本机（DNS only）
2. 用官方脚本安装 hysteria2，证书由内置 ACME 通过 Cloudflare DNS 验证签发
3. 80/443 伪装为 coming-soon 静态页（或反代到你指定的地址）
4. 配置每日重启 timer
5. 把节点注册到本服务的 `proxies` 表（同名则更新）

每次运行都会重新生成密码。若启用了 ufw，需放行 `443/udp` 与 `80,443/tcp`。

## 目录

| 路径 | 说明 |
| --- | --- |
| `pb_migrations/` | 建表迁移（启动时自动执行） |
| `pb_hooks/clash.pb.js` | `/clash` 路由，读取三张表拼装 YAML |
| `pb_hooks/lib/yaml.js` | 极简 YAML 序列化 |
| `pb_hooks/sync.pb.js` | 规则文件定时同步 + 文件目录服务（`/healthz`、`POST /api/sync`、`/...`） |
| `pb_hooks/lib/sync.js` | 下载（临时文件 + 原子替换）、目录索引渲染 |
| `Dockerfile` | alpine + pocketbase 二进制 + hooks/migrations |
| `docker-compose.yml` | 服务器部署文件（加入 `discovery` 网络，由 NPM 反代） |
| `scripts/deploy.sh` | 拉取最新镜像并重启 |
| `hysteria-install.sh` | hysteria2 节点一键安装并注册到本服务 |

## 数据模型

| 表 | 字段 | 输出 |
| --- | --- | --- |
| `proxies` | `name`、`metadata`(json)、`remark` | `proxies[]`，所有代理自动放进 `Proxy` 选择组 |
| `rule_providers` | `name`、`metadata`(json) | `rule-providers.<name>` |
| `rules` | `keyword`(select)、`value`、`policy`、`sort` | `rules[]`，按 `sort` 升序（相同则按创建时间） |
| `sync_resources` | `filename`、`url`、`disabled` | 定时下载到 `pb_data/sync/<filename>`，按 `/<filename>` 对外提供 |
| `sync_runs` | `trigger`、`started`、`finished`、`ok`、`total`、`failed` | 每次同步的结果，保留最近 30 条 |

## 规则文件同步

- 定时：`SYNC_CRON`（UTC，默认 `0 18 * * *` 即北京时间 02:00）；`SYNC_ON_START=true` 时启动后 1 分钟内先同步一次。
- 手动触发：`POST /api/sync`，需超级管理员 token（`Authorization: <token>`），同步完成后返回结果。
- 下载先写 `.tmp` 再原子替换，单个失败不影响其他文件，旧文件保留；文件响应带 `Cache-Control: public, max-age=300`，支持 Range。
- 修改清单：后台编辑 `sync_resources` 表，`filename` 既是本地相对路径也是访问路径。

## 部署

镜像由 GitHub Actions 构建并推送到 `ghcr.io/kamtorocks/ladder:latest`（push 到 `main` 或打 `v*` tag 触发）。

服务器（`lax.leen.in:/root/ladder`）：

```sh
docker compose pull && docker compose up -d
# 首次：创建后台管理员
docker exec ladder /pb/pocketbase superuser upsert you@example.com 'your-password' --dir=/pb/pb_data
```

本地一键：`pnpm deploy`（即 `scripts/deploy.sh`）。

Nginx Proxy Manager 新建 Proxy Host：`ladder.leen.in` → `http://ladder:8090`，开启 SSL。

可选环境变量 `CLASH_TOKEN`：设置后订阅地址需为 `/clash?token=xxx`。

## 本地开发

```sh
# 下载 pocketbase 二进制到 PATH 后：
pocketbase serve --http=127.0.0.1:8090 --migrationsDir=pb_migrations --hooksDir=pb_hooks
```
