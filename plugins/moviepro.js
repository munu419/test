const { cmd } = require("../command");
const axios = require("axios");
const sharp = require("sharp");

const API = "https://moviepro-mocha.vercel.app/api";
const FOOTER = "⏤͟͟͞͞★❮ 𝗦𝗔𝗬𝗨𝗥𝗔 𝗟𝗞 𝗫 𝗠𝗜𝗡𝗜 🎬 𝗠𝗢𝗩𝗜𝗘𝗣𝗥𝗢 ❯⏤͟͟͞͞★";
const BANNER = "https://raw.githubusercontent.com/gojo1777/SAYURA-LK-BOT-help/refs/heads/main/file_00000000f2d47208a24ba4f8ead1263d.png";

function pad(n) { return String(n).padStart(2, "0"); }

function fmtSize(bytes) {
  const b = Number(bytes);
  if (!b || b === 0) return "Unknown";
  const mb = b / (1024 * 1024);
  return mb > 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
}

function fmtRes(r) {
  const n = parseInt(String(r || "").replace(/\D/g, ""));
  // Handle old API codes (1-4) and new pixel-count strings ("360","480","720","1080")
  const map = { 1: "360p", 2: "480p", 3: "720p", 4: "1080p" };
  return map[n] || (n >= 144 ? `${n}p` : r || "HD");
}

async function getThumbnail(url) {
  try {
    const res = await axios.get(url, { responseType: "arraybuffer", timeout: 10000 });
    return await sharp(res.data).resize(320, 320).jpeg({ quality: 70 }).toBuffer();
  } catch (e) {
    console.warn("Thumbnail error:", e.message);
    return null;
  }
}

async function apiGet(path, retries = 1) {
  try {
    const { data } = await axios.get(API + path, { timeout: 45000 });
    return data;
  } catch (e) {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 1500));
      return apiGet(path, retries - 1);
    }
    throw e;
  }
}

async function search(q, page = 1) {
  return apiGet(`/search?q=${encodeURIComponent(q)}&page=${page}&per_page=12`);
}

async function getDetails(subjectId) {
  return apiGet(`/details/${subjectId}`);
}

async function getDownloads(subjectId) {
  return apiGet(`/downloads/${subjectId}`);
}

async function getEpisodes(subjectId, season = null) {
  const s = season ? `?season=${season}` : "";
  return apiGet(`/episodes/${subjectId}${s}`);
}

async function getEpisode(subjectId, season, episode) {
  return apiGet(`/episode/${subjectId}?season=${season}&episode=${episode}`);
}

function waitReply(bot, from, sender, targetId, timeout = 120000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      bot.ev.off("messages.upsert", handler);
      resolve(null);
    }, timeout);
    const handler = (update) => {
      const msg = update.messages?.[0];
      if (!msg?.message) return;
      const text = (msg.message.conversation || msg.message?.extendedTextMessage?.text || "").trim();
      const ctx = msg.message?.extendedTextMessage?.contextInfo;
      const msgSender = msg.key.participant || msg.key.remoteJid;
      const isReply = ctx?.stanzaId === targetId;
      const senderNum = sender.split("@")[0];
      const isUser = msgSender.includes(senderNum);
      if (msg.key.remoteJid === from && isUser && isReply) {
        clearTimeout(timer);
        bot.ev.off("messages.upsert", handler);
        resolve({ msg, text });
      }
    };
    bot.ev.on("messages.upsert", handler);
  });
}

async function sendVideo(bot, from, quoted, url, fileName, caption, thumbnail) {
  try {
    await bot.sendMessage(from, {
      document: { url },
      mimetype: "video/mp4",
      fileName,
      caption,
      jpegThumbnail: thumbnail,
    }, { quoted });
  } catch (e) {
    const res = await axios.get(url, { responseType: "stream", timeout: 180000, maxRedirects: 5 });
    await bot.sendMessage(from, {
      document: { stream: res.data },
      mimetype: "video/mp4",
      fileName,
      caption,
      jpegThumbnail: thumbnail,
    }, { quoted });
  }
}

