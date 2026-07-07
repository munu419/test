// ================= Required Modules =================
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  jidNormalizedUser,
  getContentType,
  fetchLatestBaileysVersion,
  Browsers,
  proto,
  generateWAMessageFromContent,
} = require("@whiskeysockets/baileys");

// ── Suppress libsignal / Baileys noise logs ──
const _origWrite = process.stdout.write.bind(process.stdout);
const _origErrWrite = process.stderr.write.bind(process.stderr);
const SUPPRESS_PATTERNS = [
  "Bad MAC",
  "Failed to decrypt",
  "Session error",
  "Closing open session",
  "Closing session",
  "Decrypted message with closed session",
  "closed session",
  "SessionEntry",
  "no session",
  "No session",
  "Invalid PreKey",
  "decryptWithSessions",
  "ephemeralKeyPair",
  "lastRemoteEphemeralKey",
  "pendingPreKey",
  "remoteIdentityKey",
  "currentRatchet",
  "indexInfo",
  "baseKeyType",
  "_chains",
  "registrationId",
  "useNewUrlParser",
  "useUnifiedTopology",
  "MONGODB DRIVER",
  "session_cipher",
  "queue_job",
  "verifyMAC",
  "at async _asyncQueue",
  "at async SessionCipher",
  "at Object.verifyMAC",
];

function shouldSuppress(str) {
  if (typeof str !== "string") return false;
  return SUPPRESS_PATTERNS.some(p => str.includes(p));
}

process.stdout.write = function(chunk, encoding, cb) {
  try {
    if (shouldSuppress(String(chunk))) {
      if (typeof encoding === "function") encoding();
      else if (typeof cb === "function") cb();
      return true;
    }
    return _origWrite(chunk, encoding, cb);
  } catch (e) { return true; }
};

process.stderr.write = function(chunk, encoding, cb) {
  try {
    if (shouldSuppress(String(chunk))) {
      if (typeof encoding === "function") encoding();
      else if (typeof cb === "function") cb();
      return true;
    }
    return _origErrWrite(chunk, encoding, cb);
  } catch (e) { return true; }
};

const fs = require("fs");
const P = require("pino");
const path = require("path");
const express = require("express");
const config = require("./config");
const { sms } = require("./lib/msg");

// ================= AntiDelete Module =================
const antidelete = require("./plugins/antidelete");

// ================= Auto Forward Module =================
let handleAutoForward;
try { handleAutoForward = require("./plugins/forward").handleAutoForward; } catch {}

// ================= Global Variables =================
const ownerNumber = [config.OWNER_NUMBER || "94743826406"];
const botName = "KAVI X MD";

// Mongo නෑ දැන් — bot එකක් විතරයි run කරන්නේ, session එකත් එකයි.
// creds.json එක ඔයා manually ම දාන්නේ (own pairing site එකෙන්), QR/pairing logic කිසිම එකක් මෙතන නෑ.
const SESSION_ID = "main";

let botStarted = false;

// Local session folder — Mongo නෑ, creds.json එක ඔයා දාන්නේ මෙතනටම
const AUTH_FOLDER = path.join(__dirname, "auth_info_baileys");

