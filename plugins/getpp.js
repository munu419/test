const { cmd } = require('../command');
const config = require('../config');

cmd({
    pattern: "getpp",
    react: "🖼️",
    desc: "Send profile picture by phone number",
    category: "owner",
    use: ".getpp <phone number>",
    filename: __filename
},
async (conn, mek, m, { from, quoted, args, q, isOwner, reply }) => {

    try {

        // Owner check
        if (!isOwner) return reply("🛑 This command is only for the bot owner!");

        // Input from reply / mention / args
        let input = q || 
            (quoted && quoted.sender) || 
            (m.mentionedJid && m.mentionedJid[0]);

        if (!input && args.length > 0) {
            input = args.join("");
        }

        if (!input) {
            return reply("📱 Provide a phone number!\nExample: .getpp 947XXXXXXXX");
        }

        const cleanNumber = input.replace(/[^0-9]/g, "");

        if (cleanNumber.length < 5 || cleanNumber.length > 15) {
            return reply("❌ Invalid phone number!");
        }

        const targetJid = cleanNumber + "@s.whatsapp.net";

        let ppUrl;
        try {
            ppUrl = await conn.profilePictureUrl(targetJid, "image");
        } catch (err) {
            return reply("🖼️ User has no profile picture or privacy restricted!");
        }

        await conn.sendMessage(from, {
            image: { url: ppUrl },
            caption: `✅ *GETPP SUCCESS*\n\n👤 Number: ${cleanNumber}`
        }, { quoted: mek });

        await conn.sendMessage(from, {
            react: { text: "✅", key: mek.key }
        });

    } catch (err) {
        console.log("GetPP Error:", err);
        reply("🛑 Something went wrong!");
    }
});
