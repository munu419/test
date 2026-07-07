// plugins/moviesublk.js
// MovieSubLK — Movies, TV Series & Anime (auto-detect site) — CineSubz2-style architecture
// API: subzslk.vercel.app

const { cmd } = require("../command");
const axios = require("axios");
const sharp = require("sharp");
const config = require("../config");
const { getSettings } = require("../lib/settings");
const { getContentType } = require("@whiskeysockets/baileys");

const API_BASE = "https://subzslk.vercel.app/";
const CHANNEL  = "https://whatsapp.com/channel/0029Vb8VPsxBKfi2WHCVgV0J";
const BANNER   = "https://files.catbox.moe/04jdju.jpg";
const TIMEOUT  = 5 * 60 * 1000;
const sleep    = ms => new Promise(r => setTimeout(r, ms));

// ── Logging ───────────────────────────────────────────────────────────────────
function log(...a) { console.log(`[msl] [${new Date().toISOString()}]`, ...a); }

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

// ── Type helpers ──────────────────────────────────────────────────────────────
function isTvShow(typeStr) {
  const t = (typeStr || "").toLowerCase();
  return t.includes("tvshow") || t.includes("series") || t.includes("kdrama") || t.includes("cdrama") || t.includes("drama");
}
function badgeFor(result) {
  if (result._site === "anime") return "🎌";
  return isTvShow(result.type) ? "📺" : "🎬";
}

// ── API calls ─────────────────────────────────────────────────────────────────
async function apiList(site) {
  const { data } = await axios.get(`${API_BASE}?action=list&site=${site}`, { timeout: 30000 });
  return data?.results || [];
}
async function apiSearch(query, site) {
  const { data } = await axios.get(`${API_BASE}?action=search&query=${encodeURIComponent(query)}&site=${site}`, { timeout: 30000 });
  return data?.results || [];
}
async function apiDetails(link, site) {
  const { data } = await axios.get(`${API_BASE}?action=details&url=${encodeURIComponent(link)}&site=${site}`, { timeout: 60000 });
  return data;
}
async function resolveDownloadLink(gdriveLink) {
  try {
    const { data } = await axios.get(
      `https://www.ominisave.com/api/gdrive?url=${encodeURIComponent(gdriveLink)}`,
      { timeout: 30000 }
    );
    if (data?.status === true && data?.result?.download) {
      return {
        directUrl: data.result.download,
        fileName: data.result.fileName || "file.mp4",
        fileSize: data.result.fileSize || "Unknown",
        expiresIn: data.result.expiresIn || "N/A",
      };
    }
    return { directUrl: gdriveLink, fileName: "file.mp4", fileSize: "Unknown", expiresIn: "N/A" };
  } catch (e) {
    log("resolveDownloadLink error:", e.message);
    return { directUrl: gdriveLink, fileName: "file.mp4", fileSize: "Unknown", expiresIn: "N/A" };
  }
}

