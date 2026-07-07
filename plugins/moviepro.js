// plugins/moviepro.js
// MoviePro — Movies + TV Series full support (CineSubz2-style architecture)
// API: moviepro-mocha.vercel.app

const { cmd } = require("../command");
const axios = require("axios");
const sharp = require("sharp");
const config = require("../config");
const { getSettings } = require("../lib/settings");
const { getContentType } = require("@whiskeysockets/baileys");

const API      = "https://moviepro-mocha.vercel.app/api";
const CHANNEL  = "https://whatsapp.com/channel/0029Vb8VPsxBKfi2WHCVgV0J";
const BANNER   = "https://files.catbox.moe/kmfr8j.jpg";
const TIMEOUT  = 5 * 60 * 1000;
const sleep    = ms => new Promise(r => setTimeout(r, ms));

// ── Logging ───────────────────────────────────────────────────────────────────
function log(...a) { console.log(`[mp] [${new Date().toISOString()}]`, ...a); }

// ── Retry ─────────────────────────────────────────────────────────────────────
async function retry(fn, tries = 3, delay = 2000, label = "") {
  for (let i = 1; i <= tries; i++) {
    try { return await fn(); }
    catch (e) {
      log(`❌ ${label} attempt ${i}/${tries}:`, e.message);
      if (i === tries) throw e;
      await sleep(delay * i);
    }
  }
}

// ── Formatters ────────────────────────────────────────────────────────────────
function pad(n) { return String(n).padStart(2, "0"); }

function fmtSize(bytes) {
  const b = Number(bytes);
  if (!b || b === 0) return "Unknown";
  const mb = b / (1024 * 1024);
  return mb > 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
}

function fmtRes(r) {
  const n = parseInt(String(r || "").replace(/\D/g, ""));
  const map = { 1: "360p", 2: "480p", 3: "720p", 4: "1080p" };
  return map[n] || (n >= 144 ? `${n}p` : r || "HD");
}

// ── API calls ─────────────────────────────────────────────────────────────────
async function apiGet(path) {
  const { data } = await axios.get(API + path, { timeout: 45000 });
  return data;
}
async function apiSearch(q, page = 1) {
  return apiGet(`/search?q=${encodeURIComponent(q)}&page=${page}&per_page=12`);
}
async function apiDetails(id) { return apiGet(`/details/${id}`); }
async function apiDownloads(id) { return apiGet(`/downloads/${id}`); }
async function apiEpisodes(id, season = null) {
  return apiGet(`/episodes/${id}${season ? `?season=${season}` : ""}`);
}
async function apiEpisode(id, season, episode) {
  return apiGet(`/episode/${id}?season=${season}&episode=${episode}`);
}
async function apiSubtitles(id, resourceId) {
  return apiGet(`/subtitles/${id}/${resourceId}`);
}

// ── Thumbnail ─────────────────────────────────────────────────────────────────
async function thumb(url) {
  try {
    const { data } = await axios.get(url, { responseType: "arraybuffer", timeout: 12000 });
    return await sharp(data).resize(320, 320, { fit: "cover" }).jpeg({ quality: 70 }).toBuffer();
  } catch { return null; }
}

// ── Reply helpers ─────────────────────────────────────────────────────────────
function replyBody(message) {
  if (!message) return "";
  const type = getContentType(message);
  if (type === "conversation") return message.conversation || "";
  if (type === "extendedTextMessage") return message.extendedTextMessage?.text || "";
  if (type === "buttonsResponseMessage") return message.buttonsResponseMessage?.selectedButtonId || "";
  if (type === "listResponseMessage") return message.listResponseMessage?.singleSelectReply?.selectedRowId || "";
  if (type === "templateButtonReplyMessage") return message.templateButtonReplyMessage?.selectedId || "";
  if (type === "interactiveResponseMessage") {
    try {
      const n = message.interactiveResponseMessage?.nativeFlowResponseMessage;
      return n ? (JSON.parse(n.paramsJson || "{}").id || n.name || "") : message.interactiveResponseMessage?.body?.text || "";
    } catch { return message.interactiveResponseMessage?.body?.text || ""; }
  }
  return "";
}

function replyCtx(message) {
  if (!message) return null;
  return message.extendedTextMessage?.contextInfo
    || message.buttonsResponseMessage?.contextInfo
    || message.listResponseMessage?.contextInfo
    || message.templateButtonReplyMessage?.contextInfo
    || message.interactiveResponseMessage?.contextInfo
    || null;
}

