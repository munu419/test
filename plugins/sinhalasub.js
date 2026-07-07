const { cmd } = require("../command");
const axios = require("axios");
const sharp = require("sharp");

const FOOTER = "⏤͟͟͞͞★❮  KAVI X MD 🎬 MOVIE ❯⏤͟͟͞͞★";
const CHANNEL = "https://whatsapp.com/channel/0029Vb8VPsxBKfi2WHCVgV0J";
const BANNER = "https://files.catbox.moe/kmfr8j.jpg";

const movieCache = new Map();

async function makeThumbnail(url) {
  try {
    const img = await axios.get(url || BANNER, { responseType: "arraybuffer", timeout: 12000 });
    return await sharp(img.data).resize(300).jpeg({ quality: 65 }).toBuffer();
  } catch { return null; }
}

cmd({
  pattern: "sinhalasub",
  alias: ["ssub", "sublk"],
  desc: "🎬 Sub.lk Sinhala subtitle movies search & download",
  category: "downloader",
  react: "🎬",
  filename: __filename
}, async (conn, mek, m, { from, q, sender }) => {

  if (!q) {
    return conn.sendMessage(from, {
      text: `🎬 *SinhalaSub Downloader*\n\n*Usage:* \`.sinhalasub <movie name>\`\n\n*Examples:*\n• \`.sinhalasub avengers\`\n• \`.ssub inception\`\n\n${FOOTER}`
    }, { quoted: mek });
  }

  try {
    await conn.sendMessage(from, { react: { text: "🔍", key: mek.key } });

    // ── Search ────────────────────────────────────────────────────────────────
    const cacheKey = `ssub_${q.toLowerCase()}`;
    let data = movieCache.get(cacheKey);

    if (!data) {
      const res = await axios.get(
        `https://darkyasiya-new-movie-api.vercel.app/api/movie/sinhalasub/search?q=${encodeURIComponent(q)}`,
        { timeout: 20000 }
      );
      data = res.data;
      if (!data.success || !data.data?.data?.length) throw new Error("No results found.");
      movieCache.set(cacheKey, data);
    }

    const movieList = data.data.data.map((m, i) => ({ number: i + 1, title: m.title, link: m.link }));

    let listText = `🎬 *SinhalaSub Search*\n🔍 *"${q}"*\n\n`;
    movieList.forEach(m => { listText += `*${m.number}.* 🎥 ${m.title}\n`; });
    listText += `\n*Number reply කරන්න*\n\n${FOOTER}`;

    const sentMsg = await conn.sendMessage(from, {
      image: { url: BANNER },
      caption: listText
    }, { quoted: mek });

    await conn.sendMessage(from, { react: { text: "✅", key: mek.key } });

    // movieMap — download msg id → {title, downloads}
    const movieMap = new Map();

    // ── Listener — MULTI REPLY ────────────────────────────────────────────────
    const listener = async (update) => {
      const msg = update.messages?.[0];
      if (!msg?.message) return;
      if (msg.key.remoteJid !== from) return;

      const msgSender = msg.key.participant || msg.key.remoteJid;
      const isUser = msgSender.includes(sender.split("@")[0]) || msgSender.includes("@lid");
      if (!isUser) return;

      const replyText = (
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text || ""
      ).trim();

      const repliedId =
        msg.message.extendedTextMessage?.contextInfo?.stanzaId ||
        msg.message.buttonsResponseMessage?.contextInfo?.stanzaId;

      if (!repliedId || !replyText) return;

      // ── "done" — cancel ───────────────────────────────────────────────────
      if (replyText.toLowerCase() === "done") {
        conn.ev.off("messages.upsert", listener);
        return conn.sendMessage(from, { text: `✅ *Cancelled.*\n\n${FOOTER}` }, { quoted: msg });
      }

      // ── Search list reply ─────────────────────────────────────────────────
      if (repliedId === sentMsg.key.id) {
        const num = parseInt(replyText);
        const selected = movieList.find(m => m.number === num);
        if (!selected) return conn.sendMessage(from, { text: `❌ *Invalid number. 1-${movieList.length} enter කරන්න.*` }, { quoted: msg });

        await conn.sendMessage(from, { react: { text: "⏳", key: msg.key } });

        try {
          const movieRes = await axios.get(
            `https://darkyasiya-new-movie-api.vercel.app/api/movie/sinhalasub/movie?url=${encodeURIComponent(selected.link)}`,
            { timeout: 20000 }
          );
          const movie = movieRes.data.data;

          // Filter usable links
          const downloads = (movie.downloadUrl || []).filter(d =>
            d.link.includes("pixeldrain.com") || d.link.includes("ddl.sinhalasub.net")
          );

          if (!downloads.length) {
            return conn.sendMessage(from, { text: `❌ *Download links not found.*\n\n${FOOTER}` }, { quoted: msg });
          }

          const cast = (movie.cast || []).slice(0, 5).join(", ");
          let info =
            `╭━━━〔 🎬 *${movie.title}* 〕━━━⬣\n\n` +
            `*▫️⭐ IMDb* ☛ *_${movie.imdb?.value || "N/A"}_*\n` +
            `*▫️📅 Released* ☛ *_${movie.date || "N/A"}_*\n` +
            `*▫️🌍 Country* ☛ *_${movie.country || "N/A"}_*\n` +
            `*▫️🕐 Runtime* ☛ *_${movie.runtime || "N/A"}_*\n` +
            `*▫️🎭 Genre* ☛ *_${(movie.category || []).join(", ") || "N/A"}_*\n` +
            `*▫️✍️ Sub Author* ☛ *_${movie.subtitle_author || "N/A"}_*\n` +
            `*▫️🎬 Director* ☛ *_${movie.director || "N/A"}_*\n` +
            (cast ? `*▫️👥 Cast* ☛ *_${cast}_*\n` : "") +
            `\n*📥 Download Links:*\n`;

          downloads.forEach((d, i) => {
            info += `*${i + 1}.* 💎 ${d.quality} — 📦 ${d.size}\n`;
          });
          info += `\n*Number reply කරන්න*\n\n${FOOTER}\n${CHANNEL}`;

          const thumb = await makeThumbnail(movie.mainImage);
          const downloadMsg = await conn.sendMessage(from, {
            image: { url: movie.mainImage || BANNER },
            caption: info,
            jpegThumbnail: thumb,
          }, { quoted: msg });

          // Store for download reply
          movieMap.set(downloadMsg.key.id, { title: movie.title, poster: movie.mainImage, downloads });

        } catch (e) {
          conn.sendMessage(from, { text: `❌ *Error:* ${e.message}\n\n${FOOTER}` }, { quoted: msg });
        }
        return;
      }

      // ── Download reply ────────────────────────────────────────────────────
      if (movieMap.has(repliedId)) {
        const { title, poster, downloads } = movieMap.get(repliedId);
        const num = parseInt(replyText);
        const chosen = downloads[num - 1];
        if (!chosen) return conn.sendMessage(from, { text: `❌ *Invalid number.*` }, { quoted: msg });

        // Size check
        const sizeStr = (chosen.size || "").toLowerCase();
        const sizeGB = sizeStr.includes("gb")
          ? parseFloat(sizeStr)
          : parseFloat(sizeStr) / 1024;

        if (sizeGB > 2) {
          return conn.sendMessage(from, {
            text:
              `⚠️ *File too large*\n\n` +
              `📦 *Size:* ${chosen.size}\n` +
              `WhatsApp 2GB limit exceed වෙනවා.\n\n${FOOTER}`
          }, { quoted: msg });
        }

        await conn.sendMessage(from, { react: { text: "📥", key: msg.key } });
        await conn.sendMessage(from, {
          text:
            `⏳ *Downloading...*\n\n🎬 *${title}*\n💎 *Quality:* ${chosen.quality}\n📦 *Size:* ${chosen.size}\n\n_Please wait..._`
        }, { quoted: msg });

        // Fix pixeldrain URL
        let directLink = chosen.link;
        if (directLink.includes("pixeldrain.com")) {
          const match = directLink.match(/\/([A-Za-z0-9]+)(?:\?.*)?$/);
          if (match) directLink = `https://pixeldrain.com/api/file/${match[1]}?download`;
        }

        try {
          const thumb = await makeThumbnail(poster);
          const fileName = `SAYURA-LK_${title.replace(/[^\w\s\-]/g, "").replace(/\s+/g, "_").substring(0, 40)}_${chosen.quality}.mp4`;

          await conn.sendMessage(from, {
            document: { url: directLink },
            mimetype: "video/mp4",
            fileName,
            jpegThumbnail: thumb,
            caption:
              `✅ *Download Complete!*\n\n` +
              `🎬 *${title}*\n` +
              `💎 *Quality:* ${chosen.quality}\n` +
              `📦 *Size:* ${chosen.size}\n\n` +
              `${FOOTER}\n${CHANNEL}`
          }, { quoted: msg });

          await conn.sendMessage(from, { react: { text: "✅", key: msg.key } });

        } catch (e) {
          await conn.sendMessage(from, {
            text: `❌ *Download failed*\n\n${e.message}\n\n${FOOTER}`
          }, { quoted: msg });
          await conn.sendMessage(from, { react: { text: "❌", key: msg.key } });
        }
      }
    };

    conn.ev.on("messages.upsert", listener);
    // 10 min timeout
    setTimeout(() => conn.ev.off("messages.upsert", listener), 600000);

  } catch (err) {
    await conn.sendMessage(from, { text: `❌ *Error:* ${err.message}\n\n${FOOTER}` }, { quoted: mek });
  }
});