// ── Thumbnails / posters ──────────────────────────────────────────────────────
async function thumb(url) {
  try {
    const { data } = await axios.get(url, { responseType: "arraybuffer", timeout: 12000 });
    return await sharp(data).resize(320, 320, { fit: "cover" }).jpeg({ quality: 70 }).toBuffer();
  } catch { return null; }
}
// Downloaded as a buffer (not passed as { url }) — sending a remote URL directly
// makes WhatsApp render a stuck blurred preview since it can't reliably fetch
// dimensions/thumb from a remote link itself.
async function posterBuffer(url) {
  try {
    const { data } = await axios.get(url, {
      responseType: "arraybuffer", timeout: 15000,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    return await sharp(data).jpeg({ quality: 90 }).toBuffer();
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

// ── File sender ────────────────────────────────────────────────────────────────
async function sendFileAsStream(conn, from, downloadUrl, fileName, caption, thumbnail, quoted) {
  try {
    await conn.sendMessage(from, {
      document: { url: downloadUrl },
      mimetype: "video/mp4",
      fileName,
      caption,
      jpegThumbnail: thumbnail,
    }, { quoted });
  } catch (e) {
    log("direct send failed, retrying via stream:", e.message);
    const res = await axios.get(downloadUrl, {
      responseType: "stream", timeout: 180000, maxRedirects: 5,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    await conn.sendMessage(from, {
      document: { stream: res.data },
      mimetype: "video/mp4",
      fileName,
      caption,
      jpegThumbnail: thumbnail,
    }, { quoted });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// COMMAND
// ═════════════════════════════════════════════════════════════════════════════
cmd({
  pattern: "moviesublk",
  alias: ["animesublk", "ac", "animetk", "moviesub", "ttv", "seruies"],
  react: "🎬",
  desc: "Search and download movies, TV series & anime (auto-detects the right site).",
  category: "downloader",
  filename: __filename,
}, async (conn, mek, m, { from, q, reply, sender, sessionId }) => {
  try {
    const query = (q || "").trim();
    const settings = getSettings(sessionId);
    const botName = settings.botName || config.PACKNAME || "SAYURA-LK-X-MINI";

    await conn.sendMessage(from, { react: { text: "🔎", key: mek.key } });

    let results = [];
    let headerLabel;

    if (!query) {
      // ── NO QUERY: browse latest via the "list" endpoint (movies/tv + anime combined) ──
      headerLabel = "🆕 Latest Additions";
      const [movieList, animeList] = await Promise.allSettled([
        retry(() => apiList("movie"), 2, 2000, "list-movie"),
        retry(() => apiList("anime"), 2, 2000, "list-anime"),
      ]);
      const movieResults = movieList.status === "fulfilled" ? movieList.value : [];
      const animeResults = animeList.status === "fulfilled" ? animeList.value : [];
      results = [
        ...movieResults.slice(0, 6).map(r => ({ ...r, _site: "movie" })),
        ...animeResults.slice(0, 6).map(r => ({ ...r, _site: "anime" })),
      ];
    } else {
      // ── SEARCH: try moviesublk (movies + tv series) first ──
      headerLabel = `🔎 Search Results\nQuery: ${query}`;
      try {
        results = (await retry(() => apiSearch(query, "movie"), 3, 2000, "search-movie"))
          .map(r => ({ ...r, _site: "movie" }));
      } catch (e) { log("movie search failed:", e.message); }

      // ── FALLBACK: if nothing found on moviesublk, auto-search animesublk ──
      if (!results.length) {
        try {
          results = (await retry(() => apiSearch(query, "anime"), 3, 2000, "search-anime"))
            .map(r => ({ ...r, _site: "anime" }));
        } catch (e) { log("anime search failed:", e.message); }
      }
    }

    results = results.slice(0, 10);
    if (!results.length) {
      return reply(query ? `❎ No results found for *"${query}"*.` : "❎ Couldn't load the latest list right now, try again shortly.");
    }

    const coverBuf = await posterBuffer(results[0]?.image || BANNER);
    const searchMsg = await conn.sendButton(from, {
      header: "🎬 Select a title",
      body: `${headerLabel}\n\n` + results.map((r, i) => `${i + 1}. ${badgeFor(r)} ${r.title || "Unknown"}`).join("\n"),
      footer: botName,
      image: coverBuf || undefined,
      buttons: results.map((r, i) => ({
        text: `${i + 1}. ${badgeFor(r)} ${(r.title || "Unknown").substring(0, 50)}`,
        id: `msl_sel_${i}`,
      })),
    }, mek);

    // ── Selection — MULTI REPLY ───────────────────────────────────────────────
    const searchHandler = async update => {
      const msg = update.messages?.[0];
      if (!msg?.message || msg.key.remoteJid !== from) return;
      const ctx = replyCtx(msg.message);
      if (!ctx || ctx.stanzaId !== searchMsg.key.id) return;
      const body = replyBody(msg.message);
      const idx = resolveIdx(body, "msl_sel", results.length);
      if (idx === -1) return;
      // handler remove නොකරනවා — multi-reply
      await conn.sendMessage(from, { react: { text: "⏳", key: msg.key } });
      handleSelected(conn, from, sender, msg, results[idx], botName).catch(console.error);
    };
    conn.ev.on("messages.upsert", searchHandler);
    setTimeout(() => conn.ev.off("messages.upsert", searchHandler), TIMEOUT);

  } catch (e) {
    console.error("[msl] error:", e);
    reply(`❌ Error: ${e.message}`);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// SELECTED TITLE → DETAILS → LINK LIST
// ═════════════════════════════════════════════════════════════════════════════
async function handleSelected(conn, from, sender, quotedMsg, selected, botName) {
  try {
    const detail = await retry(() => apiDetails(selected.link, selected._site), 3, 2000, "details");

    const title = detail?.title || selected.title || "N/A";
    const poster = detail?.image || selected.image || BANNER;
    const isSeries = selected._site === "anime" || !!detail?.has_episodes || isTvShow(selected.type);

    const links = (detail?.gdrive_links || []).map((l, i) => ({
      quality: isSeries ? `Episode ${i + 1}` : (l.label && l.label !== "Google Drive" ? l.label : `Link ${i + 1}`),
      original: l.original,
      direct: l.direct,
    }));

    if (!links.length) return conn.sendMessage(from, { text: `❌ No download links found for "${title}"` }, { quoted: quotedMsg });

    // Only one link — download directly
    if (links.length === 1) {
      await downloadLink(conn, from, quotedMsg, title, poster, links[0], botName);
      return;
    }

    await showLinkPage(conn, from, sender, quotedMsg, title, poster, links, isSeries, botName, 0);

  } catch (e) {
    console.error("[msl] handleSelected error:", e);
    conn.sendMessage(from, { text: `❌ Error: ${e.message}` }, { quoted: quotedMsg });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// PAGINATED LINK / EPISODE LIST
// ═════════════════════════════════════════════════════════════════════════════
async function showLinkPage(conn, from, sender, quotedMsg, title, poster, links, isSeries, botName, start) {
  const page = links.slice(start, start + 10);
  const hasMore = start + 10 < links.length;

  let body =
    `╭━━━〔 🎬 *${title}* 〕━━━⬣\n\n` +
    `📥 Select to download (${start + 1}-${start + page.length} of ${links.length}):\n\n`;
  if (isSeries && links.length > 1) body += `*0.* 🎯 සියලු Episodes (All)\n`;
  page.forEach((l, i) => { body += `*${start + i + 1}.* ${l.quality}\n`; });
  body += `\n╰━━━━━━━━━━━━━━━━━━⬣`;

  const buttons = [];
  if (isSeries && links.length > 1) buttons.push({ text: "🎯 All Episodes", id: "msl_all" });
  page.forEach((l, i) => {
    buttons.push({ text: `⬇️ ${l.quality.substring(0, 30)}`, id: `msl_dl_${start + i}` });
  });
  if (hasMore) buttons.push({ text: "▶️ More", id: `msl_more_${start + 10}` });

  const tb = await posterBuffer(poster);
  const linkMsg = await conn.sendButton(from, {
    header: `🎬 ${title}`,
    body,
    footer: botName,
    image: tb || undefined,
    buttons,
  }, quotedMsg);

  const handler = async update => {
    const msg = update.messages?.[0];
    if (!msg?.message || msg.key.remoteJid !== from) return;
    const ctx = replyCtx(msg.message);
    if (!ctx || ctx.stanzaId !== linkMsg.key.id) return;
    const body2 = replyBody(msg.message);

    // ── More pages ──
    if (body2.startsWith("msl_more_")) {
      const next = parseInt(body2.split("_")[2]);
      conn.ev.off("messages.upsert", handler);
      clearTimeout(timer);
      await conn.sendMessage(from, { react: { text: "▶️", key: msg.key } });
      await showLinkPage(conn, from, sender, msg, title, poster, links, isSeries, botName, next);
      return;
    }

    // ── All episodes ──
    if (isSeries && links.length > 1 && (body2 === "msl_all" || body2.trim() === "0")) {
      conn.ev.off("messages.upsert", handler);
      clearTimeout(timer);
      await conn.sendMessage(from, { react: { text: "⏳", key: msg.key } });
      await downloadAllLinks(conn, from, msg, title, poster, links, botName);
      return;
    }

    // ── Single link ──
    const idx = resolveIdx(body2, "msl_dl", links.length);
    if (idx === -1) return;
    // multi-reply: handler NOT removed — user can pick more than one
    await conn.sendMessage(from, { react: { text: "⬇️", key: msg.key } });
    downloadLink(conn, from, msg, title, poster, links[idx], botName).catch(console.error);
  };

  const timer = setTimeout(() => conn.ev.off("messages.upsert", handler), TIMEOUT);
  conn.ev.on("messages.upsert", handler);
}

// ═════════════════════════════════════════════════════════════════════════════
// DOWNLOAD — single link
// ═════════════════════════════════════════════════════════════════════════════
async function downloadLink(conn, from, quotedMsg, title, poster, link, botName) {
  const label = link.quality || "Download";
  try {
    log("resolving:", title, label);
    await conn.sendMessage(from, { text: `⏳ *Resolving ${label} link...*` }, { quoted: quotedMsg });

    const gdriveSource = link.original || link.direct;
    const resolved = await retry(() => resolveDownloadLink(gdriveSource), 2, 2000, "resolve-link");
    const fileName = resolved.fileName !== "file.mp4"
      ? resolved.fileName
      : `${title.replace(/[^\w\s]/g, "")}.mp4`;

    await conn.sendMessage(from, {
      text: `⏳ *Sending file...*\n📁 *File:* ${fileName}\n💾 *Size:* ${resolved.fileSize}\n⏳ *Expires:* ${resolved.expiresIn}`
    }, { quoted: quotedMsg });

    const tb = await thumb(poster);
    const caption =
      `*𝗧ɪᴛʟᴇ : ${title}*\n${label}\n💾 *Size:* ${resolved.fileSize}\n\n` +
      `*⏤͟͟͞͞★❮ ${botName} 〽️𝗢𝗩𝗜𝗘𝗦 ❯⏤͟͟͞͞★*`;

    await sendFileAsStream(conn, from, resolved.directUrl, `🎬${botName}🎬${fileName}`, caption, tb, quotedMsg);
    await conn.sendMessage(from, { react: { text: "✅", key: quotedMsg.key } });
    log("✅ sent:", fileName);

  } catch (e) {
    console.error("[msl] downloadLink error:", e);
    await conn.sendMessage(from, { text: `❌ *Download failed*\n\n${e.message}` }, { quoted: quotedMsg });
    await conn.sendMessage(from, { react: { text: "❌", key: quotedMsg.key } });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// DOWNLOAD — all episodes/links sequentially
// ═════════════════════════════════════════════════════════════════════════════
async function downloadAllLinks(conn, from, quotedMsg, title, poster, links, botName) {
  await conn.sendMessage(from, {
    text: `⬇️ *Downloading all ${links.length} episodes...*\n🎬 *${title}*\n\n_Please wait..._`
  }, { quoted: quotedMsg });

  let success = 0, failed = 0;
  const tb = await thumb(poster);

  for (const link of links) {
    const label = link.quality || "Download";
    try {
      log(`📥 All: ${label}`);
      const gdriveSource = link.original || link.direct;
      const resolved = await retry(() => resolveDownloadLink(gdriveSource), 3, 2000, `resolve-${label}`);
      const fileName = resolved.fileName !== "file.mp4"
        ? resolved.fileName
        : `${title.replace(/[^\w\s]/g, "")}_${label}.mp4`;

      const caption =
        `*𝗧ɪᴛʟᴇ : ${title}*\n${label}\n💾 *Size:* ${resolved.fileSize}\n\n` +
        `*⏤͟͟͞͞★❮ ${botName} 〽️𝗢𝗩𝗜𝗘𝗦 ❯⏤͟͟͞͞★*`;

      const docMsg = await conn.sendMessage(from, {
        document: { url: resolved.directUrl },
        mimetype: "video/mp4",
        fileName: `🎬${botName}🎬${fileName}`,
        caption,
        jpegThumbnail: tb,
      }, { quoted: quotedMsg });

      await conn.sendMessage(from, { react: { text: "✅", key: docMsg.key } });
      success++;
      log(`✅ All: ${label} done`);

    } catch (e) {
      failed++;
      log(`❌ All: ${label} failed:`, e.message);
      await conn.sendMessage(from, { text: `❌ *${label} failed*\n${e.message}` }, { quoted: quotedMsg });
    }
  }

  await conn.sendMessage(from, {
    text:
      `${success === links.length ? "✅" : "⚠️"} *Download Complete!*\n\n` +
      `🎬 *${title}*\n` +
      `✅ *Success:* ${success}/${links.length}\n` +
      `❌ *Failed:* ${failed}\n\n` +
      `*⏤͟͟͞͞★❮ ${botName} 〽️𝗢𝗩𝗜𝗘𝗦 ❯⏤͟͟͞͞★*`
  }, { quoted: quotedMsg });
}

module.exports = {};
