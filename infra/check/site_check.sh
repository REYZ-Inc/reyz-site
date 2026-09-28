#!/usr/bin/env bash
# 公開 DNS・TLS 証明書・HTTP 応答の実測（GitHub のランナーから見た「外の世界」）。何も変更しない。
# 使い方: bash infra/check/site_check.sh reyz.inc
set -uo pipefail
D="${1:-reyz.inc}"
out=()
add() { out+=("$*"); }
short() { dig +short +time=5 +tries=1 "$@" 2>/dev/null | sort | tr '\n' ' '; }

add "# site-check: $D ($(date -u +%Y-%m-%dT%H:%M:%SZ))"
for r in 1.1.1.1 8.8.8.8; do
  add "== resolver $r"
  add "NS    $(short @"$r" NS "$D")"
  add "A     $(short @"$r" A "$D")"
  add "AAAA  $(short @"$r" AAAA "$D")"
  add "www   $(short @"$r" CNAME "www.$D")"
  add "DS    $(short @"$r" DS "$D")"
  ad=$(dig +time=5 +tries=1 @"$r" A "$D" +dnssec 2>/dev/null | grep -c 'flags:.* ad')
  add "DNSSEC validated (ad flag): $ad"
done
for h in "$D" "www.$D"; do
  add "== TLS $h"
  cert=$(echo | timeout 15 openssl s_client -servername "$h" -connect "$h:443" 2>/dev/null \
         | openssl x509 -noout -subject -issuer -dates -ext subjectAltName 2>/dev/null | tr -s ' ' | tr '\n' '|')
  add "cert  ${cert:-<no certificate / handshake failed>}"
  add "http  http://$h/  → $(curl -sS -o /dev/null -m 15 -w '%{http_code} redirect=%{redirect_url}' "http://$h/" 2>&1)"
  add "https https://$h/ → $(curl -sS -o /dev/null -m 15 -w '%{http_code} redirect=%{redirect_url}' "https://$h/" 2>&1)"
done

text=$(printf '%s\n' "${out[@]}")
echo "$text"
if [ -n "${GITHUB_ACTIONS:-}" ]; then
  esc=${text//'%'/%25}; esc=${esc//$'\r'/%0D}; esc=${esc//$'\n'/%0A}
  echo "::notice title=site-check $D::$esc"
  { echo '```text'; echo "$text"; echo '```'; } >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
fi
