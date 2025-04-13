const express = require("express");
const path = require("path");
const yts = require("youtube-search-api");
const fetch = require("node-fetch");

const app = express();
const port = process.env.PORT || 3000;

// 外部のhealth情報API（health順にAPIリストを返す）
const API_HEALTH_CHECKER = "https://airy-gamy-exoplanet.glitch.me/check";

// public フォルダ内の静的ファイル（index.html、error.html など）を提供
app.use(express.static(path.join(__dirname, "public")));

// 検索結果を保持するためのグローバル変数（任意）
let currentPage = 0;
let currentQuery = "";

/* =====================================================
   /api/search エンドポイント
   クエリパラメータ q を使用して YouTube 動画検索を実行する
   youtube-search-api の GetListByKeyword メソッドを利用
===================================================== */
app.get("/api/search", async (req, res, next) => {
  const query = req.query.q;
  const page = req.query.page || 0; // ページ番号（デフォルトは 0）
  if (!query) {
    return res.status(400).json({ error: "検索クエリが必要です" });
  }
  try {
    const results = await yts.GetListByKeyword(query, false, 20, page);
    currentPage = parseInt(page) + 1; // 現在のページ番号を更新
    currentQuery = query; // 現在の検索クエリを保持
    res.json(results);
  } catch (err) {
    next(err);
  }
});

/* =====================================================
   /api/autocomplete エンドポイント
   Google のオートコンプリートAPIを使って候補ワードを取得する
===================================================== */
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
    // 余計な先頭部分（"window.google.ac.h("）を除去
    const jsonStr = text.substring(19, text.length - 1);
    const suggestions = JSON.parse(jsonStr)[1];
    res.json({ suggestions });
  } catch (err) {
    next(err);
  }
});

/* =====================================================
   /api/playlist エンドポイント
   クエリパラメータ channelName を使用して youtube-search-api で
   関連動画（プレイリスト）情報を取得し、必要な項目（動画ID, タイトル）だけ返す
----------------------------------------------------- */
app.get("/api/playlist", async (req, res, next) => {
  const channelName = req.query.channelName;
  if (!channelName) {
    return res.status(400).json({ error: "channelName パラメータが必要です" });
  }
  try {
    const playlistResults = await yts.GetListByKeyword(channelName, false, 10, 0);
    const playlistItems = playlistResults.items || [];
    const playlist = playlistItems.map(item => ({
      id: item.id, // 動画ID（環境によっては item.videoId などに変更を）
      title: item.title || "No title"
    }));
    res.json({ playlist });
  } catch (err) {
    next(err);
  }
});

