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

// 【追加】APIリストをキャッシュするためのグローバル変数
let apiListCache = [];

// 【追加】APIリストを取得し、グローバル変数に保存するヘルパー関数
async function updateApiListCache() {
  try {
    const response = await fetch(API_HEALTH_CHECKER);
    if (response.ok) {
      apiListCache = await response.json();
      console.log("APIリストキャッシュを更新しました:", apiListCache);
    } else {
      console.error("APIヘルスチェッカーでエラー発生:", response.status);
    }
  } catch (err) {
    console.error("APIリストの更新に失敗しました:", err);
  }
}

// サーバー起動時に一度だけAPIリストを取得してキャッシュする
updateApiListCache();

/**
 * ヘルパー関数：タイムアウト付き fetch
 * 各リクエストは timeout ミリ秒以内に応答がなければエラーとなる
 */
function fetchWithTimeout(url, options = {}, timeout = 4000) {
  return Promise.race([
    fetch(url, options),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout)
    )
  ]);
}

/* =====================================================
   /api/search エンドポイント
   クエリパラメータ q を使用して YouTube 動画検索を実行
===================================================== */
app.get("/api/search", async (req, res, next) => {
  const query = req.query.q;
  const page = req.query.page || 0;
  if (!query) {
    return res.status(400).json({ error: "検索クエリが必要です" });
  }
  try {
    const results = await yts.GetListByKeyword(query, false, 20, page);
    currentPage = parseInt(page) + 1;
    currentQuery = query;
    res.json(results);
  } catch (err) {
    next(err);
  }
});

/* =====================================================
   /api/autocomplete エンドポイント
   Google のオートコンプリート API を使用して候補を取得
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
    const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    const text = await response.text();
    // "window.google.ac.h(" を除去して JSON 部分だけ抽出
    const jsonStr = text.substring(19, text.length - 1);
    const suggestions = JSON.parse(jsonStr)[1];
    res.json({ suggestions });
  } catch (err) {
    next(err);
  }
});

/* =====================================================
   /api/playlist エンドポイント
   クエリパラメータ channelName を使用して関連動画（プレイリスト）を取得
===================================================== */
app.get("/api/playlist", async (req, res, next) => {
  const channelName = req.query.channelName;
  if (!channelName) {
    return res.status(400).json({ error: "channelName パラメータが必要です" });
  }
  try {
    const playlistResults = await yts.GetListByKeyword(channelName, false, 10, 0);
    const playlistItems = playlistResults.items || [];
    const playlist = playlistItems.map(item => ({
      id: item.id, // ※環境により item.videoId になる可能性もあります
      title: item.title || "No title"
    }));
    res.json({ playlist });
  } catch (err) {
    next(err);
  }
});

