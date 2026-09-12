#!/bin/bash
# hysteria2 节点一键安装（Ubuntu/Debian，需 root）：
#   1. Cloudflare 创建/更新 A 记录指向本机
#   2. 官方脚本安装 hysteria2，内置 ACME 通过 Cloudflare DNS 验证签发证书
#   3. 80/443 伪装：默认用 hysteria 自带静态文件服务展示 coming-soon 页面，也可反代到其他地址
#   4. 每日重启 timer
#   5. 把节点注册到 ladder（PocketBase）的 proxies 表
# 每次运行都会重新生成密码并覆盖 /etc/hysteria/config.yaml。
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo "Please run as root" >&2
    exit 1
fi

read -p "Please input DOMAIN (e.g. lax.leen.in): " DOMAIN
read -p "Please input CF_API_TOKEN (Zone:Read + DNS:Edit): " CF_API_TOKEN
read -p "Please input ACME_EMAIL: " ACME_EMAIL
read -p "Please input MASQUERADE_URL (empty = serve coming-soon page): " MASQUERADE_URL
read -p "Please input LADDER_URL (e.g. https://ladder.leen.in): " LADDER_URL
read -p "Please input LADDER_EMAIL (PocketBase superuser): " LADDER_EMAIL
read -s -p "Please input LADDER_PASSWORD: " LADDER_PASSWORD; echo

apt-get update
apt-get install -y curl jq unzip

