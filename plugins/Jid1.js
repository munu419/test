const { cmd } = require("../command");

cmd({
    pattern: "jid",
    desc: "Show full JID information including names and types",
    category: "owner",
    react: "🆔",
    filename: __filename
}, async (conn, mek, m, { from, isGroup, sender, reply }) => {
    try {
        const remoteJid = from;

        // ✅ Chat Type detect
        const isChannel = remoteJid.endsWith("@newsletter");
        const isPrivate = !isGroup && !isChannel;

        // ✅ Sender JID — LID ඉවත් කර numbers only + @s.whatsapp.net
        const rawParticipant = mek.key.participant || mek.key.remoteJid || "";
        const cleanNumber = rawParticipant.replace(/@.*/, "").replace(/[^0-9]/g, "");
        const senderJid = cleanNumber + "@s.whatsapp.net";

        // ✅ Bot JID
        const botNumber = (conn.user.id || "").replace(/@.*/, "").replace(/[^0-9]/g, "");
        const botJid = botNumber + "@s.whatsapp.net";

        // ✅ Group Name
        let groupName = "N/A";
        if (isGroup) {
            try {
                const metadata = await conn.groupMetadata(remoteJid);
                groupName = metadata.subject || "Unnamed Group";
            } catch {
                groupName = "Unable to fetch";
            }
        }

        // ✅ Channel Name
        let channelName = "N/A";
        if (isChannel) {
            try {
                const meta = await conn.newsletterMetadata("invite", remoteJid);
                channelName = meta?.name || "Unknown Channel";
            } catch {
                channelName = "Unable to fetch";
            }
        }

        const senderName = mek.pushName || "Unknown";

        // ✅ Chat Type Label
        const chatType = isGroup
            ? "🏘️ Group"
            : isChannel
            ? "📢 Channel"
            : "🔒 Private";

        const text = `🔍 *JID FULL DETAILS*

${isGroup   ? `👥 *Group Name:* ${groupName}\n👥 *Group JID:* ${remoteJid}` : ""}
${isChannel ? `📢 *Channel Name:* ${channelName}\n📢 *Channel JID:* ${remoteJid}` : ""}
${isPrivate ? `🔒 *Private JID:* ${remoteJid}` : ""}

👤 *Sender Name:* ${senderName}
👤 *Sender JID:* ${senderJid}
🤖 *Bot JID:* ${botJid}
💬 *Chat Type:* ${chatType}
🕐 *Message ID:* ${mek.key.id}`;

        await conn.sendMessage(remoteJid, { text }, { quoted: mek });

    } catch (e) {
        console.error("jid cmd error:", e);
        reply("❌ Error: " + e.message);
    }
});