#!/usr/bin/env bash
# Sets up a VLESS + Reality VPN node (Xray via 3x-ui) on a fresh Ubuntu/Debian
# VPS and optionally registers it in the dashboard.
#
#   curl -fsSL https://<raw-url>/infra/node/install.sh | sudo bash -s -- \
#     --dashboard https://admin.example.com --token <NODE_REGISTRATION_TOKEN> \
#     --name "Netherlands #1" --country NL --city Amsterdam
#
# Without --dashboard it only prints the values to enter in the dashboard form.
set -euo pipefail

# ---------- defaults ----------
DASHBOARD=""
TOKEN=""
NAME=""
COUNTRY=""
CITY=""
TIER="free"
SNI="google.com"
VLESS_PORT=443
PANEL_PORT=""
HOST=""
FORCE=0
# IPv6: give each client its own address from the node's /64 (auto-detected)
IPV6=1
IPV6_PREFIX=""
IPV6_ONLY=0
XUI_VERSION="latest"
# Optional Xray core release to use instead of the one bundled with 3x-ui
XRAY_VERSION=""

INSTALL_DIR=/usr/local/x-ui
STATE_FILE=/root/vpn-node.env

usage() {
	cat <<'EOF'
Usage: install.sh [options]

  --dashboard URL     Dashboard base URL to register the node with
  --token TOKEN       NODE_REGISTRATION_TOKEN from the dashboard .env
  --name NAME         Server name shown in the app (default: "<COUNTRY> <host>")
  --country CC        ISO country code, e.g. NL (required with --dashboard)
  --city CITY         City shown in the app
  --tier free|premium Who can use the server (default: free)
  --sni DOMAIN        Reality camouflage site (default: google.com)
  --port N            VLESS port (default: 443)
  --panel-port N      3x-ui panel port (default: random 20000-60000)
  --host HOST         Public IP/domain clients connect to (default: auto-detect)
  --xui-version TAG   3x-ui release tag (default: latest)
  --xray-version TAG  Replace 3x-ui's bundled Xray core with this release
  --no-ipv6           Do not set up per-client IPv6 addresses
  --ipv6-prefix P     Prefix to hand out to clients (default: upper /65 of the
                      server's /64, e.g. 2a01:4f8:c17:1234:8000::/65)
  --ipv6-only         Never give the server's IPv4 to clients (devices
                      without IPv6 cannot use this server)
  --force             Reinstall over an existing 3x-ui installation
EOF
}

while [[ $# -gt 0 ]]; do
	case "$1" in
	--dashboard) DASHBOARD="${2%/}"; shift 2 ;;
	--token) TOKEN="$2"; shift 2 ;;
	--name) NAME="$2"; shift 2 ;;
	--country) COUNTRY="$(echo "$2" | tr '[:lower:]' '[:upper:]')"; shift 2 ;;
	--city) CITY="$2"; shift 2 ;;
	--tier) TIER="$2"; shift 2 ;;
	--sni) SNI="$2"; shift 2 ;;
	--port) VLESS_PORT="$2"; shift 2 ;;
	--panel-port) PANEL_PORT="$2"; shift 2 ;;
	--host) HOST="$2"; shift 2 ;;
	--xui-version) XUI_VERSION="$2"; shift 2 ;;
	--xray-version) XRAY_VERSION="$2"; shift 2 ;;
	--no-ipv6) IPV6=0; shift ;;
	--ipv6-prefix) IPV6_PREFIX="$2"; shift 2 ;;
	--ipv6-only) IPV6_ONLY=1; shift ;;
	--force) FORCE=1; shift ;;
	-h | --help) usage; exit 0 ;;
	*) echo "Unknown option: $1" >&2; usage; exit 1 ;;
	esac
done

log() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