BASE_DOMAIN=$(echo "$DOMAIN" | awk -F. '{print $(NF-1)"."$NF}')
SUBDOMAIN=$(echo "$DOMAIN" | cut -d '.' -f 1)
LOCAL_IP=$(curl -4fsS https://ipinfo.io/ip)
WWW_DIR="/var/www/html"

# ---------- Cloudflare A 记录（必须 DNS only，QUIC 不能过 CF 代理） ----------
CF_API="https://api.cloudflare.com/client/v4"
cf() {
    curl -fsS -H "Authorization: Bearer ${CF_API_TOKEN}" -H "Content-Type: application/json" "$@"
}
ZONE_ID=$(cf "${CF_API}/zones?name=${BASE_DOMAIN}" | jq -r '.result[0].id // empty')
if [ -z "$ZONE_ID" ]; then
    echo "Cloudflare zone ${BASE_DOMAIN} not found (check token permissions)" >&2
    exit 1
fi
RECORD_ID=$(cf "${CF_API}/zones/${ZONE_ID}/dns_records?type=A&name=${DOMAIN}" | jq -r '.result[0].id // empty')
RECORD_DATA="{\"type\":\"A\",\"name\":\"${DOMAIN}\",\"content\":\"${LOCAL_IP}\",\"ttl\":120,\"proxied\":false}"
if [ -z "$RECORD_ID" ]; then
    cf -X POST "${CF_API}/zones/${ZONE_ID}/dns_records" --data "$RECORD_DATA" | jq -r '"DNS A record created: " + (.success|tostring)'
else
    cf -X PUT "${CF_API}/zones/${ZONE_ID}/dns_records/${RECORD_ID}" --data "$RECORD_DATA" | jq -r '"DNS A record updated: " + (.success|tostring)'
fi

# ---------- 伪装页面（仅在未指定 MASQUERADE_URL 时需要） ----------
if [ -z "$MASQUERADE_URL" ]; then
    BUILD_ZIP_URL=$(curl -fsS "https://api.github.com/repos/kamto7/coming-soon/releases/latest" \
        | jq -r '.assets[] | select(.name=="build.zip").browser_download_url')
    curl -fsSL -o /tmp/build.zip "$BUILD_ZIP_URL"
    rm -rf "${WWW_DIR:?}"
    mkdir -p "$WWW_DIR"
    unzip -qo /tmp/build.zip -d "$WWW_DIR"
    rm -f /tmp/build.zip
    chmod -R a+rX "$WWW_DIR"
fi

# ---------- 安装 hysteria2（官方脚本，重复执行即升级） ----------
bash <(curl -fsSL https://get.hy2.sh/)

RANDOM_PASSWORD=$(head /dev/urandom | tr -dc A-Za-z0-9 | head -c16)

if [ -n "$MASQUERADE_URL" ]; then
    MASQUERADE_BLOCK="  type: proxy
  proxy:
    url: ${MASQUERADE_URL}"
else
    MASQUERADE_BLOCK="  type: file
  file:
    dir: ${WWW_DIR}"
fi

mkdir -p /etc/hysteria
cat > /etc/hysteria/config.yaml <<EOL
listen: :443

acme:
  domains:
    - ${DOMAIN}
  email: ${ACME_EMAIL}
  type: dns
  dns:
    name: cloudflare
    config:
      cloudflare_api_token: ${CF_API_TOKEN}

auth:
  type: password
  password: ${RANDOM_PASSWORD}

masquerade:
${MASQUERADE_BLOCK}
  listenHTTP: :80
  listenHTTPS: :443
  forceHTTPS: true
EOL
chown root:hysteria /etc/hysteria/config.yaml
chmod 640 /etc/hysteria/config.yaml

# ---------- 每日重启 ----------
cat > /etc/systemd/system/hysteria-server-restart.service <<EOL
[Unit]
Description=Restart Hysteria Server

[Service]
Type=oneshot
ExecStart=/bin/systemctl restart hysteria-server.service
EOL

cat > /etc/systemd/system/hysteria-server-restart.timer <<EOL
[Unit]
Description=Restart Hysteria Server daily

[Timer]
OnCalendar=daily
Unit=hysteria-server-restart.service

[Install]
WantedBy=timers.target
EOL

systemctl daemon-reload
systemctl enable hysteria-server.service hysteria-server-restart.timer
systemctl restart hysteria-server.service
systemctl start hysteria-server-restart.timer

# ---------- 注册节点到 ladder（PocketBase）：按 name 幂等 upsert 到 proxies 表 ----------
METADATA_JSON_STRING=$(jq -cn --arg name "$SUBDOMAIN" --arg server "$DOMAIN" --arg password "$RANDOM_PASSWORD" \
    '{name: $name, type: "hysteria2", server: $server, port: 443, password: $password}')
LADDER_URL="${LADDER_URL%/}"

LADDER_TOKEN=$(curl -fsS -X POST "${LADDER_URL}/api/collections/_superusers/auth-with-password" \
    -H "Content-Type: application/json" \
    -d "{\"identity\":\"${LADDER_EMAIL}\",\"password\":\"${LADDER_PASSWORD}\"}" | jq -r '.token // empty' || true)
if [ -z "$LADDER_TOKEN" ]; then
    echo "ladder: login failed, proxy not registered" >&2
else
    EXISTING_ID=$(curl -fsS -G "${LADDER_URL}/api/collections/proxies/records" \
        --data-urlencode "filter=name=\"${SUBDOMAIN}\"" \
        -H "Authorization: ${LADDER_TOKEN}" | jq -r '.items[0].id // empty')
    BODY="{\"name\":\"${SUBDOMAIN}\",\"metadata\":${METADATA_JSON_STRING}}"
    if [ -n "$EXISTING_ID" ]; then
        curl -fsS -X PATCH "${LADDER_URL}/api/collections/proxies/records/${EXISTING_ID}" \
            -H "Authorization: ${LADDER_TOKEN}" -H "Content-Type: application/json" -d "$BODY" >/dev/null
        echo "ladder: proxy ${SUBDOMAIN} updated"
    else
        curl -fsS -X POST "${LADDER_URL}/api/collections/proxies/records" \
            -H "Authorization: ${LADDER_TOKEN}" -H "Content-Type: application/json" -d "$BODY" >/dev/null
        echo "ladder: proxy ${SUBDOMAIN} created"
    fi
fi

print_green() {
  echo -e "\033[32m$1\033[0m"
}

print_green "Finished! hysteria2 ${DOMAIN}:443 password=${RANDOM_PASSWORD}"
