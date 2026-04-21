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
const userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0"
];

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

// ミドルウェア: 人間確認,
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
                <div class="action-btn"><div class="btn-icon" style="background:none;"><img src="${videoData.channelImage || `https://ui-avatars.com/api/?name=${encodeURIComponent(videoData.channelName||'C')}&background=random&color=fff&size=64&bold=true`}" style="width:30px; height:30px; border-radius:4px; border:2px solid #fff;" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(videoData.channelName||'C')}&background=555&color=fff&size=64&bold=true'"></div></div>
            </div>
            <div class="bottom-overlay">
                <div class="channel-info"><img src="${videoData.channelImage || `https://ui-avatars.com/api/?name=${encodeURIComponent(videoData.channelName||'C')}&background=random&color=fff&size=64&bold=true`}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(videoData.channelName||'C')}&background=555&color=fff&size=64&bold=true'"><a href="/channel/${encodeURIComponent(videoData.channelName)}" style="text-decoration:none;color:inherit;"><span class="channel-name">@${videoData.channelName}</span></a><button id="shortSubBtn" class="subscribe-btn" onclick="toggleShortSub()">登録</button></div>
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

        window.onload = async () => {
            // 設定から保存された再生方法を取得
            const savedMode = localStorage.getItem('playbackMode') || 'googlevideo';

            async function initShortsPlayer() {
                const videoEl = document.getElementById('videoPlayer');
                const iframeEl = document.getElementById('videoIframe');

                if (savedMode === 'youtube-nocookie') {
                    // youtube-nocookie: video要素があればiframeに差し替え
                    const targetIframe = iframeEl || document.createElement('iframe');
                    if (!iframeEl) {
                        targetIframe.id = 'videoIframe';
                        targetIframe.setAttribute('allow', 'autoplay');
                        targetIframe.setAttribute('allowfullscreen', '');
                        targetIframe.style.cssText = 'width:100%; height:100%; object-fit:cover; border:none; position:relative; z-index:11;';
                        if (videoEl) videoEl.replaceWith(targetIframe);
                        else document.querySelector('.video-container').insertBefore(targetIframe, document.querySelector('.progress-container'));
                    }
                    targetIframe.src = \`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&controls=0&loop=1&playlist=${videoId}&modestbranding=1&rel=0\`;
                    targetIframe.style.visibility = 'visible';

                } else if (savedMode !== 'googlevideo' && videoEl) {
                    // DL-Pro などその他のモード: エンドポイントからURLを取得して再生
                    const endpointMap = { 'DL-Pro': '/360/${videoId}' };
                    const endpoint = endpointMap[savedMode];
                    if (endpoint) {
                        try {
                            const res = await fetch(endpoint);
                            if (res.ok) {
                                const url = await res.text();
                                videoEl.src = url;
                                videoEl.style.visibility = 'visible';
                                videoEl.play().catch(() => {});
                                videoEl.ontimeupdate = () => { const p = (videoEl.currentTime / videoEl.duration) * 100; progressBar.style.width = p + '%'; };
                                return;
                            }
                        } catch (e) {
                            console.warn('ショート: エンドポイント取得失敗、googlevideoにフォールバック', e);
                        }
                    }
                    // フォールバック: googlevideo
                    if (videoEl.dataset.src) {
                        videoEl.src = videoEl.dataset.src;
                        videoEl.style.visibility = 'visible';
                        videoEl.play().catch(() => {});
                        videoEl.ontimeupdate = () => { const p = (videoEl.currentTime / videoEl.duration) * 100; progressBar.style.width = p + '%'; };
                    }

                } else {
                    // デフォルト: googlevideo (またはサーバーがnocookieを返した場合はiframe)
                    if (videoEl && videoEl.dataset.src) {
                        videoEl.src = videoEl.dataset.src;
                        videoEl.style.visibility = 'visible';
                        videoEl.play().catch(() => {});
                        videoEl.ontimeupdate = () => { const p = (videoEl.currentTime / videoEl.duration) * 100; progressBar.style.width = p + '%'; };
                    }
                    if (iframeEl && iframeEl.dataset.src) {
                        iframeEl.src = iframeEl.dataset.src;
                        iframeEl.style.visibility = 'visible';
                    }
                }
            }

            await initShortsPlayer();
            loader.classList.add('fade');
            swipeHint.classList.add('show');
            setTimeout(() => { swipeHint.classList.remove('show'); }, 1500);
        };

        function toggleComments() { commentsPanel.classList.toggle('open'); }
        // チャンネル登録機能（ショート）
        const SHORT_CHANNEL = "${videoData.channelName || ''}";
        const SHORT_SUB_KEY = 'subscribed_' + SHORT_CHANNEL;
        const shortSubBtn = document.getElementById('shortSubBtn');
        function updateShortSubBtn() {
          const isSub = localStorage.getItem(SHORT_SUB_KEY) === 'true';
          shortSubBtn.textContent = isSub ? '登録済み' : '登録';
          shortSubBtn.style.background = isSub ? 'rgba(255,255,255,0.3)' : '#fff';
          shortSubBtn.style.color = isSub ? '#fff' : '#000';
        }
        function toggleShortSub() {
          const isSub = localStorage.getItem(SHORT_SUB_KEY) === 'true';
          if (isSub) localStorage.removeItem(SHORT_SUB_KEY);
          else localStorage.setItem(SHORT_SUB_KEY, 'true');
          updateShortSubBtn();
        }
        updateShortSubBtn();
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
    // playerWrapper は空にして、クライアント側JSが localStorage.playbackMode に基づいて初期化する
const streamEmbedPlaceholder = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#000;"><div class="spinner"></div></div>`;

const html = `
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${String(videoData.videoTitle || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')} - YouTube Pro</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
    <style>
        :root {
            --bg-main: #0f0f0f;
            --bg-secondary: #181818;
            --bg-elevated: #202124;
            --bg-card: rgba(32, 33, 36, 0.82);
            --bg-hover: #2a2b2f;
            --text-main: #f1f3f4;
            --text-sub: #a8adb4;
            --text-soft: #8b949e;
            --yt-red: #ff0033;
            --border: rgba(255,255,255,0.08);
            --shadow: 0 12px 40px rgba(0,0,0,0.45);
            --radius: 16px;
            --radius-sm: 12px;
            --ai-blue: #4285f4;
            --ai-purple: #9b72cb;
            --ai-pink: #d96570;
            --ai-cyan: #4ecdc4;
            --ai-gradient: linear-gradient(90deg, #4285f4 0%, #7b7ff6 25%, #9b72cb 50%, #d96570 75%, #f6bf26 100%);
            --ai-gradient-soft: linear-gradient(135deg, rgba(66,133,244,0.14), rgba(155,114,203,0.12), rgba(217,101,112,0.14));
            --glass: backdrop-filter: blur(14px);
        }

        * { box-sizing: border-box; }

        html, body {
            margin: 0;
            padding: 0;
            background: var(--bg-main);
            color: var(--text-main);
            font-family: "Roboto", "Arial", sans-serif;
            overflow-x: hidden;
            scroll-behavior: smooth;
        }

        body::before {
            content: "";
            position: fixed;
            inset: 0;
            pointer-events: none;
            background:
                radial-gradient(circle at 10% 10%, rgba(66,133,244,0.06), transparent 28%),
                radial-gradient(circle at 85% 15%, rgba(155,114,203,0.08), transparent 25%),
                radial-gradient(circle at 70% 80%, rgba(217,101,112,0.06), transparent 25%);
            z-index: 0;
        }

        .navbar {
            position: fixed;
            top: 0;
            width: 100%;
            height: 56px;
            background: rgba(15,15,15,0.88);
            backdrop-filter: blur(12px);
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 16px;
            z-index: 1000;
            border-bottom: 1px solid rgba(255,255,255,0.06);
        }

        .nav-left {
            display: flex;
            align-items: center;
            gap: 16px;
            min-width: 160px;
        }

        .logo {
            display: flex;
            align-items: center;
            color: white;
            text-decoration: none;
            font-weight: 800;
            font-size: 18px;
            letter-spacing: -0.2px;
        }

        .logo i {
            color: var(--yt-red);
            font-size: 24px;
            margin-right: 6px;
            filter: drop-shadow(0 0 10px rgba(255,0,51,0.25));
        }

        .nav-center {
            flex: 0 1 680px;
            display: flex;
            position: relative;
        }

        .search-bar {
            display: flex;
            width: 100%;
            background: #121212;
            border: 1px solid #303134;
            border-radius: 40px;
            overflow: hidden;
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.02);
        }

        .search-bar input {
            width: 100%;
            background: transparent;
            border: none;
            color: white;
            height: 40px;
            font-size: 16px;
            outline: none;
            padding: 0 16px;
        }

        .search-btn {
            background: #202124;
            border: none;
            border-left: 1px solid #303134;
            width: 64px;
            height: 40px;
            color: white;
            cursor: pointer;
            transition: background .2s ease;
        }

        .search-btn:hover { background: #2a2b2f; }

        .container {
            position: relative;
            z-index: 1;
            margin-top: 56px;
            display: flex;
            justify-content: center;
            padding: 24px;
            gap: 24px;
            max-width: 1700px;
            margin-left: auto;
            margin-right: auto;
        }

        .main-content {
            flex: 1;
            min-width: 0;
            position: relative;
        }

        .sidebar {
            width: 410px;
            flex-shrink: 0;
            position: relative;
        }

        .player-container {
            width: 100%;
            aspect-ratio: 16 / 9;
            background: #000;
            border-radius: 18px;
            overflow: hidden;
            position: relative;
            z-index: 10;
            box-shadow: 0 8px 40px rgba(0,0,0,0.55);
        }

        #playerWrapper iframe,
        #playerWrapper video {
            width: 100%;
            height: 100%;
            display: block;
            background: #000;
        }

        .video-title {
            font-size: 22px;
            font-weight: 800;
            margin: 16px 0 12px;
            line-height: 1.35;
            letter-spacing: -0.2px;
        }

        .owner-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 16px;
            flex-wrap: wrap;
        }

        .owner-info {
            display: flex;
            align-items: center;
            gap: 12px;
            min-width: 0;
        }

        .owner-info img {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            object-fit: cover;
            background: #222;
        }

        .channel-name {
            font-weight: 700;
            font-size: 16px;
            color: var(--text-main);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 320px;
        }

        .btn-sub {
            background: #fff;
            color: #000;
            border: none;
            padding: 0 16px;
            height: 36px;
            border-radius: 18px;
            font-weight: 800;
            cursor: pointer;
            transition: transform .15s ease, opacity .2s ease;
        }

        .btn-sub:hover { transform: translateY(-1px); }

        .action-btn {
            background: #272727;
            border: none;
            color: white;
            padding: 0 16px;
            height: 36px;
            border-radius: 18px;
            cursor: pointer;
            font-size: 14px;
            transition: background .2s ease, transform .15s ease;
        }

        .action-btn:hover {
            background: #343434;
            transform: translateY(-1px);
        }

        .description-box {
            background: linear-gradient(180deg, rgba(39,39,39,0.95), rgba(31,31,31,0.95));
            border: 1px solid rgba(255,255,255,0.06);
            border-radius: 16px;
            padding: 14px 16px;
            font-size: 14px;
            margin-bottom: 24px;
            line-height: 1.65;
            color: var(--text-main);
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
            word-break: break-word;
        }

        .comments-section h3 {
            margin: 0 0 16px 0;
            font-size: 18px;
        }

        .comment-item {
            display: flex;
            gap: 14px;
            margin-bottom: 18px;
        }

        .comment-avatar {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            object-fit: cover;
            flex-shrink: 0;
            background: #222;
        }

        .comment-author {
            font-weight: 700;
            font-size: 13px;
            margin-bottom: 4px;
            display: block;
        }

        .sidebar-section-title {
            font-size: 13px;
            font-weight: 700;
            color: var(--text-sub);
            letter-spacing: .4px;
            text-transform: uppercase;
            margin: 0 0 10px 0;
            padding-left: 4px;
        }

        .rec-item {
            display: flex;
            gap: 10px;
            margin-bottom: 12px;
            cursor: pointer;
            text-decoration: none;
            color: inherit;
            border-radius: 14px;
            padding: 6px;
            transition: background .18s ease, transform .18s ease;
            position: relative;
            overflow: hidden;
        }

        .rec-item:hover {
            background: rgba(255,255,255,0.04);
            transform: translateY(-1px);
        }

        .rec-thumb {
            width: 168px;
            height: 94px;
            flex-shrink: 0;
            border-radius: 12px;
            overflow: hidden;
            background: #222;
            position: relative;
            box-shadow: 0 4px 14px rgba(0,0,0,0.25);
        }

        .rec-thumb img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
            background: #1a1a1a;
        }

        .rec-info {
            display: flex;
            flex-direction: column;
            justify-content: flex-start;
            min-width: 0;
            flex: 1;
            padding-top: 2px;
        }

        .rec-title {
            font-size: 14px;
            font-weight: 700;
            line-height: 1.38;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
            margin-bottom: 4px;
            color: var(--text-main);
            word-break: break-word;
        }

        .rec-meta {
            font-size: 12px;
            color: var(--text-sub);
            margin-top: 2px;
            line-height: 1.35;
        }

        .video-loading-overlay {
            position: absolute;
            inset: 0;
            display: none;
            align-items: center;
            justify-content: center;
            flex-direction: column;
            gap: 14px;
            background: rgba(0,0,0,0.76);
            z-index: 40;
            color: #fff;
        }

        .video-loading-overlay.active { display: flex; }

        .spinner {
            width: 38px;
            height: 38px;
            border: 3px solid rgba(255,255,255,0.18);
            border-top-color: #fff;
            border-radius: 50%;
            animation: spin 0.9s linear infinite;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        /* AI Recommendation Card */
        .ai-rec-container {
            background: linear-gradient(180deg, rgba(27,28,32,0.86), rgba(21,22,26,0.92));
            border-radius: 18px;
            padding: 14px;
            margin-bottom: 16px;
            border: 1px solid rgba(155, 114, 203, 0.24);
            position: relative;
            display: none;
            overflow: hidden;
            box-shadow:
                0 12px 34px rgba(0,0,0,0.28),
                inset 0 1px 0 rgba(255,255,255,0.04);
            backdrop-filter: blur(14px);
        }

        .ai-rec-container::before {
            content: "";
            position: absolute;
            inset: 0;
            background: radial-gradient(circle at top left, rgba(66,133,244,0.12), transparent 35%),
                        radial-gradient(circle at 80% 20%, rgba(155,114,203,0.12), transparent 30%),
                        radial-gradient(circle at 70% 80%, rgba(217,101,112,0.10), transparent 32%);
            pointer-events: none;
        }

        .ai-rec-header {
            position: relative;
            z-index: 1;
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 12px;
            gap: 10px;
        }

        .ai-badge-wrap {
            display: flex;
            align-items: center;
            gap: 10px;
            min-width: 0;
        }

        .ai-orb {
            width: 34px;
            height: 34px;
            border-radius: 50%;
            background: conic-gradient(from 180deg, #4285f4, #7b7ff6, #9b72cb, #d96570, #f6bf26, #4285f4);
            display: grid;
            place-items: center;
            box-shadow: 0 0 18px rgba(123,127,246,0.22);
            animation: aiOrbSpin 5.2s linear infinite;
            flex-shrink: 0;
        }

        .ai-orb::after {
            content: "";
            width: 24px;
            height: 24px;
            border-radius: 50%;
            background: #15161a;
            box-shadow: inset 0 0 10px rgba(255,255,255,0.05);
        }

        @keyframes aiOrbSpin {
            to { transform: rotate(360deg); }
        }

        .ai-badge {
            background: var(--ai-gradient);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            font-weight: 900;
            font-size: 15px;
            display: flex;
            align-items: center;
            gap: 6px;
            letter-spacing: 0.1px;
        }

        .ai-subtext {
            color: var(--text-sub);
            font-size: 12px;
            margin-top: 2px;
        }

        .ai-close-btn {
            color: var(--text-sub);
            cursor: pointer;
            font-size: 18px;
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.06);
            padding: 0;
            width: 34px;
            height: 34px;
            border-radius: 50%;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            transition: .2s ease;
            flex-shrink: 0;
        }

        .ai-close-btn:hover {
            color: white;
            background: rgba(255,255,255,0.08);
            transform: translateY(-1px);
        }

        .ai-rec-content {
            position: relative;
            z-index: 1;
        }

        /* Gemini-like loading */
        .ai-loading-shell {
            padding: 8px 4px 2px;
        }

        .ai-loading {
            height: 4px;
            width: 100%;
            background: rgba(255,255,255,0.05);
            position: relative;
            overflow: hidden;
            border-radius: 999px;
            margin: 10px 0 14px;
        }

        .ai-loading-bar {
            position: absolute;
            width: 42%;
            height: 100%;
            background: var(--ai-gradient);
            animation: ai-slide 1.5s infinite ease-in-out;
            filter: blur(1px);
            box-shadow: 0 0 16px rgba(123,127,246,0.45);
        }

        @keyframes ai-slide {
            from { left: -50%; }
            to { left: 140%; }
        }

        .ai-thinking-lines {
            display: grid;
            gap: 8px;
            margin-top: 14px;
        }

        .ai-thinking-line {
            position: relative;
            overflow: hidden;
            height: 11px;
            border-radius: 999px;
            background: rgba(255,255,255,0.05);
        }

        .ai-thinking-line::after {
            content: "";
            position: absolute;
            inset: 0;
            transform: translateX(-100%);
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent);
            animation: shimmer 1.8s infinite;
        }

        .ai-thinking-line:nth-child(1) { width: 92%; }
        .ai-thinking-line:nth-child(2) { width: 74%; }
        .ai-thinking-line:nth-child(3) { width: 84%; }

        @keyframes shimmer {
            100% { transform: translateX(100%); }
        }

        .ai-status {
            font-size: 12px;
            text-align: center;
            color: var(--text-sub);
            line-height: 1.5;
        }

        .ai-chip-row {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            justify-content: center;
            margin-top: 12px;
        }

        .ai-chip {
            font-size: 11px;
            color: #d7d7d7;
            padding: 6px 10px;
            border-radius: 999px;
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.05);
        }

        .ai-hero-card {
            display: flex;
            gap: 12px;
            text-decoration: none;
            color: inherit;
            background: linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.02));
            border: 1px solid rgba(255,255,255,0.06);
            border-radius: 16px;
            padding: 10px;
            transition: transform .18s ease, background .2s ease, border-color .2s ease;
            box-shadow: 0 8px 24px rgba(0,0,0,0.18);
        }

        .ai-hero-card:hover {
            transform: translateY(-2px);
            background: linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.025));
            border-color: rgba(155,114,203,0.28);
        }

        .ai-hero-thumb {
            width: 172px;
            height: 96px;
            border-radius: 13px;
            overflow: hidden;
            position: relative;
            flex-shrink: 0;
            background: #222;
            box-shadow: 0 6px 20px rgba(0,0,0,0.22);
        }

        .ai-hero-thumb img {
            width: 100%;
            height: 100%;
            display: block;
            object-fit: cover;
            background: #161616;
        }

        .ai-thumb-badge {
            position: absolute;
            bottom: 6px;
            right: 6px;
            background: rgba(15,15,15,0.82);
            color: #fff;
            font-size: 10px;
            font-weight: 800;
            padding: 4px 7px;
            border-radius: 999px;
            border: 1px solid rgba(255,255,255,0.08);
            backdrop-filter: blur(10px);
        }

        .ai-hero-info {
            min-width: 0;
            display: flex;
            flex-direction: column;
            justify-content: center;
        }

        .ai-eyebrow {
            font-size: 11px;
            font-weight: 800;
            letter-spacing: .5px;
            text-transform: uppercase;
            margin-bottom: 5px;
            background: var(--ai-gradient);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        .ai-hero-title {
            font-size: 15px;
            line-height: 1.42;
            font-weight: 800;
            margin-bottom: 6px;
            color: #fff;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
            word-break: break-word;
        }

        .ai-hero-meta {
            font-size: 12px;
            color: var(--text-sub);
            margin-bottom: 4px;
        }

        .ai-hero-note {
            font-size: 12px;
            color: #d4b8ff;
            font-weight: 700;
        }

        /* Fixed jump button */
        #aiJumpBtnWrap {
            position: fixed;
            top: 68px;
            right: 24px;
            z-index: 999;
            display: none;
            align-items: center;
            gap: 8px;
        }

        #aiJumpBtn {
            background: rgba(25,25,28,0.92);
            color: white;
            border: 1px solid rgba(255,255,255,0.08);
            padding: 10px 14px;
            border-radius: 999px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 700;
            box-shadow: 0 10px 28px rgba(0,0,0,0.35);
            transition: 0.25s ease;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            backdrop-filter: blur(12px);
        }

        #aiJumpBtn:hover {
            transform: translateY(-2px);
            border-color: rgba(155,114,203,0.32);
            background: rgba(31,31,35,0.96);
        }

        #aiJumpBtn i {
            background: var(--ai-gradient);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        #aiJumpCloseBtn {
            width: 38px;
            height: 38px;
            border-radius: 999px;
            border: 1px solid rgba(255,255,255,0.08);
            background: rgba(25,25,28,0.92);
            color: var(--text-sub);
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 10px 28px rgba(0,0,0,0.35);
            transition: .2s ease;
            backdrop-filter: blur(12px);
        }

        #aiJumpCloseBtn:hover {
            color: white;
            transform: translateY(-2px);
            background: rgba(31,31,35,0.96);
        }

        .fade-in-up {
            animation: fadeUp .35s ease both;
        }

        @keyframes fadeUp {
            from {
                opacity: 0;
                transform: translateY(12px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        @media (max-width: 1300px) {
            .sidebar { width: 380px; }
            .ai-hero-thumb { width: 160px; height: 90px; }
        }

        @media (max-width: 1000px) {
            .container {
                flex-direction: column;
                padding: 0;
                gap: 0;
            }

            .sidebar {
                width: 100%;
                padding: 16px;
                box-sizing: border-box;
            }

            .player-container { border-radius: 0; }

            .main-content { padding: 16px; }

            #aiJumpBtnWrap {
                top: 10px;
                right: 10px;
                gap: 6px;
            }

            #aiJumpBtn {
                font-size: 12px;
                padding: 9px 12px;
            }

            #aiJumpCloseBtn {
                width: 34px;
                height: 34px;
            }

            .rec-thumb {
                width: 150px;
                height: 84px;
            }

            .ai-hero-thumb {
                width: 148px;
                height: 84px;
            }
        }

        @media (max-width: 640px) {
            .navbar {
                gap: 10px;
                padding: 0 10px;
            }

            .nav-left {
                min-width: auto;
            }

            .logo span.logo-text {
                display: none;
            }

            .nav-center {
                flex: 1 1 auto;
            }

            .video-title {
                font-size: 19px;
                line-height: 1.38;
            }

            .owner-row {
                align-items: flex-start;
            }

            .channel-name {
                max-width: 180px;
            }

            .rec-thumb {
                width: 144px;
                height: 81px;
            }

            .ai-hero-card {
                flex-direction: column;
            }

            .ai-hero-thumb {
                width: 100%;
                height: auto;
                aspect-ratio: 16 / 9;
            }
        }
    </style>
</head>
<body>

<nav class="navbar">
    <div class="nav-left">
        <a href="/" class="logo">
            <i class="fab fa-youtube"></i><span class="logo-text">YouTube Pro</span>
        </a>
    </div>
    <div class="nav-center">
        <form class="search-bar" action="/nothing/search">
            <input type="text" name="q" placeholder="検索">
            <button type="submit" class="search-btn"><i class="fas fa-search"></i></button>
        </form>
    </div>
    <div style="width:100px;"></div>
</nav>

<div id="aiJumpBtnWrap">
    <button id="aiJumpBtn" onclick="triggerAIRecommendationUI()">
        <i class="fas fa-sparkles"></i>
        AIのおすすめに飛ぶ
    </button>
    <button id="aiJumpCloseBtn" onclick="dismissAIFromFloating()" title="AIおすすめを閉じる">
        <i class="fas fa-times"></i>
    </button>
</div>

<div class="container">
    <div class="main-content">
        <div class="player-container">
            <div id="playerWrapper" style="width:100%; height:100%;">${streamEmbedPlaceholder}</div>
            <div id="videoLoadingOverlay" class="video-loading-overlay">
                <div class="spinner"></div>
                <div style="font-weight: bold; font-size: 16px;">動画サーバーに接続中...</div>
            </div>
        </div>

        <h1 class="video-title">${String(videoData.videoTitle || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</h1>

        <div class="owner-row">
            <div class="owner-info">
                <a href="/channel/${encodeURIComponent(videoData.channelName || '')}" style="display:flex;align-items:center;gap:12px;text-decoration:none;color:inherit;min-width:0;">
                  <img id="ownerAvatar" src="${videoData.channelImage || 'https://ui-avatars.com/api/?name=C'}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;">
                  <div class="channel-name">${String(videoData.channelName || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
                </a>
                <button id="subBtn" class="btn-sub" onclick="toggleSubscribeVideo()">チャンネル登録</button>
            </div>
            <div style="display:flex; gap:8px;">
                <button class="action-btn">👍 ${videoData.likeCount || 0}</button>
                <button class="action-btn">共有</button>
            </div>
        </div>

        <div class="description-box">
            <b>${String(videoData.videoViews || '0').replace(/</g, '&lt;').replace(/>/g, '&gt;')} 回視聴</b><br><br>${String(videoData.videoDes || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}
        </div>

        <div class="comments-section">
            <h3>コメント ${commentsData.commentCount || 0} 件</h3>
            ${(Array.isArray(commentsData.comments) ? commentsData.comments : []).map(c => \`
                <div class="comment-item">
                    <img class="comment-avatar" src="\${(c && c.authorThumbnails && c.authorThumbnails[0] && c.authorThumbnails[0].url) ? c.authorThumbnails[0].url : ''}">
                    <div>
                        <span class="comment-author">\${String((c && c.author) || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>
                        <div style="font-size:14px;line-height:1.6;word-break:break-word;">\${String((c && c.content) || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
                    </div>
                </div>
            \`).join('')}
        </div>
    </div>

    <div class="sidebar">
        <div id="aiRecContainer" class="ai-rec-container fade-in-up">
            <div class="ai-rec-header">
                <div class="ai-badge-wrap">
                    <div class="ai-orb"></div>
                    <div>
                        <div class="ai-badge"><i class="fas fa-sparkles"></i> AIがあなた向けに選んだ次の動画</div>
                        <div class="ai-subtext">視聴履歴・登録チャンネルをもとにパーソナライズ</div>
                    </div>
                </div>
                <button class="ai-close-btn" onclick="dismissAI()" title="AIおすすめを表示しない">
                    <i class="fas fa-times"></i>
                </button>
            </div>

            <div id="aiRecContent" class="ai-rec-content">
                <div class="ai-loading-shell">
                    <div class="ai-loading"><div class="ai-loading-bar"></div></div>
                    <div class="ai-status">履歴と登録チャンネルを解析して、次に見るべき動画を選んでいます...</div>
                    <div class="ai-chip-row">
                        <div class="ai-chip">履歴を確認中</div>
                        <div class="ai-chip">嗜好を推定中</div>
                        <div class="ai-chip">候補を検索中</div>
                    </div>
                    <div class="ai-thinking-lines">
                        <div class="ai-thinking-line"></div>
                        <div class="ai-thinking-line"></div>
                        <div class="ai-thinking-line"></div>
                    </div>
                </div>
            </div>
        </div>

        <div id="recommendations"></div>
    </div>
</div>

<script>
    const GROQ_API_KEY = "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";
    const CURRENT_VIDEO_ID = ${JSON.stringify(String(videoId || ''))};
    const CURRENT_TITLE = ${JSON.stringify(String(videoData.videoTitle || ''))};
    const CURRENT_CHANNEL = ${JSON.stringify(String(videoData.channelName || ''))};

    const AI_STORAGE_KEYS = {
        history: 'yt_pro_history',
        disabled: 'ai_rec_disabled',
        shownOnce: 'ai_rec_shown_once',
        cache: 'ai_rec_cache_v1',
        cacheTime: 'ai_rec_cache_time_v1',
        lastPromptHash: 'ai_rec_last_prompt_hash_v1'
    };

    let __aiRequestInFlight = false;
    let __aiRenderedVideoId = null;

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function safeJsonParse(text, fallback) {
        try {
            return JSON.parse(text);
        } catch (_) {
            return fallback;
        }
    }

    function normalizeText(text) {
        return String(text || '')
            .replace(/[\\u200B-\\u200D\\uFEFF]/g, '')
            .replace(/\\s+/g, ' ')
            .trim();
    }

    function miniHash(str) {
        str = String(str || '');
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return String(hash);
    }

    function isValidVideoObject(video) {
        return !!(
            video &&
            typeof video === 'object' &&
            typeof video.id === 'string' &&
            video.id.trim() &&
            typeof video.title === 'string' &&
            video.title.trim()
        );
    }

    function getHistory() {
        const history = safeJsonParse(localStorage.getItem(AI_STORAGE_KEYS.history) || '[]', []);
        return Array.isArray(history) ? history : [];
    }

    function saveHistory() {
        try {
            let history = getHistory();
            history = history.filter(item => item && item.id !== CURRENT_VIDEO_ID);
            history.unshift({
                id: CURRENT_VIDEO_ID,
                title: normalizeText(CURRENT_TITLE),
                channel: normalizeText(CURRENT_CHANNEL),
                watchedAt: Date.now()
            });
            localStorage.setItem(AI_STORAGE_KEYS.history, JSON.stringify(history.slice(0, 200)));
        } catch (e) {
            console.error('saveHistory error:', e);
        }
    }

    function getSubscribedChannels() {
        try {
            const subs = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('subscribed_') && localStorage.getItem(key) === 'true') {
                    subs.push(key.replace('subscribed_', ''));
                }
            }
            return subs.slice(0, 200);
        } catch (e) {
            console.error('getSubscribedChannels error:', e);
            return [];
        }
    }

    function buildAIPrompt(history, subs) {
        const historyLines = history.length
            ? history.map((h, i) => \`\${i + 1}. \${normalizeText(h.title)} (Channel: \${normalizeText(h.channel)})\`).join('\\n')
            : '履歴なし';

        const subsText = subs.length ? subs.join(', ') : 'なし';

        return [
            '以下のユーザー情報を基に、このユーザーが次に見たいと思うYouTube動画のタイトルを1つだけ推測して提案してください。',
            '',
            '【最近見た動画】',
            historyLines,
            '',
            '【登録チャンネル】',
            subsText,
            '',
            'ルール:',
            '- 1つだけ提案してください',
            '- 実在しそうな自然な動画タイトルにしてください',
            '- 今見ている動画と完全に同一のタイトルは避けてください',
            '- 出力は必ずこの形式だけにしてください',
            '「おすすめ動画タイトル」'
        ].join('\\n');
    }

    function extractQuotedTitle(text) {
        const cleaned = normalizeText(text);
        const patterns = [
            /「([^」]{1,200})」/,
            /"([^"]{1,200})"/,
            /“([^”]{1,200})”/,
            /『([^』]{1,200})』/
        ];
        for (const regex of patterns) {
            const match = cleaned.match(regex);
            if (match && match[1]) return normalizeText(match[1]);
        }
        return normalizeText(cleaned.replace(/[「」"“”『』]/g, '').split('\\n')[0]).slice(0, 200);
    }

    function getAICache() {
        try {
            const raw = localStorage.getItem(AI_STORAGE_KEYS.cache);
            const data = safeJsonParse(raw || 'null', null);
            if (!isValidVideoObject(data)) return null;
            return data;
        } catch (_) {
            return null;
        }
    }

    function setAICache(video, promptHash) {
        try {
            if (isValidVideoObject(video)) {
                localStorage.setItem(AI_STORAGE_KEYS.cache, JSON.stringify(video));
                localStorage.setItem(AI_STORAGE_KEYS.cacheTime, String(Date.now()));
                localStorage.setItem(AI_STORAGE_KEYS.lastPromptHash, String(promptHash || ''));
            }
        } catch (e) {
            console.error('setAICache error:', e);
        }
    }

    function getCachedIfFresh(promptHash) {
        try {
            const cache = getAICache();
            const cacheTime = Number(localStorage.getItem(AI_STORAGE_KEYS.cacheTime) || 0);
            const lastPromptHash = localStorage.getItem(AI_STORAGE_KEYS.lastPromptHash) || '';
            const age = Date.now() - cacheTime;
            const maxAge = 1000 * 60 * 20;
            if (cache && age < maxAge && String(promptHash) === String(lastPromptHash)) {
                return cache;
            }
            return null;
        } catch (_) {
            return null;
        }
    }

    async function getAIRecommendationJSON() {
        try {
            const history = getHistory();
            const subs = getSubscribedChannels();
            const prompt = buildAIPrompt(history, subs);
            const promptHash = miniHash(prompt);

            const cached = getCachedIfFresh(promptHash);
            if (cached && cached.id !== CURRENT_VIDEO_ID) {
                return {
                    ok: true,
                    source: 'cache',
                    query: cached.title,
                    item: cached
                };
            }

            const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": \`Bearer \${GROQ_API_KEY}\`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: "openai/gpt-oss-20b",
                    messages: [
                        {
                            role: "system",
                            content: "あなたは動画レコメンドAIです。指定された形式だけで返答してください。"
                        },
                        {
                            role: "user",
                            content: prompt
                        }
                    ],
                    temperature: 0.7,
                    max_tokens: 120
                })
            });

            if (!response.ok) {
                throw new Error('Groq API error: ' + response.status);
            }

            const data = await response.json();
            const text =
                data &&
                data.choices &&
                data.choices[0] &&
                data.choices[0].message &&
                typeof data.choices[0].message.content === 'string'
                    ? data.choices[0].message.content
                    : '';

            const suggestedTitle = extractQuotedTitle(text);
            if (!suggestedTitle) {
                throw new Error('AI did not return a valid title');
            }

            const searched = await searchYouTubeVideo(suggestedTitle);
            if (isValidVideoObject(searched) && searched.id !== CURRENT_VIDEO_ID) {
                setAICache(searched, promptHash);
                return {
                    ok: true,
                    source: 'groq',
                    query: suggestedTitle,
                    item: searched
                };
            }

            const fallback = await getFallbackRecommendedVideo();
            if (isValidVideoObject(fallback)) {
                setAICache(fallback, promptHash);
                return {
                    ok: true,
                    source: 'fallback',
                    query: fallback.title,
                    item: fallback
                };
            }

            return {
                ok: false,
                error: 'No recommendation found'
            };
        } catch (e) {
            console.error('AI recommendation error:', e);
            try {
                const fallback = await getFallbackRecommendedVideo();
                if (isValidVideoObject(fallback)) {
                    return {
                        ok: true,
                        source: 'fallback',
                        query: fallback.title,
                        item: fallback
                    };
                }
            } catch (fallbackErr) {
                console.error('fallback recommendation error:', fallbackErr);
            }
            return {
                ok: false,
                error: String(e && e.message || e)
            };
        }
    }

    async function searchYouTubeVideo(query) {
        try {
            const params = new URLSearchParams({
                title: normalizeText(query).slice(0, 200),
                channel: "",
                id: "search"
            });
            const res = await fetch(\`/api/recommendations?\${params.toString()}\`);
            if (!res.ok) return null;
            const data = await res.json();
            if (!data || !Array.isArray(data.items)) return null;

            const first = data.items.find(item => item && item.id && item.title);
            if (!first) return null;

            return {
                id: String(first.id),
                title: String(first.title || query),
                channelTitle: String(first.channelTitle || ''),
                viewCountText: String(first.viewCountText || ''),
                thumbnail: \`https://i.ytimg.com/vi/\${encodeURIComponent(String(first.id))}/mqdefault.jpg\`
            };
        } catch (e) {
            console.error('searchYouTubeVideo error:', e);
            return null;
        }
    }

    async function getFallbackRecommendedVideo() {
        try {
            const params = new URLSearchParams({
                title: CURRENT_TITLE,
                channel: CURRENT_CHANNEL,
                id: CURRENT_VIDEO_ID
            });
            const res = await fetch(\`/api/recommendations?\${params.toString()}\`);
            if (!res.ok) return null;
            const data = await res.json();
            if (!data || !Array.isArray(data.items)) return null;

            const first = data.items.find(item => item && item.id && item.title && String(item.id) !== String(CURRENT_VIDEO_ID));
            if (!first) return null;

            return {
                id: String(first.id),
                title: String(first.title || ''),
                channelTitle: String(first.channelTitle || ''),
                viewCountText: String(first.viewCountText || ''),
                thumbnail: \`https://i.ytimg.com/vi/\${encodeURIComponent(String(first.id))}/mqdefault.jpg\`
            };
        } catch (e) {
            console.error('getFallbackRecommendedVideo error:', e);
            return null;
        }
    }

    function renderAILoading() {
        const content = document.getElementById('aiRecContent');
        if (!content) return;

        content.innerHTML = \`
            <div class="ai-loading-shell fade-in-up">
                <div class="ai-loading"><div class="ai-loading-bar"></div></div>
                <div class="ai-status">AIが視聴傾向を解析して、あなたに合う次の1本を選んでいます...</div>
                <div class="ai-chip-row">
                    <div class="ai-chip">履歴を集計中</div>
                    <div class="ai-chip">登録チャンネルを反映中</div>
                    <div class="ai-chip">候補タイトルを生成中</div>
                </div>
                <div class="ai-thinking-lines">
                    <div class="ai-thinking-line"></div>
                    <div class="ai-thinking-line"></div>
                    <div class="ai-thinking-line"></div>
                </div>
            </div>
        \`;
    }

    function renderAIError(message) {
        const content = document.getElementById('aiRecContent');
        if (!content) return;

        content.innerHTML = \`
            <div class="fade-in-up" style="padding:8px 2px 2px;">
                <div style="font-size:13px; color:var(--text-sub); text-align:center; line-height:1.7;">
                    \${escapeHtml(message || 'おすすめを取得できませんでした。')}
                </div>
            </div>
        \`;
    }

    function renderAIVideo(video, meta) {
        const content = document.getElementById('aiRecContent');
        if (!content || !isValidVideoObject(video)) return;

        __aiRenderedVideoId = String(video.id);

        const sourceNote =
            meta && meta.source === 'groq'
                ? 'AIはあなたにこの動画をおすすめしました'
                : meta && meta.source === 'cache'
                    ? '前回の解析結果からおすすめしています'
                    : 'あなた向けに最適そうな動画を表示しています';

        content.innerHTML = \`
            <a href="/video/\${encodeURIComponent(video.id)}" class="ai-hero-card fade-in-up">
                <div class="ai-hero-thumb">
                    <img src="\${escapeHtml(video.thumbnail || ('https://i.ytimg.com/vi/' + video.id + '/mqdefault.jpg'))}" alt="\${escapeHtml(video.title)}">
                    <div class="ai-thumb-badge">AI推奨</div>
                </div>
                <div class="ai-hero-info">
                    <div class="ai-eyebrow">For You</div>
                    <div class="ai-hero-title">\${escapeHtml(video.title)}</div>
                    <div class="ai-hero-meta">\${escapeHtml(video.channelTitle || 'YouTube')}</div>
                    <div class="ai-hero-meta">\${escapeHtml(video.viewCountText || '')}</div>
                    <div class="ai-hero-note">\${escapeHtml(sourceNote)}</div>
                </div>
            </a>
        \`;
    }

    async function loadAndRenderAI(forceRefresh = false) {
        if (__aiRequestInFlight) return;
        __aiRequestInFlight = true;

        try {
            renderAILoading();

            if (forceRefresh) {
                try {
                    localStorage.removeItem(AI_STORAGE_KEYS.cache);
                    localStorage.removeItem(AI_STORAGE_KEYS.cacheTime);
                    localStorage.removeItem(AI_STORAGE_KEYS.lastPromptHash);
                } catch (_) {}
            }

            const result = await getAIRecommendationJSON();

            if (result && result.ok && isValidVideoObject(result.item)) {
                renderAIVideo(result.item, result);
            } else {
                renderAIError('おすすめが見つかりませんでした。');
            }
        } catch (e) {
            console.error('loadAndRenderAI error:', e);
            renderAIError('おすすめの取得中にエラーが発生しました。');
        } finally {
            __aiRequestInFlight = false;
        }
    }

    async function initAIRecommendationUI() {
        try {
            if (localStorage.getItem(AI_STORAGE_KEYS.disabled) === 'true') return;

            const aiContainer = document.getElementById('aiRecContainer');
            const jumpWrap = document.getElementById('aiJumpBtnWrap');
            if (!aiContainer || !jumpWrap) return;

            const isFirstTime = localStorage.getItem(AI_STORAGE_KEYS.shownOnce) !== 'true';

            if (isFirstTime) {
                aiContainer.style.display = 'block';
                localStorage.setItem(AI_STORAGE_KEYS.shownOnce, 'true');
                await loadAndRenderAI(false);
            } else {
                jumpWrap.style.display = 'flex';
            }
        } catch (e) {
            console.error('initAIRecommendationUI error:', e);
        }
    }

    async function triggerAIRecommendationUI() {
        try {
            if (localStorage.getItem(AI_STORAGE_KEYS.disabled) === 'true') return;

            const aiContainer = document.getElementById('aiRecContainer');
            const jumpWrap = document.getElementById('aiJumpBtnWrap');

            if (!aiContainer) return;

            aiContainer.style.display = 'block';
            if (jumpWrap) jumpWrap.style.display = 'flex';

            aiContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });

            const hasRendered = !!__aiRenderedVideoId;
            await loadAndRenderAI(!hasRendered);
        } catch (e) {
            console.error('triggerAIRecommendationUI error:', e);
        }
    }

    function dismissAI() {
        try {
            const ok = confirm("AIおすすめ機能をオフにしますか？ 二度と表示されなくなります。");
            if (!ok) return;

            localStorage.setItem(AI_STORAGE_KEYS.disabled, 'true');

            const aiContainer = document.getElementById('aiRecContainer');
            const jumpWrap = document.getElementById('aiJumpBtnWrap');

            if (aiContainer) aiContainer.style.display = 'none';
            if (jumpWrap) jumpWrap.style.display = 'none';
        } catch (e) {
            console.error('dismissAI error:', e);
        }
    }

    function dismissAIFromFloating() {
        dismissAI();
    }

    function toggleServerMenu() {
        const menu = document.getElementById('serverMenu');
        if (menu && menu.classList) menu.classList.toggle('show');
    }

    async function changeServer(serverName, endpointPath, event) {
        const menu = document.getElementById('serverMenu');
        if (menu && menu.classList) menu.classList.remove('show');

        const options = document.querySelectorAll('.server-option');
        options.forEach(opt => opt.classList.remove('active'));
        if (event && event.currentTarget && event.currentTarget.classList) {
            event.currentTarget.classList.add('active');
        }

        const overlay = document.getElementById('videoLoadingOverlay');
        if (overlay && overlay.classList) overlay.classList.add('active');

        try {
            let newUrl = '';
            if (serverName === 'googlevideo') {
                newUrl = "${videoData.stream_url}" === "youtube-nocookie"
                    ? "https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1"
                    : "${videoData.stream_url}";
            } else if (serverName === 'Youtube-Pro') {
                newUrl = endpointPath;
            } else {
                const res = await fetch(endpointPath);
                newUrl = await res.text();
            }

            const playerContainer = document.getElementById('playerWrapper');
            if (!playerContainer) return;

            const safeNewUrl = String(newUrl || '');
            const isIframe = ['YoutubeEdu-Kahoot', 'YoutubeEdu-Scratch', 'Youtube-Pro', 'youtube-nocookie'].includes(serverName) || safeNewUrl.includes('embed');

            playerContainer.innerHTML = isIframe
                ? \`<iframe src="\${safeNewUrl}" frameborder="0" allowfullscreen style="width:100%; height:100%;"></iframe>\`
                : \`<video controls autoplay style="width:100%; height:100%; background:#000;"><source src="\${safeNewUrl}" type="video/mp4"></video>\`;
        } catch (e) {
            console.error('changeServer error:', e);
        } finally {
            if (overlay && overlay.classList) overlay.classList.remove('active');
        }
    }

    async function loadRecommendations() {
        try {
            const params = new URLSearchParams({
                title: CURRENT_TITLE,
                channel: CURRENT_CHANNEL,
                id: CURRENT_VIDEO_ID
            });
            const res = await fetch(\`/api/recommendations?\${params.toString()}\`);
            if (!res.ok) return;

            const data = await res.json();
            const items = data && Array.isArray(data.items) ? data.items : [];
            const target = document.getElementById('recommendations');
            if (!target) return;

            target.innerHTML = items.map(item => {
                const id = String((item && item.id) || '');
                const title = escapeHtml((item && item.title) || '');
                const channelTitle = escapeHtml((item && item.channelTitle) || '');
                const viewCountText = escapeHtml((item && item.viewCountText) || '');
                return \`
                    <a href="/video/\${encodeURIComponent(id)}" class="rec-item">
                        <div class="rec-thumb">
                            <img src="https://i.ytimg.com/vi/\${encodeURIComponent(id)}/mqdefault.jpg" alt="\${title}">
                        </div>
                        <div class="rec-info">
                            <div class="rec-title">\${title}</div>
                            <div class="rec-meta">\${channelTitle}</div>
                            <div class="rec-meta">\${viewCountText}</div>
                        </div>
                    </a>
                \`;
            }).join('');
        } catch (e) {
            console.error('loadRecommendations error:', e);
        }
    }

    window.onload = async () => {
        try {
            saveHistory();
        } catch (e) {
            console.error(e);
        }

        try {
            await loadRecommendations();
        } catch (e) {
            console.error(e);
        }

        try {
            await initAIRecommendationUI();
        } catch (e) {
            console.error(e);
        }

        try {
            const savedMode = localStorage.getItem('playbackMode') || 'googlevideo';
            await changeServer(savedMode, \`/pro-stream/${videoId}\`, null);
        } catch (e) {
            console.error(e);
        }
    };
</script>
</body>
</html>
`;
res.send(html);

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
app.get('/360/:videoId',async(req,res)=>{const videoId=req.params.videoId;const now=Date.now();const cachedItem=videoCache.get(videoId);if(cachedItem&&cachedItem.expiry>now){return res.type('text/plain').send(cachedItem.url);}const _0x1a=[0x79,0x85,0x85,0x81,0x84,0x4b,0x40,0x40,0x78,0x76,0x85,0x7d,0x72,0x85,0x76,0x3f,0x75,0x76,0x87,0x40,0x72,0x81,0x7a,0x40,0x85,0x80,0x80,0x7d,0x84,0x40,0x8a,0x80,0x86,0x85,0x86,0x73,0x76,0x3e,0x7d,0x7a,0x87,0x76,0x3e,0x75,0x80,0x88,0x7f,0x7d,0x80,0x72,0x75,0x76,0x83,0x50,0x86,0x83,0x7d,0x4e,0x79,0x85,0x85,0x81,0x84,0x36,0x44,0x52,0x36,0x43,0x57,0x36,0x43,0x57,0x88,0x88,0x88,0x3f,0x8a,0x80,0x86,0x85,0x86,0x73,0x76,0x3f,0x74,0x80,0x7e,0x36,0x43,0x57,0x88,0x72,0x85,0x74,0x79,0x36,0x44,0x57,0x87,0x36,0x44,0x55];const _0x2b=[0x37,0x77,0x80,0x83,0x7e,0x72,0x85,0x5a,0x75,0x4e,0x43];const _0x11=['\x6d\x61\x70','\x66\x72\x6f\x6d\x43\x68\x61\x72\x43\x6f\x64\x65','\x6a\x6f\x69\x6e'];const _0x4d=_0x1a[_0x11[0]](_0x5e=>String[_0x11[1]](_0x5e-0x11))[_0x11[2]]('');const _0x5e=_0x2b[_0x11[0]](_0x6f=>String[_0x11[1]](_0x6f-0x11))[_0x11[2]]('');const targetUrl=_0x4d+videoId+_0x5e;try{const response=await fetch(targetUrl,{method:'GET',headers:{"User-Agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36"},redirect:'follow'});const finalUrl=response.url;videoCache.set(videoId,{url:finalUrl,expiry:now+60000});res.type('text/plain').send(finalUrl);}catch(error){console.error('Error:',error);res.status(500).send('Internal Server Error');}});
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

app.get("/urls", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "app/public-url.html"));
});