// ── Main command ──────────────────────────────────────────────────────────────
cmd({
  pattern: "moviepro",
  alias: ["mp", "film", "series"],
  react: "🎬",
  desc: "MoviePro — Movies, Series & Anime with downloads & subtitles",
  category: "download",
  filename: __filename,
}, async (bot, mek, m, { from, q, reply, sender }) => {
  try {
    if (!q?.trim()) return reply(
      `🎬 *MoviePro Downloader*\n\n` +
      `*Usage:* \`.moviepro <title>\`\n\n` +
      `*Examples:*\n• \`.moviepro inception\`\n• \`.moviepro one piece\`\n• \`.moviepro avengers\`\n\n${FOOTER}`
    );

    await bot.sendMessage(from, { react: { text: "🔍", key: mek.key } });

    let searchData;
    try {
      searchData = await search(q.trim());
    } catch (e) {
      return reply(`❌ *Search failed:* ${e.message}\n\n${FOOTER}`);
    }

    const results = searchData?.items || [];
    if (!results.length) return reply(`❌ *"${q}"* — Results not found.\n\n${FOOTER}`);

    let listText = `🎬 *MoviePro Search*\n🔍 *"${q}"*\n\n`;
    results.slice(0, 12).forEach((item, i) => {
      const type = Number(item.subject_type) === 2 ? "📺" : "🎬";
      const year = item.release_date ? ` _(${String(item.release_date).substring(0, 4)})_` : "";
      const rating = item.imdb_rating_value > 0 ? ` ⭐${item.imdb_rating_value}` : "";
      listText += `*${i + 1}.* ${type} ${item.title}${year}${rating}\n`;
    });
    listText += `\n*Number reply කරන්න*\n\n${FOOTER}`;

    const cover = results[0]?.cover?.url;
    let sentList = cover
      ? await bot.sendMessage(from, { image: { url: cover }, caption: listText }, { quoted: mek })
      : await bot.sendMessage(from, { text: listText }, { quoted: mek });

    await bot.sendMessage(from, { react: { text: "✅", key: mek.key } });

    while (true) {
      const sel = await waitReply(bot, from, sender, sentList.key.id, 120000);
      if (!sel) break;
      const idx = parseInt(sel.text) - 1;
      if (isNaN(idx) || idx < 0 || idx >= results.length) continue;
      handleItem(bot, from, sender, results[idx], sel.msg).catch(console.error);
    }

  } catch (e) {
    console.error("[moviepro]", e);
    reply(`❌ Error: ${e.message}\n\n${FOOTER}`);
  }
});

// ── Item handler ──────────────────────────────────────────────────────────────
async function handleItem(bot, from, sender, item, quotedMsg) {
  try {
    await bot.sendMessage(from, { react: { text: "⏳", key: quotedMsg.key } });

    let isTV = Number(item.subject_type) === 2;

    let detail = item;
    try {
      detail = await getDetails(item.subject_id);
      if (Number(detail.subject_type) === 2) isTV = true;
    } catch (e) {
      console.log("[detail fallback]", e.message);
    }

    console.log(`[handleItem] "${item.title}" isTV=${isTV}`);

    let epCache = null;

    if (isTV) {
      try {
        const epCheck = await getEpisodes(detail.subject_id);
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
          console.log(`[handleItem] TV — ${detail.seasons.total_seasons} seasons (cached)`);
        } else {
          console.log("[handleItem] TV but no episodes → treating as movie");
          isTV = false;
        }
      } catch (e) {
        console.log("[episode check error]", e.message);
      }
    }

    isTV
      ? await handleSeries(bot, from, sender, detail, quotedMsg, epCache)
      : await handleMovie(bot, from, sender, detail, quotedMsg);

  } catch (e) {
    console.error("[handleItem]", e);
    bot.sendMessage(from, { text: `❌ Error: ${e.message}\n\n${FOOTER}` }, { quoted: quotedMsg });
  }
}