// ================= Bot Context (Fake ID) =================
const chama = {
  key: {
    remoteJid: "status@broadcast",
    participant: "0@s.whatsapp.net",
    fromMe: false,
    id: "META_AI_FAKE_ID_TS",
  },
  message: {
    contactMessage: {
      displayName: botName,
      vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD`,
    },
  },
};

// ====================== LOCAL FOLDERS ======================
// Mega/Mongo කිසිම එකක් ඕන නෑ — folders ඔක්කොම local path එකෙන්ම use කරනවා.
// Folder නැත්නම් විතරක් හිස් folder එකක් auto create කරනවා.
const LOCAL_ONLY_FOLDERS = ["plugins", "lib", "auth_info_baileys", "data", "cookies", "sessions"];

function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function ensureBotFiles() {
  LOCAL_ONLY_FOLDERS.forEach(f => ensureDirSync(path.join(__dirname, f)));
  console.log("✅ All bot folders ready (local only, no Mega/Mongo).");
}
// ====================== END LOCAL FOLDERS ======================

// ═══════════════════════════════════════════════════
//  Body Extractor
// ═══════════════════════════════════════════════════
function extractBody(message) {
  if (!message) return "";
  const type = getContentType(message);

  if (type === "conversation")
    return message.conversation || "";

  if (type === "extendedTextMessage")
    return message.extendedTextMessage?.text || "";

  if (type === "buttonsResponseMessage")
    return message.buttonsResponseMessage?.selectedButtonId || "";

  if (type === "listResponseMessage")
    return message.listResponseMessage?.singleSelectReply?.selectedRowId || "";

  if (type === "templateButtonReplyMessage")
    return message.templateButtonReplyMessage?.selectedId || "";

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

  if (type === "imageMessage") return message.imageMessage?.caption || "";
  if (type === "videoMessage") return message.videoMessage?.caption || "";

  return "";
}

// ═══════════════════════════════════════════════════
//  Global Button State
// ═══════════════════════════════════════════════════
const buttonStateMap = new Map();
const buttonStateDir = path.join(__dirname, "./data");

function getButtonStateFile(sid) {
  return path.join(buttonStateDir, "button_state_" + sid + ".json");
}

global.isButtonEnabled = function(sessionId) {
  if (buttonStateMap.has(sessionId)) return buttonStateMap.get(sessionId);
  try {
    const file = getButtonStateFile(sessionId);
    if (fs.existsSync(file)) {
      const val = JSON.parse(fs.readFileSync(file, "utf8")).enabled;
      buttonStateMap.set(sessionId, val);
      return val;
    }
  } catch {}
  return true;
};

global.setButtonState = function(sessionId, value) {
  buttonStateMap.set(sessionId, value);
  try {
    if (!fs.existsSync(buttonStateDir)) fs.mkdirSync(buttonStateDir, { recursive: true });
    fs.writeFileSync(getButtonStateFile(sessionId), JSON.stringify({ enabled: value }, null, 2));
  } catch (e) { console.error("Button state save error:", e.message); }
};

function buildFallback(options) {
  let text = "";
  if (options.header) text += `*${options.header}*\n\n`;
  text += (options.body || "");
  if (options.buttons?.length) {
    text += "\n\n";
    options.buttons.forEach((b, i) => { text += `*${i + 1}.* ${b.text}\n`; });
    text += "\n_Reply with number_";
  }
  if (options.sections?.length) {
    text += "\n\n";
    let c = 1;
    options.sections.forEach(sec => {
      if (sec.title) text += `*${sec.title}*\n`;
      sec.rows?.forEach(row => {
        text += `*${c}.* ${row.title}`;
        if (row.description) text += ` — ${row.description}`;
        text += "\n";
        c++;
      });
    });
    text += "\n_Reply with number_";
  }
  if (options.footer) text += `\n\n${options.footer}`;
  return text;
}

global.sendInteractiveButtons = async function (conn, jid, options, quotedMsg) {
  const _sid = options._sessionId;
  if (!global.isButtonEnabled(_sid)) {
    const fallbackText = buildFallback(options);
    return await conn.sendMessage(jid, { text: fallbackText }, { quoted: quotedMsg });
  }

  try {
    const buttons = [];

    if (options.buttons?.length) {
      options.buttons.forEach(btn => {
        buttons.push({
          name: "cta_reply",
          buttonParamsJson: JSON.stringify({ display_text: btn.text, id: btn.id })
        });
      });
    }

    if (options.sections?.length) {
      buttons.push({
        name: "single_select",
        buttonParamsJson: JSON.stringify({
          title: options.listTitle || "Select",
          sections: options.sections
        })
      });
    }

    if (options.url) {
      buttons.push({
        name: "cta_url",
        buttonParamsJson: JSON.stringify({
          display_text: options.url.text || "Open Link",
          url: options.url.link,
          merchant_url: options.url.link
        })
      });
    }

    if (options.copy) {
      buttons.push({
        name: "cta_copy",
        buttonParamsJson: JSON.stringify({
          display_text: options.copy.text || "Copy",
          copy_code: options.copy.value
        })
      });
    }

    const interactiveMsg = generateWAMessageFromContent(jid, {
      messageContextInfo: {
        deviceListMetadata: {},
        deviceListMetadataVersion: 2
      },
      interactiveMessage: proto.Message.InteractiveMessage.create({
        body:   proto.Message.InteractiveMessage.Body.create({ text: options.body || "" }),
        footer: proto.Message.InteractiveMessage.Footer.create({ text: options.footer || botName }),
        header: proto.Message.InteractiveMessage.Header.create({
          hasMediaAttachment: false,
          title: options.header || ""
        }),
        nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
          buttons: buttons,
          messageParamsJson: ""
        })
      })
    }, { quoted: quotedMsg, userJid: conn.user?.id });

    await conn.relayMessage(jid, interactiveMsg.message, {
      messageId: interactiveMsg.key.id
    });

    console.log("✅ Interactive button sent");
    return interactiveMsg;

  } catch (err) {
    console.error("❌ Interactive Button Error:", err.message);
    const fallbackText = buildFallback(options);
    return await conn.sendMessage(jid, { text: fallbackText }, { quoted: quotedMsg });
  }
};

// ================= Single Bot Instance Start =================

async function startBot() {
  if (botStarted) return;

  const credsPath = path.join(AUTH_FOLDER, "creds.json");
  if (!fs.existsSync(credsPath)) {
    console.log("⏳ auth_info_baileys/creds.json තාම නෑ. ඔයාගේ pairing site එකෙන් හදාගත්ත creds.json එක auth_info_baileys/ folder එකට දාන්න — restart නොකරම, 10s කින් auto-detect වෙයි.");
    setTimeout(() => startBot(), 10000);
    return;
  }

  botStarted = true;

  const prefix = config.PREFIX || ".";
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const { version } = await fetchLatestBaileysVersion();

  const conn = makeWASocket({
    logger: P({ level: "silent" }),
    printQRInTerminal: false,
    browser: Browsers.macOS("Firefox"),
    syncFullHistory: false,
    auth: state,
    version,
  });

  console.log(`🚀 Starting bot session: ${SESSION_ID}`);

  conn.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      botStarted = false;
      if (shouldReconnect) {
        console.log(`🔄 Reconnecting: ${SESSION_ID}`);
        setTimeout(() => startBot(), 8000);
      } else {
        console.log(`❌ Logged Out: ${SESSION_ID}. auth_info_baileys/creds.json එක delete කරලා අලුත් session එකක් දාන්න.`);
      }
    } else if (connection === "open") {
      console.log(`✅ Connected: ${SESSION_ID} (${conn.user.id.split(":")[0]})`);

      const upMsg = `${botName} Connected ✅\nPrefix: ${prefix}`;
      try {
        await conn.sendMessage(ownerNumber[0] + "@s.whatsapp.net", { text: upMsg });
      } catch (e) {}

      try {
        const channelId = "0029Vb7Cx5gJENxwXCJaXk2I";
        await conn.newsletterFollow(`${channelId}@newsletter`);
        console.log(`📢 Channel followed: ${SESSION_ID}`);
      } catch (e) {}
    }
  });

  conn.ev.on("creds.update", saveCreds);

  conn.ev.on("messages.update", async (updates) => {
    await antidelete.onDelete(conn, updates, SESSION_ID);
  });

  conn.ev.on("messages.upsert", async (mkk) => {
    try {
      let mek = mkk.messages[0];
      if (!mek?.message) return;

      const msgKeys = Object.keys(mek.message);
      if (
        msgKeys.includes("senderKeyDistributionMessage") ||
        msgKeys.includes("protocolMessage") ||
        (msgKeys.length === 1 && msgKeys[0] === "messageContextInfo")
      ) return;

      mek.message = getContentType(mek.message) === "ephemeralMessage"
        ? mek.message.ephemeralMessage?.message || mek.message
        : mek.message;

      if (!mek.message) return;

      try { await antidelete.onMessage(conn, mek, SESSION_ID); } catch {}

      if (handleAutoForward) try { await handleAutoForward(conn, mek, SESSION_ID); } catch {}

      const m = sms(conn, mek);
      const from = mek.key.remoteJid;
      if (!from) return;

      const body = extractBody(mek.message);

      const isCmd = body.startsWith(prefix);
      const commandText = isCmd ? body.slice(prefix.length).trim().split(/ +/)[0].toLowerCase() : "";
      const args = body.trim().split(/ +/).slice(1);
      const q = args.join(" ");

      const sender = mek.key.fromMe
        ? conn.user.id.split(":")[0] + "@s.whatsapp.net"
        : mek.key.participant || mek.key.remoteJid;
      const senderNumber = sender.split("@")[0];
      const botNumber = conn.user.id.split(":")[0];
      const isOwner = ownerNumber.includes(senderNumber) || botNumber.includes(senderNumber);
      const reply = (text) => conn.sendMessage(from, { text }, { quoted: chama });

      conn.sendButton = (jid, options, quoted) =>
        global.sendInteractiveButtons(conn, jid, { ...options, _sessionId: SESSION_ID }, quoted || mek);

      const events = require("./command");

      if (!global._pluginsLoaded || events.commands.length === 0) {
        setTimeout(async () => {
          const ev2 = require("./command");
          if (!ev2.commands.length) return;
          const cmd2 = ev2.commands.find(
            c => c.pattern === commandText || (c.alias && c.alias.includes(commandText))
          );
          if (cmd2) {
            if (cmd2.react) conn.sendMessage(from, { react: { text: cmd2.react, key: mek.key } });
            try {
              await cmd2.function(conn, mek, m, {
                from, body, isCmd, command: commandText,
                args, q, sender, senderNumber, botNumber,
                isOwner, reply, sessionId: SESSION_ID
              });
            } catch (e) { console.error(`[CMD RETRY ERROR] ${SESSION_ID}:`, e.message); }
          }
        }, 10000);
        return;
      }

      const cmd = events.commands.find(
        (c) => c.pattern === commandText || (c.alias && c.alias.includes(commandText))
      );

      if (isCmd) console.log(`[CMD] ${SESSION_ID} | ${commandText} | from: ${senderNumber}`);

      if (cmd) {
        if (cmd.react) conn.sendMessage(from, { react: { text: cmd.react, key: mek.key } });
        try {
          await cmd.function(conn, mek, m, {
            from, body, isCmd, command: commandText,
            args, q, sender, senderNumber, botNumber,
            isOwner, reply, sessionId: SESSION_ID
          });
        } catch (err) {
          console.error(`[CMD ERROR] ${SESSION_ID}:`, err);
        }
      }
    } catch (err) {
      if (!err.message?.includes("Bad MAC") && !err.message?.includes("decrypt")) {
        console.error(`[MSG ERROR] ${SESSION_ID}:`, err.message);
      }
    }
  });
}

// ================= Express Server =================
const app = express();
const port = process.env.PORT || 8000;
app.get("/", (req, res) =>
  res.send(`${botName} is Running. Status: ${botStarted ? "Connected ✅" : "Not connected ❌"}`)
);
app.listen(port, () => console.log(`🌐 Server running on port ${port}`));

// ================= Plugin Loader =================
function loadPlugins() {
  if (global._pluginsLoaded) return;
  global._pluginsLoaded = true;

  try {
    const cmdPath = require.resolve("./command");
    delete require.cache[cmdPath];
  } catch {}

  const pluginFolder = "./plugins/";
  let loadedCount = 0;

  if (fs.existsSync(pluginFolder)) {
    fs.readdirSync(pluginFolder).forEach((plugin) => {
      if (path.extname(plugin).toLowerCase() === ".js") {
        try {
          delete require.cache[require.resolve(pluginFolder + plugin)];
          require(pluginFolder + plugin);
          loadedCount++;
        } catch (e) {
          console.log(`⚠️ Plugin load error [${plugin}]:`, e.message);
        }
      }
    });
  }
  console.log(`📦 Loaded ${loadedCount} plugins, ${require("./command").commands.length} commands`);
}

// ================= Main Connector =================
async function connectToWA() {
  try {
    await startBot();
    setTimeout(() => loadPlugins(), 8000);
  } catch (err) {
    console.error("❌ Startup Error:", err);
  }
}

// ================= START =================
setTimeout(async () => {
  await ensureBotFiles(); // ✅ Step 1: local folders check (Mega/Mongo නෑ)
  await connectToWA();    // ✅ Step 2: Bot connect (auth_info_baileys/creds.json එකෙන්)
}, 4000);
