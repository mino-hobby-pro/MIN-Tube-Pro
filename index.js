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
const videoCache = new Map();

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

setInterval(() => {
    const now = Date.now();
    for (const [videoId, cachedItem] of videoCache.entries()) {
        if (cachedItem.expiry < now) {
            videoCache.delete(videoId);
        }
    }
}, 300000);

// ミドルウェア: 人間確認
app.use(async (req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/video") || req.path === "/") {
    if (!req.cookies || req.cookies.humanVerified !== "true") {
      const pages = [
        'https://raw.githubusercontent.com/mino-hobby-pro/memo/refs/heads/main/min-tube-pro-main-loading.txt',
        'https://raw.githubusercontent.com/mino-hobby-pro/memo/refs/heads/main/min-tube-pro-sub-roading-like-command-loader-local.txt'
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
    videoData = await Promise.any([
      fetchWithTimeout(`${apiBase}/api/video/${videoId}`, {}, 5000)
        .then(res => res.ok ? res.json() : Promise.reject())
        .then(data => data.stream_url ? data : Promise.reject()),
      fetchWithTimeout(`${protocol}://${host}/sia-dl/${videoId}`, {}, 5000)
        .then(res => res.ok ? res.json() : Promise.reject())
        .then(data => data.stream_url ? data : Promise.reject()),

      new Promise((resolve, reject) => {
        setTimeout(() => {
          fetchWithTimeout(`${protocol}://${host}/ai-fetch/${videoId}`, {}, 5000)
            .then(res => res.ok ? res.json() : Promise.reject())
            .then(data => data.stream_url ? resolve(data) : reject())
            .catch(reject);
        }, 2000);
      })
    ]);


    try {
      const cRes = await fetchWithTimeout(`${apiBase}/api/comments/${videoId}`, {}, 3000);
      if (cRes.ok) commentsData = await cRes.json();
    } catch (e) {}

    successfulApi = apiBase;
    break;

  } catch (e) {
    try {
      const rapidRes = await fetchWithTimeout(`${protocol}://${host}/rapid/${videoId}`, {}, 5000);
      if (rapidRes.ok) {
        const rapidData = await rapidRes.json();
        if (rapidData.stream_url) {
          videoData = rapidData;
          
          try {
            const cRes = await fetchWithTimeout(`${apiBase}/api/comments/${videoId}`, {}, 3000);
            if (cRes.ok) commentsData = await cRes.json();
          } catch (e) {}

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

console.log(commentsData)
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
                <div class="channel-info"><img src="${videoData.channelImage || 'https://via.placeholder.com/40'}"><a href="/channel/${encodeURIComponent(videoData.channelName)}" style="text-decoration:none;color:inherit;"><span class="channel-name">@${videoData.channelName}</span></a><button class="subscribe-btn">登録</button></div>
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
        .server-dropdown-container { position: relative; display: inline-block; margin-left: 12px; }
        .btn-server { background: var(--bg-secondary); color: var(--text-main); border: none; padding: 0 16px; height: 36px; border-radius: 18px; font-weight: bold; cursor: pointer; display: flex; align-items: center; gap: 8px; font-size: 14px; transition: background 0.2s; }
        .btn-server:hover { background: var(--bg-hover); }
        .server-menu { display: none; position: absolute; top: 100%; left: 0; margin-top: 8px; background: var(--bg-secondary); border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.5); z-index: 200; min-width: 220px; border: 1px solid #333; }
        .server-menu.show { display: block; }
        .server-option { padding: 12px 16px; cursor: pointer; font-size: 14px; transition: background 0.2s; display: flex; align-items: center; }
        .server-option:hover { background: var(--bg-hover); }
        .server-option.active { background: #333; border-left: 4px solid var(--yt-red); padding-left: 12px; }
        .video-loading-overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.7); z-index: 150; display: flex; flex-direction: column; align-items: center; justify-content: center; color: white; opacity: 0; pointer-events: none; transition: opacity 0.3s ease; backdrop-filter: blur(2px); }
        .video-loading-overlay.active { opacity: 1; pointer-events: auto; }
        .spinner { border: 4px solid rgba(255, 255, 255, 0.1); width: 50px; height: 50px; border-radius: 50%; border-top-color: var(--yt-red); animation: spin 1s ease-in-out infinite; margin-bottom: 16px; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
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
        <div class="player-container">
            <div id="playerWrapper" style="width:100%; height:100%;">
                ${streamEmbedPlaceholder}
            </div>
            <div id="videoLoadingOverlay" class="video-loading-overlay">
                <div class="spinner"></div>
                <div style="font-weight: bold; font-size: 16px;">動画サーバーに接続中...</div>
            </div>
        </div>
        <h1 class="video-title">${videoData.videoTitle}</h1>
        <div class="owner-row">
            <div class="owner-info">
                <a href="/channel/${encodeURIComponent(videoData.channelName)}" style="display:flex;align-items:center;gap:12px;text-decoration:none;color:inherit;">
                  <img src="${videoData.channelImage || 'https://via.placeholder.com/40'}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;">
                  <div class="channel-name">${videoData.channelName}</div>
                </a>
                <button class="btn-sub">チャンネル登録</button>
                <div class="server-dropdown-container">
                    <button class="btn-server" onclick="toggleServerMenu()">
                        <i class="fas fa-server"></i> 動画サーバー <i class="fas fa-chevron-down" style="font-size: 12px; margin-left: 2px;"></i>
                    </button>
                    <div id="serverMenu" class="server-menu">
                        <div class="server-option active" onclick="changeServer('googlevideo', '', event)">Googlevideo</div>
                        <div class="server-option" onclick="changeServer('youtube-nocookie', '/nocookie/${videoId}', event)">Youtube-nocookie</div>
                        <div class="server-option" onclick="changeServer('DL-Pro', '/360/${videoId}', event)">DL-Pro</div>
                        <div class="server-option" onclick="changeServer('YoutubeEdu-Kahoot', '/kahoot-edu/${videoId}', event)">YoutubeEdu-Kahoot</div>
                        <div class="server-option" onclick="changeServer('YoutubeEdu-Scratch', '/scratch-edu/${videoId}', event)">YoutubeEdu-Scratch</div>
                        <div class="server-option" onclick="changeServer('Youtube-Pro', '/pro-stream/${videoId}', event)">Youtube-Pro</div>
                    </div>
                </div>
            </div>
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
    function toggleServerMenu() { document.getElementById('serverMenu').classList.toggle('show'); }
    window.addEventListener('click', function(e) { if (!e.target.closest('.server-dropdown-container')) { const menu = document.getElementById('serverMenu'); if (menu && menu.classList.contains('show')) menu.classList.remove('show'); } });

    async function changeServer(serverName, endpointPath, event) {
        document.getElementById('serverMenu').classList.remove('show');
        const options = document.querySelectorAll('.server-option');
        options.forEach(opt => opt.classList.remove('active'));
        event.currentTarget.classList.add('active');

        const overlay = document.getElementById('videoLoadingOverlay');
        overlay.classList.add('active');

        try {
            let newUrl = '';
            // --- ロジックの条件分岐 ---
            if (serverName === 'googlevideo') {
                newUrl = "${videoData.stream_url}" === "youtube-nocookie" ? \`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1\` : "${videoData.stream_url}";
            } else if (serverName === 'Youtube-Pro') {
                // Youtube-ProはエンドポイントURLをそのまま使用
                newUrl = endpointPath;
            } else {
                // それ以外はサーバーから生のURLを取得
                const res = await fetch(endpointPath);
                if (!res.ok) throw new Error("サーバーエラー");
                newUrl = await res.text();
            }

            const playerContainer = document.getElementById('playerWrapper');
            // Kahoot, Scratch, Youtube-Pro, およびnocookieは強制的にiframe
            const forceIframe = ['YoutubeEdu-Kahoot', 'YoutubeEdu-Scratch', 'Youtube-Pro', 'youtube-nocookie'].includes(serverName);
            const isIframe = forceIframe || newUrl.includes('embed');

            let playerHtml = '';
            if (isIframe) {
                playerHtml = \`<iframe id="mainIframe" src="\${newUrl}" frameborder="0" allowfullscreen style="width:100%; height:100%; position:relative; z-index:10;"></iframe>\`;
            } else {
                playerHtml = \`<video id="mainPlayer" controls autoplay style="width:100%; height:100%; position:relative; z-index:10; background:#000;"><source src="\${newUrl}" type="video/mp4"></video>\`;
            }
            playerContainer.innerHTML = playerHtml;
            const newVideo = document.getElementById('mainPlayer');
            if (newVideo) { newVideo.load(); newVideo.play().catch(e => console.log("Auto")); }
        } catch (error) { console.error(error); alert('サーバー切り替えに失敗しました。'); } finally { overlay.classList.remove('active'); }
    }

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
        loadRecommendations();

        const storageKey = "reloaded_" + "${videoId}";
        if (!sessionStorage.getItem(storageKey)) {
            sessionStorage.setItem(storageKey, "true");

            setTimeout(() => {
                // 設定画面で保存した再生方法をlocalStorageから読み取る
                const savedMode = localStorage.getItem('playbackMode') || 'googlevideo';
                const serverEndpoints = {
                    'googlevideo':        '',
                    'youtube-nocookie':   '/nocookie/${videoId}',
                    'DL-Pro':             '/360/${videoId}',
                    'YoutubeEdu-Kahoot':  '/kahoot-edu/${videoId}',
                    'YoutubeEdu-Scratch': '/scratch-edu/${videoId}',
                    'Youtube-Pro':        '/pro-stream/${videoId}'
                };
                const serverName = serverEndpoints.hasOwnProperty(savedMode) ? savedMode : 'googlevideo';
                const endpointPath = serverEndpoints[serverName];

                // 対応する .server-option 要素を探してアクティブにする
                const options = document.querySelectorAll('.server-option');
                let targetOption = options[0];
                options.forEach(opt => {
                    const onclick = opt.getAttribute('onclick') || '';
                    if (onclick.includes("'" + serverName + "'")) targetOption = opt;
                });

                if (targetOption) {
                    changeServer(serverName, endpointPath, { currentTarget: targetOption });
                }
            }, 500);
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


app.get('/streams', (req, res) => {
    const cacheData = Object.fromEntries(videoCache);
    res.json(cacheData);
});


app.get('/360/:videoId', async (req, res) => {
    const videoId = req.params.videoId;

    const now = Date.now();
    const cachedItem = videoCache.get(videoId);

    if (cachedItem && cachedItem.expiry > now) {
        return res.type('text/plain').send(cachedItem.url);
    }

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

        videoCache.set(videoId, {
            url: finalUrl,
            expiry: now + 60000
        });

        res.type('text/plain').send(finalUrl);
    } catch (error) {
        console.error('Error fetching the URL:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/scratch-edu/:id', async (req, res) => {
  const id = req.params.id;

  const configUrl = 'https://raw.githubusercontent.com/siawaseok3/wakame/master/video_config.json';
  const configRes = await fetch(configUrl);
  const configJson = await configRes.json();
  const params = configJson.params; 

  const url = `https://www.youtubeeducation.com/embed/${id}${params}`;
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.send(url);
});


app.get('/kahoot-edu/:id', async (req, res) => {
  const id = req.params.id;

  const paramUrl = 'https://raw.githubusercontent.com/wista-api-project/auto/refs/heads/main/edu/1.txt';
  const response = await fetch(paramUrl);
  const params = await response.text(); 

  const url = `https://www.youtubeeducation.com/embed/${id}${params}`;

  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.send(url);
});


app.get('/nocookie/:id', (req, res) => {
  const id = req.params.id;
  const url = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1`;
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.send(url);
});

app.get('/pro-stream/:videoId', (req, res) => {
  const videoId = req.params.videoId;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Pro Stream — ${videoId}</title>
<style>
  :root{--bg:#000814;--accent:#00e5ff;--muted:#9fb6c8}
  html,body{height:100%;margin:0;background:radial-gradient(ellipse at center, rgba(0,8,20,1) 0%, rgba(0,4,10,1) 70%);font-family:Inter,system-ui,Roboto,"Hiragino Kaku Gothic ProN",Meiryo,sans-serif;color:#e6f7ff}
  .stage{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden}
  .frame{position:relative;width:100%;height:100%;background:#000;overflow:hidden}
  .layer{position:absolute;inset:0;transition:opacity .8s cubic-bezier(.2,.9,.2,1), transform .8s;display:flex;align-items:center;justify-content:center}
  .layer iframe{width:100%;height:100%;border:0;display:block}
  .layer.inactive{opacity:0;transform:scale(1.02);pointer-events:none}
  .layer.active{opacity:1;transform:scale(1);pointer-events:auto}
  .hud{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:80;display:flex;flex-direction:column;align-items:center;gap:14px;backdrop-filter:blur(6px)}
  .card{min-width:360px;max-width:88vw;padding:18px 20px;border-radius:14px;background:linear-gradient(180deg, rgba(255,255,255,0.03), rgba(0,0,0,0.35));box-shadow:0 10px 40px rgba(0,0,0,0.6);color:#dff9ff}
  .title{font-size:18px;font-weight:700;color:var(--accent);letter-spacing:0.6px}
  .status{margin-top:8px;font-size:14px;font-weight:600}
  .sub{margin-top:6px;font-size:13px;color:var(--muted);line-height:1.4}
  .streams{margin-top:12px;display:flex;flex-direction:column;gap:8px;max-height:160px;overflow:auto;padding-right:6px}
  .stream-item{display:flex;justify-content:space-between;align-items:center;padding:8px;border-radius:8px;background:rgba(255,255,255,0.02);font-size:13px}
  .stream-item.ok{border-left:4px solid #2ee6a7}
  .stream-item.fail{opacity:0.6;border-left:4px solid #ff6b6b}
  .progress{height:6px;background:rgba(255,255,255,0.04);border-radius:6px;overflow:hidden;margin-top:10px}
  .bar{height:100%;width:0%;background:linear-gradient(90deg,var(--accent),#2ee6a7)}
  .btn{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);color:#dff9ff;padding:8px 12px;border-radius:10px;cursor:pointer;font-weight:600}
  .btn.primary{background:linear-gradient(90deg,var(--accent),#2ee6a7);color:#001}
  @media (max-width:720px){.card{min-width:300px;padding:14px}.title{font-size:16px}}
</style>
</head>
<body>
<div class="stage">
  <div class="frame" id="frame"></div>

  <div class="hud" id="hud">
    <div class="card" id="card">
      <div class="title">Pro Stream — 読み込み中</div>
      <div class="status" id="status">初期化しています…</div>
      <div class="sub" id="sub">エンドポイントへ接続中</div>
      <div class="progress" aria-hidden="true"><div class="bar" id="progressBar"></div></div>
      <div class="streams" id="streamsList" aria-live="polite"></div>
    </div>
  </div>
</div>

<script>
const VIDEO_ID = ${JSON.stringify(videoId)};
const ENDPOINTS = [
  {name:'/scratch-edu', path:'/scratch-edu/' + VIDEO_ID},
  {name:'/kahoot-edu', path:'/kahoot-edu/' + VIDEO_ID},
  {name:'/nocookie', path:'/nocookie/' + VIDEO_ID}
];
const PLAYABLE_TIMEOUT = 9000;

const frame = document.getElementById('frame');
const hud = document.getElementById('hud');
const statusEl = document.getElementById('status');
const subEl = document.getElementById('sub');
const streamsList = document.getElementById('streamsList');
const progressBar = document.getElementById('progressBar');

let layers = [];
let activeIndex = 0;
let globalMuted = true;

function setStatus(main, sub){ statusEl.textContent = main; subEl.textContent = sub || ''; }
function setProgress(p){ progressBar.style.width = Math.max(0, Math.min(1,p)) * 100 + '%'; }
function upsertStreamRow(name, url, state, note){
  let el = document.querySelector('[data-stream="'+name+'"]');
  if(!el){
    el = document.createElement('div');
    el.className = 'stream-item';
    el.dataset.stream = name;
    el.innerHTML = '<div class="label"><strong>'+name+'</strong><div style="font-size:12px;color:var(--muted)">'+(url||'')+'</div></div><div class="state"></div>';
    streamsList.appendChild(el);
  }
  el.querySelector('.state').textContent = note || (state === 'ok' ? '取得済' : '失敗');
  el.classList.toggle('ok', state === 'ok');
  el.classList.toggle('fail', state !== 'ok');
}

async function fetchAllUrls(){
  setStatus('URL取得中', '各エンドポイントに問い合わせています');
  const results = [];
  for(let i=0;i<ENDPOINTS.length;i++){
    const ep = ENDPOINTS[i];
    upsertStreamRow(ep.name, '', 'pending', '問い合わせ中');
    try{
      const res = await fetch(ep.path, {cache:'no-store'});
      if(!res.ok) throw new Error('HTTP ' + res.status);
      const text = (await res.text()).trim();
      if(text){
        results.push({name:ep.name, url:text, ok:true});
        upsertStreamRow(ep.name, text, 'ok', 'URL取得');
      } else {
        results.push({name:ep.name, url:null, ok:false});
        upsertStreamRow(ep.name, '', 'fail', '空のレスポンス');
      }
    }catch(err){
      results.push({name:ep.name, url:null, ok:false});
      upsertStreamRow(ep.name, '', 'fail', err.message || '取得失敗');
    }
    setProgress((i+1)/ENDPOINTS.length * 0.4);
  }
  return results;
}

function createLayer(name, url, idx){
  const layer = document.createElement('div');
  layer.className = 'layer inactive';
  layer.style.zIndex = 10 + idx;
  layer.dataset.name = name;
  const iframe = document.createElement('iframe');
  iframe.setAttribute('allow','autoplay; fullscreen; picture-in-picture');
  iframe.setAttribute('allowfullscreen','');

  try {
    const u = new URL(url, location.href);
    if(!u.searchParams.has('autoplay')) u.searchParams.set('autoplay','1');
    if(!u.searchParams.has('mute')) u.searchParams.set('mute','1');
    iframe.src = u.toString();
  } catch(e) {
    iframe.src = url + (url.includes('?') ? '&' : '?') + 'autoplay=1&mute=1';
  }

  layer.appendChild(iframe);
  frame.appendChild(layer);
  return {name, url, el:layer, iframe, state:'init', ok:false};
}

function initGenericIframe(layerObj){
  return new Promise((resolve) => {
    const iframe = layerObj.iframe;
    let resolved = false;
    const onLoad = () => {
      if(resolved) return;
      resolved = true;
      layerObj.state = 'loaded';
      layerObj.ok = true;
      resolve({ok:true});
    };
    const onErr = () => {
      if(resolved) return;
      resolved = true;
      layerObj.state = 'error';
      layerObj.ok = false;
      resolve({ok:false});
    };
    iframe.addEventListener('load', onLoad, {once:true});
    setTimeout(()=>{ if(!resolved) onErr(); }, PLAYABLE_TIMEOUT);
  });
}

async function initLayers(results){
  setStatus('埋め込みを初期化中', 'プレイヤーを生成しています');

  const valid = results.filter(r => r.ok && r.url);

  if(valid.length === 0){
    setStatus('再生可能なストリームが見つかりません', '別の動画IDをお試しください');
    setProgress(1);
    return;
  }

  setStatus('埋め込み候補を検査中', '最初に再生可能なストリームを一つだけ選択します');
  setProgress(0.4);

  let chosen = null;
  for(let i=0;i<valid.length;i++){
    const r = valid[i];
    upsertStreamRow(r.name, r.url, 'pending', '埋め込み生成（試行）');
    const obj = createLayer(r.name, r.url, 0);
    const check = await initGenericIframe(obj);
    if(check && check.ok){
      chosen = obj;
      upsertStreamRow(r.name, r.url, 'ok', 'ロード完了（採用）');
      break;
    } else {
      try{ obj.el.remove(); }catch(e){}
      upsertStreamRow(r.name, r.url, 'fail', '埋め込み失敗');
    }
    setProgress(0.4 + (i+1)/valid.length * 0.2);
  }

  if(!chosen){
    setStatus('全ての埋め込みが失敗しました', '別の動画IDをお試しください');
    setProgress(1);
    return;
  }

  valid.forEach(v => {
    const el = document.querySelector('[data-stream="'+v.name+'"]');
    if(el && el.classList.contains('ok') === false){
      el.querySelector('.state').textContent = '未採用';
      el.classList.remove('ok');
      el.classList.add('fail');
    }
  });

  layers = [chosen];
  activeIndex = 0;
  updateLayerVisibility();
  setProgress(0.85);
  setStatus('自動再生を試行中', 'ミュートで再生を開始します');

  try{ chosen.iframe.focus(); }catch(e){}

  setTimeout(()=> {
    setProgress(1);
    setStatus('没入準備完了', '画面をタップすると音声再生が可能になる場合があります');
    hud.style.transition = 'opacity .8s ease';
    hud.style.opacity = '0';
    setTimeout(()=> { hud.style.display = 'none'; }, 900);
  }, 900);
}

function updateLayerVisibility(){
  layers.forEach((l,i) => {
    if(i === activeIndex){ l.el.classList.remove('inactive'); l.el.classList.add('active'); }
    else { l.el.classList.remove('active'); l.el.classList.add('inactive'); }
  });
}

function showNext(){
  if(layers.length <= 1) return;
  activeIndex = (activeIndex + 1) % layers.length;
  updateLayerVisibility();
}

function toggleMute(){
  globalMuted = !globalMuted;
  layers.forEach(l => {
    try{ l.iframe.contentWindow.postMessage(JSON.stringify({event:'command',func: globalMuted ? 'mute' : 'unMute', args:[]}), '*'); }catch(e){}
    try{ l.iframe.muted = globalMuted; }catch(e){}
  });
}

function enterImmersive(){
  const el = document.documentElement;
  if(el.requestFullscreen) el.requestFullscreen();
  else if(el.webkitRequestFullscreen) el.webkitRequestFullscreen();
}

(async function main(){
  try{
    setStatus('初期化中', 'エンドポイントを問い合わせています');
    const results = await fetchAllUrls();
    setStatus('URL取得完了', '埋め込みを初期化します');
    await initLayers(results);
  }catch(err){
    console.error(err);
    setStatus('エラーが発生しました', String(err));
  }
})();

frame.addEventListener('click', ()=> {
  if(hud.style.display !== 'none'){
    hud.style.display = 'none';
    layers.forEach(l => { try{ l.iframe.focus(); }catch(e){} });
  } else {
    showNext();
  }
});
</script>
</body>
</html>`);
});

app.get('/sia-dl/:videoId', async (req, res) => {
    const videoId = req.params.videoId;
    const protocol = req.protocol;
    const host = req.get('host');

    try {
        const metadataUrl = `https://siawaseok.duckdns.org/api/video2/${videoId}?depth=1`;
        const metaResponse = await fetch(metadataUrl);
        if (!metaResponse.ok) throw new Error('Metadata API response was not ok');
        const data = await metaResponse.json();

        const streamInfoUrl = `${protocol}://${host}/360/${videoId}`;
        const streamResponse = await fetch(streamInfoUrl);
        const rawStreamUrl = streamResponse.ok ? await streamResponse.text() : "";

        const parseCount = (str) => {
            if (!str) return 0;
            return parseInt(str.replace(/[^0-9]/g, '')) || 0;
        };

        const formattedResponse = {
            stream_url: rawStreamUrl.trim(),
            highstreamUrl: rawStreamUrl.trim(), 
            audioUrl: "", 
            
            videoId: data.id,
            channelId: data.author?.id || "",
            channelName: data.author?.name || "",
            channelImage: data.author?.thumbnail || "",
            videoTitle: data.title,
            videoDes: data.description?.text || "",
            
            videoViews: parseCount(data.views || data.extended_stats?.views_original),
            
            likeCount: parseCount(data.likes)
        };

        res.json(formattedResponse);

    } catch (error) {
        console.error('Error fetching data:', error);
        res.status(500).json({ error: 'Internal Server Error', message: error.message });
    }
});

app.get('/ai-fetch/:videoId', async (req, res) => {
    const _0x5a1e = ['\x6c\x69\x6b\x65\x43\x6f\x75\x6e\x74', '\x76\x69\x64\x65\x6f\x44\x65\x73', '\x67\x65\x74', '\x68\x6f\x73\x74', '\x61\x62\x6f\x72\x74', '\x74\x65\x78\x74', '\x70\x72\x6f\x74\x6f\x63\x6f\x6c', '\x6a\x73\x6f\x6e', '\x76\x69\x64\x65\x6f\x49\x64', '\x65\x72\x72\x6f\x72', '\x61\x69\x2d\x66\x65\x74\x63\x68', '\x68\x74\x74\x70\x73\x3a\x2f\x2f\x61\x70\x69\x2e\x61\x69\x6a\x69\x6d\x79\x2e\x63\x6f\x6d\x2f\x67\x65\x74\x3f\x63\x6f\x64\x65\x3d\x67\x65\x74\x2d\x79\x6f\x75\x74\x75\x62\x65\x2d\x76\x69\x64\x65\x6f\x64\x61\x74\x61\x26\x74\x65\x78\x74\x3d', '\x73\x74\x61\x74\x75\x73'];
    const _0x42f1 = function(_0x2d12f3, _0x5a1e3e) {
        _0x2d12f3 = _0x2d12f3 - 0x0;
        let _0x4b3c2a = _0x5a1e[_0x2d12f3];
        return _0x4b3c2a;
    };

    const videoId = req.params[_0x42f1('0x8')];
    
    const _0x1f22a1 = (function(_0x33e1a) {
        return _0x33e1a.split('').reverse().join('');
    })('\x3d\x74\x78\x65\x74\x26\x61\x74\x61\x64\x6f\x65\x64\x69\x76\x2d\x65\x62\x75\x74\x75\x6f\x79\x2d\x74\x65\x67\x3d\x65\x64\x6f\x63\x3f\x74\x65\x67\x2f\x6d\x6f\x63\x2e\x79\x6d\x69\x6a\x69\x61\x2e\x69\x70\x61\x2f\x2f\x3a\x73\x70\x74\x74\x68');
    const apiUrl = _0x1f22a1 + videoId;

    try {
        const response = await fetch(apiUrl);
        const textData = await response[_0x42f1('0x5')]();

        const descriptionMatch = textData.match(/概要欄:\s*([\s\S]*?)\s*公開日:/);
        const viewsMatch = textData.match(/再生回数:\s*(\d+)/);
        const likesMatch = textData.match(/高評価数:\s*(\d+)/);

        const videoDes = descriptionMatch ? descriptionMatch[1].trim() : "";
        const videoViews = viewsMatch ? parseInt(viewsMatch[1]) : 0;
        const likeCount = likesMatch ? parseInt(likesMatch[1]) : 0;

        let videoTitle = videoId; 
        let channelName = videoId;
        let found = false;

        try {
            const noEmbedRes = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
            if (noEmbedRes.ok) {
                const noEmbedData = await noEmbedRes.json();
                if (noEmbedData && !noEmbedData.error) {
                    videoTitle = noEmbedData.title || videoId;
                    channelName = noEmbedData.author_name || videoId;
                    found = true;
                }
            }
        } catch (noEmbedErr) {

        }

        if (!found) {
            try {
                let page = 0;
                while (page < 10 && !found) {
                    const searchResults = await yts.GetListByKeyword(videoId, false, 20, page);
                    if (searchResults && searchResults.items && searchResults.items.length > 0) {
                        const matchedVideo = searchResults.items.find(item => item.id === videoId);
                        if (matchedVideo) {
                            videoTitle = matchedVideo.title || videoId;
                            channelName = (matchedVideo.author && matchedVideo.author.name) ? matchedVideo.author.name : videoId;
                            found = true;
                        }
                    } else {
                        break;
                    }
                    page++;
                }
            } catch (searchErr) {
                console.error("Search API Error:", searchErr);
            }
        }

        const protocol = req[_0x42f1('0x6')];
        const host = req[_0x42f1('0x2')](_0x42f1('0x3'));
        const internalUrl = `${protocol}://${host}/360/${videoId}`;
        let finalStreamUrl = `https://www.youtube-nocookie.com/embed/${videoId}`;

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller[_0x42f1('0x4')](), 3000); 

            const internalRes = await fetch(internalUrl, { signal: controller.signal });
            if (internalRes.ok) {
                const rawText = await internalRes[_0x42f1('0x5')]();
                if (rawText && rawText.trim() !== "") {
                    finalStreamUrl = rawText.trim(); 
                }
            }
            clearTimeout(timeoutId);
        } catch (err) {
        }

        const formattedResponse = {
            stream_url: finalStreamUrl,
            highstreamUrl: finalStreamUrl,
            audioUrl: finalStreamUrl,
            videoId: videoId,
            channelId: "", 
            channelName: channelName, 
            channelImage: `https://ui-avatars.com/api/?name=${encodeURIComponent(channelName)}&background=random&color=fff&size=128`,
            videoTitle: videoTitle, 
            videoDes: videoDes,
            videoViews: videoViews,
            likeCount: likeCount
        };

        res[_0x42f1('0x7')](formattedResponse);

    } catch (error) {
        console.error("Error fetching video data:", error);
        res[_0x42f1('0xc')](500)[_0x42f1('0x7')]({ error: "Failed to fetch video data" });
    }
});

app.get("/youtube-pro", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "min-tube-pro.html"));
});

app.get("/min-img.png", (req, res) => {
  const filePath = path.join(__dirname, "img", "min-tube-pro.png");
  res.sendFile(filePath);
});

app.get("/helios", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "proxy/helios.html"));
});