// ── Movie handler ─────────────────────────────────────────────────────────────
async function handleMovie(bot, from, sender, detail, quotedMsg) {
  try {
    const title = detail.title || "Movie";
    const cover = detail.cover?.url || BANNER;
    const year = String(detail.release_date || "").substring(0, 4);
    const rating = detail.imdb_rating_value || detail.imdb_rate || "N/A";
    const genre = (detail.genre || []).join(", ") || "N/A";
    const desc = detail.description ? detail.description.substring(0, 200) + "..." : "";

    let files = [];
    try {
      const dlData = await getDownloads(detail.subject_id);
      // For movies: exclude episode files; fall back to all files if none remain
      files = (dlData.files || []).filter(f => !Number(f.season) && !Number(f.episode));
      if (!files.length) files = dlData.files || [];
    } catch {}

    let subs = [];
    if (files[0]?.resource_id) {
      try {
        const subData = await apiGet(`/subtitles/${detail.subject_id}/${files[0].resource_id}`);
        subs = subData.subtitles || [];
      } catch {}
    }

    let caption =
      `🎬 *${title}*\n\n` +
      `*▫️⭐ IMDB* ☛ *_${rating}_*\n` +
      `*▫️🎭 Genre* ☛ *_${genre}_*\n` +
      `*▫️📅 Year* ☛ *_${year}_*\n` +
      (desc ? `\n_${desc}_\n` : "") +
      `\n*🎥 Download Options:*\n`;

    const fileOptions = files.slice(0, 6);
    fileOptions.forEach((f, i) => {
      caption += `*${i + 1}.* 💎 ${fmtRes(f.resolution)} — 📦 ${fmtSize(f.size)}\n`;
    });

    const subOffset = fileOptions.length;
    if (subs.length) {
      caption += `\n*🔤 Subtitles (${subs.length}):*\n`;
      subs.slice(0, 6).forEach((s, i) => {
        caption += `*${subOffset + i + 1}.* ${s.lan_name || s.lan}\n`;
      });
    }

    caption += `\n*Reply කරන්න*\n\n${FOOTER}`;

    let sent = await bot.sendMessage(from, { image: { url: cover }, caption }, { quoted: quotedMsg });
    await bot.sendMessage(from, { react: { text: "✅", key: quotedMsg.key } });

    while (true) {
      const sel = await waitReply(bot, from, sender, sent.key.id, 120000);
      if (!sel) break;
      const choice = parseInt(sel.text);
      if (isNaN(choice) || choice < 1) continue;

      if (choice <= subOffset) {
        const file = fileOptions[choice - 1];
        if (!file) continue;
        downloadFile(bot, from, sender, detail, file, null, null, sel.msg).catch(console.error);
      } else {
        const sub = subs[choice - subOffset - 1];
        if (!sub) continue;
        downloadSub(bot, from, detail, sub, null, null, sel.msg).catch(console.error);
      }
    }

  } catch (e) {
    console.error("[handleMovie]", e);
    bot.sendMessage(from, { text: `❌ Error: ${e.message}\n\n${FOOTER}` }, { quoted: quotedMsg });
  }
}

// ── Series → Season select ────────────────────────────────────────────────────
async function handleSeries(bot, from, sender, detail, quotedMsg, epCache) {
  try {
    const title = detail.title || "Series";
    const cover = detail.cover?.url || BANNER;
    const seasons = detail.seasons?.seasons || [];
    const totalSeasons = detail.seasons?.total_seasons || seasons.length;

    if (!totalSeasons) {
      return bot.sendMessage(from, {
        text: `❌ Season info not found for "${title}"\n\n${FOOTER}`
      }, { quoted: quotedMsg });
    }

    let text =
      `📺 *${title}*\n\n` +
      `*▫️⭐ IMDB* ☛ *_${detail.imdb_rating_value || "N/A"}_*\n` +
      `*▫️🎭 Genre* ☛ *_${(detail.genre || []).join(", ") || "N/A"}_*\n\n` +
      `*🗂 Season Select:*\n\n`;

    for (const sd of seasons) {
      const sNum = sd.season_number;
      text += `*${sNum}.* Season ${sNum}${sd.total_episodes ? ` _(${sd.total_episodes} eps)_` : ""}\n`;
    }
    text += `\n*Season number reply කරන්න*\n\n${FOOTER}`;

    let sent = await bot.sendMessage(from, { image: { url: cover }, caption: text }, { quoted: quotedMsg });

    while (true) {
      const sel = await waitReply(bot, from, sender, sent.key.id, 120000);
      if (!sel) break;
      const sNum = parseInt(sel.text);
      const validSeason = seasons.find(s => s.season_number === sNum);
      if (!validSeason) continue;
      handleEpisodeList(bot, from, sender, detail, sNum, sel.msg, epCache).catch(console.error);
    }

  } catch (e) {
    bot.sendMessage(from, { text: `❌ Error: ${e.message}\n\n${FOOTER}` }, { quoted: quotedMsg });
  }
}

