// plugins/settings.js
// Owner-only commands to change the bot's WhatsApp display name and profile
// picture (logo). Also stores the new name/logo so .alive / .owner / .menu
// can show the updated branding.

const { cmd } = require("../command");
const config = require("../config");
const axios = require("axios");
const { getSettings, updateSettings } = require("../lib/settings");

// ═══════════════════════════════════════════
//  .setbotname <new name>
// ═══════════════════════════════════════════
cmd({
  pattern: "setbotname",
  alias: ["setname", "changename"],
  desc: "Change the bot's WhatsApp display name",
  category: "owner",
  react: "✏️",
  filename: __filename
}, async (conn, mek, m, { isOwner, reply, sessionId, q }) => {
  try {
    if (!isOwner) return reply("❌ මේ command එක owner ට විතරයි.");

    const newName = (q || "").trim();
    if (!newName) {
      return reply("✏️ අලුත් bot name එක දෙන්න.\n\n*Example:* .setbotname Sayura Cinema MD");
    }
    if (newName.length > 25) {
      return reply("❌ Name එක වචන 25කට වඩා දිග වැඩියි. පොඩි කරලා ට්‍රයි කරන්න.");
    }

    // 1) Actually change the WhatsApp account's profile name
    try {
      await conn.updateProfileName(newName);
    } catch (e) {
      console.log("⚠️ updateProfileName failed:", e.message);
    }

    // 2) Save it so alive/owner/menu messages use the new name too
    updateSettings(sessionId, { botName: newName });

    return reply(`✅ Bot name සාර්ථකව *${newName}* ලෙස වෙනස් කළා.`);
  } catch (err) {
    console.log("[setbotname error]", err);
    reply(`❌ Error: ${err.message}`);
  }
});

// ═══════════════════════════════════════════
//  .setbotpic  (reply to an image, or give a direct image URL)
// ═══════════════════════════════════════════
cmd({
  pattern: "setbotpic",
  alias: ["setlogo", "setpp", "changelogo"],
  desc: "Change the bot's profile picture / logo",
  category: "owner",
  react: "🖼️",
  filename: __filename
}, async (conn, mek, m, { isOwner, reply, sessionId, q }) => {
  try {
    if (!isOwner) return reply("❌ මේ command එක owner ට විතරයි.");

    let buffer;
    let logoUrl;

    if (m.quoted && m.quoted.type === "imageMessage") {
      // Replied to an existing image
      buffer = await m.quoted.download();
    } else if (m.type === "imageMessage") {
      // Image sent directly with caption ".setbotpic"
      buffer = await m.download();
    } else if (q && /^https?:\/\//i.test(q.trim())) {
      // Direct image URL: .setbotpic https://...
      logoUrl = q.trim();
      const res = await axios.get(logoUrl, { responseType: "arraybuffer" });
      buffer = Buffer.from(res.data);
    }

    if (!buffer) {
      return reply(
        "🖼️ අලුත් logo photo එකකට *reply* කරලා *.setbotpic* කියලා යවන්න,\n" +
        "නැත්නම් image එකේම caption එක *.setbotpic* විදිහට යවන්න,\n" +
        "නැත්නම් *.setbotpic <image url>* විදිහට යවන්න."
      );
    }

    // 1) Actually change the WhatsApp account's profile picture
    await conn.updateProfilePicture(conn.user.id, { url: buffer });

    // 2) Save the logo URL (if a direct URL was given) so alive/menu can use it
    if (logoUrl) updateSettings(sessionId, { botLogo: logoUrl });

    return reply("✅ Bot logo සාර්ථකව වෙනස් කළා.");
  } catch (err) {
    console.log("[setbotpic error]", err);
    reply(`❌ Error: ${err.message}\n\n(Tip: WhatsApp profile picture update එකට image එක ටිකක් pause වෙලා try කරන්න.)`);
  }
});

// ═══════════════════════════════════════════
//  .botsettings — show current name/logo
// ═══════════════════════════════════════════
cmd({
  pattern: "botsettings",
  alias: ["mysettings"],
  desc: "Show the bot's current name/logo settings",
  category: "owner",
  react: "⚙️",
  filename: __filename
}, async (conn, mek, m, { isOwner, reply, sessionId }) => {
  if (!isOwner) return reply("❌ මේ command එක owner ට විතරයි.");

  const s = getSettings(sessionId);
  const name = s.botName || config.PACKNAME || "Not set";
  const logo = s.botLogo || config.ALIVE_IMG || "Not set";

  return reply(
    `⚙️ *Bot Settings*\n\n` +
    `📛 Name : ${name}\n` +
    `🖼️ Logo : ${logo}\n\n` +
    `_Change with .setbotname / .setbotpic_`
  );
});
