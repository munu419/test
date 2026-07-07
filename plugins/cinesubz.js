// plugins/cinesubz.js
// CineSubz movie search & download, adapted to this bot base:
//  - uses command.js's cmd() signature: (conn, mek, m, { from, q, reply, sender, sessionId })
//  - uses lib/settings.js (getSettings) for the per-session bot name (no "userSettings" param exists here)
//  - uses conn.sendButton() (global.sendInteractiveButtons, set up in index.js) for the button UI.
//    That helper AUTOMATICALLY falls back to a plain numbered text list when button mode is
//    switched off for the session (global.isButtonEnabled), so we don't need two separate
//    "buttons on / buttons off" code paths like the original script did.

const { cmd } = require("../command");
const axios = require("axios");
const sharp = require("sharp");
const config = require("../config");
const { getSettings } = require("../lib/settings");
const { getContentType } = require("@whiskeysockets/baileys");

const CINESUBZ_KEY = "key_faa62e4037a95cda";
const SEARCH_POSTER = "https://files.catbox.moe/04jdju.jpg";
const CHANNEL_LINK = "https://whatsapp.com/channel/0029Vb8VPsxBKfi2WHCVgV0J";
const LISTENER_TIMEOUT = 5 * 60 * 1000; // 5 min

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function retry(fn, retries = 3, baseDelay = 2000) {
    for (let i = 1; i <= retries; i++) {
        try {
            return await fn();
        } catch (err) {
            console.error(`[cinesubz] Attempt ${i} failed:`, err.message);
            if (i === retries) throw err;
            await sleep(baseDelay * i);
        }
    }
}

// ---------- CineSubz API helpers ----------
async function searchMovies(query) {
    const url = `https://mr-thinuzz-api-build.vercel.app/api/cinesubz/search?query=${encodeURIComponent(query)}&apiKey=${CINESUBZ_KEY}`;
    const { data } = await axios.get(url, { timeout: 30000 });
    if (!data.status) throw new Error("API returned error");
    return data.data.all || data.data.movies || [];
}

async function getMovieInfo(url) {
    const apiUrl = `https://mr-thinuzz-api-build.vercel.app/api/cinesubz/movie?url=${encodeURIComponent(url)}&apiKey=${CINESUBZ_KEY}`;
    const { data } = await axios.get(apiUrl, { timeout: 30000 });
    if (!data.status) throw new Error("API returned error");
    return data.data;
}

async function getDownloadLinks(downloadUrl) {
    const apiUrl = `https://mr-thinuzz-api-build.vercel.app/api/cinesubz/download?url=${encodeURIComponent(downloadUrl)}&apiKey=${CINESUBZ_KEY}`;
    const { data } = await axios.get(apiUrl, { timeout: 60000 });
    if (!data.status) throw new Error("API returned error");
    return (data.data?.downloadUrls || []).map((u) => u.url);
}

function selectBestLink(links) {
    if (!links || !links.length) return null;
    let best = links.find((l) => l.includes("pixeldrain.com"));
    if (best) {
        if (best.includes("pixeldrain.com/u/")) best = best.replace("/u/", "/api/file/");
        return best;
    }
    best = links.find((l) => l.startsWith("http") && !l.includes("t.me"));
    return best || links[0] || null;
}

async function getThumbnail(imageUrl) {
    try {
        const { data } = await axios.get(imageUrl, { responseType: "arraybuffer", timeout: 15000 });
        return await sharp(data).resize(320, 320, { fit: "cover" }).jpeg({ quality: 70 }).toBuffer();
    } catch (err) {
        console.warn("[cinesubz] Thumbnail generation failed:", err.message);
        return null;
    }
}

// ---------- Incoming-reply helpers (mirrors index.js's extractBody / contextInfo logic) ----------
function getReplyBody(message) {
    if (!message) return "";
    const type = getContentType(message);
    if (type === "conversation") return message.conversation || "";
    if (type === "extendedTextMessage") return message.extendedTextMessage?.text || "";
    if (type === "buttonsResponseMessage") return message.buttonsResponseMessage?.selectedButtonId || "";
    if (type === "listResponseMessage") return message.listResponseMessage?.singleSelectReply?.selectedRowId || "";
    if (type === "templateButtonReplyMessage") return message.templateButtonReplyMessage?.selectedId || "";
    if (type === "interactiveResponseMessage") {
        try {
            const nativeReply = message.interactiveResponseMessage?.nativeFlowResponseMessage;
            if (nativeReply) {
                const parsed = JSON.parse(nativeReply.paramsJson || "{}");
                return parsed.id || nativeReply.name || "";
            }
        } catch {}
        return message.interactiveResponseMessage?.body?.text || "";
    }
    return "";
}

function getReplyContext(message) {
    if (!message) return null;
    return (
        message.extendedTextMessage?.contextInfo ||
        message.buttonsResponseMessage?.contextInfo ||
        message.listResponseMessage?.contextInfo ||
        message.templateButtonReplyMessage?.contextInfo ||
        message.interactiveResponseMessage?.contextInfo ||
        null
    );
}

