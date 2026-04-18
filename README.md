ごめんvercel垢落ちちゃった 全然エラー起きてるわけじゃないです---mino

vercel逝ちゃいましたけどどうするんすか---ねむ

# ver1.2.1
変更点
- ゲームを3つ追加
- wista追加

#  ver1.2.0
変更点
- 視聴履歴を追加
- 高評価した動画を見れるように
- 個人のみの再生リストを追加
- デザインをYoutube風に変更
- モバイルのUIに対応(MIN-Tube-Proのみ)
- チャンネルの閲覧を強化しました
- ゲームを2つ追加
#  ver1.1.1
変更点

- MIN-Tube-Proのライト&ダークモードの変更を可能にしました
- 設定から再生方法を変更可能しました
- チャンネルの閲覧を可能にしました(テスト段階)
- 6つのゲームを追加

#  ver1.1.0
変更点

- 複数のゲームを追加されました
- MIN-Tube-Proのホーム画面を見やすく変更しました

#  ver1.0.4
コメントが表示されないバグを修正しました。
Youtube-search-apiで動画IDを検索、タイトルとチャンネル名を取得する仕様に変更しました。

# ver1.0.3
変更点

タイトルとチャンネル名の取得自動化により読み込みが早くなりました。

# ver1.0.2
変更点

siawaseok 様の API と MIN-Tube2 の API を
Promise.any() を用いて 並列取得する方式に変更

どちらか一方が落ちていても、もう片方から取得できるため
Invidious 依存を完全に排除した堅牢な設計に進化

API 障害に強く、動画メタデータ取得の成功率が大幅に向上


# ver1.0.1
変更点

YouTubeEducation の埋め込みパラメータを
woolisbest 様 と siawaseok 様 の GitHub リポジトリから取得する方式に変更

これにより、手動でパラメータを管理する必要がなくなり、
最新の Education 用パラメータを自動で反映できる設計に改善

# MIN-Tube-Pro

CG / YouTube web app.  
「MIN-Tube-Pro」は、YouTube や動画視聴をより快適にするための Web アプリです。  
ブラウザからすぐにアクセスでき、PC・スマホ問わず軽量に動作することを目指しています。

### デモ
- https://min-tube2.vercel.app
- https://min-tube-pro.vercel.app
- https://min-tube-pro-roan.vercel.app
  
---

## デプロイ

ワンクリックで自分の環境にデプロイできます。

### Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/mino-hobby-pro/MIN-Tube-Pro)

### Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/mino-hobby-pro/MIN-Tube-Pro)

### Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?templateUrl=https://github.com/mino-hobby-pro/MIN-Tube-Pro)

---

## 特徴

- **軽量:** HTML + JavaScript ベースのシンプル構成
- **ホスティングしやすい:** Vercel / Render / Railway などの PaaS に対応しやすい構造
- **Node.js 対応:** `index.js` + `Procfile` によるサーバー起動が可能
- **設定ファイル付き:** `render.yaml` / `railway.json` などのデプロイ設定ファイルを同梱

---

## 必要要件

- **Node.js** (推奨: LTS)
- **npm** または **yarn**

---

## ローカル開発

```bash
# 依存関係のインストール
npm install

# 開発サーバー起動
npm start
# または
node index.js
