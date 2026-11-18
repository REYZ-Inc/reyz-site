# 構造・メディア改修の実画面

2026-11-19 JSTに、生成済みサイトを実ブラウザで表示して取得した画像。デザインの合成見本ではない。

| 画像 | 取得対象 | 状態 |
|---|---|---|
| [home-desktop.jpg](home-desktop.jpg) | cloud browserのHome | 実動画のデコード後、利用者操作で停止。1280×720、currentTime 0.5922秒、paused=trueを観測 |
| [home-mobile.png](home-mobile.png) | Chromium、390×844pxのHome | 実動画と固定コピー、3導線が表示された状態 |
| [creative-mobile.png](creative-mobile.png) | Chromium、390×844pxのCreative | 実写、説明、イメージ映像表示、素材の出典と再生操作 |

この画面が参照する入口は`site.fdca354e432d05c5.css`と`experience.bb02b954660bd4cc.js`。本番公開の証明は画像ではなく、対象PRのマージと配備runを参照する。

情報の順序は[サイトの情報設計](../../site-information-architecture.md)、制作方法と素材の出典は[メディア記録](../../media-sources.md)に記載する。
