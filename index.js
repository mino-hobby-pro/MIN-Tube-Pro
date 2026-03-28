const express = require("express");
const path = require("path");
const yts = require("youtube-search-api");
const fetch = require("node-fetch");
const cookieParser = require("cookie-parser");

const app = express();
const port = process.env.PORT || 3000;

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

const API_HEALTH_CHECKER = "https://raw.githubusercontent.com/Minotaur-ZAOU/test/refs/heads/main/min-tube-api.json";
const TEMP_API_LIST = "https://raw.githubusercontent.com/Minotaur-ZAOU/test/refs/heads/main/min-tube-api.json";
const RAPID_API_HOST = 'ytstream-download-youtube-videos.p.rapidapi.com';

const keys = [
  process.env.RAPIDAPI_KEY_1 || '69e2995a79mshcb657184ba6731cp16f684jsn32054a070ba5',
  process.env.RAPIDAPI_KEY_2 || 'ece95806fdmshe322f47bce30060p1c3411jsn41a3d4820039',
  process.env.RAPIDAPI_KEY_3 || '41c9265bc6msha0fa7dfc1a63eabp18bf7cjsne6ef10b79b38'
];

app.use(express.static(path.join(__dirname, "public")));
app.use(cookieParser());

let apiListCache = [];

async function updateApiListCache() {
  try {
    const response = await fetch(API_HEALTH_CHECKER);
    if (response.ok) {
      const mainApiList = await response.json();
      if (Array.isArray(mainApiList) && mainApiList.length > 0) {
        apiListCache = mainApiList;
        console.log("API List updated.");
      }
    }
  } catch (err) {
    console.error("API update failed.");
  }
}

updateApiListCache();
setInterval(updateApiListCache, 1000 * 60 * 10);

function fetchWithTimeout(url, options = {}, timeout = 5000) {
  return Promise.race([
    fetch(url, options),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout)
    )
  ]);
}

// ミドルウェア: 人間確認
app.use(async (req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/video") || req.path === "/") {
    if (!req.cookies || req.cookies.humanVerified !== "true") {
      const pages = [
        'https://raw.githubusercontent.com/mino-hobby-pro/memo/refs/heads/main/min-tube-pro-main-loading.txt'
      ];
      const randomPage = pages[Math.floor(Math.random() * pages.length)];
      try {
        const response = await fetch(randomPage);
        const htmlContent = await response.text();
        return res.render("robots", { content: htmlContent });
      } catch (err) {
        return res.render("robots", { content: "<p>Verification Required</p>" });
      }
    }
  }
  next();
});

// --- API ENDPOINTS ---

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "home.html"));
});

app.get("/api/trending", async (req, res) => {
  const page = parseInt(req.query.page) || 0;
  try {
    const trendingSeeds = [
      "人気急上昇", "最新 ニュース", "Music Video Official", 
      "ゲーム実況 人気", "話題の動画", "トレンド", 
      "Breaking News Japan", "Top Hits", "いま話題"
    ];

    const seed1 = trendingSeeds[(page * 2) % trendingSeeds.length];
    const seed2 = trendingSeeds[(page * 2 + 1) % trendingSeeds.length];

    const [res1, res2] = await Promise.all([
      yts.GetListByKeyword(seed1, false, 25),
      yts.GetListByKeyword(seed2, false, 25)
    ]);

    let combined = [...(res1.items || []), ...(res2.items || [])];
    const finalItems = [];
    const seenIdsServer = new Set();

    for (const item of combined) {
      if (item.type === 'video' && !seenIdsServer.has(item.id)) {
        if (item.viewCountText) {
          seenIdsServer.add(item.id);
          finalItems.push(item);
        }
      }
    }

    const result = finalItems.sort(() => 0.5 - Math.random());
    res.json({ items: result });
    
  } catch (err) {
    console.error("Trending API Error:", err);
    res.json({ items: [] });
  }
});