json_escape() {
	local s=$1
	s=${s//\\/\\\\}
	s=${s//\"/\\\"}
	s=${s//$'\n'/\\n}
	s=${s//$'\r'/}
	s=${s//$'\t'/\\t}
	printf '%s' "$s"
}

# Upper half (/65) of the /64 that contains $1, e.g. 2a01:4f8:c17:1234::1 -> 2a01:4f8:c17:1234:8000::/65
client_prefix_from_addr() {
	local addr=${1%%/*} left right
	local -a l=() r=() g=()
	if [[ "$addr" == *::* ]]; then
		left=${addr%%::*}
		right=${addr#*::}
	else
		left=$addr
		right=""
	fi
	[[ -n "$left" ]] && IFS=: read -ra l <<<"$left"
	[[ -n "$right" ]] && IFS=: read -ra r <<<"$right"
	if [[ "$addr" != *::* ]] && ((${#l[@]} != 8)); then return 1; fi
	g=("${l[@]}")
	local i
	for ((i = ${#l[@]} + ${#r[@]}; i < 8; i++)); do g+=(0); done
	g+=("${r[@]}")
	((${#g[@]} == 8)) || return 1
	printf '%x:%x:%x:%x:8000::/65\n' "0x${g[0]}" "0x${g[1]}" "0x${g[2]}" "0x${g[3]}"
}

rand_alnum() { tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1" || true; }

# ---------- checks ----------
[[ $EUID -eq 0 ]] || die "Run as root (sudo)."
[[ "$TIER" == "free" || "$TIER" == "premium" ]] || die "--tier must be free or premium"
if [[ $IPV6_ONLY -eq 1 && $IPV6 -eq 0 ]]; then
	die "--ipv6-only and --no-ipv6 contradict each other"
fi
if [[ -n "$DASHBOARD" ]]; then
	[[ -n "$TOKEN" ]] || die "--token is required with --dashboard"
	[[ "$COUNTRY" =~ ^[A-Z]{2}$ ]] || die "--country must be a 2-letter code with --dashboard"
fi
if [[ -d "$INSTALL_DIR" && $FORCE -eq 0 ]]; then
	die "3x-ui is already installed in $INSTALL_DIR. Re-run with --force to reinstall (existing inbounds and clients are wiped)."
fi

case "$(uname -m)" in
x86_64 | amd64) ARCH=amd64 XRAY_ASSET=Xray-linux-64.zip ;;
aarch64 | arm64) ARCH=arm64 XRAY_ASSET=Xray-linux-arm64-v8a.zip ;;
*) die "Unsupported CPU architecture: $(uname -m)" ;;
esac

log "Installing packages"
if command -v apt-get >/dev/null; then
	export DEBIAN_FRONTEND=noninteractive
	apt-get update -qq
	apt-get install -y -qq curl openssl tar unzip ca-certificates iproute2 >/dev/null
	if [[ $IPV6 -eq 1 ]]; then
		apt-get install -y -qq ndppd >/dev/null 2>&1 || warn "ndppd is not available; IPv6 will only work if the provider routes the /64 to this server"
	fi
elif command -v dnf >/dev/null; then
	dnf install -y -q curl openssl tar unzip ca-certificates iproute
	if [[ $IPV6 -eq 1 ]]; then
		dnf install -y -q ndppd >/dev/null 2>&1 || warn "ndppd is not available; IPv6 will only work if the provider routes the /64 to this server"
	fi
else
	die "Only apt (Debian/Ubuntu) and dnf (RHEL/Fedora) are supported."
fi

if [[ -z "$HOST" ]]; then
	HOST="$(curl -fsS4 --max-time 10 https://api.ipify.org || curl -fsS4 --max-time 10 https://ifconfig.me || true)"
	[[ -n "$HOST" ]] || die "Could not detect the public IP; pass --host."
fi
[[ -n "$NAME" ]] || NAME="${COUNTRY:-Node} $HOST"
[[ -n "$PANEL_PORT" ]] || PANEL_PORT=$((20000 + RANDOM % 40000))
[[ "$PANEL_PORT" != "$VLESS_PORT" ]] || die "--panel-port must differ from --port"

# Detect IPv6 before touching anything, so a failed check leaves the node as is
LISTEN=""
if [[ $IPV6 -eq 1 ]]; then
	V6_ROUTE="$(ip -6 route get 2001:4860:4860::8888 2>/dev/null || true)"
	V6_SRC="$(sed -nE 's/.* src ([0-9a-fA-F:]+).*/\1/p' <<<"$V6_ROUTE")"
	V6_DEV="$(sed -nE 's/.* dev ([^ ]+).*/\1/p' <<<"$V6_ROUTE")"
	if [[ -z "$IPV6_PREFIX" && -n "$V6_SRC" ]]; then
		IPV6_PREFIX="$(client_prefix_from_addr "$V6_SRC")" || IPV6_PREFIX=""
	fi
	if [[ -z "$IPV6_PREFIX" || -z "$V6_DEV" ]]; then
		if [[ $IPV6_ONLY -eq 1 ]]; then
			die "No global IPv6 found, cannot use --ipv6-only. Enable IPv6 at your provider or pass --ipv6-prefix."
		fi
		warn "No global IPv6 on this server; clients will use IPv4 only."
		IPV6=0
		IPV6_PREFIX=""
	fi
fi
# A previous installation holds its own ports; stop it before checking
systemctl stop x-ui >/dev/null 2>&1 || true
sleep 1
if ss -ltn "sport = :$VLESS_PORT" 2>/dev/null | grep -q LISTEN; then
	die "Port $VLESS_PORT is already in use."
fi

# ---------- kernel tuning ----------
log "Enabling BBR congestion control"
cat >/etc/sysctl.d/99-vpn-node.conf <<'EOF'
net.core.default_qdisc=fq
net.ipv4.tcp_congestion_control=bbr
net.ipv4.tcp_fastopen=3
EOF
sysctl --system >/dev/null 2>&1 || warn "Could not apply sysctl settings"

# ---------- IPv6 (one address per client) ----------
# Clients get random addresses from a prefix the kernel treats as local
# (AnyIP), so the node answers on all of them without configuring each one.
# By default the upper half of the server's /64 is used: providers put the
# gateway and the server's own addresses in the low half, so the two never
# collide. ndppd answers neighbour discovery for the range on providers that
# do not route the /64 to the server.
if [[ $IPV6 -eq 1 ]]; then
	log "Routing $IPV6_PREFIX to this node (one IPv6 per client)"
	cat >/etc/systemd/system/vpn-anyip.service <<UNIT
[Unit]
Description=Route the VPN client IPv6 prefix to this host (AnyIP)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/sbin/ip -6 route replace local $IPV6_PREFIX dev lo
ExecStop=/sbin/ip -6 route del local $IPV6_PREFIX dev lo

[Install]
WantedBy=multi-user.target
UNIT
	systemctl daemon-reload
	systemctl enable vpn-anyip >/dev/null 2>&1
	systemctl restart vpn-anyip
	ip -6 route show table local | grep -q "${IPV6_PREFIX%/*}" || warn "AnyIP route for $IPV6_PREFIX is not active"

	if command -v ndppd >/dev/null; then
		cat >/etc/ndppd.conf <<CONF
proxy $V6_DEV {
	rule $IPV6_PREFIX {
		static
	}
}
CONF
		systemctl enable ndppd >/dev/null 2>&1
		systemctl restart ndppd || warn "ndppd failed to start"
	fi
	# Dual-stack listener: Go's [::] socket also accepts IPv4
	LISTEN="::"
fi

# ---------- 3x-ui ----------
if [[ "$XUI_VERSION" == "latest" ]]; then
	URL="https://github.com/MHSanaei/3x-ui/releases/latest/download/x-ui-linux-${ARCH}.tar.gz"
else
	URL="https://github.com/MHSanaei/3x-ui/releases/download/${XUI_VERSION}/x-ui-linux-${ARCH}.tar.gz"
fi
log "Downloading 3x-ui ($XUI_VERSION, $ARCH)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL --retry 3 -o "$TMP/x-ui.tar.gz" "$URL"
tar -xzf "$TMP/x-ui.tar.gz" -C "$TMP"
[[ -x "$TMP/x-ui/x-ui" ]] || die "Unexpected 3x-ui archive layout"

rm -rf "$INSTALL_DIR"
[[ $FORCE -eq 1 ]] && rm -rf /etc/x-ui
mv "$TMP/x-ui" "$INSTALL_DIR"
chmod +x "$INSTALL_DIR/x-ui" "$INSTALL_DIR"/bin/xray-linux-*
if [[ -f "$INSTALL_DIR/x-ui.sh" ]]; then
	install -m 755 "$INSTALL_DIR/x-ui.sh" /usr/bin/x-ui
fi
XUI="$INSTALL_DIR/x-ui"
XRAY="$INSTALL_DIR/bin/xray-linux-${ARCH}"

if [[ -n "$XRAY_VERSION" ]]; then
	log "Installing Xray core $XRAY_VERSION"
	curl -fsSL --retry 3 -o "$TMP/xray.zip" \
		"https://github.com/XTLS/Xray-core/releases/download/${XRAY_VERSION}/${XRAY_ASSET}"
	unzip -qo "$TMP/xray.zip" xray -d "$TMP/xray"
	install -m 755 "$TMP/xray/xray" "$XRAY"
fi

PANEL_USER="admin_$(rand_alnum 6)"
PANEL_PASS="$(rand_alnum 24)"
PANEL_PATH="$(rand_alnum 16)"

log "Generating panel TLS certificate"
mkdir -p /etc/x-ui/tls
if [[ "$HOST" =~ ^[0-9.]+$ || "$HOST" == *:* ]]; then SAN="IP:$HOST"; else SAN="DNS:$HOST"; fi
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 3650 \
	-subj "/CN=$HOST" -addext "subjectAltName=$SAN" \
	-keyout /etc/x-ui/tls/panel.key -out /etc/x-ui/tls/panel.crt >/dev/null 2>&1
chmod 600 /etc/x-ui/tls/panel.key

log "Configuring panel"
"$XUI" migrate >/dev/null 2>&1 || true
"$XUI" setting -username "$PANEL_USER" -password "$PANEL_PASS" -port "$PANEL_PORT" \
	-webBasePath "$PANEL_PATH" >/dev/null
"$XUI" setting -webCert /etc/x-ui/tls/panel.crt -webCertKey /etc/x-ui/tls/panel.key >/dev/null

cat >/etc/systemd/system/x-ui.service <<EOF
[Unit]
Description=x-ui panel (VLESS + Reality node)
After=network.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR/
ExecStart=$XUI run
Restart=on-failure
RestartSec=5s
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now x-ui >/dev/null 2>&1

PANEL_LOCAL="https://127.0.0.1:${PANEL_PORT}/${PANEL_PATH}"
log "Waiting for the panel to start"
for _ in $(seq 1 30); do
	curl -fsk -o /dev/null --max-time 2 "$PANEL_LOCAL/" && break
	sleep 1
done
curl -fsk -o /dev/null --max-time 2 "$PANEL_LOCAL/" || die "Panel did not start; check: journalctl -u x-ui"

API_TOKEN="$("$XUI" setting -getApiToken 2>/dev/null | sed -n 's/^apiToken:[[:space:]]*//p' | tail -1)"
[[ -n "$API_TOKEN" ]] || die "Could not obtain a 3x-ui API token (needs 3x-ui 3.x)."

# ---------- Reality inbound ----------
log "Creating VLESS + Reality inbound on port $VLESS_PORT (camouflage: $SNI)"
if ! curl -fsS -o /dev/null --max-time 10 --tlsv1.3 "https://$SNI"; then
	warn "$SNI did not answer over TLS 1.3 from this server; consider a different --sni."
fi

KEYS="$("$XRAY" x25519)"
# Xray prints "Private key:/Public key:" (older) or "PrivateKey:/Password (PublicKey):" (newer)
PRIVATE_KEY="$(echo "$KEYS" | sed -nE 's/^Private ?[Kk]ey:[[:space:]]*//p')"
PUBLIC_KEY="$(echo "$KEYS" | sed -nE 's/^(Public ?[Kk]ey|Password( \(PublicKey\))?):[[:space:]]*//p')"
[[ -n "$PRIVATE_KEY" && -n "$PUBLIC_KEY" ]] || die "Could not parse xray x25519 output"
SHORT_ID="$(openssl rand -hex 8)"
PROBE_UUID="$(cat /proc/sys/kernel/random/uuid)"

SETTINGS="{\"clients\":[{\"id\":\"$PROBE_UUID\",\"flow\":\"xtls-rprx-vision\",\"email\":\"probe\",\"enable\":true,\"limitIp\":0,\"totalGB\":0,\"expiryTime\":0}],\"decryption\":\"none\",\"fallbacks\":[]}"
STREAM="{\"network\":\"tcp\",\"security\":\"reality\",\"externalProxy\":[],\"realitySettings\":{\"show\":false,\"xver\":0,\"target\":\"$SNI:443\",\"dest\":\"$SNI:443\",\"serverNames\":[\"$SNI\"],\"privateKey\":\"$PRIVATE_KEY\",\"minClientVer\":\"\",\"maxClientVer\":\"\",\"maxTimediff\":0,\"shortIds\":[\"$SHORT_ID\"],\"settings\":{\"publicKey\":\"$PUBLIC_KEY\",\"fingerprint\":\"chrome\",\"serverName\":\"\",\"spiderX\":\"/\"}},\"tcpSettings\":{\"acceptProxyProtocol\":false,\"header\":{\"type\":\"none\"}}}"
SNIFF='{"enabled":true,"destOverride":["http","tls","quic"],"metadataOnly":false,"routeOnly":true}'
INBOUND="{\"up\":0,\"down\":0,\"total\":0,\"remark\":\"vless-reality\",\"enable\":true,\"expiryTime\":0,\"listen\":\"$LISTEN\",\"port\":$VLESS_PORT,\"protocol\":\"vless\",\"settings\":\"$(json_escape "$SETTINGS")\",\"streamSettings\":\"$(json_escape "$STREAM")\",\"sniffing\":\"$(json_escape "$SNIFF")\"}"

RESP="$(curl -fsSk --max-time 15 -X POST "$PANEL_LOCAL/panel/api/inbounds/add" \
	-H "Authorization: Bearer $API_TOKEN" -H 'Content-Type: application/json' --data "$INBOUND")"
echo "$RESP" | grep -q '"success":true' || die "Inbound creation failed: $RESP"
INBOUND_ID="$(echo "$RESP" | grep -oE '"obj":\{"id":[0-9]+' | grep -oE '[0-9]+$')"
[[ -n "$INBOUND_ID" ]] || die "Could not read inbound id from: $RESP"

for _ in $(seq 1 10); do
	ss -ltn "sport = :$VLESS_PORT" 2>/dev/null | grep -q LISTEN && break
	sleep 1
done
ss -ltn "sport = :$VLESS_PORT" 2>/dev/null | grep -q LISTEN || warn "Xray is not listening on :$VLESS_PORT yet"

# ---------- firewall ----------
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
	log "Opening ports in ufw"
	ufw allow "$VLESS_PORT/tcp" >/dev/null
	ufw allow "$PANEL_PORT/tcp" >/dev/null
fi

PANEL_URL="https://${HOST}:${PANEL_PORT}/${PANEL_PATH}"
PANEL_CERT="$(cat /etc/x-ui/tls/panel.crt)"

umask 077
cat >"$STATE_FILE" <<EOF
# Generated by install.sh on $(date -u +%FT%TZ). Keep private.
HOST=$HOST
VLESS_PORT=$VLESS_PORT
REALITY_PUBLIC_KEY=$PUBLIC_KEY
REALITY_PRIVATE_KEY=$PRIVATE_KEY
REALITY_SHORT_ID=$SHORT_ID
REALITY_SNI=$SNI
INBOUND_ID=$INBOUND_ID
IPV6_PREFIX=$IPV6_PREFIX
PANEL_URL=$PANEL_URL
PANEL_USER=$PANEL_USER
PANEL_PASS=$PANEL_PASS
PANEL_API_TOKEN=$API_TOKEN
EOF

# ---------- register ----------
REGISTERED=0
if [[ -n "$DASHBOARD" ]]; then
	log "Registering node in $DASHBOARD"
	EXPOSE_IPV4=true
	[[ $IPV6_ONLY -eq 1 ]] && EXPOSE_IPV4=false
	BODY="{\"name\":\"$(json_escape "$NAME")\",\"countryCode\":\"$COUNTRY\",\"city\":\"$(json_escape "$CITY")\",\"tier\":\"$TIER\",\"host\":\"$(json_escape "$HOST")\",\"port\":$VLESS_PORT,\"ipv6Prefix\":\"$IPV6_PREFIX\",\"exposeIpv4\":$EXPOSE_IPV4,\"realityPublicKey\":\"$PUBLIC_KEY\",\"realityShortId\":\"$SHORT_ID\",\"realitySni\":\"$(json_escape "$SNI")\",\"fingerprint\":\"chrome\",\"flow\":\"xtls-rprx-vision\",\"panelUrl\":\"$(json_escape "$PANEL_URL")\",\"panelUsername\":\"$PANEL_USER\",\"panelPassword\":\"$PANEL_PASS\",\"panelApiToken\":\"$API_TOKEN\",\"panelInbound\":\"$INBOUND_ID\",\"panelTlsCert\":\"$(json_escape "$PANEL_CERT")\"}"
	if REG="$(curl -fsS --max-time 30 -X POST "$DASHBOARD/api/admin/nodes/register" \
		-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data "$BODY")"; then
		REGISTERED=1
		echo "$REG" | grep -q '"panelOk":true' ||
			warn "Dashboard cannot reach the panel: $REG (is port $PANEL_PORT open to the dashboard?)"
		if echo "$REG" | grep -q '"ipv6Reachable":false'; then
			warn "The dashboard could not reach a client IPv6 in $IPV6_PREFIX. The provider may not route it to this server."
		elif [[ -n "$IPV6_PREFIX" ]] && echo "$REG" | grep -q '"ipv6Reachable":null'; then
			warn "The dashboard host has no IPv6, so client IPv6 reachability was not checked."
		fi
	else
		warn "Registration failed. Add the server manually with the values below."
	fi
fi

echo
log "Node is ready"
cat <<EOF

  Server         $NAME ($HOST:$VLESS_PORT)
  Reality pbk    $PUBLIC_KEY
  Short ID       $SHORT_ID
  SNI            $SNI
  Panel          $PANEL_URL
  Panel login    $PANEL_USER / $PANEL_PASS
  API token      $API_TOKEN
  Inbound ID     $INBOUND_ID
  Client IPv6    ${IPV6_PREFIX:-disabled}$([[ $IPV6_ONLY -eq 1 ]] && echo " (IPv4 hidden from clients)")

  All values are saved in $STATE_FILE
EOF
if [[ $REGISTERED -eq 1 ]]; then
	echo "  Registered in the dashboard: $DASHBOARD/servers"
else
	echo "  Add it in the dashboard: Servers -> Add server (panel type 3x-ui)."
	echo "  Paste /etc/x-ui/tls/panel.crt into \"Panel certificate\"."
fi
