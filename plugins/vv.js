const { cmd } = require("../command");

cmd({
  pattern: "vv",
  alias: ["viewonce", "retrieve"],
  react: "🐳",
  desc: "Retrieve View Once",
  category: "tools",
  filename: __filename
}, async (conn, m, match) => {
  try {

    if (!m.quoted) return m.reply("🍁 Reply to a view once message!");

    const buffer = await m.quoted.download();
    const type = m.quoted.type;

    const target = m.sender; // ✅ Command eka use karapu kenata yanna

    if (type === "imageMessage") {
      return conn.sendMessage(target, {
        image: buffer,
        caption: m.quoted.msg?.caption || ""
      });
    }

    if (type === "videoMessage") {
      return conn.sendMessage(target, {
        video: buffer,
        caption: m.quoted.msg?.caption || ""
      });
    }

    if (type === "audioMessage") {
      return conn.sendMessage(target, {
        audio: buffer,
        mimetype: "audio/mpeg",
        ptt: false
      });
    }

    return m.reply("❌ Unsupported message type.");

  } catch (err) {
    console.log(err);
    m.reply("❌ Failed to retrieve message.");
  }
});