app.get("/api/search", async (req, res, next) => {
  const query = req.query.q;
  const page = req.query.page || 0;
  if (!query) return res.status(400).json({ error: "Query required" });
  try {
    const results = await yts.GetListByKeyword(query, false, 20, page);
    res.json(results);
  } catch (err) { next(err); }
});

// ★★★ パーフェクト・アルゴリズム (Shorts許可版) ★★★
app.get("/api/recommendations", async (req, res) => {
  const { title, channel, id } = req.query;
  try {
    const cleanKwd = title
      .replace(/[【】「」()!！?？\[\]]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const words = cleanKwd.split(' ').filter(w => w.length >= 2);
    const mainTopic = words.length > 0 ? words.slice(0, 2).join(' ') : cleanKwd;

    const [topicRes, channelRes, relatedRes] = await Promise.all([
      yts.GetListByKeyword(`${mainTopic}`, false, 12),
      yts.GetListByKeyword(`${channel}`, false, 8),
      yts.GetListByKeyword(`${mainTopic} 関連`, false, 8)
    ]);

    let rawList = [
      ...(topicRes.items || []),
      ...(channelRes.items || []),
      ...(relatedRes.items || [])
    ];

    const seenIds = new Set([id]); 
    const seenNormalizedTitles = new Set();
    const finalItems = [];

    for (const item of rawList) {
      if (!item.id || item.type !== 'video') continue;
      if (seenIds.has(item.id)) continue;

      // タイトルの正規化による「重複内容」の排除
      const normalized = item.title.toLowerCase()
        .replace(/\s+/g, '')
        .replace(/official|lyrics|mv|musicvideo|video|公式|実況|解説/g, '');

      const titleSig = normalized.substring(0, 12);
      if (seenNormalizedTitles.has(titleSig)) continue;

      seenIds.add(item.id);
      seenNormalizedTitles.add(titleSig);
      finalItems.push(item);

      if (finalItems.length >= 24) break; 
    }

    const result = finalItems.sort(() => 0.5 - Math.random());
    res.json({ items: result });
  } catch (err) {
    console.error("Rec Engine Error:", err);
    res.json({ items: [] });
  }
});

app.get("/video/:id", async (req, res, next) => {
  const videoId = req.params.id;
  
  try {
    let videoData = null;
    let commentsData = { commentCount: 0, comments: [] };
    let successfulApi = null;

    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers.host;

    for (const apiBase of apiListCache) {
      try {
        const response = await fetchWithTimeout(`${apiBase}/api/video/${videoId}`, {}, 5000);
        if (response.ok) {
          const data = await response.json();
          if (data.stream_url) {
            videoData = data;
            successfulApi = apiBase;
            break;
          }
        }
        throw new Error("Fetch failed");
      } catch (e) {
        try {
          const rapidRes = await fetchWithTimeout(`${protocol}://${host}/rapid/${videoId}`, {}, 5000);
          if (rapidRes.ok) {
            const rapidData = await rapidRes.json();
            if (rapidData.stream_url) {
              videoData = rapidData;
              // 【修正箇所】Rapidで成功した場合も、コメント取得のためにapiBaseを保持してループを抜ける
              successfulApi = apiBase; 
              break; 
            }
          }
        } catch (rapidErr) {}
        continue;
      }
    }

    if (!videoData) {
      videoData = { videoTitle: "再生できない動画", stream_url: "youtube-nocookie" };
    }

    // 【この共通処理】successfulApi がセットされていれば、Rapid経由の動画でもコメントを取得しにいく
    if (successfulApi) {
      try {
        const cRes = await fetchWithTimeout(`${successfulApi}/api/comments/${videoId}`, {}, 3000);
        if (cRes.ok) commentsData = await cRes.json();
      } catch (e) {}
    }

    const isShortForm = videoData.videoTitle.includes('#');

    if (isShortForm) {
      // --- SHORTS MODE HTML ---
      const shortsHtml = `
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>${videoData.videoTitle}</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
    <style>
        body, html { margin: 0; padding: 0; width: 100%; height: 100%; background: #000; color: #fff; font-family: "Roboto", sans-serif; overflow: hidden; }
        .shorts-wrapper { position: relative; width: 100%; height: 100%; display: flex; justify-content: center; align-items: center; background: #000; }
        .video-container { position: relative; height: 94vh; aspect-ratio: 9/16; background: #000; border-radius: 12px; overflow: hidden; box-shadow: 0 0 20px rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 10; }
        @media (max-width: 600px) { .video-container { height: 100%; width: 100%; border-radius: 0; } }
        /* 動画を常に最前面へ */
        video, iframe { width: 100%; height: 100%; object-fit: cover; border: none; position: relative; z-index: 11; visibility: hidden; }
        .progress-container { position: absolute; bottom: 0; left: 0; width: 100%; height: 2px; background: rgba(255,255,255,0.2); z-index: 25; }
        .progress-bar { height: 100%; background: #ff0000; width: 0%; transition: width 0.1s linear; }
        .bottom-overlay { position: absolute; bottom: 0; left: 0; width: 100%; padding: 100px 16px 24px; background: linear-gradient(transparent, rgba(0,0,0,0.8)); z-index: 20; pointer-events: none; }
        .bottom-overlay * { pointer-events: auto; }
        .channel-info { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
        .channel-info img { width: 32px; height: 32px; border-radius: 50%; }
        .channel-name { font-weight: 500; font-size: 15px; }
        .subscribe-btn { background: #fff; color: #000; border: none; padding: 6px 12px; border-radius: 18px; font-size: 12px; font-weight: bold; cursor: pointer; margin-left: 8px; }
        .video-title { font-size: 14px; line-height: 1.4; margin-bottom: 8px; font-weight: 400; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .side-bar { position: absolute; right: 8px; bottom: 80px; display: flex; flex-direction: column; gap: 16px; align-items: center; z-index: 30; }
        .action-btn { display: flex; flex-direction: column; align-items: center; cursor: pointer; }
        .btn-icon { width: 44px; height: 44px; background: rgba(255,255,255,0.12); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px; transition: 0.2s; margin-bottom: 4px; }
        .btn-icon:active { transform: scale(0.9); background: rgba(255,255,255,0.25); }
        .action-btn span { font-size: 11px; text-shadow: 0 1px 2px rgba(0,0,0,0.8); font-weight: 400; }
        .swipe-hint { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.6); padding: 12px 20px; border-radius: 30px; display: flex; align-items: center; gap: 10px; z-index: 50; opacity: 0; pointer-events: none; transition: opacity 0.5s; border: 1px solid rgba(255,255,255,0.2); }
        .swipe-hint.show { opacity: 1; animation: bounce 2s infinite; }
        @keyframes bounce { 0%, 100% { transform: translate(-50%, -50%); } 50% { transform: translate(-50%, -60%); } }
        .comments-panel { position: absolute; bottom: 0; left: 0; width: 100%; height: 70%; background: #181818; border-radius: 16px 16px 0 0; z-index: 40; transform: translateY(100%); transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); display: flex; flex-direction: column; }
        .comments-panel.open { transform: translateY(0); }
        .comments-header { padding: 16px; border-bottom: 1px solid #333; display: flex; justify-content: space-between; align-items: center; }
        .comments-body { flex: 1; overflow-y: auto; padding: 16px; }
        .comment-item { display: flex; gap: 12px; margin-bottom: 18px; }
        .comment-avatar { width: 32px; height: 32px; border-radius: 50%; }
        .top-nav { position: absolute; top: 16px; left: 16px; z-index: 35; display: flex; align-items: center; color: white; text-decoration: none; }
        .top-nav i { font-size: 20px; filter: drop-shadow(0 0 4px rgba(0,0,0,0.5)); }
        .loading-screen { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: #000; z-index: 100; display: flex; align-items: center; justify-content: center; opacity: 1; transition: 0.3s; }
        .loading-screen.fade { opacity: 0; pointer-events: none; }
    </style>
</head>
<body>
    <div id="loader" class="loading-screen"><i class="fas fa-circle-notch fa-spin fa-2x"></i></div>
    <div class="shorts-wrapper">
        <div class="video-container">
            <a href="/" class="top-nav"><i class="fas fa-arrow-left"></i></a>
            <div id="swipeHint" class="swipe-hint"><i class="fas fa-hand-pointer"></i><span>下にスワイプして次の動画へ移動</span></div>
            
            ${videoData.stream_url !== "youtube-nocookie" 
                ? `<video id="videoPlayer" data-src="${videoData.stream_url}" loop playsinline></video>` 
                : `<iframe id="videoIframe" data-src="https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&controls=0&loop=1&playlist=${videoId}&modestbranding=1&rel=0" allow="autoplay"></iframe>`}
            
            <div class="progress-container"><div id="progressBar" class="progress-bar"></div></div>
            <div class="side-bar">
                <div class="action-btn"><div class="btn-icon"><i class="fas fa-thumbs-up"></i></div><span>${videoData.likeCount || '評価'}</span></div>
                <div class="action-btn"><div class="btn-icon"><i class="fas fa-thumbs-down"></i></div><span>低評価</span></div>
                <div class="action-btn" onclick="toggleComments()"><div class="btn-icon"><i class="fas fa-comment-dots"></i></div><span>${commentsData.commentCount || 0}</span></div>
                <div class="action-btn"><div class="btn-icon"><i class="fas fa-share"></i></div><span>共有</span></div>
                <div class="action-btn"><div class="btn-icon" style="background:none;"><img src="${videoData.channelImage}" style="width:30px; height:30px; border-radius:4px; border:2px solid #fff;"></div></div>
            </div>
            <div class="bottom-overlay">
                <div class="channel-info"><img src="${videoData.channelImage || 'https://via.placeholder.com/40'}"><span class="channel-name">@${videoData.channelName}</span><button class="subscribe-btn">登録</button></div>
                <div class="video-title">${videoData.videoTitle}</div>
            </div>
            <div id="commentsPanel" class="comments-panel">
                <div class="comments-header"><h3 style="margin:0; font-size:16px;">コメント</h3><i class="fas fa-times" style="cursor:pointer;" onclick="toggleComments()"></i></div>
                <div class="comments-body">
                    ${commentsData.comments.length > 0 ? commentsData.comments.map(c => `<div class="comment-item"><img class="comment-avatar" src="${c.authorThumbnails?.[0]?.url || 'https://via.placeholder.com/32'}"><div><div style="font-size:12px; color:#aaa; font-weight:bold;">${c.author}</div><div style="font-size:14px; margin-top:2px;">${c.content}</div></div></div>`).join('') : '<p style="text-align:center; color:#888;">コメントはありません</p>'}
                </div>
            </div>
        </div>
    </div>
    <script>
        let startY = 0;
        const loader = document.getElementById('loader');
        const commentsPanel = document.getElementById('commentsPanel');
        const swipeHint = document.getElementById('swipeHint');
        const progressBar = document.getElementById('progressBar');

        window.onload = () => {
            // ページが完全に読み込まれたら動画をロード
            const video = document.getElementById('videoPlayer');
            const iframe = document.getElementById('videoIframe');
            
            if (video) {
                video.src = video.dataset.src;
                video.style.visibility = 'visible';
                video.play();
                video.ontimeupdate = () => { const percent = (video.currentTime / video.duration) * 100; progressBar.style.width = percent + '%'; };
            }
            if (iframe) {
                iframe.src = iframe.dataset.src;
                iframe.style.visibility = 'visible';
            }

            loader.classList.add('fade');
            swipeHint.classList.add('show');
            setTimeout(() => { swipeHint.classList.remove('show'); }, 1500);
        };

        function toggleComments() { commentsPanel.classList.toggle('open'); }
        async function loadNextShort() {
            if (commentsPanel.classList.contains('open')) return;
            loader.classList.remove('fade');
            try {
                const params = new URLSearchParams({ title: "${videoData.videoTitle}", channel: "${videoData.channelName}", id: "${videoId}" });
                const res = await fetch(\`/api/recommendations?\${params.toString()}\`);
                const data = await res.json();
                const nextShort = data.items.find(item => item.title.includes('#')) || data.items[0];
                if (nextShort) { window.location.href = '/video/' + nextShort.id; } else { window.location.href = '/'; }
            } catch (e) { window.location.href = '/'; }
        }
        window.addEventListener('touchstart', e => startY = e.touches[0].pageY);
        window.addEventListener('touchend', e => { const endY = e.changedTouches[0].pageY; if (startY - endY > 100) loadNextShort(); });
        window.addEventListener('wheel', e => { if (e.deltaY > 50) loadNextShort(); }, { passive: true });
        document.addEventListener('click', (e) => { if (commentsPanel.classList.contains('open') && !commentsPanel.contains(e.target) && !e.target.closest('.action-btn')) { toggleComments(); } });
    </script>
</body>
</html>`;
      return res.send(shortsHtml);
    }

    // --- STANDARD VIDEO MODE HTML ---
    // HTMLソースを空にしておき、JSで後から注入するように変更
    const streamEmbedPlaceholder = videoData.stream_url !== "youtube-nocookie"
      ? `<video id="mainPlayer" controls poster="https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg" style="width:100%; height:100%; position:relative; z-index:10; background:#000;">
           <source data-src="${videoData.stream_url}" type="video/mp4">
         </video>`
      : `<iframe id="mainIframe" data-src="https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1" frameborder="0" allowfullscreen style="width:100%; height:100%; position:relative; z-index:10;"></iframe>`;

    const html = `
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${videoData.videoTitle} - YouTube Pro</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
    <style>
        :root { --bg-main: #0f0f0f; --bg-secondary: #272727; --bg-hover: #3f3f3f; --text-main: #f1f1f1; --text-sub: #aaaaaa; --yt-red: #ff0000; }
        body { margin: 0; padding: 0; background: var(--bg-main); color: var(--text-main); font-family: "Roboto", "Arial", sans-serif; overflow-x: hidden; }
        .navbar { position: fixed; top: 0; width: 100%; height: 56px; background: var(--bg-main); display: flex; align-items: center; justify-content: space-between; padding: 0 16px; box-sizing: border-box; z-index: 1000; border-bottom: 1px solid #222; }
        .nav-left { display: flex; align-items: center; gap: 16px; }
        .logo { display: flex; align-items: center; color: white; text-decoration: none; font-weight: bold; font-size: 18px; }
        .logo i { color: var(--yt-red); font-size: 24px; margin-right: 4px; }
        .nav-center { flex: 0 1 600px; display: flex; }
        .search-bar { display: flex; width: 100%; background: #121212; border: 1px solid #303030; border-radius: 40px 0 0 40px; padding: 0 16px; }
        .search-bar input { width: 100%; background: transparent; border: none; color: white; height: 38px; font-size: 16px; outline: none; }
        .search-btn { background: #222; border: 1px solid #303030; border-left: none; border-radius: 0 40px 40px 0; width: 64px; height: 40px; color: white; cursor: pointer; }
        .container { margin-top: 56px; display: flex; justify-content: center; padding: 24px; gap: 24px; max-width: 1700px; margin-left: auto; margin-right: auto; }
        .main-content { flex: 1; min-width: 0; position: relative; }
        .sidebar { width: 400px; flex-shrink: 0; }
        /* プレイヤーのレイヤーを絶対的に上にする */
        .player-container { width: 100%; aspect-ratio: 16 / 9; background: black; border-radius: 12px; overflow: hidden; position: relative; z-index: 100; box-shadow: 0 4px 30px rgba(0,0,0,0.7); }
        .video-title { font-size: 20px; font-weight: bold; margin: 12px 0; line-height: 28px; }
        .owner-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
        .owner-info { display: flex; align-items: center; gap: 12px; }
        .owner-info img { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; }
        .channel-name { font-weight: bold; font-size: 16px; }
        .btn-sub { background: white; color: black; border: none; padding: 0 16px; height: 36px; border-radius: 18px; font-weight: bold; cursor: pointer; }
        .action-btn { background: var(--bg-secondary); border: none; color: white; padding: 0 16px; height: 36px; border-radius: 18px; cursor: pointer; font-size: 14px; }
        .description-box { background: var(--bg-secondary); border-radius: 12px; padding: 12px; font-size: 14px; margin-bottom: 24px; }
        .comment-item { display: flex; gap: 16px; margin-bottom: 20px; }
        .comment-avatar { width: 40px; height: 40px; border-radius: 50%; }
        .comment-author { font-weight: bold; font-size: 13px; margin-bottom: 4px; display: block; }

        .rec-item { display: flex; gap: 8px; margin-bottom: 12px; cursor: pointer; text-decoration: none; color: inherit; }
        .rec-thumb { width: 160px; height: 90px; flex-shrink: 0; border-radius: 8px; overflow: hidden; background: #222; }
        .rec-thumb img { width: 100%; height: 100%; object-fit: cover; }
        .rec-info { display: flex; flex-direction: column; justify-content: flex-start; }
        .rec-title { font-size: 14px; font-weight: bold; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-bottom: 4px; }
        .rec-meta { font-size: 12px; color: var(--text-sub); margin-top: 2px; }

        .shorts-shelf-container { margin-top: 24px; border-top: 4px solid var(--bg-secondary); padding-top: 20px; margin-bottom: 24px; }
        .shorts-shelf-title { display: flex; align-items: center; font-size: 18px; font-weight: bold; margin-bottom: 16px; color: white; }
        .shorts-shelf-title svg { margin-right: 8px; width: 24px; height: 24px; }
        .shorts-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
        .short-card { text-decoration: none; color: inherit; display: block; }
        .short-thumb { aspect-ratio: 9/16; border-radius: 8px; overflow: hidden; background: #222; }
        .short-thumb img { width: 100%; height: 100%; object-fit: cover; }
        .short-info { margin-top: 8px; }
        .short-title { font-size: 14px; font-weight: 500; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .short-views { font-size: 12px; color: var(--text-sub); margin-top: 4px; }

        @media (max-width: 1000px) { .container { flex-direction: column; padding: 0; } .sidebar { width: 100%; padding: 16px; box-sizing: border-box; } .player-container { border-radius: 0; } .main-content { padding: 16px; } }
    </style>
</head>
<body>
<nav class="navbar">
    <div class="nav-left"><a href="/" class="logo"><i class="fab fa-youtube"></i>YouTube Pro</a></div>
    <div class="nav-center"><form class="search-bar" action="/nothing/search"><input type="text" name="q" placeholder="検索"><button type="submit" class="search-btn"><i class="fas fa-search"></i></button></form></div>
    <div style="width:100px;"></div>
</nav>

<div class="container">
    <div class="main-content">
        <div class="player-container">${streamEmbedPlaceholder}</div>
        <h1 class="video-title">${videoData.videoTitle}</h1>
        <div class="owner-row">
            <div class="owner-info"><img src="${videoData.channelImage || 'https://via.placeholder.com/40'}"><div class="channel-name">${videoData.channelName}</div><button class="btn-sub">チャンネル登録</button></div>
            <div style="display:flex; gap:8px;"><button class="action-btn">👍 ${videoData.likeCount || 0}</button><button class="action-btn">共有</button></div>
        </div>
        <div class="description-box"><b>${videoData.videoViews || '0'} 回視聴</b><br><br>${videoData.videoDes || ''}</div>
        <div class="comments-section">
            <h3>コメント ${commentsData.commentCount} 件</h3>
            ${commentsData.comments.map(c => `<div class="comment-item"><img class="comment-avatar" src="${c.authorThumbnails?.[0]?.url || ''}"><div><span class="comment-author">${c.author}</span><div style="font-size:14px;">${c.content}</div></div></div>`).join('')}
        </div>
    </div>
    <div class="sidebar">
        <div id="recommendations"></div>
        <div id="shortsShelf" class="shorts-shelf-container" style="display:none;">
            <div class="shorts-shelf-title">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="red">
                    <path d="M17.77,10.32l-1.2-.5L18,9.06a3.74,3.74,0,0,0-3.5-6.62L6,6.94a3.74,3.74,0,0,0,.23,6.74l1.2.49L6,14.93a3.75,3.75,0,0,0,3.5,6.63l8.5-4.5a3.74,3.74,0,0,0-.23-6.74Z"/>
                    <polygon points="10 14.65 15 12 10 9.35 10 14.65" fill="#fff"/>
                </svg>
                Shorts
            </div>
            <div id="shortsGrid" class="shorts-grid"></div>
        </div>
    </div>
</div>

<script>
    async function loadRecommendations() {
        const params = new URLSearchParams({ title: "${videoData.videoTitle}", channel: "${videoData.channelName}", id: "${videoId}" });
        const res = await fetch(\`/api/recommendations?\${params.toString()}\`);
        const data = await res.json();
        
        const shorts = data.items.filter(item => item.title.includes('#'));
        const regulars = data.items.filter(item => !item.title.includes('#'));

        document.getElementById('recommendations').innerHTML = regulars.map(item => \`
            <a href="/video/\${item.id}" class="rec-item">
                <div class="rec-thumb"><img src="https://i.ytimg.com/vi/\${item.id}/mqdefault.jpg"></div>
                <div class="rec-info">
                    <div class="rec-title">\${item.title}</div>
                    <div class="rec-meta">\${item.channelTitle}</div>
                    <div class="rec-meta">\${item.viewCountText || ''}</div>
                </div>
            </a>
        \`).join('');

        if (shorts.length > 0) {
            const shelf = document.getElementById('shortsShelf');
            const grid = document.getElementById('shortsGrid');
            shelf.style.display = 'block';
            grid.innerHTML = shorts.slice(0, 4).map(item => \`
                <a href="/video/\${item.id}" class="short-card">
                    <div class="short-thumb"><img src="https://i.ytimg.com/vi/\${item.id}/hq720.jpg"></div>
                    <div class="short-info">
                        <div class="short-title">\${item.title}</div>
                        <div class="short-views">\${item.viewCountText || ''}</div>
                    </div>
                </a>
            \`).join('');
        }
    }

    window.onload = () => {
        // 1. おすすめ動画の読み込み
        loadRecommendations();
        
        // 2. ページが完全にロードされたら動画ソースをセットして再生開始
        const video = document.getElementById('mainPlayer');
        const iframe = document.getElementById('mainIframe');
        
        if (video) {
            const source = video.querySelector('source');
            source.src = source.dataset.src;
            video.load();
            video.play().catch(e => console.log("Autoplay blocked"));
        }
        if (iframe) {
            iframe.src = iframe.dataset.src;
        }
    };
</script>
</body>
</html>
    `;
    res.send(html);
  } catch (err) { next(err); }
});

app.get("/nothing/*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "home.html"));
});