function resolveIdx(body, prefix, max) {
  const n = parseInt(body, 10);
  if (!isNaN(n) && String(n) === body.trim()) { const i = n - 1; return (i >= 0 && i < max) ? i : -1; }
  const m = body.match(new RegExp(`^${prefix}_(\\d+)$`));
  if (m) { const i = parseInt(m[1]); return (i >= 0 && i < max) ? i : -1; }
  return -1;
}

// ── Listener factory (single-shot, auto cleanup) ─────────────────────────────
function makeListener(conn, from, msgId, prefix, max, onSelect, onTimeout) {
  const handler = async update => {
    const msg = update.messages?.[0];
    if (!msg?.message || msg.key.remoteJid !== from) return;
    const ctx = replyCtx(msg.message);
    if (!ctx || ctx.stanzaId !== msgId) return;
    const body = replyBody(msg.message);
    const idx = resolveIdx(body, prefix, max);
    if (idx === -1) return;
    conn.ev.off("messages.upsert", handler);
    clearTimeout(timer);
    await onSelect(idx, msg);
  };
  const timer = setTimeout(() => {
    conn.ev.off("messages.upsert", handler);
    onTimeout && onTimeout();
  }, TIMEOUT);
  conn.ev.on("messages.upsert", handler);
  return handler;
}