// ── Episode list ──────────────────────────────────────────────────────────────
async function handleEpisodeList(bot, from, sender, detail, seasonNum, quotedMsg, epCache) {
  try {
    await bot.sendMessage(from, { react: { text: "⏳", key: quotedMsg.key } });

    let epData = null;
    const cachedSeason = epCache?.seasons?.find(s => s.season === seasonNum);

    if (cachedSeason && (cachedSeason.episodes || []).length > 0) {
      epData = epCache;
    } else {
      epData = await getEpisodes(detail.subject_id, seasonNum);
    }

    const seasonInfo = (epData.seasons || []).find(s => s.season === seasonNum);
    const episodes = seasonInfo?.episodes || [];
    const totalEps = seasonInfo?.total_episodes || episodes.length;

    if (!episodes.length) {
      return bot.sendMessage(from, {
        text: `❌ Season ${seasonNum} episodes not found\n\n${FOOTER}`
      }, { quoted: quotedMsg });
    }

    async function showPage(start) {
      const page = episodes.slice(start, start + 30);
      let text = `📺 *${detail.title}* — Season ${seasonNum}\n`;
      text += `*Episodes (${start + 1}–${start + page.length} of ${totalEps}):*\n\n`;

      page.forEach((ep, i) => {
        const displayNum = start + i + 1;
        text += `*${displayNum}.* S${pad(seasonNum)}E${pad(ep.episode)}${ep.title ? ` — ${ep.title}` : ""}\n`;
      });

      const hasMore = start + 30 < episodes.length;
      if (hasMore) text += `\n_"more" reply කරන්න next page_\n`;
      text += `\n*Number reply කරන්න* (list number)\n\n${FOOTER}`;

      let sent = await bot.sendMessage(from, { text }, { quoted: quotedMsg });
      await bot.sendMessage(from, { react: { text: "✅", key: quotedMsg.key } });

      while (true) {
        const sel = await waitReply(bot, from, sender, sent.key.id, 120000);
        if (!sel) break;

        if (sel.text.toLowerCase() === "more" && hasMore) {
          await showPage(start + 30);
          break;
        }

        const listNum = parseInt(sel.text);
        if (isNaN(listNum) || listNum < 1 || listNum > episodes.length) continue;

        const ep = episodes[listNum - 1];
        if (!ep) continue;

        handleEpisodeDownload(
          bot, from, sender, detail,
          seasonNum, ep.episode,
          ep.title || `S${pad(seasonNum)}E${pad(ep.episode)}`,
          sel.msg
        ).catch(console.error);
      }
    }

    await showPage(0);

  } catch (e) {
    console.error("[handleEpisodeList]", e);
    bot.sendMessage(from, { text: `❌ Error: ${e.message}\n\n${FOOTER}` }, { quoted: quotedMsg });
  }
}

// ── Episode download options ──────────────────────────────────────────────────
async function handleEpisodeDownload(bot, from, sender, detail, season, episode, epTitle, quotedMsg) {
  try {
    await bot.sendMessage(from, { react: { text: "⏳", key: quotedMsg.key } });

    const epData = await getEpisode(detail.subject_id, season, episode);
    const files = epData.files || [];

    if (!files.length) {
      return bot.sendMessage(from, {
        text: `❌ S${pad(season)}E${pad(episode)} files not found\n\n${FOOTER}`
      }, { quoted: quotedMsg });
    }

    const cover = detail.cover?.url || BANNER;

    let subs = [];
    if (files[0]?.resource_id) {
      try {
        const subData = await apiGet(`/subtitles/${detail.subject_id}/${files[0].resource_id}`);
        subs = subData.subtitles || [];
      } catch {}
    }

    const epTag = `S${pad(season)}E${pad(episode)}`;
    let caption =
      `📺 *${detail.title}* — *${epTag}*\n` +
      (epTitle && epTitle !== epTag ? `_${epTitle}_\n` : "") +
      `\n*💎 Download Quality:*\n`;

    files.forEach((f, i) => {
      caption += `*${i + 1}.* ${fmtRes(f.resolution)} — 📦 ${fmtSize(f.size)}\n`;
    });

    const fileOffset = files.length;
    if (subs.length) {
      caption += `\n*🔤 Subtitles (${subs.length}):*\n`;
      subs.slice(0, 6).forEach((s, i) => {
        caption += `*${fileOffset + i + 1}.* ${s.lan_name || s.lan}\n`;
      });
    }

    caption += `\n*Reply කරන්න*\n\n${FOOTER}`;

    let sent = await bot.sendMessage(from, { image: { url: cover }, caption }, { quoted: quotedMsg });
    await bot.sendMessage(from, { react: { text: "✅", key: quotedMsg.key } });

    while (true) {
      const sel = await waitReply(bot, from, sender, sent.key.id, 120000);
      if (!sel) break;
      const choice = parseInt(sel.text);
      if (isNaN(choice) || choice < 1) continue;

      if (choice <= fileOffset) {
        const file = files[choice - 1];
        if (!file) continue;
        downloadFile(bot, from, sender, detail, file, season, episode, sel.msg).catch(console.error);
      } else {
        const sub = subs[choice - fileOffset - 1];
        if (!sub) continue;
        downloadSub(bot, from, detail, sub, season, episode, sel.msg).catch(console.error);
      }
    }

  } catch (e) {
    console.error("[handleEpisodeDownload]", e);
    bot.sendMessage(from, { text: `❌ Error: ${e.message}\n\n${FOOTER}` }, { quoted: quotedMsg });
  }
}