app.get("/chat", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "chat/chat.html"));
});

app.get("/nautilus-os", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "proxy/NautilusOS.html"));
});

app.get("/unblockers", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "app/search.html"));
});

app.get("/labo5", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "app/html-tube.html"));
});

app.get("/ai", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "app/ai.html"));
});

app.get("/dl-pro", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "app/study2525.html"));
});

app.get("/update", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "app/sorry.html"));
});

app.get("/blog", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "app/sorry.html"));
});

app.get("/game", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "app/sorry.html"));
});

app.get("/movie", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "app/sorry.html"));
});

app.get("/check", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "app/check.html"));
});

app.get("/use-api", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "app/sorry.html"));
});

app.get("/version", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "raw/version.json"));
});

app.get("/games.json", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "game/game.json"));
});

app.get("/cts", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "app/cantsee.html"));
});

// --- チャンネル動画API ---
app.get("/api/channel", async (req, res) => {
  const channelName = req.query.name || req.query.id;
  const page = parseInt(req.query.page) || 0;
  if (!channelName) return res.status(400).json({ error: "name required" });
  try {
    const results = await yts.GetListByKeyword(channelName, false, 30, page);
    const videos = (results.items || []).filter(item => item.type === 'video');
    res.json({ channelName, videos, nextPage: page + 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/inv/channel/:name', async (req, res) => {
  const channelName = req.params.name;

  const url = `https://inv.vern.cc/api/v1/search?q=${encodeURIComponent(
    channelName
  )}&type=channel`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      return res
        .status(response.status)
        .json({ error: `Upstream error: ${response.statusText}` });
    }

    const data = await response.json();

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- チャンネルページ ---
app.get("/channel/:channelName", (req, res) => {
  const channelName = decodeURIComponent(req.params.channelName);
  const initial = channelName.charAt(0).toUpperCase();
  // チャンネルごとにアバター背景色を決定（固定色）
  const colors = ['#ff0000','#ff6d00','#ffd600','#00c853','#00b0ff','#651fff','#d500f9','#f50057'];
  const colorIndex = channelName.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % colors.length;
  const avatarBg = colors[colorIndex];

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${channelName} - MIN-Tube-Pro</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg:#0f0f0f; --surface:#212121; --card:#272727; --hover:#3f3f3f;
      --text:#f1f1f1; --text-sub:#aaaaaa; --text-sec:#717171;
      --red:#ff0000; --border:#3f3f3f;
      --avatar-bg: ${avatarBg};
    }
    * { box-sizing:border-box; margin:0; padding:0; }
    body { background:var(--bg); color:var(--text); font-family:'Roboto',Arial,sans-serif; -webkit-font-smoothing:antialiased; }

    /* ===== NAVBAR ===== */
    .navbar {
      position:fixed; top:0; width:100%; height:56px;
      background:var(--bg); display:flex; align-items:center;
      padding:0 16px; z-index:1000; gap:12px;
    }
    .nav-logo { display:flex; align-items:center; gap:4px; text-decoration:none; color:var(--text); }
    .nav-logo-icon { background:var(--red); border-radius:6px; width:34px; height:24px; display:flex; align-items:center; justify-content:center; }
    .nav-logo-icon svg { width:16px; height:16px; fill:white; }
    .nav-logo-text { font-size:18px; font-weight:700; letter-spacing:-0.5px; }
    .nav-logo-sub { font-size:10px; color:var(--text-sub); font-weight:500; margin-left:1px; align-self:flex-end; margin-bottom:4px; }
    .back-btn {
      background:none; border:none; color:var(--text); cursor:pointer;
      width:40px; height:40px; border-radius:50%; display:flex; align-items:center; justify-content:center;
      transition:background .15s; font-size:0; flex-shrink:0;
    }
    .back-btn:hover { background:rgba(255,255,255,0.1); }
    .back-btn svg { width:24px; height:24px; fill:var(--text); }

    /* ===== BANNER ===== */
    .channel-banner {
      margin-top:56px; width:100%; height:176px;
      background:linear-gradient(135deg, #1c1c2e 0%, #2d1b4e 40%, #1a2a4a 100%);
      position:relative; overflow:hidden;
    }
    .channel-banner::before {
      content:''; position:absolute; inset:0;
      background:radial-gradient(ellipse at 20% 60%, ${avatarBg}33 0%, transparent 60%);
    }
    .channel-banner::after {
      content:''; position:absolute; inset:0;
      background:radial-gradient(ellipse at 80% 30%, rgba(255,255,255,0.04) 0%, transparent 50%);
    }
    .banner-pattern {
      position:absolute; inset:0; opacity:0.05;
      background-image: repeating-linear-gradient(45deg, #fff 0, #fff 1px, transparent 0, transparent 50%);
      background-size:20px 20px;
    }

    /* ===== CHANNEL HEADER ===== */
    .channel-header-wrap {
      max-width:1284px; margin:0 auto; padding:0 24px;
    }
    .channel-header {
      display:flex; align-items:flex-end; gap:24px;
      padding:0 0 16px;
      transform:translateY(-28px);
    }
    .channel-avatar {
      width:88px; height:88px; border-radius:50%;
      background:var(--avatar-bg);
      display:flex; align-items:center; justify-content:center;
      font-size:36px; font-weight:700; color:#fff;
      border:4px solid var(--bg); flex-shrink:0;
      overflow:hidden; position:relative;
      box-shadow:0 2px 16px rgba(0,0,0,0.6);
    }
    .channel-avatar img {
      width:100%; height:100%; object-fit:cover; display:none;
      position:absolute; inset:0;
    }
    .channel-avatar img.loaded { display:block; }
    .avatar-initial { position:relative; z-index:1; }

    .channel-info { flex:1; min-width:0; padding-bottom:4px; }
    .channel-title {
      font-size:24px; font-weight:700; line-height:1.2;
      margin-bottom:6px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
    }
    .channel-handle {
      font-size:13px; color:var(--text-sub); margin-bottom:4px;
    }
    .channel-stats {
      font-size:13px; color:var(--text-sub);
      display:flex; align-items:center; gap:8px; flex-wrap:wrap;
    }
    .channel-stats-dot { color:var(--text-sec); }

    .channel-actions { display:flex; align-items:center; gap:8px; padding-bottom:4px; flex-shrink:0; }
    .btn-subscribe {
      background:var(--text); color:var(--bg);
      border:none; border-radius:20px;
      padding:10px 16px; font-size:14px; font-weight:500;
      cursor:pointer; transition:background .15s, opacity .15s;
      font-family:'Roboto',Arial,sans-serif; white-space:nowrap;
    }
    .btn-subscribe:hover { opacity:0.85; }
    .btn-subscribe.subscribed {
      background:var(--card); color:var(--text);
    }
    .btn-subscribe.subscribed:hover { background:var(--hover); }
    .btn-notify {
      background:var(--card); border:none; color:var(--text);
      width:40px; height:40px; border-radius:50%;
      display:none; align-items:center; justify-content:center;
      cursor:pointer; transition:background .15s; flex-shrink:0;
    }
    .btn-notify.show { display:flex; }
    .btn-notify:hover { background:var(--hover); }
    .btn-notify svg { width:20px; height:20px; fill:var(--text); }

    /* ===== TABS ===== */
    .channel-tabs-wrap {
      max-width:1284px; margin:0 auto; padding:0 24px;
      border-bottom:1px solid var(--border);
      margin-top:-28px;
    }
    .channel-tabs { display:flex; gap:0; overflow-x:auto; scrollbar-width:none; }
    .channel-tabs::-webkit-scrollbar { display:none; }
    .tab {
      padding:12px 20px; cursor:pointer; font-size:14px; font-weight:500;
      color:var(--text-sub); border-bottom:2px solid transparent;
      transition:color .15s, border-color .15s; white-space:nowrap;
      letter-spacing:0.3px;
    }
    .tab:hover { color:var(--text); background:rgba(255,255,255,0.05); }
    .tab.active { color:var(--text); border-bottom-color:var(--text); }

    /* ===== CONTENT ===== */
    .content { max-width:1284px; margin:24px auto; padding:0 24px; }
    .video-grid {
      display:grid;
      grid-template-columns:repeat(auto-fill, minmax(220px,1fr));
      gap:16px 16px; row-gap:32px;
    }
    .video-card { text-decoration:none; color:inherit; display:block; cursor:pointer; }
    .thumb { aspect-ratio:16/9; border-radius:10px; overflow:hidden; background:#1a1a1a; position:relative; }
    .thumb img { width:100%; height:100%; object-fit:cover; display:block; transition:border-radius .2s; }
    .video-card:hover .thumb img { border-radius:0; }
    .duration-badge {
      position:absolute; bottom:6px; right:6px;
      background:rgba(0,0,0,0.85); color:#fff;
      font-size:12px; font-weight:700; padding:2px 5px;
      border-radius:4px; letter-spacing:0.3px;
    }
    .video-card-meta { margin-top:10px; display:flex; gap:10px; align-items:flex-start; }
    .card-avatar {
      width:36px; height:36px; border-radius:50%;
      background:var(--avatar-bg);
      display:flex; align-items:center; justify-content:center;
      font-size:14px; font-weight:700; color:#fff;
      flex-shrink:0;
    }
    .card-info { flex:1; min-width:0; }
    .video-title {
      font-size:14px; font-weight:500; line-height:1.4;
      display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;
      overflow:hidden; margin-bottom:4px; color:var(--text);
    }
    .video-sub { font-size:12px; color:var(--text-sub); }

    /* ===== LOADING ===== */
    .loading { display:flex; justify-content:center; align-items:center; padding:60px; }
    .spinner { border:3px solid #333; border-top-color:var(--red); border-radius:50%; width:40px; height:40px; animation:spin 0.8s linear infinite; }
    @keyframes spin { to { transform:rotate(360deg); } }

    .load-more {
      display:block; margin:32px auto; padding:10px 24px;
      background:var(--card); border:none; color:var(--text);
      border-radius:20px; font-size:14px; font-weight:500;
      cursor:pointer; transition:background .15s;
      font-family:'Roboto',Arial,sans-serif;
    }
    .load-more:hover { background:var(--hover); }
    .empty { text-align:center; padding:60px; color:var(--text-sub); font-size:15px; }

    /* ===== RESPONSIVE ===== */
    @media (max-width:768px) {
      .channel-banner { height:110px; }
      .channel-avatar { width:72px; height:72px; font-size:28px; }
      .channel-title { font-size:18px; }
      .channel-header { gap:16px; transform:translateY(-24px); }
      .channel-tabs-wrap { margin-top:-24px; }
      .channel-header-wrap { padding:0 16px; }
      .channel-tabs-wrap { padding:0 16px; }
      .content { padding:0 12px; }
      .video-grid { grid-template-columns:repeat(2,1fr); gap:10px; row-gap:24px; }
      .btn-subscribe { padding:8px 14px; font-size:13px; }
    }
    @media (max-width:480px) {
      .channel-title { font-size:16px; }
      .channel-actions { gap:6px; }
      .video-grid { gap:8px; row-gap:20px; }
    }
  </style>
</head>
<body>

<nav class="navbar">
  <button class="back-btn" onclick="history.back()" aria-label="戻る">
    <svg viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
  </button>
  <a href="/" class="nav-logo">
    <div class="nav-logo-icon">
      <svg viewBox="0 0 24 24"><path d="M10 15l5.19-3L10 9v6zm11.56-7.83c.13.47.22 1.1.28 1.9.07.8.1 1.49.1 2.09L22 12c0 2.19-.16 3.8-.44 4.83-.25.9-.83 1.48-1.73 1.73-.47.13-1.33.22-2.65.28-1.3.07-2.49.1-3.59.1L12 19c-4.19 0-6.8-.16-7.83-.44-.9-.25-1.48-.83-1.73-1.73-.13-.47-.22-1.1-.28-1.9-.07-.8-.1-1.49-.1-2.09L2 12c0-2.19.16-3.8.44-4.83.25-.9.83-1.48 1.73-1.73.47-.13 1.33-.22 2.65-.28 1.3-.07 2.49-.1 3.59-.1L12 5c4.19 0 6.8.16 7.83.44.9.25 1.48.83 1.73 1.73z"/></svg>
    </div>
    <span class="nav-logo-text">MIN-Tube</span><span class="nav-logo-sub">Pro</span>
  </a>
</nav>

<div class="channel-banner">
  <div class="banner-pattern"></div>
</div>

<div class="channel-header-wrap">
  <div class="channel-header">
    <div class="channel-avatar" id="channelAvatar">
      <img id="channelAvatarImg" src="" alt="">
      <span class="avatar-initial" id="avatarInitial">${initial}</span>
    </div>
    <div class="channel-info">
      <div class="channel-title" id="channelTitle">${channelName}</div>
      <div class="channel-handle" id="channelHandle">@${channelName.toLowerCase().replace(/\s+/g, '')}</div>
      <div class="channel-stats">
        <span id="subCount">読み込み中...</span>
        <span class="channel-stats-dot" id="statsDot" style="display:none">•</span>
        <span id="videoCount" style="display:none"></span>
      </div>
    </div>
    <div class="channel-actions">
      <button class="btn-subscribe" id="subscribeBtn" onclick="toggleSubscribe()">チャンネル登録</button>
      <button class="btn-notify" id="notifyBtn" aria-label="通知">
        <svg viewBox="0 0 24 24"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>
      </button>
    </div>
  </div>
</div>

<div class="channel-tabs-wrap">
  <div class="channel-tabs">
    <div class="tab active">動画</div>
    <div class="tab" onclick="alert('近日公開予定')">再生リスト</div>
    <div class="tab" onclick="alert('近日公開予定')">コミュニティ</div>
  </div>
</div>

<div class="content">
  <div id="videoGrid" class="video-grid"></div>
  <div id="loading" class="loading"><div class="spinner"></div></div>
  <button id="loadMoreBtn" class="load-more" style="display:none;" onclick="loadMore()">もっと見る</button>
</div>

<script>
  const CHANNEL_NAME = ${JSON.stringify(channelName)};
  const AVATAR_INITIAL = ${JSON.stringify(initial)};
  let currentPage = 0;
  let isLoading = false;
  let totalLoaded = 0;
  let isSubscribed = false;

  // ローカルストレージでチャンネル登録状態を管理
  const SUB_KEY = 'subscribed_' + CHANNEL_NAME;
  if (localStorage.getItem(SUB_KEY) === 'true') {
    isSubscribed = true;
    updateSubscribeUI();
  }

  function toggleSubscribe() {
    isSubscribed = !isSubscribed;
    localStorage.setItem(SUB_KEY, isSubscribed ? 'true' : 'false');
    updateSubscribeUI();
  }

  function updateSubscribeUI() {
    const btn = document.getElementById('subscribeBtn');
    const notifyBtn = document.getElementById('notifyBtn');
    if (isSubscribed) {
      btn.textContent = '登録済み';
      btn.classList.add('subscribed');
      notifyBtn.classList.add('show');
    } else {
      btn.textContent = 'チャンネル登録';
      btn.classList.remove('subscribed');
      notifyBtn.classList.remove('show');
    }
  }

  function formatViews(v) {
    if (!v) return '';
    const n = parseInt(String(v).replace(/[^0-9]/g, ''));
    if (isNaN(n)) return v;
    if (n >= 100000000) return Math.floor(n/100000000) + '億回視聴';
    if (n >= 10000) return Math.floor(n/10000) + '万回視聴';
    if (n >= 1000) return (n/1000).toFixed(1) + '千回視聴';
    return n.toLocaleString() + '回視聴';
  }

  // 視聴数からチャンネル登録者数を推定
  function estimateSubscribers(videos) {
    if (!videos || videos.length === 0) return null;
    let totalViews = 0;
    let count = 0;
    for (const v of videos) {
      if (!v.viewCountText) continue;
      const n = parseInt(String(v.viewCountText).replace(/[^0-9]/g, ''));
      if (!isNaN(n) && n > 0) { totalViews += n; count++; }
    }
    if (count === 0) return null;
    const avgViews = totalViews / count;
    // 平均再生数の約1〜5%が登録者数と仮定（チャンネルの規模に応じて調整）
    const est = Math.round(avgViews * (0.01 + Math.random() * 0.04));
    return est;
  }

  function formatSubscribers(n) {
    if (!n || n <= 0) return null;
    if (n >= 100000000) return (n/100000000).toFixed(1) + '億人';
    if (n >= 10000000) return Math.floor(n/10000000) + '千万人';
    if (n >= 10000) return Math.floor(n/10000) + '万人';
    if (n >= 1000) return (n/1000).toFixed(1) + '千人';
    return n.toLocaleString() + '人';
  }

  // チャンネルアイコン画像をYouTube APIから試みる（利用不可の場合はイニシャル）
  function tryLoadChannelAvatar(channelId) {
    if (!channelId) return;
    // YTのチャンネルアバターURLパターンを試みる
    const tryUrls = [
      \`https://yt3.ggpht.com/ytc/\${channelId}=s88-c-k-c0x00ffffff-no-rj\`,
    ];
    const img = document.getElementById('channelAvatarImg');
    img.onload = function() { img.classList.add('loaded'); document.getElementById('avatarInitial').style.display='none'; };
    img.onerror = function() { /* イニシャル表示のまま */ };
    img.src = tryUrls[0];
  }

  function renderVideos(videos) {
    const grid = document.getElementById('videoGrid');
    if (videos.length === 0 && totalLoaded === 0) {
      grid.innerHTML = '<div class="empty">動画が見つかりませんでした</div>';
      return;
    }

    const html = videos.map(v => \`
      <a href="/video/\${v.id}" class="video-card">
        <div class="thumb">
          <img src="https://i.ytimg.com/vi/\${v.id}/mqdefault.jpg" loading="lazy" alt="\${(v.title||'').replace(/"/g,'&quot;')}">
        </div>
        <div class="video-card-meta">
          <div class="card-avatar">\${AVATAR_INITIAL}</div>
          <div class="card-info">
            <div class="video-title">\${v.title || ''}</div>
            <div class="video-sub">\${formatViews(v.viewCountText) || ''}\${v.publishedTimeText ? ' • '+v.publishedTimeText : ''}</div>
          </div>
        </div>
      </a>
    \`).join('');

    grid.insertAdjacentHTML('beforeend', html);
    totalLoaded += videos.length;

    // 初回ロード時にチャンネル情報を更新
    if (totalLoaded <= videos.length && videos[0]) {
      const first = videos[0];
      const realName = first.channelTitle || CHANNEL_NAME;
      document.getElementById('channelTitle').textContent = realName;
      document.getElementById('channelHandle').textContent = '@' + realName.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9\u3000-\u9fff]/g, '');

      // 登録者数の推定表示
      const estSubs = estimateSubscribers(videos);
      const subFmt = estSubs ? formatSubscribers(estSubs) + ' 人のチャンネル登録者' : 'チャンネル';
      document.getElementById('subCount').textContent = subFmt;
      document.getElementById('statsDot').style.display = '';
      document.getElementById('videoCount').style.display = '';
      document.getElementById('videoCount').textContent = \`動画 \${totalLoaded}件以上\`;

      // チャンネルIDを推定して試みる（first.channelIdがあれば）
      if (first.channelId) tryLoadChannelAvatar(first.channelId);
    } else {
      document.getElementById('videoCount').textContent = \`動画 \${totalLoaded}件以上\`;
    }
  }

  async function loadVideos(page) {
    if (isLoading) return;
    isLoading = true;
    document.getElementById('loading').style.display = 'flex';
    document.getElementById('loadMoreBtn').style.display = 'none';
    try {
      const res = await fetch(\`/api/channel?name=\${encodeURIComponent(CHANNEL_NAME)}&page=\${page}\`);
      const data = await res.json();
      renderVideos(data.videos || []);
      currentPage = data.nextPage;
      if ((data.videos || []).length >= 20) {
        document.getElementById('loadMoreBtn').style.display = 'block';
      }
    } catch (e) {
      document.getElementById('videoGrid').innerHTML = '<div class="empty">読み込みに失敗しました</div>';
    } finally {
      document.getElementById('loading').style.display = 'none';
      isLoading = false;
    }
  }

  function loadMore() { loadVideos(currentPage); }

  loadVideos(0);
</script>
</body>
</html>`;
  res.send(html);
});

app.use((req, res) => res.status(404).sendFile(path.join(__dirname, "public", "error.html")));
app.use((err, req, res, next) => {
  res.status(500).sendFile(path.join(__dirname, "public", "error.html"));
});

app.listen(port, () => console.log(`Server is running on port \${port}`));