// ═════════════════════════════════════════════════════════════════════════════
// COMMAND
// ═════════════════════════════════════════════════════════════════════════════
cmd({
  pattern: "moviepro",
  alias: ["mp", "film", "series"],
  react: "🎬",
  desc: "MoviePro — Movies & TV Series with downloads & subtitles",
  category: "downloader",
  filename: __filename,
}, async (conn, mek, m, { from, q, reply, sender, sessionId }) => {
  try {
    const query = (q || "").trim();
    if (!query) return reply("🎬 *MOVIEPRO*\n\nUsage: `.moviepro <title>`\n\nExample: `.mp inception`");

    const settings = getSettings(sessionId);
    const botName = settings.botName || config.PACKNAME || "SAYURA-LK-X-MINI";

    await conn.sendMessage(from, { react: { text: "🔎", key: mek.key } });

    // ── Search ────────────────────────────────────────────────────────────────
    const searchData = await retry(() => apiSearch(query), 3, 2000, "search");
    const results = searchData?.items || [];
    if (!results.length) return reply("❎ Results not found.");

    const display = results.slice(0, 10);
    const cover = display[0]?.cover?.url || BANNER;

    await conn.sendMessage(from, {
      image: { url: cover },
      caption: `🎬 *MoviePro Search*\nQuery: *${query}*`
    }, { quoted: mek });

    const searchMsg = await conn.sendButton(from, {
      header: "🎬 Select a title",
      body: display.map((r, i) => {
        const type = Number(r.subject_type) === 2 ? "📺" : "🎬";
        const year = r.release_date ? ` (${String(r.release_date).substring(0, 4)})` : "";
        const rating = r.imdb_rating_value > 0 ? ` ⭐${r.imdb_rating_value}` : "";
        return `${i + 1}. ${type} ${r.title}${year}${rating}`;
      }).join("\n"),
      footer: botName,
      buttons: display.map((r, i) => ({
        text: `${i + 1}. ${Number(r.subject_type) === 2 ? "📺" : "🎬"} ${String(r.title).substring(0, 50)}`,
        id: `mp_sel_${i}`,
      })),
    }, mek);

    // ── Selection — MULTI REPLY ───────────────────────────────────────────────
    const searchHandler = async update => {
      const msg = update.messages?.[0];
      if (!msg?.message || msg.key.remoteJid !== from) return;
      const ctx = replyCtx(msg.message);
      if (!ctx || ctx.stanzaId !== searchMsg.key.id) return;
      const body = replyBody(msg.message);
      const idx = resolveIdx(body, "mp_sel", display.length);
      if (idx === -1) return;
      // handler remove නොකරනවා — multi-reply
      await conn.sendMessage(from, { react: { text: "⏳", key: msg.key } });
      handleItem(conn, from, sender, msg, display[idx], botName).catch(console.error);
    };
    conn.ev.on("messages.upsert", searchHandler);
    setTimeout(() => conn.ev.off("messages.upsert", searchHandler), TIMEOUT);

  } catch (e) {
    console.error("[mp] error:", e);
    reply(`❌ Error: ${e.message}`);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// ITEM ROUTER — decide movie vs series
// ═════════════════════════════════════════════════════════════════════════════
async function handleItem(conn, from, sender, quotedMsg, item, botName) {
  try {
    let isTV = Number(item.subject_type) === 2;
    let detail = item;

    try {
      detail = await retry(() => apiDetails(item.subject_id), 3, 2000, "details");
      if (Number(detail.subject_type) === 2) isTV = true;
    } catch (e) {
      detail = item;
    }

    let epCache = null;

    if (isTV) {
      try {
        const epCheck = await retry(() => apiEpisodes(detail.subject_id), 3, 2000, "episodes-check");
        const validSeasons = (epCheck.seasons || []).filter(
          s => s.total_episodes > 0 || (s.episodes || []).length > 0
        );
        if (validSeasons.length > 0) {
          epCache = epCheck;
          detail.seasons = {
            total_seasons: epCheck.total_seasons || validSeasons.length,
            seasons: validSeasons.map(s => ({
              season_number: s.season,
              total_episodes: s.total_episodes || (s.episodes || []).length,
            })),
          };
        } else {
          isTV = false;
        }
      } catch (e) { isTV = false; }
    }

    isTV
      ? await handleTVShow(conn, from, sender, quotedMsg, detail, epCache, botName)
      : await handleMovie(conn, from, sender, quotedMsg, detail, botName);

  } catch (e) {
    console.error("[mp] handleItem error:", e);
    conn.sendMessage(from, { text: `❌ Error: ${e.message}` }, { quoted: quotedMsg });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// MOVIE HANDLER
// ═════════════════════════════════════════════════════════════════════════════
async function handleMovie(conn, from, sender, quotedMsg, detail, botName) {
  try {
    const title = detail.title || "Movie";
    const poster = detail.cover?.url || BANNER;
    const year = String(detail.release_date || "").substring(0, 4);
    const rating = detail.imdb_rating_value || detail.imdb_rate || "N/A";
    const genre = (detail.genre || []).join(", ") || "N/A";
    const desc = detail.description ? detail.description.substring(0, 200) + "..." : "";

    let files = [];
    try {
      const dlData = await retry(() => apiDownloads(detail.subject_id), 3, 2000, "downloads");
      files = (dlData.files || []).filter(f => !Number(f.season) && !Number(f.episode));
      if (!files.length) files = dlData.files || [];
    } catch (e) { log("downloads fetch failed:", e.message); }

    if (!files.length) return conn.sendMessage(from, { text: "❎ No download links." }, { quoted: quotedMsg });

    files = files.slice(0, 8);

    const caption =
      `╭━━━〔 🎬 *${title}* 〕━━━⬣\n\n` +
      `*▫️⭐ IMDB ➟* ${rating}\n` +
      `*▫️🎭 Genre ➟* ${genre}\n` +
      `*▫️📅 Year ➟* ${year}\n` +
      (desc ? `\n_${desc}_\n` : "") +
      `\n*⬇️ Qualities:*\n` +
      files.map(f => `➤ ${fmtRes(f.resolution)} (${fmtSize(f.size)})`).join("\n") +
      `\n╰━━━━━━━━━━━━━━━━━━⬣\n${CHANNEL}`;

    const tb = await thumb(poster);
    await conn.sendMessage(from, { image: { url: poster }, caption, jpegThumbnail: tb }, { quoted: quotedMsg });

    const qualityMsg = await conn.sendButton(from, {
      header: `🎬 ${title}`,
      body: "Quality select කරන්න:",
      footer: botName,
      buttons: files.map((f, i) => ({
        text: `${fmtRes(f.resolution).includes("1080") ? "🔥" : fmtRes(f.resolution).includes("720") ? "⚡" : "⬇️"} ${fmtRes(f.resolution)} (${fmtSize(f.size)})`,
        id: `mp_q_${i}`,
      })),
    }, quotedMsg);

    // Movie quality — MULTI REPLY
    const qHandler = async update => {
      const msg = update.messages?.[0];
      if (!msg?.message || msg.key.remoteJid !== from) return;
      const ctx = replyCtx(msg.message);
      if (!ctx || ctx.stanzaId !== qualityMsg.key.id) return;
      const body = replyBody(msg.message);
      const idx = resolveIdx(body, "mp_q", files.length);
      if (idx === -1) return;
      // handler remove නොකරනවා
      await conn.sendMessage(from, { react: { text: "📥", key: msg.key } });
      downloadFile(conn, from, msg, detail, files[idx], null, null, title, poster, botName).catch(console.error);
    };
    conn.ev.on("messages.upsert", qHandler);
    setTimeout(() => conn.ev.off("messages.upsert", qHandler), TIMEOUT);

    // Subtitles (separate button, optional)
    if (files[0]?.resource_id) {
      try {
        const subData = await apiSubtitles(detail.subject_id, files[0].resource_id);
        const subs = subData.subtitles || [];
        if (subs.length) await sendSubtitleButton(conn, from, quotedMsg, detail, subs, title, null, null, botName);
      } catch (e) { log("subtitle fetch failed:", e.message); }
    }

  } catch (e) {
    console.error("[mp] handleMovie error:", e);
    conn.sendMessage(from, { text: `❌ Error: ${e.message}` }, { quoted: quotedMsg });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// TV SHOW HANDLER
// ═════════════════════════════════════════════════════════════════════════════
async function handleTVShow(conn, from, sender, quotedMsg, detail, epCache, botName) {
  try {
    const title = detail.title || "Series";
    const poster = detail.cover?.url || BANNER;
    const seasons = detail.seasons?.seasons || [];
    const totalSeasons = detail.seasons?.total_seasons || seasons.length;

    if (!totalSeasons) return conn.sendMessage(from, { text: "❎ Season info not found." }, { quoted: quotedMsg });

    const tb = await thumb(poster);

    // Single season — go straight to episodes
    if (seasons.length === 1) {
      await showEpisodes(conn, from, sender, quotedMsg, title, poster, tb, detail, seasons[0].season_number, epCache, botName);
      return;
    }

    // Multiple seasons — season select
    const seasonCaption =
      `╭━━━〔 📺 *${title}* 〕━━━⬣\n\n` +
      `*▫️⭐ IMDB ➟* ${detail.imdb_rating_value || "N/A"}\n` +
      `*▫️🎭 Genre ➟* ${(detail.genre || []).join(", ") || "N/A"}\n\n` +
      `*🗂 Seasons: ${seasons.length}*\n` +
      seasons.map(s => `➤ Season ${s.season_number}${s.total_episodes ? ` (${s.total_episodes} eps)` : ""}`).join("\n") +
      `\n╰━━━━━━━━━━━━━━━━━━⬣`;

    await conn.sendMessage(from, { image: { url: poster }, caption: seasonCaption, jpegThumbnail: tb }, { quoted: quotedMsg });

    const seasonMsg = await conn.sendButton(from, {
      header: `📺 ${title}`,
      body: "Season select කරන්න:",
      footer: botName,
      buttons: seasons.map((s, i) => ({
        text: `Season ${s.season_number}${s.total_episodes ? ` (${s.total_episodes} eps)` : ""}`,
        id: `mp_se_${i}`,
      })),
    }, quotedMsg);

    // Season select — MULTI REPLY
    const seHandler = async update => {
      const msg = update.messages?.[0];
      if (!msg?.message || msg.key.remoteJid !== from) return;
      const ctx = replyCtx(msg.message);
      if (!ctx || ctx.stanzaId !== seasonMsg.key.id) return;
      const body = replyBody(msg.message);
      const idx = resolveIdx(body, "mp_se", seasons.length);
      if (idx === -1) return;
      // handler remove නොකරනවා
      await conn.sendMessage(from, { react: { text: "⏳", key: msg.key } });
      showEpisodes(conn, from, sender, msg, title, poster, tb, detail, seasons[idx].season_number, epCache, botName).catch(console.error);
    };
    conn.ev.on("messages.upsert", seHandler);
    setTimeout(() => conn.ev.off("messages.upsert", seHandler), TIMEOUT);

  } catch (e) {
    console.error("[mp] handleTVShow error:", e);
    conn.sendMessage(from, { text: `❌ Error: ${e.message}` }, { quoted: quotedMsg });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// EPISODE LIST
// ═════════════════════════════════════════════════════════════════════════════
async function showEpisodes(conn, from, sender, quotedMsg, title, poster, tb, detail, seasonNum, epCache, botName) {
  try {
    let epData = null;
    const cachedSeason = epCache?.seasons?.find(s => s.season === seasonNum);

    if (cachedSeason && (cachedSeason.episodes || []).length > 0) {
      epData = epCache;
    } else {
      epData = await retry(() => apiEpisodes(detail.subject_id, seasonNum), 3, 2000, "episodes");
    }

    const seasonInfo = (epData.seasons || []).find(s => s.season === seasonNum);
    const episodes = seasonInfo?.episodes || [];
    const totalEps = seasonInfo?.total_episodes || episodes.length;

    if (!episodes.length) return conn.sendMessage(from, { text: `❎ Season ${seasonNum} episodes not found.` }, { quoted: quotedMsg });

    async function showPage(start) {
      const page = episodes.slice(start, start + 10);
      const hasMore = start + 10 < episodes.length;

      let body = `📺 *${title}* — Season ${seasonNum}\n`;
      body += `Episodes (${start + 1}–${start + page.length} of ${totalEps}):\n\n`;
      body += `*0.* 🎯 සියලු Episodes (All)\n`;
      page.forEach((ep, i) => {
        body += `*${start + i + 1}.* S${pad(seasonNum)}E${pad(ep.episode)}${ep.title ? ` — ${ep.title}` : ""}\n`;
      });

      const buttons = [{ text: "🎯 All Episodes (Season)", id: "mp_all_eps" }];
      page.forEach((ep, i) => {
        buttons.push({
          text: `EP${ep.episode}${ep.title ? " — " + ep.title.substring(0, 25) : ""}`,
          id: `mp_ep_${start + i}`,
        });
      });
      if (hasMore) buttons.push({ text: "▶️ More episodes", id: `mp_more_${start + 10}` });

      const epMsg = await conn.sendButton(from, {
        header: `📺 Season ${seasonNum} (${totalEps} eps)`,
        body,
        footer: botName,
        buttons,
      }, quotedMsg);

      const handler = async update => {
        const msg = update.messages?.[0];
        if (!msg?.message || msg.key.remoteJid !== from) return;
        const ctx = replyCtx(msg.message);
        if (!ctx || ctx.stanzaId !== epMsg.key.id) return;
        const body2 = replyBody(msg.message);

        // ── More pages ──
        if (body2.startsWith("mp_more_")) {
          const next = parseInt(body2.split("_")[2]);
          conn.ev.off("messages.upsert", handler);
          clearTimeout(timer);
          await conn.sendMessage(from, { react: { text: "▶️", key: msg.key } });
          await showPage(next);
          return;
        }

        // ── All episodes ──
        if (body2 === "mp_all_eps" || body2.trim() === "0") {
          conn.ev.off("messages.upsert", handler);
          clearTimeout(timer);
          await conn.sendMessage(from, { react: { text: "⏳", key: msg.key } });
          await downloadAllEpisodes(conn, from, sender, msg, title, poster, detail, episodes, seasonNum, botName);
          return;
        }

        // ── Single episode ──
        const idx = resolveIdx(body2, "mp_ep", episodes.length);
        if (idx === -1) return;
        // multi-reply: handler NOT removed — user can select multiple episodes
        await conn.sendMessage(from, { react: { text: "⏳", key: msg.key } });
        handleEpisode(conn, from, sender, msg, title, poster, tb, detail, episodes[idx], seasonNum, botName).catch(console.error);
      };

      const timer = setTimeout(() => conn.ev.off("messages.upsert", handler), TIMEOUT);
      conn.ev.on("messages.upsert", handler);
    }

    await showPage(0);

  } catch (e) {
    console.error("[mp] showEpisodes error:", e);
    conn.sendMessage(from, { text: `❌ Error: ${e.message}` }, { quoted: quotedMsg });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// ALL EPISODES DOWNLOAD
// ═════════════════════════════════════════════════════════════════════════════
async function downloadAllEpisodes(conn, from, sender, quotedMsg, title, poster, detail, episodes, seasonNum, botName) {
  try {
    // First ep quality get
    const firstEpData = await retry(() => apiEpisode(detail.subject_id, seasonNum, episodes[0].episode), 3, 2000, "first-ep");
    const firstFiles = firstEpData?.files || [];
    if (!firstFiles.length) return conn.sendMessage(from, { text: "❎ Download links not found." }, { quoted: quotedMsg });

    let qText = `🎯 *All Episodes Quality Select*\n*${title} — Season ${seasonNum}*\n*Total: ${episodes.length} episodes*\n\n`;
    firstFiles.forEach((f, i) => {
      qText += `*${i + 1}.* ${fmtRes(f.resolution)} (${fmtSize(f.size)})\n`;
    });

    const qualityMsg = await conn.sendButton(from, {
      header: `🎯 Season ${seasonNum} — All ${episodes.length} eps`,
      body: qText + "\nQuality select කරන්න:",
      footer: botName,
      buttons: firstFiles.map((f, i) => ({
        text: `${fmtRes(f.resolution).includes("1080") ? "🔥" : fmtRes(f.resolution).includes("720") ? "⚡" : "⬇️"} ${fmtRes(f.resolution)} (${fmtSize(f.size)})`,
        id: `mp_aq_${i}`,
      })),
    }, quotedMsg);

    makeListener(conn, from, qualityMsg.key.id, "mp_aq", firstFiles.length, async (qIdx, qMsg) => {
      const chosenRes = fmtRes(firstFiles[qIdx].resolution);
      await conn.sendMessage(from, { react: { text: "📥", key: qMsg.key } });
      await conn.sendMessage(from, {
        text:
          `⬇️ *Downloading all ${episodes.length} episodes...*\n` +
          `📺 *${title} — Season ${seasonNum}*\n` +
          `💎 *Quality:* ${chosenRes}\n\n_Please wait..._`
      }, { quoted: qMsg });

      let success = 0, failed = 0;

      for (const ep of episodes) {
        try {
          log(`📥 All-eps: EP${ep.episode}`);
          const epData = await retry(() => apiEpisode(detail.subject_id, seasonNum, ep.episode), 3, 2000, `ep${ep.episode}`);
          const epFiles = epData?.files || [];

          // Same quality index — fallback to first if not available
          const file = epFiles[qIdx] || epFiles[0];
          if (!file?.resource_link) { failed++; continue; }

          const epTitle = `${title} S${pad(seasonNum)}E${pad(ep.episode)}`;
          const epThumb = await thumb(poster);
          const safeTitle = epTitle.replace(/[^\w\s\-]/g, "").replace(/\s+/g, "_").substring(0, 50);
          const fileName = `🎬${botName}🎬${safeTitle}_(${fmtRes(file.resolution)}).mp4`;

          const docMsg = await conn.sendMessage(from, {
            document: { url: file.resource_link },
            mimetype: "video/mp4",
            fileName,
            jpegThumbnail: epThumb,
            caption:
              `📺 *${epTitle}*\n` +
              `💎 *Quality:* ${fmtRes(file.resolution)}\n` +
              `📦 *Size:* ${fmtSize(file.size)}\n\n` +
              `*⏤͟͟͞͞★❮ ${botName} 〽️𝗢𝗩𝗜𝗘𝗦 ❯⏤͟͟͞͞★*`,
          }, { quoted: qMsg });

          await conn.sendMessage(from, { react: { text: "✅", key: docMsg.key } });
          success++;
          log(`✅ All-eps: EP${ep.episode} done`);

        } catch (e) {
          failed++;
          log(`❌ All-eps: EP${ep.episode} failed:`, e.message);
          await conn.sendMessage(from, {
            text: `❌ *EP${ep.episode} failed*\n${e.message}`
          }, { quoted: qMsg });
        }
      }

      // Summary
      await conn.sendMessage(from, {
        text:
          `${success === episodes.length ? "✅" : "⚠️"} *Download Complete!*\n\n` +
          `📺 *${title} — Season ${seasonNum}*\n` +
          `✅ *Success:* ${success}/${episodes.length}\n` +
          `❌ *Failed:* ${failed}\n\n` +
          `*⏤͟͟͞͞★❮ ${botName} 〽️𝗢𝗩𝗜𝗘𝗦 ❯⏤͟͟͞͞★*`
      }, { quoted: qMsg });

    });

  } catch (e) {
    console.error("[mp] downloadAllEpisodes error:", e);
    conn.sendMessage(from, { text: `❌ Error: ${e.message}` }, { quoted: quotedMsg });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// EPISODE DETAIL + QUALITY SELECT
// ═════════════════════════════════════════════════════════════════════════════
async function handleEpisode(conn, from, sender, quotedMsg, seriesTitle, poster, tb, detail, ep, seasonNum, botName) {
  try {
    const epData = await retry(() => apiEpisode(detail.subject_id, seasonNum, ep.episode), 3, 2000, "episode");
    const files = epData?.files || [];

    if (!files.length) return conn.sendMessage(from, { text: `❎ S${pad(seasonNum)}E${pad(ep.episode)} files not found.` }, { quoted: quotedMsg });

    const epTag = `S${pad(seasonNum)}E${pad(ep.episode)}`;
    const epTitle = `${seriesTitle} — ${epTag}`;

    const caption =
      `╭━━━〔 📺 *${epTitle}* 〕━━━⬣\n\n` +
      (ep.title ? `*▫️📝 ${ep.title}*\n\n` : "\n") +
      `*⬇️ Qualities:*\n` +
      files.map(f => `➤ ${fmtRes(f.resolution)} (${fmtSize(f.size)})`).join("\n") +
      `\n╰━━━━━━━━━━━━━━━━━━⬣\n${CHANNEL}`;

    await conn.sendMessage(from, { image: { url: poster }, caption, jpegThumbnail: tb }, { quoted: quotedMsg });

    const qualityMsg = await conn.sendButton(from, {
      header: `📺 ${epTitle}`,
      body: "Quality select කරන්න:",
      footer: botName,
      buttons: files.map((f, i) => ({
        text: `${fmtRes(f.resolution).includes("1080") ? "🔥" : fmtRes(f.resolution).includes("720") ? "⚡" : "⬇️"} ${fmtRes(f.resolution)} (${fmtSize(f.size)})`,
        id: `mp_eq_${i}`,
      })),
    }, quotedMsg);

    // Episode quality — MULTI REPLY
    const eqHandler = async update => {
      const msg = update.messages?.[0];
      if (!msg?.message || msg.key.remoteJid !== from) return;
      const ctx = replyCtx(msg.message);
      if (!ctx || ctx.stanzaId !== qualityMsg.key.id) return;
      const body = replyBody(msg.message);
      const idx = resolveIdx(body, "mp_eq", files.length);
      if (idx === -1) return;
      // handler remove නොකරනවා
      await conn.sendMessage(from, { react: { text: "📥", key: msg.key } });
      downloadFile(conn, from, msg, detail, files[idx], seasonNum, ep.episode, epTitle, poster, botName).catch(console.error);
    };
    conn.ev.on("messages.upsert", eqHandler);
    setTimeout(() => conn.ev.off("messages.upsert", eqHandler), TIMEOUT);

    // Subtitles for this episode
    if (files[0]?.resource_id) {
      try {
        const subData = await apiSubtitles(detail.subject_id, files[0].resource_id);
        const subs = subData.subtitles || [];
        if (subs.length) await sendSubtitleButton(conn, from, quotedMsg, detail, subs, seriesTitle, seasonNum, ep.episode, botName);
      } catch (e) { log("subtitle fetch failed:", e.message); }
    }

  } catch (e) {
    console.error("[mp] handleEpisode error:", e);
    conn.sendMessage(from, { text: `❌ Error: ${e.message}` }, { quoted: quotedMsg });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// SUBTITLE BUTTON + DOWNLOAD
// ═════════════════════════════════════════════════════════════════════════════
async function sendSubtitleButton(conn, from, quotedMsg, detail, subs, title, seasonNum, episode, botName) {
  const list = subs.slice(0, 10);
  const epTag = seasonNum ? `S${pad(seasonNum)}E${pad(episode)}` : "";

  const subMsg = await conn.sendButton(from, {
    header: "🔤 Subtitles",
    body: `*${title}*${epTag ? ` — ${epTag}` : ""}\n\n` +
      list.map((s, i) => `${i + 1}. ${s.lan_name || s.lan}`).join("\n") +
      `\n\nSubtitle select කරන්න:`,
    footer: botName,
    buttons: list.map((s, i) => ({
      text: `🔤 ${s.lan_name || s.lan}`,
      id: `mp_sub_${i}`,
    })),
  }, quotedMsg);

  const subHandler = async update => {
    const msg = update.messages?.[0];
    if (!msg?.message || msg.key.remoteJid !== from) return;
    const ctx = replyCtx(msg.message);
    if (!ctx || ctx.stanzaId !== subMsg.key.id) return;
    const body = replyBody(msg.message);
    const idx = resolveIdx(body, "mp_sub", list.length);
    if (idx === -1) return;
    // handler remove නොකරනවා — multi-reply
    await conn.sendMessage(from, { react: { text: "📥", key: msg.key } });
    downloadSub(conn, from, msg, detail, list[idx], title, seasonNum, episode, botName).catch(console.error);
  };
  conn.ev.on("messages.upsert", subHandler);
  setTimeout(() => conn.ev.off("messages.upsert", subHandler), TIMEOUT);
}

async function downloadSub(conn, from, quotedMsg, detail, sub, title, seasonNum, episode, botName) {
  try {
    const epTag = seasonNum ? `S${pad(seasonNum)}E${pad(episode)}` : "";
    const langName = sub.lan_name || sub.lan || "Unknown";
    const baseName = `${title}${epTag ? " " + epTag : ""}`.replace(/[\\/:*?"<>|]/g, "");

    const origRes = await retry(() => axios.get(sub.url, { responseType: "arraybuffer", timeout: 30000 }), 3, 2000, "sub-download");
    await conn.sendMessage(from, {
      document: Buffer.from(origRes.data),
      mimetype: "application/x-subrip",
      fileName: `${baseName} [${langName}].srt`,
      caption:
        `✅ *Subtitle Downloaded!*\n\n` +
        `🎬 *${title}*${epTag ? `\n📺 *Episode:* ${epTag}` : ""}\n` +
        `🔤 *Language:* ${langName}\n\n${CHANNEL}`
    }, { quoted: quotedMsg });

    try {
      const sourceLang = sub.lan || "en";
      const translateUrl = `${API}/translate-subtitle?url=${encodeURIComponent(sub.url)}&from=${encodeURIComponent(sourceLang)}&to=si&format=srt`;
      const siRes = await axios.get(translateUrl, { responseType: "arraybuffer", timeout: 60000 });
      await conn.sendMessage(from, {
        document: Buffer.from(siRes.data),
        mimetype: "application/x-subrip",
        fileName: `${baseName} [Sinhala].srt`,
        caption:
          `✅ *Sinhala Subtitle!*\n\n` +
          `🎬 *${title}*${epTag ? `\n📺 *Episode:* ${epTag}` : ""}\n` +
          `🔤 *Language:* Sinhala (Translated)\n\n${CHANNEL}`
      }, { quoted: quotedMsg });
    } catch (e) { log("sinhala translate failed:", e.message); }

    await conn.sendMessage(from, { react: { text: "✅", key: quotedMsg.key } });

  } catch (e) {
    console.error("[mp] downloadSub error:", e);
    await conn.sendMessage(from, { text: `❌ *Subtitle failed*\n${e.message}` }, { quoted: quotedMsg });
    await conn.sendMessage(from, { react: { text: "❌", key: quotedMsg.key } });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// DOWNLOAD + SEND (movie file / episode file)
// ═════════════════════════════════════════════════════════════════════════════
async function downloadFile(conn, from, quotedMsg, detail, file, season, episode, title, poster, botName) {
  const epTag = season ? `S${pad(season)}E${pad(episode)}` : "";
  const res = fmtRes(file.resolution);
  const safeTitle = title.replace(/[^\w\s\-]/g, "").replace(/\s+/g, "_").substring(0, 50);
  const fileName = `🎬${botName}🎬${safeTitle}${epTag ? "_" + epTag : ""}_(${res}).mp4`;

  try {
    log("resolving download for:", title, res);

    await conn.sendMessage(from, {
      text:
        `⏳ *Downloading...*\n\n` +
        `🎬 *${title}*${epTag ? `\n📺 *Episode:* ${epTag}` : ""}\n` +
        `💎 *Quality:* ${res}\n` +
        `📦 *Size:* ${fmtSize(file.size)}\n\n_Please wait..._`
    }, { quoted: quotedMsg });

    const dlUrl = file.resource_link;
    if (!dlUrl) throw new Error("Download URL not found");

    const tb = await thumb(poster);

    const caption =
      `*𝗧ɪᴛʟᴇ : ${title}*${epTag ? `\n📺 *Episode:* ${epTag}` : ""}\n\n` +
      `\`[${res} ${fmtSize(file.size)}]\`\n\n` +
      `*⏤͟͟͞͞★❮ ${botName} 〽️𝗢𝗩𝗜𝗘𝗦 ❯⏤͟͟͞͞★*`;

    try {
      await conn.sendMessage(from, {
        document: { url: dlUrl },
        mimetype: "video/mp4",
        fileName,
        caption,
        jpegThumbnail: tb,
      }, { quoted: quotedMsg });
    } catch (e) {
      log("direct send failed, retrying via stream:", e.message);
      const res2 = await axios.get(dlUrl, { responseType: "stream", timeout: 180000, maxRedirects: 5 });
      await conn.sendMessage(from, {
        document: { stream: res2.data },
        mimetype: "video/mp4",
        fileName,
        caption,
        jpegThumbnail: tb,
      }, { quoted: quotedMsg });
    }

    await conn.sendMessage(from, { react: { text: "✅", key: quotedMsg.key } });
    log("✅ sent:", fileName);

  } catch (e) {
    console.error("[mp] downloadFile error:", e);
    await conn.sendMessage(from, { text: `❌ *Download failed*\n\n${e.message}` }, { quoted: quotedMsg });
    await conn.sendMessage(from, { react: { text: "❌", key: quotedMsg.key } });
  }
}

module.exports = {};
