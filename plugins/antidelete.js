const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

const tempFolder = path.join(__dirname, '../temp');
if (!fs.existsSync(tempFolder)) {
  fs.mkdirSync(tempFolder, { recursive: true });
}

const CLEANUP_TIME = 10 * 60 * 1000;

// ================= Per-Session Stores =================
// sessionId එකට වෙන් වෙන්ව Map හදනවා
const sessionMessageStores = new Map(); // sessionId => Map(keyId => storedMsg)
const sessionMediaStores   = new Map(); // sessionId => Map(keyId => filePath)

function getMessageStore(sessionId) {
  if (!sessionMessageStores.has(sessionId)) {
    sessionMessageStores.set(sessionId, new Map());
  }
  return sessionMessageStores.get(sessionId);
}

function getMediaStore(sessionId) {
  if (!sessionMediaStores.has(sessionId)) {
    sessionMediaStores.set(sessionId, new Map());
  }
  return sessionMediaStores.get(sessionId);
}

// ================= AntiDelete State Check =================
function isAntiDeleteEnabled(sessionId, jid) {
  try {
    const stateFile = path.join(__dirname, `../data/antidelete_state_${sessionId}.json`);
    if (!fs.existsSync(stateFile)) return false;
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    return state[jid] === true;
  } catch (e) {
    return false;
  }
}

// ================= Helpers =================
function unwrapMessage(message) {
  if (!message) return null;
  if (message.ephemeralMessage)
    return unwrapMessage(message.ephemeralMessage.message);
  if (message.viewOnceMessageV2)
    return unwrapMessage(message.viewOnceMessageV2.message);
  if (message.viewOnceMessage)
    return unwrapMessage(message.viewOnceMessage.message);
  return message;
}

function getExtension(type, msg) {
  switch (type) {
    case 'imageMessage':    return '.jpg';
    case 'videoMessage':    return '.mp4';
    case 'audioMessage':    return '.ogg';
    case 'stickerMessage':  return '.webp';
    case 'documentMessage':
      return msg.documentMessage?.fileName
        ? path.extname(msg.documentMessage.fileName)
        : '.bin';
    default: return '.bin';
  }
}

// ================= Module Export =================
module.exports = {
  name: 'antidelete',

  // index.js එකෙන් call කරද්දී sessionId pass කරනවා
  onMessage: async (conn, msg, sessionId) => {
    if (!msg?.message || msg.key.fromMe) return;

    const keyId     = msg.key.id;
    const messageStore = getMessageStore(sessionId);
    const mediaStore   = getMediaStore(sessionId);

    const cleanMessage = unwrapMessage(msg.message);
    if (!cleanMessage) return;

    messageStore.set(keyId, {
      key: msg.key,
      message: cleanMessage,
      remoteJid: msg.key.remoteJid
    });

    const type = Object.keys(cleanMessage)[0];
    if (!type) return;

    const mediaTypes = [
      'imageMessage', 'videoMessage',
      'audioMessage', 'stickerMessage', 'documentMessage'
    ];
    if (!mediaTypes.includes(type)) return;

    try {
      const stream = await downloadContentFromMessage(
        cleanMessage[type],
        type.replace('Message', '')
      );

      let buffer = Buffer.from([]);
      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
      }
      if (!buffer.length) return;

      const ext      = getExtension(type, cleanMessage);
      const filePath = path.join(tempFolder, `${sessionId}_${keyId}${ext}`);

      await fs.promises.writeFile(filePath, buffer);
      mediaStore.set(keyId, filePath);

      setTimeout(() => {
        messageStore.delete(keyId);
        if (mediaStore.has(keyId)) {
          try { fs.unlinkSync(mediaStore.get(keyId)); } catch {}
          mediaStore.delete(keyId);
        }
      }, CLEANUP_TIME);

    } catch (err) {
      // fetch failed, expired media keys — silent skip
      const silentErrors = ["fetch failed", "Cannot derive", "Empty media key", "media key"];
      if (!silentErrors.some(e => err.message?.includes(e))) {
        console.log(`❌ [${sessionId}] AntiDelete media download error:`, err.message);
      }
    }
  },

  onDelete: async (conn, updates, sessionId) => {
    const messageStore = getMessageStore(sessionId);
    const mediaStore   = getMediaStore(sessionId);

    for (const update of updates) {
      const key = update?.key;
      if (!key?.id) continue;

      const isDelete =
        update.action === 'delete' ||
        update.update?.message === null;
      if (!isDelete) continue;

      const from = key.remoteJid;

      // ===== ON/OFF check — session + chat JID =====
      if (!isAntiDeleteEnabled(sessionId, from)) continue;

      const keyId  = key.id;
      const stored = messageStore.get(keyId);
      if (!stored) continue;

      const sender = key.participant || from;

      const caption =
`🗑️ *Deleted Message Recovered*

👤 *Sender:* @${sender.split('@')[0]}
🕒 *Time:* ${new Date().toLocaleString()}`;

      try {
        const mediaPath = mediaStore.get(keyId);

        if (mediaPath && fs.existsSync(mediaPath)) {
          const opts = { caption, mentions: [sender] };

          if (mediaPath.endsWith('.jpg')) {
            await conn.sendMessage(from, { image: { url: mediaPath }, ...opts });
          } else if (mediaPath.endsWith('.mp4')) {
            await conn.sendMessage(from, { video: { url: mediaPath }, ...opts });
          } else if (mediaPath.endsWith('.webp')) {
            await conn.sendMessage(from, { sticker: { url: mediaPath } });
            await conn.sendMessage(from, { text: caption, mentions: [sender] });
          } else if (mediaPath.endsWith('.ogg')) {
            await conn.sendMessage(from, {
              audio: { url: mediaPath },
              mimetype: 'audio/ogg; codecs=opus'
            });
            await conn.sendMessage(from, { text: caption, mentions: [sender] });
          } else {
            await conn.sendMessage(from, { document: { url: mediaPath }, ...opts });
          }
          continue;
        }

        const msgObj = stored.message;
        const text =
          msgObj.conversation ||
          msgObj.extendedTextMessage?.text ||
          msgObj.imageMessage?.caption ||
          msgObj.videoMessage?.caption ||
          msgObj.documentMessage?.caption || '';

        await conn.sendMessage(from, {
          text: text ? `${caption}\n\n📝 *Message:* ${text}` : caption,
          mentions: [sender]
        });

      } catch (err) {
        console.log(`❌ [${sessionId}] AntiDelete resend error:`, err.message);
      }
    }
  }
};
