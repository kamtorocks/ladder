#!/bin/bash

read -p "Please input DOMAIN: " DOMAIN
read -p "Please input CF_Email: " CF_Email
read -p "Please input CF_Key: " CF_Key
read -p "Please input LADDER_URL (e.g. https://ladder.leen.in): " LADDER_URL
read -p "Please input LADDER_EMAIL (PocketBase superuser): " LADDER_EMAIL
read -s -p "Please input LADDER_PASSWORD: " LADDER_PASSWORD; echo

sudo apt-get update
sudo apt-get install -y jq zip

if ! command -v nginx &>/dev/null; then
    sudo apt-get install -y nginx
fi

NGINX_HTML_DIR="/var/www/html"
RELEASE_INFO=$(curl -s "https://api.github.com/repos/kamto7/coming-soon/releases/latest")
BUILD_ZIP_URL=$(echo "$RELEASE_INFO" | jq -r '.assets[] | select(.name=="build.zip").browser_download_url')
curl -s -L -o build.zip "$BUILD_ZIP_URL"
sudo rm -rf "${NGINX_HTML_DIR:?}/*"
sudo unzip build.zip -d "$NGINX_HTML_DIR"
rm build.zip

echo -e "server {\n    listen 2000;\n    return 400;\n}" | sudo tee /etc/nginx/conf.d/listen_2000.conf
sudo systemctl restart nginx

if [ ! -d "$HOME/.acme.sh" ]; then
    export CF_Key=$CF_Key
    export CF_Email=$CF_Email
    curl https://get.acme.sh | sh -s email=$CF_Email
fi

ECC_DIR="$HOME/.acme.sh/${DOMAIN}_ecc"
CERT_FILE="$HOME/.acme.sh/${DOMAIN}_ecc/${DOMAIN}.cer"
KEY_FILE="$HOME/.acme.sh/${DOMAIN}_ecc/${DOMAIN}.key"

if [ ! -d "$ECC_DIR" ]; then
    $HOME/.acme.sh/acme.sh --issue --dns dns_cf -d $DOMAIN
fi

LOCAL_IP=$(curl -s https://ipinfo.io/ip)
BASE_DOMAIN=$(echo "$DOMAIN" | awk -F. '{print $(NF-1)"."$NF}')
SUBDOMAIN=$(echo "$DOMAIN" | cut -d '.' -f 1)
ZONE_ID=$(curl -s -X GET "https://api.cloudflare.com/client/v4/zones?name=${BASE_DOMAIN}" -H "X-Auth-Email: $CF_Email" -H "X-Auth-Key: $CF_Key" -H "Content-Type: application/json" | jq -r '.result[0].id')
RECORD_ID=$(curl -s -X GET "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?type=A&name=$SUBDOMAIN" -H "X-Auth-Email: $CF_Email" -H "X-Auth-Key: $CF_Key" -H "Content-Type: application/json" | jq -r '.result[0].id')
if [ "$RECORD_ID" == "null" ]; then
  # Create new A record
  curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" -H "X-Auth-Email: $CF_Email" -H "X-Auth-Key: $CF_Key" -H "Content-Type: application/json" --data "{\"type\":\"A\",\"name\":\"$SUBDOMAIN\",\"content\":\"$LOCAL_IP\",\"ttl\":120,\"proxied\":false}"
else
  # Update existing A record
  curl -s -X PUT "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$RECORD_ID" -H "X-Auth-Email: $CF_Email" -H "X-Auth-Key: $CF_Key" -H "Content-Type: application/json" --data "{\"type\":\"A\",\"name\":\"$SUBDOMAIN\",\"content\":\"$LOCAL_IP\",\"ttl\":120,\"proxied\":false}"
fi

RANDOM_PASSWORD=$(head /dev/urandom | tr -dc A-Za-z0-9 | head -c8)

if [ ! -d "/usr/local/trojan" ]; then
    LATEST_RELEASE=$(curl -s "https://api.github.com/repos/p4gefau1t/trojan-go/releases/latest" | jq -r '.tag_name')
    wget https://github.com/p4gefau1t/trojan-go/releases/download/${LATEST_RELEASE}/trojan-go-linux-amd64.zip
    sudo unzip trojan-go-linux-amd64.zip -d /usr/local/trojan
    rm trojan-go-linux-amd64.zip
fi

sudo bash -c "cat > /usr/local/trojan/server.json <<EOL
{
    \"run_type\": \"server\",
    \"local_addr\": \"0.0.0.0\",
    \"local_port\": 443,
    \"remote_addr\": \"127.0.0.1\",
    \"remote_port\": 80,
    \"password\": [
        \"${RANDOM_PASSWORD}\"
    ],
    \"ssl\": {
        \"cert\": \"${CERT_FILE}\",
        \"key\": \"${KEY_FILE}\",
        \"fallback_port\": 2000
    }
}
EOL"

