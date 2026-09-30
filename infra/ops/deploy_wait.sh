#!/usr/bin/env bash
# contact-worker（main）を起動し、その run の完了を待つ。運用 workflow（oauth-consent / turnstile-rotate）から使う。
# 環境変数: GH_TOKEN（GitHub App のトークン。actions: write）、REPO（owner/name）
# 出力: 標準出力に "run_id=<id>" と "conclusion=<success|failure|...>"（GITHUB_OUTPUT があればそこにも書く）。success でなければ exit 1
set -euo pipefail
: "${GH_TOKEN:?GH_TOKEN が必要}" "${REPO:?REPO が必要}"
WORKFLOW="${WORKFLOW:-contact-worker.yml}"; TRIES="${TRIES:-40}"; INTERVAL="${INTERVAL:-15}"
before=$(date -u +%s)
gh workflow run "$WORKFLOW" --repo "$REPO" --ref main
sleep 20
run_id=""; conclusion=""
for i in $(seq 1 "$TRIES"); do
  row=$(gh run list --repo "$REPO" --workflow "$WORKFLOW" --event workflow_dispatch --branch main --limit 1 --json databaseId,status,conclusion,createdAt -q '.[0] | "\(.databaseId) \(.status) \(.conclusion) \(.createdAt)"' || true)
  set -- $row; id=${1:-}; status=${2:-}; concl=${3:-}; created=${4:-}
  if [ -n "$created" ] && [ "$(date -u -d "$created" +%s)" -ge "$before" ]; then
    run_id=$id; conclusion=$concl
    echo "try $i: run $id $status $concl"
    [ "$status" = "completed" ] && break
  else
    echo "try $i: waiting for the dispatched run to appear"
  fi
  sleep "$INTERVAL"
done
echo "run_id=$run_id"; echo "conclusion=$conclusion"
if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "run_id=$run_id" >> "$GITHUB_OUTPUT"; echo "conclusion=$conclusion" >> "$GITHUB_OUTPUT"; fi
[ "$conclusion" = "success" ] || { echo "::error title=deploy_wait::配備（$WORKFLOW run ${run_id:-?}）が success になりませんでした（${conclusion:-timeout}）"; exit 1; }
