const { cmd } = require("../command");
const config = require("../config");
const { getBotName, getBotLogo } = require("../lib/settings");

cmd({
    pattern: "owner",
    desc: "Show bot owner details",
    category: "main",
    react: "👑",
    filename: __filename
},
async (conn, mek, m, { from, pushname, sessionId }) => {
    try {

        const botName = getBotName(sessionId, "KAVI X MD");
        const imageUrl = getBotLogo(sessionId, "https://files.catbox.moe/kmfr8j.jpg");

        let dec = `
╔══════════════════════════╗
        👑 BOT OWNER 👑
╚══════════════════════════╝

👋 Hello ${pushname}

🎬 BOT        : ${botName}
🪪 NUMBER     : 0714390328
👤 OWNER      : Mr Kavi
🌍 COUNTRY    : Sri Lanka
🎂 AGE        : 18 – 25
⚡ ROLE       : Developer & Founder

━━━━━━━━━━━━━━━━━━
📢 Official Name :
${botName} OFFICIAL
━━━━━━━━━━━━━━━━━━

"Building the future of WhatsApp automation."

╔══════════════════════════╗
 © POWERED BY ${botName}
╚══════════════════════════╝
`;

        await conn.sendMessage(from, {
            image: { url: imageUrl },
            caption: dec
        }, { quoted: mek });

    } catch (e) {
        console.log(e);
    }
});