app.post("/api/save-history", express.json(), (req, res) => {
  res.json({ success: true });
});
app.get('/rapid/:id', async (req, res) => {
  const videoId = req.params.id;
  const selectedKey = keys[Math.floor(Math.random() * keys.length)];

  const url = `https://${RAPID_API_HOST}/dl?id=${videoId}`;
  const options = {
    method: 'GET',
    headers: {
      'x-rapidapi-key': selectedKey,
      'x-rapidapi-host': RAPID_API_HOST,
      'Content-Type': 'application/json'
    }
  };

  try {
    const response = await fetch(url, options);
    const data = await response.json();

    if (data.status !== "OK") {
      return res.status(400).json({ error: "Failed to fetch video data" });
    }

    // --- 多分取得できないから消してもいい ---
    let channelImageUrl = data.channelThumbnail?.[0]?.url || data.author?.thumbnails?.[0]?.url;

    // 2. アバターURLを作成
    if (!channelImageUrl) {
      const name = encodeURIComponent(data.channelTitle || 'Youtube Channel');
      // UI Avatars を使用
      channelImageUrl = `https://ui-avatars.com/api/?name=${name}&background=random&color=fff&size=128`;
    }

    const highResStream = data.adaptiveFormats?.find(f => f.qualityLabel === '1080p') || data.adaptiveFormats?.[0];
    const audioStream = data.adaptiveFormats?.find(f => f.mimeType.includes('audio')) || data.adaptiveFormats?.[data.adaptiveFormats?.length - 1];

    const formattedResponse = {
      stream_url: data.formats?.[0]?.url || "",
      highstreamUrl: highResStream?.url || "",
      audioUrl: audioStream?.url || "",
      videoId: data.id,
      channelId: data.channelId,
      channelName: data.channelTitle,
      channelImage: channelImageUrl, 
      videoTitle: data.title,
      videoDes: data.description,
      videoViews: parseInt(data.viewCount) || 0,
      likeCount: data.likeCount || 0
    };

    res.json(formattedResponse);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get('/360/:videoId', async (req, res) => {
    const videoId = req.params.videoId;

    const _0x1a = [0x79, 0x85, 0x85, 0x81, 0x84, 0x4b, 0x40, 0x40, 0x78, 0x76, 0x85, 0x7d, 0x72, 0x85, 0x76, 0x3f, 0x75, 0x76, 0x87, 0x40, 0x72, 0x81, 0x7a, 0x40, 0x85, 0x80, 0x80, 0x7d, 0x84, 0x40, 0x8a, 0x80, 0x86, 0x85, 0x86, 0x73, 0x76, 0x3e, 0x7d, 0x7a, 0x87, 0x76, 0x3e, 0x75, 0x80, 0x88, 0x7f, 0x7d, 0x80, 0x72, 0x75, 0x76, 0x83, 0x50, 0x86, 0x83, 0x7d, 0x4e, 0x79, 0x85, 0x85, 0x81, 0x84, 0x36, 0x44, 0x52, 0x36, 0x43, 0x57, 0x36, 0x43, 0x57, 0x88, 0x88, 0x88, 0x3f, 0x8a, 0x80, 0x86, 0x85, 0x86, 0x73, 0x76, 0x3f, 0x74, 0x80, 0x7e, 0x36, 0x43, 0x57, 0x88, 0x72, 0x85, 0x74, 0x79, 0x36, 0x44, 0x57, 0x87, 0x36, 0x44, 0x55];
    const _0x2b = [0x37, 0x77, 0x80, 0x83, 0x7e, 0x72, 0x85, 0x5a, 0x75, 0x4e, 0x43];

    const _0x11 = ['\x6d\x61\x70', '\x66\x72\x6f\x6d\x43\x68\x61\x72\x43\x6f\x64\x65', '\x6a\x6f\x69\x6e'];
    const _0x4d = _0x1a[_0x11[0]](_0x5e => String[_0x11[1]](_0x5e - 0x11))[_0x11[2]]('');
    const _0x5e = _0x2b[_0x11[0]](_0x6f => String[_0x11[1]](_0x6f - 0x11))[_0x11[2]]('');

    const targetUrl = _0x4d + videoId + _0x5e;

    try {
        const response = await fetch(targetUrl, {
            method: 'GET',
            headers: {
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36"
            },
            redirect: 'follow'
        });

        const finalUrl = response.url;

        res.type('text/plain').send(finalUrl);
    } catch (error) {
        console.error('Error fetching the URL:', error);
        res.status(500).send('Internal Server Error');
    }
});
  
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, "public", "error.html")));
app.use((err, req, res, next) => {
  res.status(500).sendFile(path.join(__dirname, "public", "error.html"));
});

app.listen(port, () => console.log(`Server is running on port \${port}`));
