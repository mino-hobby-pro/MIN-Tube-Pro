const express = require("express");
const path = require("path");
const yts = require("youtube-search-api");
const fetch = require("node-fetch");

const app = express();
const port = process.env.PORT || 3000;

// public フォルダ内の静的ファイル（index.html など）を提供
app.use(express.static(path.join(__dirname, "public")));

// 検索結果を保持するためのグローバル変数
let currentPage = 0;
let currentQuery = "";

// /api/search エンドポイント：クエリパラメータ q を利用して動画検索を実行
app.get("/api/search", async (req, res) => {
  const query = req.query.q;
  const page = req.query.page || 0; // ページ番号を取得
  if (!query) {
    return res.status(400).json({ error: "検索クエリが必要です" });
  }
  try {
    const results = await yts.GetListByKeyword(query, false, 20, page);
    currentPage = parseInt(page) + 1; // 現在のページを更新
    currentQuery = query; // 現在のクエリを保持
    res.json(results);
  } catch (err) {
    next(err);
  }
});

// /api/autocomplete エンドポイント：Google のオートコンプリート API 経由で提案ワードを取得
app.get("/api/autocomplete", async (req, res, next) => {
  const keyword = req.query.q;
  if (!keyword) {
    return res.status(400).json({ error: "検索クエリが必要です" });
  }
  try {
    const url =
      "http://www.google.com/complete/search?client=youtube&hl=ja&ds=yt&q=" +
      encodeURIComponent(keyword);
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    const text = await response.text();
    const jsonStr = text.substring(19, text.length - 1);
    const suggestions = JSON.parse(jsonStr)[1];
    res.json({ suggestions });
  } catch (err) {
    next(err);
  }
});

// /video/:id エンドポイント：動画のIDを元に詳細情報を取得してページ表示
app.get("/video/:id", async (req, res, next) => {
  const videoId = req.params.id;
  if (!videoId) {
    return res.status(400).send("動画IDが必要です");
  }
  try {
    const videoDetails = await yts.GetVideoDetails(videoId);
    let thumb = "";
    if (videoDetails.thumbnails && videoDetails.thumbnails.length > 0) {
      thumb = videoDetails.thumbnails[0].url;
    }
    const html = `
      <!DOCTYPE html>
      <html lang="ja">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${videoDetails.title}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; background-color: #121212; color: #e0e0e0; }
          img { max-width: 100%; height: auto; }
          a { text-decoration: none; color: #bb86fc; }
        </style>
      </head>
      <body>
        <h1>${videoDetails.title}</h1>
        <img src="https://i3.ytimg.com/vi/${videoId}/sddefault.jpg" alt="${videoDetails.title}">
        <p>${videoDetails.description || "詳細情報はありません"}</p>
        <p>公開日: ${videoDetails.publishedTime || "不明"}</p>
        <p>
          <a href="https://www.youtube.com/watch?v=${videoId}" target="_blank">
            YouTubeで視聴する
          </a> ｜ 
          <a href="/">検索に戻る</a>
        </p>
      </body>
      </html>
    `;
    res.send(html);
  } catch (err) {
    next(err);
  }
});

// クライアントサイドのルーティング用に、 /nothing/* へのリクエストは index.html を返す
app.get("/nothing/*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ★ 以下、エラーおよび404用のハンドリング ★
app.use((req, res, next) => {
  res.status(404).sendFile(path.join(__dirname, "public", "error.html"));
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).sendFile(path.join(__dirname, "public", "error.html"));
});

// サーバー起動
app.listen(port, () => {
  console.log(`サーバーがポート ${port} で起動しました。`);
});