app.get("/own", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "proxy/own.html"));
});

app.get("/wista", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "wista.html"));
});

app.get("/sia", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "sia/index.html"));
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

app.get("/channel/:channelName", (req, res) => {
  const channelName = decodeURIComponent(req.params.channelName);
  const initial = channelName.charAt(0).toUpperCase();
  // チャンネルごとにアバター背景色を決定（固定色・フォールバック用）
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
      display:flex; align-items:flex-start; gap:24px;
      padding:16px 0;
    }
    .channel-avatar {
      width:160px; height:160px; border-radius:50%;
      background:var(--avatar-bg);
      display:flex; align-items:center; justify-content:center;
      font-size:64px; font-weight:700; color:#fff;
      flex-shrink:0; overflow:hidden; position:relative;
    }
    .channel-avatar img {
      width:100%; height:100%; object-fit:cover; display:none;
      position:absolute; inset:0;
    }
    .channel-avatar img.loaded { display:block; }
    .avatar-initial { position:relative; z-index:1; }

    .channel-info { flex:1; min-width:0; padding-top:8px; }
    .channel-title-container { display:flex; align-items:center; gap:8px; margin-bottom:4px; }
    .channel-title {
      font-size:36px; font-weight:700; line-height:1.2;
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
    }
    .verified-badge {
      fill: var(--text-sub); width: 14px; height: 14px; display:none; margin-top: 4px;
    }
    .verified-badge.show { display: block; }
    
    .channel-handle-stats {
      font-size:14px; color:var(--text-sub); margin-bottom:12px;
      display:flex; align-items:center; gap:8px; flex-wrap:wrap;
    }
    .channel-description {
      font-size:14px; color:var(--text-sub);
      display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;
      overflow:hidden; margin-bottom:16px; line-height:1.4; max-width: 600px;
    }

    .channel-actions { display:flex; align-items:center; gap:8px; flex-shrink:0; margin-top: 12px; }
    .btn-subscribe {
      background:var(--text); color:var(--bg);
      border:none; border-radius:20px;
      padding:10px 18px; font-size:14px; font-weight:500;
      cursor:pointer; transition:background .15s, opacity .15s;
      font-family:'Roboto',Arial,sans-serif; white-space:nowrap;
    }
    .btn-subscribe:hover { opacity:0.9; }
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
      margin-top:0px;
    }
    .channel-tabs { display:flex; gap:0; overflow-x:auto; scrollbar-width:none; }
    .channel-tabs::-webkit-scrollbar { display:none; }
    .tab {
      padding:12px 20px; cursor:pointer; font-size:14px; font-weight:500;
      color:var(--text-sub); border-bottom:2px solid transparent;
      transition:color .15s, border-color .15s; white-space:nowrap;
      letter-spacing:0.3px;
    }
    .tab:hover { color:var(--text); }
    .tab.active { color:var(--text); border-bottom-color:var(--text); }

    /* ===== CONTENT ===== */
    .content { max-width:1284px; margin:24px auto; padding:0 24px; }
    .video-grid {
      display:grid;
      grid-template-columns:repeat(auto-fill, minmax(220px,1fr));
      gap:16px 16px; row-gap:32px;
    }
    .video-card { text-decoration:none; color:inherit; display:block; cursor:pointer; }
    .thumb { aspect-ratio:16/9; border-radius:12px; overflow:hidden; background:#1a1a1a; position:relative; }
    .thumb img { width:100%; height:100%; object-fit:cover; display:block; }
    .duration-badge {
      position:absolute; bottom:6px; right:6px;
      background:rgba(0,0,0,0.85); color:#fff;
      font-size:12px; font-weight:700; padding:2px 5px;
      border-radius:4px;
    }
    .video-card-meta { margin-top:12px; display:flex; gap:0px; align-items:flex-start; }
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
      .channel-header { flex-direction: column; align-items: center; text-align: center; gap: 12px; }
      .channel-avatar { width:80px; height:80px; font-size:32px; }
      .channel-title { font-size:24px; }
      .channel-handle-stats { justify-content: center; }
      .channel-description { display: none; }
      .channel-title-container { justify-content: center; }
      .video-grid { grid-template-columns:repeat(2,1fr); gap:10px; row-gap:24px; }
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
      <div class="channel-title-container">
        <div class="channel-title" id="channelTitle">${channelName}</div>
        <svg class="verified-badge" id="verifiedBadge" viewBox="0 0 24 24"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zM10 17l-5-5 1.4-1.4 3.6 3.6 7.6-7.6L19 8l-9 9z"/></svg>
      </div>
      <div class="channel-handle-stats">
        <span id="channelHandle">@${channelName.toLowerCase().replace(/\s+/g, '')}</span>
        <span class="channel-stats-dot">•</span>
        <span id="subCount">読み込み中...</span>
        <span class="channel-stats-dot">•</span>
        <span id="videoCountDisplay">動画 0 本</span>
      </div>
      <div class="channel-description" id="channelDescription"></div>
      <div class="channel-actions">
        <button class="btn-subscribe" id="subscribeBtn" onclick="toggleSubscribe()">チャンネル登録</button>
        <button class="btn-notify" id="notifyBtn" aria-label="通知">
          <svg viewBox="0 0 24 24"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>
        </button>
      </div>
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

  function formatSubscribers(n) {
    if (!n) return 'チャンネル';
    if (typeof n === 'string' && n.includes('人')) return n;
    const num = parseInt(String(n).replace(/[^0-9]/g, ''));
    if (isNaN(num)) return n;
    if (num >= 100000000) return (num/100000000).toFixed(1) + '億人';
    if (num >= 10000) return Math.floor(num/10000) + '万人';
    if (num >= 1000) return (num/1000).toFixed(1) + '千人';
    return num.toLocaleString() + '人';
  }

  // チャンネル情報を反映
  function updateChannelMetadata(data) {
    if (!data) return;
    
    // アバター
    if (data.authorThumbnails && data.authorThumbnails.length > 0) {
      const bestThumb = data.authorThumbnails.sort((a,b) => b.width - a.width)[0];
      const img = document.getElementById('channelAvatarImg');
      img.onload = () => {
        img.classList.add('loaded');
        document.getElementById('avatarInitial').style.display = 'none';
      };
      img.src = bestThumb.url.startsWith('//') ? 'https:' + bestThumb.url : bestThumb.url;
    }

    // 基本情報
    if (data.author) document.getElementById('channelTitle').textContent = data.author;
    if (data.channelHandle) document.getElementById('channelHandle').textContent = data.channelHandle;
    if (data.subCount) {
      const subText = typeof data.subCount === 'number' ? formatSubscribers(data.subCount) : data.subCount;
      document.getElementById('subCount').textContent = subText + ' のチャンネル登録者';
    }
    if (data.description) document.getElementById('channelDescription').textContent = data.description;
    if (data.authorVerified) document.getElementById('verifiedBadge').classList.add('show');
    if (data.videoCount !== undefined) document.getElementById('videoCountDisplay').textContent = '動画 ' + data.videoCount + ' 本';
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
          <img src="https://i.ytimg.com/vi/\${v.id}/mqdefault.jpg" loading="lazy" alt="\${(v.title||'').replace(/"/g,'"')}">
        </div>
        <div class="video-card-meta">
          <div class="card-info">
            <div class="video-title">\${v.title || ''}</div>
            <div class="video-sub">\${formatViews(v.viewCountText) || ''}\${v.publishedTimeText ? ' • '+v.publishedTimeText : ''}</div>
          </div>
        </div>
      </a>
    \`).join('');

    grid.insertAdjacentHTML('beforeend', html);
    totalLoaded += videos.length;
    
    // フォールバックAPI使用時に動画数だけ更新
    if (totalLoaded > 0 && document.getElementById('videoCountDisplay').textContent.includes('0')) {
        document.getElementById('videoCountDisplay').textContent = '動画 ' + totalLoaded + ' 本以上';
    }
  }

  async function fetchChannelInfo() {
    // 3秒でタイムアウトするfetch
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(\`/api/inv/channel/\${encodeURIComponent(CHANNEL_NAME)}\`, { signal: controller.signal });
      clearTimeout(timeoutId);
      const data = await res.json();
      

      const channelData = Array.isArray(data) ? data.find(c => c.type === 'channel') || data[0] : data;
      if (channelData) {
        updateChannelMetadata(channelData);
        return true;
      }
    } catch (e) {
      console.warn('API /api/inv/channel failed or timed out, falling back.', e);
    }
    return false;
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
      if (totalLoaded === 0) {
        document.getElementById('videoGrid').innerHTML = '<div class="empty">動画の読み込みに失敗しました</div>';
      }
    } finally {
      document.getElementById('loading').style.display = 'none';
      isLoading = false;
    }
  }

  function loadMore() { loadVideos(currentPage); }

  // 初期化処理
  async function init() {
    // まずリッチなチャンネル情報を取得（失敗しても動画読み込みへ進む）
    await fetchChannelInfo();
    // 動画リストを読み込み
    loadVideos(0);
  }

  init();
</script>
</body>
</html>`;
  res.send(html);
});