// ── File download ─────────────────────────────────────────────────────────────
async function downloadFile(bot, from, sender, detail, file, season, episode, quotedMsg) {
  const title = detail.title || "video";
  const epTag = season ? `S${pad(season)}E${pad(episode)}` : "";
  const res = fmtRes(file.resolution);
  const safeTitle = title.replace(/[^\w\s\-]/g, "").replace(/\s+/g, "_").substring(0, 40);
  const fileName = `SAYURA-LK_${safeTitle}${epTag ? "_" + epTag : ""}_${res}.mp4`;

  try {
    await bot.sendMessage(from, { react: { text: "📥", key: quotedMsg.key } });
    await bot.sendMessage(from, {
      text:
        `⏳ *Downloading...*\n\n` +
        `🎬 *${title}*${epTag ? `\n📺 *Episode:* ${epTag}` : ""}\n` +
        `💎 *Quality:* ${res}\n` +
        `📦 *Size:* ${fmtSize(file.size)}\n\n` +
        `_Please wait..._`
    }, { quoted: quotedMsg });

    const dlUrl = file.resource_link;
    if (!dlUrl) throw new Error("Download URL not found");

    const cover = detail.cover?.url || BANNER;
    const thumb = await getThumbnail(cover);

    const caption =
      `✅ *Download Complete!*\n\n` +
      `🎬 *${title}*${epTag ? `\n📺 *Episode:* ${epTag}` : ""}\n` +
      `💎 *Quality:* ${res}\n` +
      `📦 *Size:* ${fmtSize(file.size)}\n\n${FOOTER}`;

    await sendVideo(bot, from, quotedMsg, dlUrl, fileName, caption, thumb);
    await bot.sendMessage(from, { react: { text: "✅", key: quotedMsg.key } });

  } catch (e) {
    console.error("[downloadFile]", e);
    await bot.sendMessage(from, {
      text: `❌ *Download failed*\n\n${e.message}\n\n${FOOTER}`
    }, { quoted: quotedMsg });
    await bot.sendMessage(from, { react: { text: "❌", key: quotedMsg.key } });
  }
}

// ── Subtitle download ─────────────────────────────────────────────────────────
async function downloadSub(bot, from, detail, sub, season, episode, quotedMsg) {
  try {
    await bot.sendMessage(from, { react: { text: "📥", key: quotedMsg.key } });

    const title = detail.title || "video";
    const epTag = season ? `S${pad(season)}E${pad(episode)}` : "";
    const langName = sub.lan_name || sub.lan || "Unknown";
    const baseName = `${title}${epTag ? " " + epTag : ""}`.replace(/[\\/:*?"<>|]/g, "");

    const origRes = await axios.get(sub.url, { responseType: "arraybuffer", timeout: 30000 });
    await bot.sendMessage(from, {
      document: Buffer.from(origRes.data),
      mimetype: "application/x-subrip",
      fileName: `${baseName} [${langName}].srt`,
      caption:
        `✅ *Subtitle Downloaded!*\n\n` +
        `🎬 *${title}*${epTag ? `\n📺 *Episode:* ${epTag}` : ""}\n` +
        `🔤 *Language:* ${langName}\n\n${FOOTER}`
    }, { quoted: quotedMsg });

    try {
      const sourceLang = sub.lan || "en";
      const translateUrl = `${API}/translate-subtitle?url=${encodeURIComponent(sub.url)}&from=${encodeURIComponent(sourceLang)}&to=si&format=srt`;
      const siRes = await axios.get(translateUrl, { responseType: "arraybuffer", timeout: 60000 });
      await bot.sendMessage(from, {
        document: Buffer.from(siRes.data),
        mimetype: "application/x-subrip",
        fileName: `${baseName} [Sinhala].srt`,
        caption:
          `✅ *Sinhala Subtitle!*\n\n` +
          `🎬 *${title}*${epTag ? `\n📺 *Episode:* ${epTag}` : ""}\n` +
          `🔤 *Language:* Sinhala (Translated)\n\n${FOOTER}`
      }, { quoted: quotedMsg });
    } catch (e) {
      console.log("[sinhala translate skip]", e.message);
    }

    await bot.sendMessage(from, { react: { text: "✅", key: quotedMsg.key } });

  } catch (e) {
    console.error("[downloadSub]", e);
    await bot.sendMessage(from, {
      text: `❌ *Subtitle failed*\n${e.message}\n\n${FOOTER}`
    }, { quoted: quotedMsg });
    await bot.sendMessage(from, { react: { text: "❌", key: quotedMsg.key } });
  }
}