// Resolves a reply into a zero-based index, accepting either a plain number
// (text-fallback mode: "2") or a "prefix_INDEX" button/list id (button mode: "cinesubz_movie_1").
function resolveIndex(body, prefix, max) {
    const asNumber = parseInt(body, 10);
    if (!isNaN(asNumber) && String(asNumber) === body.trim()) {
        const idx = asNumber - 1;
        return idx >= 0 && idx < max ? idx : -1;
    }
    const m = body.match(new RegExp(`^${prefix}_(\\d+)$`));
    if (m) {
        const idx = parseInt(m[1], 10);
        return idx >= 0 && idx < max ? idx : -1;
    }
    return -1;
}

function buildDetailsCaption(movie) {
    const title = movie.maintitle || movie.title || "N/A";
    const year = movie.dateCreate || movie.year || "N/A";
    const rating = movie.imdb?.value || movie.rating?.value || "N/A";
    const plot = movie.description || "No description available.";
    let cast = "N/A";
    if (Array.isArray(movie.cast)) cast = movie.cast.map((c) => c.actor?.name || c.name).join(", ");

    return `*☘️ 𝗧ɪᴛʟᴇ : ${title}*

*▫️📅 𝗥ᴇʟᴇᴀꜱᴇ 𝗗ᴀᴛᴇ ➟ ${year}*
*▫️🥇 𝗜ᴍᴅʙ 𝗩ᴏᴛᴇꜱ ➟ _${rating}_*
*▫️🕵️‍♂️ 𝗖ᴀsᴛ ➟ ${cast}*

*▫️📖 𝗗𝗲𝘀𝗰𝗿𝗶𝗽𝘁𝗶𝗼𝗻 ➟ ${plot}*

*➟➟➟➟➟➟➟➟➟➟➟➟➟➟➟*
*👥 𝙵𝙾𝙻𝙻𝙾𝚆 𝙾𝚄𝚁 𝙲𝙷𝙰𝙽𝙽𝙴𝙻 ➟* ${CHANNEL_LINK}
*➟➟➟➟➟➟➟➟➟➟➟➟➟➟➟*`;
}

