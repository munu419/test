const { cmd, commands } = require("../command");
const axios = require("axios");

// ----- Multi-Reply Smart Waiter (Anime plugin logic) -----
function waitForReply(conn, from, sender, targetId) {
    return new Promise((resolve) => {
        const handler = (update) => {
            const msg = update.messages?.[0];
            if (!msg?.message) return;

            const text = msg.message.conversation || msg.message?.extendedTextMessage?.text || "";
            const context = msg.message?.extendedTextMessage?.contextInfo;
            const msgSender = msg.key.participant || msg.key.remoteJid;
            
            const isTargetReply = context?.stanzaId === targetId;
            const isCorrectUser = msgSender.includes(sender.split('@')[0]) || msgSender.includes("@lid");

            if (msg.key.remoteJid === from && isCorrectUser && isTargetReply && !isNaN(text)) {
                resolve({ msg, text: text.trim() });
            }
        };
        conn.ev.on("messages.upsert", handler);
        setTimeout(() => { conn.ev.off("messages.upsert", handler); }, 600000); 
    });
}

cmd({
    pattern: "movie",
    alias: ["movie5"],
    desc: "Ultimate Multi-reply movie engine with fixed UI",
    category: "downloader",
    react: "🎬",
    filename: __filename,
}, async (conn, mek, m, { from, q, reply, sender }) => {
    try {
        if (!q) return reply("❗ කරුණාකර සෙවිය යුතු ෆිල්ම් එකේ නම ලබා දෙන්න.");

        const posterUrl = "https://files.catbox.moe/d0v6fe.png";

        // --- Premium UI Design ---
        let menu = `🎬 *𝐒𝐀𝐘𝐔𝐑𝐀 𝐌𝐃 𝐌𝐎𝐕𝐈𝐄 𝐄𝐍𝐆𝐈𝐍𝐄* 🎬
   *🔍 සෙවුම:* _${q.toUpperCase()}_
  *Select your movie source below:*
 ┌──────────────┈⊷
  │  𝟎𝟏 ┋ *Sinhalasub*
  │  𝟎𝟐 ┋ *Cinesubz*
  │  𝟎𝟑 ┋ *Dinka Sinhalasub*
  │  𝟎𝟒 ┋ *SL Anime Club*
  │  𝟎𝟓 ┋ *Pirate.lk*
  │  𝟎𝟔 ┋ *Moviesublk*
  └──────────────┈⊷ 
   *අංකය Reply කරන්න.*
  _(SAYURA MD MOVIE LK🔥)_
         *ᴘᴏᴡᴇʀᴇᴅ ʙʏ sᴀʏᴜʀᴀ ᴍɪʜɪʀᴀɴɢᴀ*`;

        // Image එකක් ලෙස යැවීමෙන් පින්තූරය නොපෙනී යාමේ ගැටලුව ස්ථිරවම විසඳේ.
        const listMsg = await conn.sendMessage(from, { 
            image: { url: posterUrl }, 
            caption: menu 
        }, { quoted: m });

        // --- Multi-Reply Flow Control ---
        const startFlow = async () => {
            while (true) {
                const selection = await waitForReply(conn, from, sender, listMsg.key.id);
                if (!selection) break;

                (async () => {
                    let targetPattern = "";
                    const selText = selection.text;

                    if (selText === '1') targetPattern = "sinhalasub";
                    else if (selText === '2') targetPattern = "cinesubz";
                    else if (selText === '3') targetPattern = "dinka";
                    else if (selText === '4') targetPattern = "anime";
                    else if (selText === '5') targetPattern = "pirate";
                    else if (selText === '6') targetPattern = "moviesub";

                    if (targetPattern) {
                        await conn.sendMessage(from, { react: { text: "🔍", key: selection.msg.key } });
                        
                        const selectedCmd = commands.find((c) => c.pattern === targetPattern);
                        if (selectedCmd) {
                            // මෙතනදී q: q ලබා දීමෙන් මුල් සෙවුම් නමම පාවිච්චි වේ.
                            await selectedCmd.function(conn, selection.msg, selection.msg, { 
                                from, 
                                q: q, 
                                reply, 
                                isGroup: m.isGroup, 
                                sender: m.sender, 
                                pushname: m.pushname 
                            });
                        }
                    }
                })();
            }
        };

        startFlow();

    } catch (e) {
        console.error("Movie Engine Error:", e);
    }
});