/* =====================================================
   /video/:id エンドポイント
   指定された動画IDに対して
    ① /check から health順に並んだAPIリストを取得
    ② 各APIの /api/video/:id から動画詳細（stream_url, videoTitle, videoDes, channel情報、視聴回数、likeCount）を取得
    ③ 同APIの /api/comments/:id によりコメント情報を取得
    ④ 取得した情報を元にHTMLページを生成して返す
        ※ プレイリストはページ読み込み後に非同期取得するため、空のコンテナを用意
===================================================== */
app.get("/video/:id", async (req, res, next) => {
  const videoId = req.params.id;
  if (!videoId) {
    return res.status(400).send("動画IDが必要です");
  }

  try {
    // ① 外部APIの /check で、healthが高い順のAPIリストを取得
    const checkResponse = await fetch(API_HEALTH_CHECKER);
    const apiList = await checkResponse.json();
    if (!Array.isArray(apiList) || apiList.length === 0) {
      return res.status(500).send("有効なAPIリストが取得できませんでした。");
    }

    let videoData = null;
    let commentsData = null;

    // ② APIリスト順に試し、動画詳細とコメント情報を取得する。
    for (const apiBase of apiList) {
      try {
        const videoResponse = await fetch(`${apiBase}/api/video/${videoId}`);
        if (videoResponse.ok) {
          videoData = await videoResponse.json();
        }
        const commentsResponse = await fetch(`${apiBase}/api/comments/${videoId}`);
        if (commentsResponse.ok) {
          commentsData = await commentsResponse.json();
        }
        if (videoData) {
          break; // 動画データが取得できたらループ終了
        }
      } catch (err) {
        console.warn(`${apiBase} でのデータ取得に失敗しました: ${err.message}`);
        continue;
      }
    }

    if (!videoData) {
      return res.status(500).send("動画詳細の取得に失敗しました。");
    }
    if (!commentsData) {
      commentsData = { commentCount: 0, comments: [] };
    }

    // 動画再生用のコンテンツ。stream_url が存在すれば <video> タグ、なければ YouTube 埋め込みを使用
    const videoPlayerHTML = videoData.stream_url
      ? `<video controls autoplay>
           <source src="${videoData.stream_url}" type="video/mp4">
           お使いのブラウザは video タグに対応していません。
         </video>`
      : `<iframe src="https://www.youtube.com/embed/${videoId}" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;

    // ③ コメントのHTML生成
    let commentsHTML = "";
    if (
      commentsData.comments &&
      Array.isArray(commentsData.comments) &&
      commentsData.comments.length > 0
    ) {
      commentsHTML = commentsData.comments
        .map((comment) => {
          const thumb =
            comment.authorThumbnails && comment.authorThumbnails.length > 0
              ? comment.authorThumbnails[0].url
              : "";
          return `
            <div class="comment">
              <div class="comment-header">
                ${thumb ? `<img class="avatar" src="${thumb}" alt="${comment.author}">` : ""}
                <span class="comment-author">${comment.author}</span>
                <span class="comment-time">${comment.publishedText || ""}</span>
              </div>
              <div class="comment-body">${comment.contentHtml || comment.content}</div>
              <div class="comment-stats">Likes: ${comment.likeCount || 0}</div>
            </div>
          `;
        })
        .join("");
    } else {
      commentsHTML = "<p>コメントがありません。</p>";
    }

    // ④ HTMLページの生成
    // レイアウトは flex コンテナで左側に動画・詳細・コメント、右側にプレイリスト（非同期取得）を配置
    const html = `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${videoData.videoTitle}</title>
  <style>
    body { 
      font-family: Arial, sans-serif; 
      margin:0; padding:0; 
      background-color: #121212; 
      color: #e0e0e0; 
    }
    header { 
      padding: 20px; 
      text-align: center; 
      background-color: #1e1e1e; 
    }
    header h1 { margin:0; font-size: 24px; }
    .container { padding: 20px; }
    .main-content {
      display: flex;
      gap: 20px;
      align-items: flex-start;
    }
    .video-section {
      flex: 1;
    }
    .video-player { 
      width: 100%; 
      max-width: 800px; 
      margin: 0 auto; 
    }
    video, iframe { 
      width: 100%; 
      height: auto; 
      background-color: black; 
    }
    .details { 
      max-width: 800px; 
      margin:20px auto; 
    }
    .channel-info { 
      display: flex; 
      align-items: center; 
      margin-bottom: 10px; 
    }
    .channel-avatar { 
      width: 50px; 
      height: 50px; 
      border-radius: 50%; 
      object-fit: cover; 
      margin-right: 10px; 
    }
    .comments { 
      max-width: 800px; 
      margin: 20px auto; 
    }
    .comment { 
      border-bottom: 1px solid #333; 
      padding: 10px 0; 
    }
    .comment-header { 
      display: flex; 
      align-items: center; 
    }
    .avatar { 
      width: 40px; 
      height: 40px; 
      border-radius: 50%; 
      object-fit: cover; 
      margin-right: 10px; 
    }
    .comment-author { 
      font-weight: bold; 
    }
    .comment-time { 
      margin-left: auto; 
      font-size: 12px; 
      color: #aaa; 
    }
    .comment-body { margin: 5px 0; }
    .comment-stats { 
      font-size: 12px; 
      color: #aaa; 
    }
    a { color: #bb86fc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .back-link { 
      margin-top: 20px; 
      display: block; 
      text-align: center; 
    }
    /* プレイリスト領域 */
    .playlist-section {
      width: 300px;
      background-color: #1e1e1e;
      padding: 10px;
      border-radius: 4px;
      max-height: 600px;
      overflow-y: auto;
    }
    .playlist-section h2 {
      font-size: 18px;
      margin-bottom: 10px;
    }
    .playlist-item {
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 10px;
      background-color: #121212;
      padding: 5px;
      border-radius: 4px;
    }
    .playlist-item img {
      width: 90px;
      height: auto;
      display: block;
    }
    .playlist-item-title {
      font-size: 14px;
      font-weight: bold;
      color: #e0e0e0;
    }
  </style>
</head>
<body>
  <header>
    <h1>${videoData.videoTitle}</h1>
  </header>
  <div class="container">
    <div class="main-content">
      <div class="video-section">
        <div class="video-player">
          ${videoPlayerHTML}
        </div>
        <div class="details">
          <h2>動画詳細</h2>
          <div class="channel-info">
            <img class="channel-avatar" src="${videoData.channelImage}" alt="${videoData.channelName}">
            <div>
              <p>${videoData.channelName}</p>
              <p>チャンネルID: ${videoData.channelId}</p>
            </div>
          </div>
          <p>${videoData.videoDes || "詳細情報はありません"}</p>
          <p>視聴回数: ${videoData.videoViews.toLocaleString()}</p>
          <p>いいね: ${videoData.likeCount.toLocaleString()}</p>
          <p>
            <a href="https://www.youtube.com/watch?v=${videoId}" target="_blank">YouTubeで視聴する</a>
          </p>
        </div>
        <div class="comments">
          <h2>コメント (${commentsData.commentCount || 0} 件)</h2>
          ${commentsHTML}
        </div>
        <a class="back-link" href="/">検索に戻る</a>
      </div>
      <div class="playlist-section">
        <h2>${videoData.channelName} のプレイリスト</h2>
        <div id="playlist-container">
          <!-- プレイリストはここに非同期で読み込まれます -->
          <p>読み込み中...</p>
        </div>
      </div>
    </div>
  </div>
  <!-- クライアントサイドのスクリプトでプレイリストを取得 -->
  <script>
    window.addEventListener('DOMContentLoaded', () => {
      const channelName = "${videoData.channelName}";
      fetch('/api/playlist?channelName=' + encodeURIComponent(channelName))
        .then(response => response.json())
        .then(data => {
          let html = "";
          if (data.playlist && data.playlist.length > 0) {
            data.playlist.forEach(item => {
              html += \`
                <div class="playlist-item">
                  <a href="/video/\${item.id}">
                    <img src="https://i3.ytimg.com/vi/\${item.id}/sddefault.jpg" alt="\${item.title}">
                    <div class="playlist-item-title">\${item.title}</div>
                  </a>
                </div>
              \`;
            });
          } else {
            html = "<p>プレイリストがありません。</p>";
          }
          document.getElementById("playlist-container").innerHTML = html;
        })
        .catch(err => {
          console.error(err);
          document.getElementById("playlist-container").innerHTML = "<p>プレイリストの読み込みに失敗しました。</p>";
        });
    });
  </script>
</body>
</html>
    `;
    res.send(html);
  } catch (err) {
    next(err);
  }
});

/* =====================================================
   クライアントサイドのルーティング対応
   /nothing/* へのリクエストは public/index.html を返す
===================================================== */
app.get("/nothing/*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* =====================================================
   エラーハンドリングおよび404ハンドリング
===================================================== */
// 存在しないURLの場合は public/error.html を返す
app.use((req, res, next) => {
  res.status(404).sendFile(path.join(__dirname, "public", "error.html"));
});

// 内部エラーの場合はエラーログを出力し public/error.html を返す
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).sendFile(path.join(__dirname, "public", "error.html"));
});

// サーバー起動
app.listen(port, () => {
  console.log(`サーバーがポート ${port} で起動しました。`);
});