sudo /bin/bash -c 'cat >/etc/systemd/system/trojan.service <<-EOF
[Unit]
Description=Trojan
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/trojan/trojan-go -config /usr/local/trojan/server.json
KillMode=process
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
EOF'

sudo /bin/bash -c 'cat >/etc/systemd/system/trojan-restart.service <<-EOF
[Unit]
Description=Restart Trojan

[Service]
ExecStart=/bin/systemctl restart trojan

[Install]
WantedBy=multi-user.target
EOF'

sudo /bin/bash -c 'cat >/etc/systemd/system/trojan-restart.timer <<-EOF
[Unit]
Description=Restart Trojan service every day

[Timer]
OnCalendar=daily
Unit=trojan-restart.service

[Install]
WantedBy=timers.target
EOF'

sudo systemctl daemon-reload

sudo systemctl start trojan.service
sudo systemctl enable trojan.service

sudo systemctl start trojan-restart.timer
sudo systemctl enable trojan-restart.timer

METADATA=$(
    cat <<EOL
{
  "name": "${SUBDOMAIN}",
  "port": 443,
  "type": "trojan",
  "server": "${DOMAIN}",
  "password": "${RANDOM_PASSWORD}",
  "skip-cert-verify": true,
  "udp": true
}
EOL
)

METADATA_JSON_STRING=$(echo "$METADATA" | jq -c .)
LADDER_URL="${LADDER_URL%/}"

# 注册节点到 ladder（PocketBase）：按 name 幂等 upsert 到 proxies 表
LADDER_TOKEN=$(curl -s -X POST "${LADDER_URL}/api/collections/_superusers/auth-with-password" \
    -H "Content-Type: application/json" \
    -d "{\"identity\":\"${LADDER_EMAIL}\",\"password\":\"${LADDER_PASSWORD}\"}" | jq -r '.token // empty')
if [ -z "$LADDER_TOKEN" ]; then
    echo "ladder: login failed, proxy not registered" >&2
else
    EXISTING_ID=$(curl -s -G "${LADDER_URL}/api/collections/proxies/records" \
        --data-urlencode "filter=name=\"${SUBDOMAIN}\"" \
        -H "Authorization: ${LADDER_TOKEN}" | jq -r '.items[0].id // empty')
    BODY="{\"name\":\"${SUBDOMAIN}\",\"metadata\":${METADATA_JSON_STRING}}"
    if [ -n "$EXISTING_ID" ]; then
        curl -s -X PATCH "${LADDER_URL}/api/collections/proxies/records/${EXISTING_ID}" \
            -H "Authorization: ${LADDER_TOKEN}" -H "Content-Type: application/json" -d "$BODY" >/dev/null
    else
        curl -s -X POST "${LADDER_URL}/api/collections/proxies/records" \
            -H "Authorization: ${LADDER_TOKEN}" -H "Content-Type: application/json" -d "$BODY" >/dev/null
    fi
fi

function print_green() {
  echo -e "\033[32m$1\033[0m"
}

print_green "Finished!"