cmd(
    {
        pattern: "cinesubz",
        alias: ["cs"],
        react: "🎬",
        desc: "Search and download movies from CineSubz.",
        category: "downloader",
        filename: __filename,
    },
    async (conn, mek, m, { from, q, reply, sessionId }) => {
        try {
            const query = (q || "").trim();
            if (!query) return reply("🎬 *CINESUBZ MOVIE SEARCH*\n\nExample: `.cinesubz Avatar`");

            const settings = getSettings(sessionId);
            const botName = settings.botName || config.PACKNAME || "SAYURA-LK-X-MINI";

            await conn.sendMessage(from, { react: { text: "🔎", key: mek.key } });

            const results = await retry(() => searchMovies(query), 3, 2000);
            if (!results || !results.length) return reply("❎ No movies found.");

            const displayResults = results.slice(0, 10);

            await conn.sendMessage(
                from,
                { image: { url: SEARCH_POSTER }, caption: `🎬 *CineSubz Search Results*\n\nQuery: ${query}` },
                { quoted: mek }
            );

            const movieMsg = await conn.sendButton(
                from,
                {
                    header: "🎬 Select a Movie",
                    body: displayResults.map((r, i) => `${i + 1}. ${r.title}`).join("\n"),
                    footer: botName,
                    buttons: displayResults.map((r, i) => ({
                        text: `${i + 1}. ${(r.title || "").substring(0, 55)}`,
                        id: `cinesubz_movie_${i}`,
                    })),
                },
                mek
            );

            const movieListener = async (update) => {
                try {
                    const msg = update.messages?.[0];
                    if (!msg?.message || msg.key.remoteJid !== from) return;

                    const ctx = getReplyContext(msg.message);
                    if (!ctx || ctx.stanzaId !== movieMsg.key.id) return;

                    const body = getReplyBody(msg.message);
                    const index = resolveIndex(body, "cinesubz_movie", displayResults.length);
                    if (index === -1) return;

                    conn.ev.off("messages.upsert", movieListener);
                    await conn.sendMessage(from, { react: { text: "⏳", key: msg.key } });

                    const selected = displayResults[index];
                    const movieUrl = selected.link || selected.url;
                    if (!movieUrl) throw new Error("Movie URL not found");

                    const movie = await retry(() => getMovieInfo(movieUrl), 3, 2000);
                    if (!movie) return conn.sendMessage(from, { text: "❎ Failed to fetch movie details." });

                    let downloads = movie.downloadUrl || [];
                    if (!downloads.length) return conn.sendMessage(from, { text: "❎ No download links available." });

                    downloads = downloads.slice().sort((a, b) => {
                        const getRes = (d) => parseInt(d?.quality?.match(/\d+/)?.[0]) || 0;
                        return getRes(b) - getRes(a);
                    });

                    const title = movie.maintitle || movie.title || "N/A";
                    const posterUrl = movie.mainImage || "https://via.placeholder.com/300x450?text=No+Image";

                    let fullCaption = `╭━━━〔 🎬 CINE SUBZ DETAILS 〕━━━⬣

☘️ 𝓣𝓲𝓽𝓵𝓮 ➮ ${title}
⬇️ 𝓐𝓿𝓪𝓲𝓵𝓪𝓫𝓵𝓮 𝓠𝓾𝓪𝓵𝓲𝓽𝓲𝓮𝓼:
${downloads.map((d) => `➤ ${d.quality} (${d.size || "unknown"})`).join("\n")}
╰━━━━━━━━━━━━━━━━━━⬣
✨ 𝓕𝓸𝓵𝓵𝓸𝔀 𝓾𝓼:
${CHANNEL_LINK}`;
                    if (fullCaption.length > 4000) fullCaption = fullCaption.substring(0, 3970) + "…\n╰━━━━━━━━━━━━━━━━━━⬣";

                    await conn.sendMessage(from, { image: { url: posterUrl }, caption: fullCaption }, { quoted: msg });

                    const qualityButtons = downloads.map((d, i) => ({
                        text: d.quality?.includes("1080") ? `🔥 ${d.quality}` : d.quality?.includes("720") ? `⚡ ${d.quality}` : `⬇️ ${d.quality}`,
                        id: `cinesubz_quality_${i}`,
                    }));
                    qualityButtons.push({ text: "📑 Details Card", id: "cinesubz_details_card" });

                    const qualityMsg = await conn.sendButton(
                        from,
                        {
                            header: `🎬 ${title}`,
                            body: "Pick a quality to download, or view the details card.",
                            footer: botName,
                            buttons: qualityButtons,
                        },
                        msg
                    );

                    const actionListener = async (actionUpdate) => {
                        try {
                            const actionMsg = actionUpdate.messages?.[0];
                            if (!actionMsg?.message || actionMsg.key.remoteJid !== from) return;

                            const actionCtx = getReplyContext(actionMsg.message);
                            if (!actionCtx || actionCtx.stanzaId !== qualityMsg.key.id) return;

                            const actionBody = getReplyBody(actionMsg.message);

                            // "Details card" is always the last option (index = downloads.length)
                            const detailsIndex = downloads.length;
                            const isDetails =
                                actionBody === "cinesubz_details_card" ||
                                (parseInt(actionBody, 10) === detailsIndex + 1 && String(parseInt(actionBody, 10)) === actionBody.trim());

                            if (isDetails) {
                                conn.ev.off("messages.upsert", actionListener);
                                await conn.sendMessage(from, { react: { text: "📋", key: actionMsg.key } });
                                await conn.sendMessage(
                                    from,
                                    { image: { url: posterUrl }, caption: buildDetailsCaption(movie) },
                                    { quoted: actionMsg }
                                );
                                return;
                            }

                            const qIndex = resolveIndex(actionBody, "cinesubz_quality", downloads.length);
                            if (qIndex === -1) return;

                            conn.ev.off("messages.upsert", actionListener);
                            const selectedQuality = downloads[qIndex];
                            await conn.sendMessage(from, { react: { text: "⏳", key: actionMsg.key } });

                            const finalLink = selectedQuality.link;
                            if (!finalLink) throw new Error("No download link found for this quality");

                            const links = await retry(() => getDownloadLinks(finalLink), 3, 2000);
                            const usableUrl = selectBestLink(links);
                            if (!usableUrl) throw new Error("No usable download link found");

                            const thumbnail = await getThumbnail(posterUrl).catch(() => null);
                            const safeTitle = title.replace(/[^\w\s]/g, "");
                            const fileName = `🎬${botName}🎬${safeTitle} (${selectedQuality.quality}).mkv`;

                            await conn.sendMessage(
                                from,
                                {
                                    document: { url: usableUrl },
                                    mimetype: "video/mp4",
                                    fileName,
                                    jpegThumbnail: thumbnail,
                                    caption: `*𝗧ɪᴛʟᴇ : ${title}*\n\n\`[${selectedQuality.quality} ${selectedQuality.size || "N/A"}]\`\n\n*⏤͟͟͞͞★❮ ${botName} 〽️𝗢𝗩𝗜𝗘𝗦 ❯⏤͟͟͞͞★*`,
                                },
                                { quoted: actionMsg }
                            );
                        } catch (err) {
                            console.error("[cinesubz] Action error:", err);
                            conn.ev.off("messages.upsert", actionListener);
                            await conn.sendMessage(from, { text: `❌ Failed: ${err.message}` });
                        }
                    };

                    conn.ev.on("messages.upsert", actionListener);
                    setTimeout(() => conn.ev.off("messages.upsert", actionListener), LISTENER_TIMEOUT);
                } catch (err) {
                    console.error("[cinesubz] Movie selection error:", err);
                    conn.ev.off("messages.upsert", movieListener);
                    await conn.sendMessage(from, { text: `❌ Failed to process movie: ${err.message}` });
                }
            };

            conn.ev.on("messages.upsert", movieListener);
            setTimeout(() => conn.ev.off("messages.upsert", movieListener), LISTENER_TIMEOUT);
        } catch (err) {
            console.error("[cinesubz] Command error:", err);
            await reply(`❌ ERROR: ${err.message}`);
        }
    }
);

module.exports = {};