/* =====================================================
   /video/:id エンドポイント
   指定された動画IDについて、外部APIから動画詳細およびコメント情報を取得
   ・各 API 呼び出しは 4 秒以内のタイムアウト
   ・全体の最大待機時間は 15 秒
   ・15 秒以内に stream_url が取得できなかった場合、fallback として
     https://www.youtube-nocookie.com/embed/動画ID?autoplay=1 を利用
   ・ページ内では右側にプレイリスト表示、そして動画下部に【動画を再読み込み】、【動画を再取得】ボタンと
     サーバー切り替えボタン（DL‑Yvideo／YouTube‑nocookie）を配置します。
===================================================== */
app.get("/video/:id", async (req, res, next) => {
  const videoId = req.params.id;
  if (!videoId) {
    return res.status(400).send("動画IDが必要です");
  }

  try {
    // 【変更】グローバル変数 apiListCache を利用する。
    if (!Array.isArray(apiListCache) || apiListCache.length === 0) {
      return res.status(500).send("有効なAPIリストが取得できませんでした。");
    }
    const apiList = apiListCache;

    let videoData = null;
    let commentsData = null;
    let successfulApi = null;

    // 全体待機時間：15秒
    const overallTimeout = 15000;
    const startTime = Date.now();

    // 15秒以内に stream_url を取得できるか試行
    while (Date.now() - startTime < overallTimeout) {
      for (const apiBase of apiList) {
        if (Date.now() - startTime >= overallTimeout) break;
        try {
          const videoResponse = await fetchWithTimeout(
            `${apiBase}/api/video/${videoId}`,
            {},
            4000 // 各 API ごとのタイムアウト：4秒
          );
          if (videoResponse.ok) {
            const tempData = await videoResponse.json();
            // stream_url が存在するなら取得成功とみなす
            if (tempData.stream_url) {
              videoData = tempData;
              successfulApi = apiBase;
              break;
            }
          }
        } catch (err) {
          console.warn(`${apiBase} での動画取得エラー: ${err.message}`);
          continue;
        }
      }
      if (videoData && videoData.stream_url) break;
    }

    // 15秒以内に stream_url が取得できなかった場合、fallback として youtube-nocookie を設定
    if (!videoData || !videoData.stream_url) {
      videoData = videoData || {};
      videoData.stream_url = "youtube-nocookie";
    }

    // 成功した API がある場合、その API からコメント情報をタイムアウト付きで取得
    if (successfulApi) {
      try {
        const commentsResponse = await fetchWithTimeout(
          `${successfulApi}/api/comments/${videoId}`,
          {},
          4000
        );
        if (commentsResponse.ok) {
          commentsData = await commentsResponse.json();
        }
      } catch (err) {
        console.warn(`${successfulApi} でのコメント取得エラー: ${err.message}`);
      }
    }
    if (!commentsData) {
      commentsData = { commentCount: 0, comments: [] };
    }

    // サーバー側で動画再生用HTMLを作成
    // (1) DL‐Yvideo版（デフォルト、※videoData.stream_url が "youtube-nocookie" でない場合は video タグ）
    const streamEmbedHTML =
      videoData.stream_url !== "youtube-nocookie"
        ? `<video controls autoplay>
             <source src="${videoData.stream_url}" type="video/mp4">
             お使いのブラウザは video タグに対応していません。
           </video>`
        : `<iframe src="https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;

    // (2) YouTube‑nocookie 版（iframe に inline style で埋め込みサイズを指定）
    const youtubeEmbedHTML = `<iframe style="width: 100%; height: 100%;" src="https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;

    // コメント部分の HTML 生成
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

    // HTML ページの生成
    // ・プレイリストは即時表示、動画部分はまずローディングアニメーション（スピナー）表示し、
    //   ページ読み込み完了後1秒で、サーバー切り替えに対応した動画埋め込み用コンテナにデフォルト（DL‑Yvideo版）が挿入されるようにしています。
    const html = `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${videoData.videoTitle || "動画詳細"}</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      margin:0;
      padding:0;
      background-color: #121212;
      color: #e0e0e0;
    }
    header {
      padding: 20px;
      text-align: center;
      background-color: #1e1e1e;
    }
    header h1 {
      margin: 0;
      font-size: 24px;
    }
    .container {
      padding: 20px;
    }
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
    /* ボタン領域 */
    .video-buttons {
      display: flex;
      justify-content: center;
      gap: 10px;
      margin-top: 10px;
    }
    .video-buttons button {
      padding: 8px 12px;
      font-size: 14px;
      cursor: pointer;
      background-color: #333;
      border: none;
      color: #e0e0e0;
      border-radius: 4px;
    }
    .video-buttons button:hover {
      background-color: #555;
    }
    /* サーバー切り替え用コンテナ */
    #server-switcher {
      display: flex;
      justify-content: center;
      gap: 10px;
      margin: 10px 0;
    }
    #server-switcher button {
      padding: 6px 10px;
      font-size: 14px;
      cursor: pointer;
      background-color: #333;
      border: none;
      color: #e0e0e0;
      border-radius: 4px;
    }
    #server-switcher button.active {
      background-color: #bb86fc;
      color: #121212;
    }
    .details {
      max-width: 800px;
      margin: 20px auto;
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
    .comment-body {
      margin: 5px 0;
    }
    .comment-stats {
      font-size: 12px;
      color: #aaa;
    }
    a {
      color: #bb86fc;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    .back-link {
      margin-top: 20px;
      display: block;
      text-align: center;
    }
    /* プレイリスト領域（右側） */
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
    /* ローディングアニメーション（スピナー） */
    .loading-animation {
      display: flex;
      justify-content: center;
      align-items: center;
      height: 300px;
    }
    .spinner {
      border: 8px solid rgba(255, 255, 255, 0.2);
      border-top: 8px solid #bb86fc;
      border-radius: 50%;
      width: 60px;
      height: 60px;
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <header>
    <h1>${videoData.videoTitle || "動画詳細"}</h1>
  </header>
  <div class="container">
    <div class="main-content">
      <div class="video-section">
        <!-- 動画プレイヤー部分：最初はスピナー（ローディングアニメーション）表示 -->
        <div class="video-player" id="video-player-container">
          <div class="loading-animation"><div class="spinner"></div></div>
        </div>
        <!-- サーバー切り替え用のボタン（DL‑Yvideo／YouTube‑nocookie） -->
        <div id="server-switcher">
          <button id="switch-stream-url" class="active">DL‑Yvideo</button>
          <button id="switch-nocookie">YouTube‑nocookie</button>
        </div>
        <!-- 動画再生エリア下にボタンを配置 -->
        <div class="video-buttons">
          <button id="reload-video">動画を再読み込み</button>
          <button id="refetch-video">動画を再取得</button>
        </div>
        <div class="details">
          <h2>動画詳細</h2>
          <div class="channel-info">
            <img class="channel-avatar" src="${videoData.channelImage || ''}" alt="${videoData.channelName || 'チャンネル'}">
            <div>
              <p>${videoData.channelName || 'チャンネル名未設定'}</p>
              <p>チャンネルID: ${videoData.channelId || '不明'}</p>
            </div>
          </div>
          <p>${videoData.videoDes || "詳細情報はありません"}</p>
          <p>視聴回数: ${videoData.videoViews ? videoData.videoViews.toLocaleString() : "0"}</p>
          <p>いいね: ${videoData.likeCount ? videoData.likeCount.toLocaleString() : "0"}</p>
          <p><a href="https://www.youtube.com/watch?v=${videoId}" target="_blank">YouTubeで視聴する</a></p>
        </div>
        <div class="comments">
          <h2>コメント (${commentsData.commentCount || 0} 件)</h2>
          ${commentsHTML}
        </div>
        <a class="back-link" href="/">検索に戻る</a>
      </div>
      <div class="playlist-section">
        <h2>${videoData.channelName || "プレイリスト"}</h2>
        <div id="playlist-container">
          <p>読み込み中...</p>
        </div>
      </div>
    </div>
  </div>
  <!-- クライアントサイドスクリプト -->
  <script>
    window.addEventListener('DOMContentLoaded', () => {
      // プレイリストの非同期取得（即時実行）
      const channelName = "${videoData.channelName || ''}";
      if (channelName) {
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
      } else {
        document.getElementById("playlist-container").innerHTML = "<p>チャネル情報がありません。</p>";
      }

      // クライアントサイド用：2種類の動画埋め込み用HTMLを作成
      const streamEmbedHTML = \`${streamEmbedHTML.replace(/`/g, '\\`')}\`;
      const youtubeEmbedHTML = \`${youtubeEmbedHTML.replace(/`/g, '\\`')}\`;

      // ページが完全に読み込まれてから1秒後に、デフォルトの動画（DL‑Yvideo版＝Stream URL版）を埋め込む
      setTimeout(() => {
        const container = document.getElementById("video-player-container");
        if (container) {
          container.innerHTML = streamEmbedHTML;
        }
      }, 1000);

      // サーバー切り替えボタンの処理
      const btnStream = document.getElementById("switch-stream-url");
      const btnNocookie = document.getElementById("switch-nocookie");
      btnStream.addEventListener("click", () => {
        document.getElementById("video-player-container").innerHTML = streamEmbedHTML;
        btnStream.classList.add("active");
        btnNocookie.classList.remove("active");
      });
      btnNocookie.addEventListener("click", () => {
        document.getElementById("video-player-container").innerHTML = youtubeEmbedHTML;
        btnNocookie.classList.add("active");
        btnStream.classList.remove("active");
      });

      // 「動画を再読み込み」ボタンの処理
      document.getElementById("reload-video").addEventListener("click", () => {
        const videoElem = document.querySelector('.video-player video');
        if (videoElem) {
          videoElem.load();
          videoElem.play();
        } else {
          const iframeElem = document.querySelector('.video-player iframe');
          if (iframeElem) {
            // src を再設定して iframe をリロード
            iframeElem.src = iframeElem.src;
          }
        }
      });

      // 「動画を再取得」ボタンの処理 → ページ全体を再読み込み
      document.getElementById("refetch-video").addEventListener("click", () => {
        window.location.reload();
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
