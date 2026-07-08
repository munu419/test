const { cmd } = require("../command");
const axios = require("axios");
const sharp = require("sharp");
const config = require("../config");

const API_BASE = "https://dinka-main-2-zip--nikaluffy5000.replit.app";
const CHANNEL = "https://whatsapp.com/channel/0029Vb8VPsxBKfi2WHCVgV0J";

cmd({
    pattern: "dinka",
    alias: ["dk", "dinkafilm"],
    react: "🎬",
    desc: "Search and download movies from DinkaMovies.",
    category: "movie",
    filename: __filename,
}, async (bot, mek, m, { from, q, reply, prefix, userSettings }) => {

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    async function retry(fn, retries = 3, baseDelay = 2000) {
        for (let i = 1; i <= retries; i++) {
            try {
                return await fn();
            } catch (err) {
                console.error(`Attempt ${i} failed:`, err.message);
                if (i === retries) throw err;
                await sleep(baseDelay * i);
            }
        }
    }

    // ── API helpers ────────────────────────────────────────────────────────────

    async function searchMovies(query) {
        const { data } = await axios.get(`${API_BASE}/`, {
            params: { action: "search", query },
            timeout: 30000
        });
        if (!data.status) throw new Error("Search API returned error");
        return data.data || [];
    }

    async function getMovieInfo(url) {
        const { data } = await axios.get(`${API_BASE}/`, {
            params: { action: "movie", url },
            timeout: 30000
        });
        if (!data.status) throw new Error("Movie API returned error");
        return data.data;
    }

    async function resolveDownloadLink(url) {
        const { data } = await axios.get(`${API_BASE}/`, {
            params: { action: "resolve", url },
            timeout: 90000
        });
        if (!data.status) throw new Error(data.error || "Resolve API returned error");
        return data.data || null; // { link, type, fileName, fileSize, page_title }
    }

    // Sort qualities highest resolution first — same convention as cinesubz.js
    function sortByQualityDesc(list) {
        return [...list].sort((a, b) => {
            const getRes = (q) => parseInt(q?.quality?.match(/\d+/)?.[0]) || 0;
            return getRes(b) - getRes(a);
        });
    }

    async function sendFileAsStream(to, downloadUrl, fileName, caption, thumbnail, quoted) {
        try {
            const response = await axios.get(downloadUrl, {
                responseType: "stream",
                timeout: 120000,
                maxRedirects: 5,
                headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
            });
            await bot.sendMessage(to, {
                document: { stream: response.data },
                mimetype: "video/mp4",
                fileName,
                caption,
                jpegThumbnail: thumbnail
            }, { quoted });
        } catch (err) {
            console.warn("Stream failed, trying URL directly:", err.message);
            await bot.sendMessage(to, {
                document: { url: downloadUrl },
                mimetype: "video/mp4",
                fileName,
                caption,
                jpegThumbnail: thumbnail
            }, { quoted });
        }
    }

    async function getThumbnail(imageUrl) {
        try {
            const response = await axios.get(imageUrl, {
                responseType: "arraybuffer",
                timeout: 15000
            });
            return await sharp(response.data)
                .resize(320, 320, { fit: "cover" })
                .jpeg({ quality: 70 })
                .toBuffer();
        } catch (err) {
            console.warn("⚠️ Thumbnail generation failed:", err.message);
            return null;
        }
    }

    // Full-size poster buffer for caption images — sending { url } directly lets
    // WhatsApp fetch the remote link itself, which renders as a stuck blurred
    // preview. Downloading the bytes ourselves and sending a Buffer avoids that.
    async function getPosterBuffer(url) {
        if (!url) return null;
        try {
            const res = await axios.get(url, {
                responseType: "arraybuffer",
                timeout: 15000,
                headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
            });
            return await sharp(res.data).jpeg({ quality: 90 }).toBuffer();
        } catch (e) {
            console.warn("Poster fetch error:", e.message);
            return null;
        }
    }

    // ── Main logic ─────────────────────────────────────────────────────────────

    try {
        const query = q.trim();
        if (!query) {
            return reply(
                `🎬 *DINKA MOVIES*\n\nExample: ${prefix}dinka Avatar`
            );
        }

        const settings = userSettings || global.CURRENT_BOT_SETTINGS || {};
        const isButtonsOn = settings.buttons === "true";
        const botName = settings.botName || config.DEFAULT_BOT_NAME || "DINKA-BOT";

        await bot.sendMessage(from, { react: { text: "🔎", key: mek.key } });

        const results = await retry(() => searchMovies(query), 3, 2000);
        if (!results || !results.length) {
            return reply("❎ No movies found.");
        }
        const displayResults = results.slice(0, 10);

        // ── BUTTON MODE ────────────────────────────────────────────────────────

        if (isButtonsOn) {
            const buttons = displayResults.map((r, i) => ({
                buttonId: `dinka_movie_${i}`,
                buttonText: { displayText: `🎬 ${r.title?.substring(0, 30)}` },
                type: 1
            }));

            const firstThumbUrl = displayResults.find(r => r.thumbnail)?.thumbnail || null;
            const firstThumbBuf = await getPosterBuffer(firstThumbUrl);
            const searchMsg = await bot.sendMessage(from, {
                ...(firstThumbBuf ? { image: firstThumbBuf } : firstThumbUrl ? { image: { url: firstThumbUrl } } : {}),
                caption: `🎬 *Dinka Movies Search Results*\n\nQuery: ${query}\nSelect a movie:`,
                buttons,
                headerType: (firstThumbBuf || firstThumbUrl) ? 4 : 1
            }, { quoted: mek });

            const movieListener = async (update) => {
                try {
                    const m = update.messages[0];
                    if (!m?.message?.buttonsResponseMessage) return;

                    const contextInfo = m.message.buttonsResponseMessage.contextInfo ||
                                       m.message.extendedTextMessage?.contextInfo;
                    if (!contextInfo || contextInfo.stanzaId !== searchMsg.key.id) return;

                    const btnId = m.message.buttonsResponseMessage.selectedButtonId;
                    if (!btnId?.startsWith("dinka_movie_")) return;

                    const index = parseInt(btnId.split("_")[2]);
                    const selected = displayResults[index];
                    if (!selected) return;

                    await bot.sendMessage(from, { react: { text: "⏳", key: m.key } });

                    const movie = await retry(() => getMovieInfo(selected.url), 3, 2000);
                    if (!movie) {
                        return await bot.sendMessage(from, { text: "❎ Failed to fetch movie details." });
                    }

                    const { title, poster, labels, meta, download_links, watch_link } = movie;
                    const downloads = sortByQualityDesc(download_links || []);

                    if (!downloads.length) {
                        return await bot.sendMessage(from, { text: "❎ No download links available." });
                    }

                    const metaStr = Object.entries(meta || {})
                        .map(([k, v]) => `▫️ *${k}* ➮ ${v}`)
                        .join("\n");

                    let fullCaption = `
╭━━━〔 🎬 DINKA MOVIES DETAILS 〕━━━⬣

☘️ 𝓣𝓲𝓽𝓵𝓮 ➮ ${title || "N/A"}
🏷️ 𝓛𝓪𝓫𝓮𝓵𝓼 ➮ ${(labels || []).join(", ") || "N/A"}
${metaStr}
⬇️ 𝓐𝓿𝓪𝓲𝓵𝓪𝓫𝓵𝓮 𝓠𝓾𝓪𝓵𝓲𝓽𝓲𝓮𝓼:
${downloads.map(d => `➤ ${d.quality}`).join("\n")}
╰━━━━━━━━━━━━━━━━━━⬣
✨ 𝓕𝓸𝓵𝓵𝓸𝔀 𝓾𝓼:
${CHANNEL}`.trim();

                    if (fullCaption.length > 4000) fullCaption = fullCaption.substring(0, 3970) + "…\n╰━━━━━━━━━━━━━━━━━━⬣";

                    const qualityButtons = downloads.map((dl, i) => ({
                        buttonId: `dinka_quality_${i}`,
                        buttonText: {
                            displayText: dl.quality?.includes("1080") ? `🔥 ${dl.quality}` :
                                         dl.quality?.includes("720")  ? `⚡ ${dl.quality}` :
                                         `⬇️ ${dl.quality}`
                        },
                        type: 1
                    }));

                    qualityButtons.unshift({
                        buttonId: "dinka_details_card",
                        buttonText: { displayText: "📑 Details Card" },
                        type: 1
                    });

                    const posterUrl = poster || null;
                    const posterBuf = await getPosterBuffer(posterUrl);

                    const qualityMsg = await bot.sendMessage(from, {
                        ...(posterBuf ? { image: posterBuf } : posterUrl ? { image: { url: posterUrl } } : {}),
                        caption: fullCaption,
                        buttons: qualityButtons,
                        headerType: (posterBuf || posterUrl) ? 4 : 1
                    }, { quoted: mek });

                    bot.ev.off("messages.upsert", movieListener);

                    const actionListener = async (actionUpdate) => {
                        try {
                            const actionMsg = actionUpdate.messages[0];
                            if (!actionMsg?.message?.buttonsResponseMessage) return;

                            const ctx = actionMsg.message.buttonsResponseMessage.contextInfo ||
                                        actionMsg.message.extendedTextMessage?.contextInfo;
                            if (!ctx || ctx.stanzaId !== qualityMsg.key.id) return;

                            const actionBtnId = actionMsg.message.buttonsResponseMessage.selectedButtonId;

                            if (actionBtnId === "dinka_details_card") {
                                await bot.sendMessage(from, { react: { text: "📋", key: actionMsg.key } });
                                const cleanDetailsCaption = `*☘️ 𝗧ɪᴛʟᴇ : ${title || "N/A"}*

*▫️🏷️ 𝗟𝗮𝗯𝗲𝗹𝘀 ➟ ${(labels || []).join(", ") || "N/A"}*
${metaStr}

*➟➟➟➟➟➟➟➟➟➟➟➟➟➟➟*
*👥 𝙵𝙾𝙻𝙻𝙾𝚆 𝙾𝚄𝚁 𝙲𝙷𝙰𝙽𝙽𝙴𝙻 ➟* ${CHANNEL}
*➟➟➟➟➟➟➟➟➟➟➟➟➟➟➟*`.trim();
                                await bot.sendMessage(from, {
                                    ...(posterBuf ? { image: posterBuf } : posterUrl ? { image: { url: posterUrl } } : {}),
                                    caption: cleanDetailsCaption
                                }, { quoted: actionMsg });
                                return;
                            }

                            if (!actionBtnId?.startsWith("dinka_quality_")) return;

                            const qIndex = parseInt(actionBtnId.split("_")[2]);
                            const selectedQuality = downloads[qIndex];
                            if (!selectedQuality) throw new Error("Invalid quality selection");

                            await bot.sendMessage(from, { react: { text: "⏳", key: actionMsg.key } });

                            const resolved = await retry(() => resolveDownloadLink(selectedQuality.link), 3, 5000);
                            if (!resolved?.link) throw new Error("No usable download link found");

                            let thumbnail = null;
                            try { thumbnail = await getThumbnail(posterUrl); } catch (e) {}

                            const safeTitle = (title || "movie").replace(/[^\w\s]/g, "");
                            const fileName = resolved.fileName || `🎬${botName}🎬${safeTitle} (${selectedQuality.quality}).mp4`;
                            const caption = `*𝗧ɪᴛʟᴇ : ${title || "N/A"}*\n\n \`[${selectedQuality.quality}${resolved.fileSize ? " • " + resolved.fileSize : ""}]\` \n\n*⏤͟͟͞͞★❮ ${botName} 〽️𝗢𝗩𝗜𝗘𝗦 ❯⏤͟͟͞͞★*`;

                            await bot.sendMessage(from, { text: `⏳ Sending file...\n📁 ${fileName}${resolved.fileSize ? "\n💾 " + resolved.fileSize : ""}` }, { quoted: actionMsg });
                            await sendFileAsStream(from, resolved.link, `🎬${botName}🎬${fileName}`, caption, thumbnail, actionMsg);

                            bot.ev.off("messages.upsert", actionListener);

                        } catch (err) {
                            console.error("Action error:", err);
                            await bot.sendMessage(from, { text: `❌ Failed: ${err.message}` });
                            bot.ev.off("messages.upsert", actionListener);
                        }
                    };

                    bot.ev.on("messages.upsert", actionListener);
                    setTimeout(() => bot.ev.off("messages.upsert", actionListener), 300000);

                } catch (err) {
                    console.error("Movie selection error:", err);
                    await bot.sendMessage(from, { text: `❌ Failed to process movie: ${err.message}` });
                }
            };

            bot.ev.on("messages.upsert", movieListener);
            setTimeout(() => bot.ev.off("messages.upsert", movieListener), 300000);
            return;
        }

        // ── TEXT MODE (Buttons OFF) ────────────────────────────────────────────

        let searchList = `🎬 *Dinka Movies Search Results*\n\nQuery: ${query}\n\n`;
        displayResults.forEach((r, i) => {
            searchList += `${i + 1}️⃣ ${r.title}\n`;
        });
        searchList += `\nReply with the number (1-${displayResults.length}).`;

        const firstThumbUrl = displayResults.find(r => r.thumbnail)?.thumbnail || null;
        const firstThumbBuf = await getPosterBuffer(firstThumbUrl);
        const searchMsg = await bot.sendMessage(from, {
            ...(firstThumbBuf ? { image: firstThumbBuf } : firstThumbUrl ? { image: { url: firstThumbUrl } } : {}),
            caption: searchList
        }, { quoted: mek });

        const movieTextListener = async (update) => {
            try {
                const m = update.messages[0];
                if (!m?.message) return;
                const body = m.message.conversation || m.message.extendedTextMessage?.text;
                if (!body) return;

                const contextInfo = m.message.extendedTextMessage?.contextInfo;
                if (!contextInfo || contextInfo.stanzaId !== searchMsg.key.id) return;

                const selectedNum = parseInt(body.trim());
                if (isNaN(selectedNum) || selectedNum < 1 || selectedNum > displayResults.length) return;

                const selected = displayResults[selectedNum - 1];
                if (!selected) return;

                await bot.sendMessage(from, { react: { text: "⏳", key: m.key } });

                const movie = await retry(() => getMovieInfo(selected.url), 3, 2000);
                if (!movie) {
                    return await bot.sendMessage(from, { text: "❎ Failed to fetch movie details." });
                }

                const { title, poster, labels, meta, download_links } = movie;
                const downloads = sortByQualityDesc(download_links || []);

                if (!downloads.length) {
                    return await bot.sendMessage(from, { text: "❎ No download links available." });
                }

                const metaStr = Object.entries(meta || {})
                    .map(([k, v]) => `▫️ *${k}* ➮ ${v}`)
                    .join("\n");

                const posterUrl = poster || null;
                const posterBuf = await getPosterBuffer(posterUrl);

                let qualityList = `🎬 *${title}*\n\n🏷️ ${(labels || []).join(", ")}\n\n📋 *Available Qualities:*\n`;
                let qIdx = 1;
                downloads.forEach((d) => {
                    qualityList += `${qIdx++}️⃣ ${d.quality}\n`;
                });
                qualityList += `\n${qIdx}️⃣ 📑 Details Card\n`;
                qualityList += `\nReply with the number (1-${qIdx}).`;

                const qualityMsg = await bot.sendMessage(from, {
                    ...(posterBuf ? { image: posterBuf } : posterUrl ? { image: { url: posterUrl } } : {}),
                    caption: qualityList
                }, { quoted: mek });

                bot.ev.off("messages.upsert", movieTextListener);

                const qualityTextListener = async (update2) => {
                    try {
                        const m2 = update2.messages[0];
                        if (!m2?.message) return;
                        const body2 = m2.message.conversation || m2.message.extendedTextMessage?.text;
                        if (!body2) return;

                        const ctx2 = m2.message.extendedTextMessage?.contextInfo;
                        if (!ctx2 || ctx2.stanzaId !== qualityMsg.key.id) return;

                        const selectedNum2 = parseInt(body2.trim());
                        if (isNaN(selectedNum2)) return;

                        if (selectedNum2 === downloads.length + 1) {
                            await bot.sendMessage(from, { react: { text: "📋", key: m2.key } });
                            const cleanDetailsCaption = `*☘️ 𝗧ɪᴛʟᴇ : ${title || "N/A"}*

*▫️🏷️ 𝗟𝗮𝗯𝗲𝗹𝘀 ➟ ${(labels || []).join(", ") || "N/A"}*
${metaStr}

*➟➟➟➟➟➟➟➟➟➟➟➟➟➟➟*
*👥 𝙵𝙾𝙻𝙻𝙾𝚆 𝙾𝚄𝚁 𝙲𝙷𝙰𝙽𝙽𝙴𝙻 ➟* ${CHANNEL}
*➟➟➟➟➟➟➟➟➟➟➟➟➟➟➟*`.trim();
                            await bot.sendMessage(from, {
                                ...(posterBuf ? { image: posterBuf } : posterUrl ? { image: { url: posterUrl } } : {}),
                                caption: cleanDetailsCaption
                            }, { quoted: m2 });
                            bot.ev.off("messages.upsert", qualityTextListener);
                            return;
                        }

                        if (selectedNum2 < 1 || selectedNum2 > downloads.length) return;
                        const selectedQuality = downloads[selectedNum2 - 1];
                        if (!selectedQuality) return;

                        await bot.sendMessage(from, { react: { text: "⏳", key: m2.key } });

                        const resolved = await retry(() => resolveDownloadLink(selectedQuality.link), 3, 5000);
                        if (!resolved?.link) throw new Error("No usable download link found");

                        let thumbnail = null;
                        try { thumbnail = await getThumbnail(posterUrl); } catch (e) {}

                        const safeTitle = (title || "movie").replace(/[^\w\s]/g, "");
                        const fileName = resolved.fileName || `🎬${botName}🎬${safeTitle} (${selectedQuality.quality}).mp4`;
                        const caption = `*𝗧ɪᴛʟᴇ : ${title || "N/A"}*\n\n \`[${selectedQuality.quality}${resolved.fileSize ? " • " + resolved.fileSize : ""}]\` \n\n*⏤͟͟͞͞★❮ ${botName} 〽️𝗢𝗩𝗜𝗘𝗦 ❯⏤͟͟͞͞★*`;

                        await bot.sendMessage(from, { text: `⏳ Sending file...\n📁 ${fileName}${resolved.fileSize ? "\n💾 " + resolved.fileSize : ""}` }, { quoted: m2 });
                        await sendFileAsStream(from, resolved.link, `🎬${botName}🎬${fileName}`, caption, thumbnail, m2);

                        bot.ev.off("messages.upsert", qualityTextListener);

                    } catch (err) {
                        console.error("Quality text error:", err);
                        await bot.sendMessage(from, { text: `❌ Failed: ${err.message}` });
                        bot.ev.off("messages.upsert", qualityTextListener);
                    }
                };

                bot.ev.on("messages.upsert", qualityTextListener);
                setTimeout(() => bot.ev.off("messages.upsert", qualityTextListener), 300000);

            } catch (err) {
                console.error("Movie text selection error:", err);
                await bot.sendMessage(from, { text: `❌ Failed to process movie: ${err.message}` });
            }
        };

        bot.ev.on("messages.upsert", movieTextListener);
        setTimeout(() => bot.ev.off("messages.upsert", movieTextListener), 300000);

    } catch (err) {
        console.error("Command error:", err);
        await bot.sendMessage(from, { text: `❌ ERROR: ${err.message}` });
    }
});

module.exports = {};
