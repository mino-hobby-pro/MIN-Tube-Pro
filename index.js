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
        'https://raw.githubusercontent.com/mino-hobby-pro/gisou-min2/refs/heads/main/3d.txt',
        'https://raw.githubusercontent.com/mino-hobby-pro/gisou-min2/refs/heads/main/math.txt',
        'https://raw.githubusercontent.com/mino-hobby-pro/gisou-min2/refs/heads/main/study.txt'
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
    // 確実に結果が出る幅広いキーワード群
    const baseTopics = [
      "音楽", "ニュース", "ゲーム実況", "エンタメ", 
      "Vlog", "料理", "スポーツ", "アニメ", "バラエティ"
    ];

    // キーワードをシャッフルして、毎回違うジャンルが混ざるようにする
    const shuffledTopics = shuffleArray([...baseTopics]);
    const seed1 = shuffledTopics[0];
    const seed2 = shuffledTopics[1];

    // 並列で取得して効率化
    const [res1, res2] = await Promise.all([
      yts.GetListByKeyword(seed1, false, 40),
      yts.GetListByKeyword(seed2, false, 40)
    ]);

    let combined = [...(res1.items || []), ...(res2.items || [])];
    const uniqueItemsMap = new Map();

    for (const item of combined) {
      if (item.type !== 'video') continue;

      const titleLower = item.title.toLowerCase();
      // ★絶対ショート動画を読み込まないフィルター
      if (titleLower.includes('shorts') || titleLower.includes('#shorts') || titleLower.includes('ショート')) continue;
      
      const thumbUrl = item.thumbnail?.thumbnails?.[0]?.url || "";
      if (thumbUrl.includes('shorts')) continue;

      // 重複排除してマップに格納
      if (!uniqueItemsMap.has(item.id)) {
        uniqueItemsMap.set(item.id, item);
      }
    }

    // 全体をシャッフルして、特定のジャンルが固まらないようにする
    let finalItems = Array.from(uniqueItemsMap.values());
    finalItems = shuffleArray(finalItems).slice(0, 30);

    res.json({ items: finalItems });
    
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

