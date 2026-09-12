# ladder

Clash 订阅配置服务，基于 [PocketBase](https://pocketbase.io) 单容器部署（替代原 Supabase Functions 方案）。

- `GET /clash` —— 输出 Clash YAML 订阅（proxies / proxy-groups / rules / rule-providers）
- `/_/` —— PocketBase 后台，可视化增删改 proxies / rules / rule_providers
- 数据存放在 SQLite（`pb_data/`），表结构由 `pb_migrations/` 版本化管理

## 目录

| 路径 | 说明 |
| --- | --- |
| `pb_migrations/` | 建表迁移（启动时自动执行） |
| `pb_hooks/clash.pb.js` | `/clash` 路由，读取三张表拼装 YAML |
| `pb_hooks/lib/yaml.js` | 极简 YAML 序列化 |
| `Dockerfile` | alpine + pocketbase 二进制 + hooks/migrations |
| `docker-compose.yml` | 服务器部署文件（加入 `discovery` 网络，由 NPM 反代） |
| `scripts/migrate-from-supabase.mjs` | 一次性从 Supabase 导入数据 |
| `scripts/deploy.sh` | 拉取最新镜像并重启 |

## 数据模型

| 表 | 字段 | 输出 |
| --- | --- | --- |
| `proxies` | `name`、`metadata`(json)、`remark` | `proxies[]`，所有代理自动放进 `Proxy` 选择组 |
| `rule_providers` | `name`、`metadata`(json) | `rule-providers.<name>` |
| `rules` | `keyword`(select)、`value`、`policy`、`sort` | `rules[]`，按 `sort` 升序（相同则按创建时间） |

## 部署

镜像由 GitHub Actions 构建并推送到 `ghcr.io/kamtorocks/ladder:latest`（push 到 `main` 或打 `v*` tag 触发）。

服务器（`lax.leen.in:/root/ladder`）：

```sh
docker compose pull && docker compose up -d
# 首次：创建后台管理员
docker exec ladder /pb/pocketbase superuser upsert you@example.com 'your-password' --dir=/pb/pb_data
```

本地一键：`pnpm deploy`（即 `scripts/deploy.sh`）。

Nginx Proxy Manager 新建 Proxy Host：`clash.leen.in` → `http://ladder:8090`，开启 SSL。

可选环境变量 `CLASH_TOKEN`：设置后订阅地址需为 `/clash?token=xxx`。

## 本地开发

```sh
# 下载 pocketbase 二进制到 PATH 后：
pocketbase serve --http=127.0.0.1:8090 --migrationsDir=pb_migrations --hooksDir=pb_hooks
```

## 从 Supabase 迁移

```sh
SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_KEY=... \
PB_URL=http://127.0.0.1:8090 PB_EMAIL=you@example.com PB_PASSWORD=... \
node scripts/migrate-from-supabase.mjs
```

脚本幂等，可重复执行。
