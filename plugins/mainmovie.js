const config = require("../config");
const { cmd, commands } = require("../command");
const { getBotName, getBotLogo } = require("../lib/settings");
const { runtime } = require("../lib/functions");

// ================= Category Order & Emojis =================
// අලුත් category එකක් plugin එකකට දැම්මොත්, මෙතන ලින් එකක් add කරන්න
// නැත්නම් "misc" tab එකට වැටෙයි.
const CATEGORY_ORDER = [
  "main",
  "movie",
  "downloader",
  "download",
  "tools",
  "utility",
  "group",
  "owner",
  "misc",
];

const CATEGORY_LABEL = {
  main: "🏠 MAIN",
  movie: "🎬 MOVIE",
  downloader: "⬇️ DOWNLOADER",
  download: "⬇️ DOWNLOAD",
  tools: "🛠️ TOOLS",
  utility: "🧰 UTILITY",
  group: "👥 GROUP",
  owner: "👑 OWNER",
  misc: "📂 OTHER",
};

function buildMenuText({ botName, prefix, pushname }) {
  // pattern හම්බුනොත් duplicate නොවෙන්න, dontAddCommandList වුනොත් menu එකේ නොපෙන්නෙන්න
  const grouped = {};
  for (const c of commands) {
    if (c.dontAddCommandList) continue;
    const cat = c.category || "misc";
    if (!grouped[cat]) grouped[cat] = [];
    // duplicate pattern (plugins දෙකකින්ම add උනොත්) skip කරන්න
    if (grouped[cat].some((x) => x.pattern === c.pattern)) continue;
    grouped[cat].push(c);
  }

  const orderedCats = [
    ...CATEGORY_ORDER.filter((c) => grouped[c]),
    ...Object.keys(grouped).filter((c) => !CATEGORY_ORDER.includes(c)),
  ];

  let totalCmds = 0;
  let body = "";
  for (const cat of orderedCats) {
    const list = grouped[cat].sort((a, b) => a.pattern.localeCompare(b.pattern));
    if (!list.length) continue;
    body += `\n╭─❍ ${CATEGORY_LABEL[cat] || "📂 " + cat.toUpperCase()} ❍\n`;
    for (const c of list) {
      totalCmds++;
      body += `│ ➤ ${prefix}${c.pattern}\n`;
    }
    body += `╰────────────────\n`;
  }

  const uptime = runtime(process.uptime());

  const header = `╭━━━『 *${botName}* 』━━━╮
│ 👋 Hello *${pushname}*
│ ⚙️ Prefix   : *${prefix}*
│ 📦 Commands : *${totalCmds}*
│ ⏱️ Uptime   : *${uptime}*
╰━━━━━━━━━━━━━━━━━━━━╯
`;

  const footer = `
_command එකක් run කරන්න ${prefix}command-name ලෙස type කරන්න_
_උදා: ${prefix}alive_

> © 𝐏𝐎𝐖𝐄𝐑𝐄𝐃 𝐁𝐘 ${botName}`;

  return header + body + footer;
}

cmd(
  {
    pattern: "menu",
    alias: ["allmenu", "help", "commands"],
    desc: "Show all available commands",
    category: "main",
    react: "📜",
    filename: __filename,
  },
  async (conn, mek, m, { from, pushname, sessionId, reply }) => {
    try {
      const prefix = config.PREFIX || ".";
      const botName = getBotName(sessionId, config.PACKNAME || "KAVI X MD");
      const botLogo = getBotLogo(
        sessionId,
        config.MENU_IMG || config.ALIVE_IMG || "https://files.catbox.moe/kmfr8j.jpg"
      );

      const menuText = buildMenuText({
        botName,
        prefix,
        pushname: pushname || "User",
      });

      try {
        return await conn.sendMessage(
          from,
          { image: { url: botLogo }, caption: menuText },
          { quoted: mek }
        );
      } catch (imgErr) {
        console.log("[menu] image send failed, falling back to text:", imgErr.message);
        return await conn.sendMessage(from, { text: menuText }, { quoted: mek });
      }
    } catch (e) {
      console.log("[menu] error:", e);
      reply(`❌ Error: ${e.message || e}`);
    }
  }
);