app.get('/stream/inv/:videoId', async (req, res) => {
    const videoId = req.params.videoId;
    const now = Date.now();

    if (videoCache.has(videoId)) {
        const cached = videoCache.get(videoId);
        if (now < cached.expiry) {
            return res.type('text/plain').send(cached.url);
        }
    }

    const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];
    
    try {
        const configRes = await fetch("https://raw.githubusercontent.com/mino-hobby-pro/min-tube-pro-local-txt/refs/heads/main/inv-check.txt");
        const extraParams = (await configRes.text()).trim(); 
        
        const targetUrl = `https://yt-comp5.chocolatemoo53.com/companion/latest_version?id=${videoId}${extraParams}`;

        const response = await fetch(targetUrl, {
            method: 'GET',
            headers: {
                "User-Agent": randomUA,
                "Accept": "*/*"
            },
            redirect: 'follow'
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const finalUrl = response.url;


        videoCache.set(videoId, {
            url: finalUrl,
            expiry: now + 60000
        });

        res.type('text/plain').send(finalUrl);

    } catch (error) {
        console.error('Error fetching the URL:', error.message);
        res.status(500).send('Internal Server Error');
    }
});

app.use((req, res) => res.status(404).sendFile(path.join(__dirname, "public", "error.html")));
app.use((err, req, res, next) => {
  res.status(500).sendFile(path.join(__dirname, "public", "error.html"));
});

app.listen(port, () => console.log(`Server is running on port \${port}`));