// ★★★ 究極のパーフェクト・アルゴリズム (No Shorts, No Channels) ★★★
app.get("/api/recommendations", async (req, res) => {
  const { title, channel, id } = req.query;
  try {
    // 1. タイトルのクレンジング（検索精度向上）
    const cleanKwd = title
      .replace(/[【】「」()!！?？\[\]]/g, ' ')
      .replace(/#shorts|shorts|ショート/gi, '') // 検索ワードからShortsを排除
      .replace(/\s+/g, ' ')
      .trim();

    const words = cleanKwd.split(' ').filter(w => w.length >= 2);
    const mainTopic = words.length > 0 ? words.slice(0, 2).join(' ') : cleanKwd;

    // 2. 複数のソースから候補を収集
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

    // 3. 厳格なフィルタリング・フェーズ
    const seenIds = new Set([id]); 
    const seenNormalizedTitles = new Set();
    const finalItems = [];

    for (const item of rawList) {
      // (1) アカウント（Channel）やプレイリストを除外、動画のみを許可
      if (!item.id || item.type !== 'video') continue;
      
      // (2) すでにリストにある、または現在の動画ならスキップ
      if (seenIds.has(item.id)) continue;

      // (3) Shortsの徹底排除ロジック
      const isShortsTitle = /#shorts|shorts|ショート/gi.test(item.title);
      // 一部のAPIではthumbnailのURLにshortsが含まれる、または特定のフラグがある
      const isShortsThumb = item.thumbnail?.thumbnails?.[0]?.url?.includes('shorts');
      if (isShortsTitle || isShortsThumb) continue;

      // (4) タイトルの正規化による「重複内容」の排除
      const normalized = item.title.toLowerCase()
        .replace(/\s+/g, '')
        .replace(/official|lyrics|mv|musicvideo|video|公式|実況|解説|ショート|#shorts/g, '');

      // 内容が似すぎている動画（例：同じ曲の別アップロードなど）を排除
      const titleSig = normalized.substring(0, 12);
      if (seenNormalizedTitles.has(titleSig)) continue;

      // 合格した動画をリストに追加
      seenIds.add(item.id);
      seenNormalizedTitles.add(titleSig);
      finalItems.push(item);

      if (finalItems.length >= 18) break; 
    }

    // 4. シャッフルして自然なおすすめ感を演出
    const result = finalItems.sort(() => 0.5 - Math.random());
    
    res.json({ items: result });
  } catch (err) {
    console.error("Rec Engine Error:", err);
    res.json({ items: [] });
  }
});

// --- VIDEO PAGE ---

app.get("/video/:id", async (req, res, next) => {
  const videoId = req.params.id;
  
  try {
    let videoData = null;
    let commentsData = { commentCount: 0, comments: [] };
    let successfulApi = null;

    for (const apiBase of apiListCache) {
      try {
        const response = await fetchWithTimeout(`${apiBase}/api/video/${videoId}`, {}, 6000);
        if (response.ok) {
          const data = await response.json();
          if (data.stream_url) {
            videoData = data;
            successfulApi = apiBase;
            break;
          }
        }
      } catch (e) { continue; }
    }

    if (!videoData) {
      videoData = { videoTitle: "再生できない動画", stream_url: "youtube-nocookie" };
    }

    if (successfulApi) {
      try {
        const cRes = await fetchWithTimeout(`${successfulApi}/api/comments/${videoId}`, {}, 3000);
        if (cRes.ok) commentsData = await cRes.json();
      } catch (e) {}
    }

    const streamEmbed = videoData.stream_url !== "youtube-nocookie"
      ? `<video controls autoplay poster="https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg">
           <source src="${videoData.stream_url}" type="video/mp4">
         </video>`
      : `<iframe src="https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1" frameborder="0" allowfullscreen></iframe>`;

    const html = `
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${videoData.videoTitle} - YouTube Pro</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
    <style>
        :root {
            --bg-main: #0f0f0f;
            --bg-secondary: #272727;
            --bg-hover: #3f3f3f;
            --text-main: #f1f1f1;
            --text-sub: #aaaaaa;
            --yt-red: #ff0000;
        }
        body {
            margin: 0; padding: 0;
            background: var(--bg-main);
            color: var(--text-main);
            font-family: "Roboto", "Arial", sans-serif;
            overflow-x: hidden;
        }

        .navbar {
            position: fixed; top: 0; width: 100%; height: 56px;
            background: var(--bg-main);
            display: flex; align-items: center; justify-content: space-between;
            padding: 0 16px; box-sizing: border-box; z-index: 1000;
            border-bottom: 1px solid #222;
        }
        .nav-left { display: flex; align-items: center; gap: 16px; }
        .logo { display: flex; align-items: center; color: white; text-decoration: none; font-weight: bold; font-size: 18px; }
        .logo i { color: var(--yt-red); font-size: 24px; margin-right: 4px; }
        
        .nav-center { flex: 0 1 600px; display: flex; }
        .search-bar {
            display: flex; width: 100%;
            background: #121212; border: 1px solid #303030; border-radius: 40px 0 0 40px;
            padding: 0 16px;
        }
        .search-bar input {
            width: 100%; background: transparent; border: none; color: white;
            height: 38px; font-size: 16px; outline: none;
        }
        .search-btn {
            background: #222; border: 1px solid #303030; border-left: none;
            border-radius: 0 40px 40px 0; width: 64px; height: 40px;
            color: white; cursor: pointer;
        }

        .container {
            margin-top: 56px; display: flex; justify-content: center;
            padding: 24px; gap: 24px; max-width: 1700px; margin-left: auto; margin-right: auto;
        }
        .main-content { flex: 1; min-width: 0; }
        .sidebar { width: 400px; flex-shrink: 0; }

        .player-container {
            width: 100%; aspect-ratio: 16 / 9;
            background: black; border-radius: 12px; overflow: hidden;
        }
        .player-container video, .player-container iframe { width: 100%; height: 100%; border: none; }

        .video-title { font-size: 20px; font-weight: bold; margin: 12px 0; line-height: 28px; }
        .owner-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
        .owner-info { display: flex; align-items: center; gap: 12px; }
        .owner-info img { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; }
        .channel-name { font-weight: bold; font-size: 16px; }
        
        .btn-sub {
            background: white; color: black; border: none;
            padding: 0 16px; height: 36px; border-radius: 18px;
            font-weight: bold; cursor: pointer;
        }
        .action-btn {
            background: var(--bg-secondary); border: none; color: white;
            padding: 0 16px; height: 36px; border-radius: 18px;
            cursor: pointer; font-size: 14px;
        }

        .description-box {
            background: var(--bg-secondary); border-radius: 12px;
            padding: 12px; font-size: 14px; margin-bottom: 24px;
        }

        .comment-item { display: flex; gap: 16px; margin-bottom: 20px; }
        .comment-avatar { width: 40px; height: 40px; border-radius: 50%; }
        .comment-author { font-weight: bold; font-size: 13px; margin-bottom: 4px; display: block; }

        .rec-item { display: flex; gap: 8px; margin-bottom: 12px; cursor: pointer; text-decoration: none; color: inherit; }
        .rec-thumb { width: 160px; height: 90px; flex-shrink: 0; border-radius: 8px; overflow: hidden; background: #222; }
        .rec-thumb img { width: 100%; height: 100%; object-fit: cover; }
        .rec-title { font-size: 14px; font-weight: bold; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .rec-meta { font-size: 12px; color: var(--text-sub); margin-top: 4px; }

        @media (max-width: 1000px) {
            .container { flex-direction: column; padding: 0; }
            .sidebar { width: 100%; padding: 16px; box-sizing: border-box; }
            .player-container { border-radius: 0; }
            .main-content { padding: 16px; }
        }
    </style>
</head>
<body>

<nav class="navbar">
    <div class="nav-left">
        <a href="/" class="logo"><i class="fab fa-youtube"></i>YouTube Pro</a>
    </div>
    <div class="nav-center">
        <form class="search-bar" action="/nothing/search">
            <input type="text" name="q" placeholder="検索">
            <button type="submit" class="search-btn"><i class="fas fa-search"></i></button>
        </form>
    </div>
    <div style="width:100px;"></div>
</nav>

<div class="container">
    <div class="main-content">
        <div class="player-container">
            ${streamEmbed}
        </div>
        <h1 class="video-title">${videoData.videoTitle}</h1>
        <div class="owner-row">
            <div class="owner-info">
                <img src="${videoData.channelImage || 'https://via.placeholder.com/40'}">
                <div class="channel-name">${videoData.channelName}</div>
                <button class="btn-sub">チャンネル登録</button>
            </div>
            <div style="display:flex; gap:8px;">
                <button class="action-btn">👍 ${videoData.likeCount || 0}</button>
                <button class="action-btn">共有</button>
            </div>
        </div>
        <div class="description-box">
            <b>${videoData.videoViews || '0'} 回視聴</b><br><br>
            ${videoData.videoDes || ''}
        </div>
        <div class="comments-section">
            <h3>コメント ${commentsData.commentCount} 件</h3>
            ${commentsData.comments.map(c => `
                <div class="comment-item">
                    <img class="comment-avatar" src="${c.authorThumbnails?.[0]?.url || ''}">
                    <div>
                        <span class="comment-author">${c.author}</span>
                        <div style="font-size:14px;">${c.content}</div>
                    </div>
                </div>
            `).join('')}
        </div>
    </div>
    <div class="sidebar">
        <div id="recommendations"></div>
    </div>
</div>

<script>
    async function loadRecommendations() {
        const params = new URLSearchParams({
            title: "${videoData.videoTitle}",
            channel: "${videoData.channelName}",
            id: "${videoId}"
        });
        const res = await fetch(\`/api/recommendations?\${params.toString()}\`);
        const data = await res.json();
        
        document.getElementById('recommendations').innerHTML = data.items.map(item => \`
            <a href="/video/\${item.id}" class="rec-item">
                <div class="rec-thumb"><img src="https://i.ytimg.com/vi/\${item.id}/mqdefault.jpg"></div>
                <div class="rec-info">
                    <div class="rec-title">\${item.title}</div>
                    <div class="rec-meta">\${item.channelTitle}</div>
                </div>
            </a>
        \`).join('');
    }
    window.onload = loadRecommendations;
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

app.use((req, res) => res.status(404).sendFile(path.join(__dirname, "public", "error.html")));
app.use((err, req, res, next) => {
  res.status(500).sendFile(path.join(__dirname, "public", "error.html"));
});

app.listen(port, () => console.log(`Server is running on port \${port}`));
