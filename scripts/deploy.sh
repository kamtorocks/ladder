#!/usr/bin/env sh
# 拉取 GHCR 最新镜像并重启（服务器：lax.leen.in，目录 /root/ladder）
set -eu
HOST="${DEPLOY_HOST:-root@lax.leen.in}"
DIR="${DEPLOY_DIR:-/root/ladder}"
scp "$(dirname "$0")/../docker-compose.yml" "$HOST:$DIR/docker-compose.yaml"
ssh "$HOST" "cd $DIR && docker compose pull && docker compose up -d --remove-orphans && docker image prune -f >/dev/null && docker compose ps"
