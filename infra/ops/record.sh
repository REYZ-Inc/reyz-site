#!/usr/bin/env bash
# 運用記録: 固定タイトルの issue を探し（無ければ作り）、1 行コメントを追加する。秘密は書かない。
# 環境変数: GH_TOKEN（GitHub App のトークン。issues: write）、REPO、TITLE（issue の題名）、BODY（コメント本文。1 行）、CREATE_BODY（新規作成時の本文。任意）
set -euo pipefail
: "${GH_TOKEN:?GH_TOKEN が必要}" "${REPO:?REPO が必要}" "${TITLE:?TITLE が必要}" "${BODY:?BODY が必要}"
num=$(gh issue list --repo "$REPO" --state all --search "\"$TITLE\" in:title" --json number,title -q ".[] | select(.title == \"$TITLE\") | .number" | head -1)
if [ -z "$num" ]; then
  num=$(gh issue create --repo "$REPO" --title "$TITLE" --body "${CREATE_BODY:-運用記録。workflow が 1 回ごとにコメントを追加する。秘密の値は記録しない。}" | grep -oE '[0-9]+$')
fi
gh issue comment "$num" --repo "$REPO" --body "$BODY" >/dev/null
echo "recorded in issue #$num"
