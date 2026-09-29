# REYZ エンジニアリング標準（正本）

REYZ は、AI オーケストレーション／AI エージェント開発の中核企業として、監査・規制・ガバナンスの技術を世界に提供する側に立つ。
その前提から導かれる唯一の原則:

> **REYZ が世界に示す基準を、REYZ 自身の最小の仕組みから満たす。** 最先端の実務を下回る実装は許容しない。下回る点が見つかったら、黙って残さず是正計画に載せる。

この文書は、その原則を「型」として固定し、破綻させないための **記録の形式** と **判定の手順** を定める。対象はこのリポジトリと、ここから複製される顧客サイト・製品基盤。

## 1. 記録の形式（何を、どこに、どう残すか）

| 種類 | 置き場 | 形式 | いつ書く |
|---|---|---|---|
| 原則・基準表 | `docs/STANDARDS.md`（この文書） | 原則、基準対応表、手順 | 原則や基準が変わったとき |
| 設計書（サブシステムごとの正本） | `docs/<subsystem>.md` | 目的・要件・構成・関門・方針・秘密・運用・参照標準・意図的に含めないもの・変更履歴 | 実装の前。実装で分かった事実を追記 |
| 決定記録（ADR） | `docs/adr/NNNN-<slug>.md` | MADR: 文脈 / 選択肢 / 決定 / 帰結 / 参照。1 決定 1 ファイル、番号は増えるのみ、覆すときは新しい ADR で「置き換え」 | 複数案から選んだとき、方針を決めたとき、外部依存を採るとき |
| 事故記録（ポストモーテム） | `docs/incidents/YYYY-MM-DD-<slug>.md` | 時系列 / 影響 / 根本原因 / 検知 / 是正 / 再発防止 / 教訓。責めない（blameless） | 本番に不具合が出たとき、秘密が漏れたとき、誤配備したとき |
| 変更の説明 | Pull Request 本文（`.github/PULL_REQUEST_TEMPLATE.md`） | 目的 / 参照基準 / 一致と差分 / 検証（FACT） / 未確認 / 影響 | すべての PR |
| 検証の証跡 | GitHub Actions の run（annotation・Summary・artifact） | 機械が生成。人は改変しない | 自動 |
| 稼働の記録 | Cloudflare Workers Logs → 日次で自社保管（設計 v2 で実装） | 構造化 JSON、PII なし | 自動 |

## 2. 基準対応表（最先端の実務 ＝ REYZ の実装）

各行は「出典のある実務」に対する REYZ の状態。判定は PASS / GAP のみ（「概ね」は禁止）。GAP は是正計画（ADR または設計書）を必ず持つ。

| 領域 | 最先端の実務（出典） | REYZ の実装 | 判定 | 是正計画 |
|---|---|---|---|---|
| 変更管理 | 版管理・PR・自動テスト・小さなバッチ・配備前検証（DORA、Continuous Delivery） | GitHub ＋ PR ＋ CI（単体・全検証・CI 内フルスタック e2e）＋ Actions 配備 | PASS | — |
| 変更の承認 | 必須チェック・ブランチ保護・複数人レビュー | 必須チェック設定は作業中（PR #15 後）。レビュアーは 1 名 | GAP | ブランチ保護（ロウ）。2 人目の承認者は組織拡大時 |
| 最小権限 | 鍵は必要な 1 箱だけに届く | Cloudflare トークンはゾーン限定。**Google はドメイン全体の委任＝過大** | GAP | ADR-0002: 送信主体 `no-reply@` 実ユーザー ＋ OAuth 同意へ |
| 秘密の扱い | 秘密はリポジトリ・チャット・ログに出さない。ローテーション | GitHub Secrets → Worker secret。90 日警告 | PASS | — |
| ボット対策 | 多層（OWASP Automated Threats）、代替手段（WCAG 2.2） | Turnstile fail-open ＋ レート制限 ＋ honeypot ＋ ヒューリスティック ＋ メール代替経路 | PASS | — |
| メール認証 | SPF / DKIM / DMARC p=reject（Google・Yahoo 送信者要件、RFC 7489） | 済 | PASS | — |
| 送信主体の分離 | システムのメールは人のアカウントから出さない | CEO のアカウントから送信 | GAP | ADR-0002 |
| 受信の保護 | MTA-STS ＋ TLS-RPT（RFC 8461 / 8460） | 未 | GAP | 設計 v2 段階 2 |
| 到達性の監視 | Postmaster Tools、DMARC 集計の解析 | dmarc@ 受け口のみ | GAP | 設計 v2 段階 2 |
| 役割アドレス | RFC 2142（noc / hostmaster / security / abuse / postmaster）、RFC 9116（security.txt） | contact / hostmaster / dmarc / noc は済。security@・security.txt は未 | GAP | 設計 v2 段階 2 |
| 配備前検証 | 本物の部品で通し検証（提供元の公式テストキー） | `stack-e2e`（Turnstile 公式テストキー、Google トークン取得） | PASS | — |
| 監視・通知 | 合成監視、異常時のみ通知、当番 | 配備後 e2e、日次集計、noc@ へ異常時通知 | PASS | — |
| 証跡の保全 | 監査に耐える保持期間、改変不可 | Cloudflare の保持期間（無料枠 3 日）に依存 | GAP | 設計 v2 段階 3: 日次書き出し |
| 事故対応 | blameless ポストモーテム、再発防止の追跡 | `docs/incidents/` に記録（2026-09-29 から） | PASS | — |
| AI の関与の可視化 | 誰（人／AI）が書き、誰が承認したかを機械的に区別 | AI のコミットが CEO のアカウント名義 | GAP | ADR（予定）: AI 専用 GitHub App |
| 提供元の差し替え可能性 | 宣言は自社、事業者は adapter | DNS as code、Worker の adapter 構成 | PASS | — |

## 3. 判定の手順（Full Cycle）

重要な成果物には次を順に適用し、結果を PR 本文に残す。

1. 出力生成 → 2. 反証（自分で壊す） → 3. 是正 → 4. Red Team（敵対的再攻撃） → 5. 再是正 → 6. Fact Check（出典・実測） → 7. 再検証（ゼロから） → 8. 全件立証（PASS / FAIL、BLOCKING / DECISION / RECORD） → 9. 納品

- 事実（FACT）・推論（INFERENCE）・仮説（HYPOTHESIS）を分けて書く。確認できない主張を確認済みとして書かない
- BLOCKING が 1 件でもあれば納品しない。DECISION は決定者（CEO）が閉じる。RECORD は監査欄に残し、進行を止めない
- 「世界最高」「完璧」は目標であって事実ではない。事実として書くときは比較対象・実測・再現手順を添える

## 4. 破綻させないための機械的な仕組み

| 仕組み | 効果 |
|---|---|
| PR テンプレート（必須見出し） | 参照基準・検証・未確認を書かない PR を作れない |
| `docs-gate` チェック | PR 本文に必須見出しがなければ失敗。ブランチ保護の必須チェックに含める |
| 必須チェック `worker-tests` / `stack-e2e` / `site-verify` / `docs-gate` | 関門を通らない変更は main に入らない |
| ADR の連番・置き換え規則 | 決定の履歴が消えない。「なぜそうなっているか」が常に追える |
| 事故記録の再発防止欄に PR 番号を必須化 | 再発防止が実装されたことを追跡できる |

## 5. 索引

- 設計書: [contact-pipeline.md](contact-pipeline.md)
- 決定記録: [adr/](adr/)
- 事故記録: [incidents/](incidents/)
