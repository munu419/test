const { cmd } = require("../command");
const { getContentType } = require("@whiskeysockets/baileys");
const { randomBytes } = require("crypto");
const genMsgId = () => randomBytes(10).toString("hex").toUpperCase();

function getCtx(message) {
  if (!message) return null;
  const type = getContentType(message);
  if (!type) return null;
  const content = message[type];
  if (!content) return null;
  if (type === "ephemeralMessage") return getCtx(content.message);
  return content?.contextInfo || null;
}

// ── null/undefined fields protobuf crash කරනවා — strip කරනවා ──
function stripNulls(obj) {
  if (Array.isArray(obj)) {
    return obj.map(stripNulls).filter(v => v !== null && v !== undefined);
  }
  if (obj && typeof obj === "object") {
    const clean = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined) continue;
      clean[k] = stripNulls(v);
    }
    return clean;
  }
  return obj;
}

cmd({
  pattern: "forward",
  alias: ["fw", "fwd"],
  desc: "Reply කළ message forward කිරීම (JIDs 20ක් දක්වා)",
  category: "tools",
  react: "📤",
  filename: __filename,
}, async (conn, mek, m, { from, reply, q }) => {

  const ctx    = getCtx(mek.message);
  let quoted   = ctx?.quotedMessage;

  if (!quoted) {
    return reply(
      "📤 *Forward Usage*\n\nForward කරන්නට ඕනේ message එකට *reply* කරලා *.forward* type කරන්න.\n\n" +
      "✅ Single JID: *.forward 120363382037700734@g.us*\n" +
      "✅ Multi JID (max 20): *.forward jid1,jid2,jid3*\n" +
      "✅ JID නැත්නම් current chat එකට forward වෙනවා."
    );
  }

  // ── JID list parse කරනවා (max 20) ──
  let targets = [];
  if (q && q.trim()) {
    targets = q.split(",")
      .map(j => j.trim())
      .filter(j => j.length > 0)
      .slice(0, 20); // max 20
  }
  if (!targets.length) targets = [from];

  await conn.sendMessage(from, { react: { text: "⏳", key: mek.key } });

  try {
    // View Once unwrap
    if (quoted.viewOnceMessageV2) {
      quoted = quoted.viewOnceMessageV2.message;
    } else if (quoted.viewOnceMessage) {
      quoted = quoted.viewOnceMessage.message;
    }

    // Clone + null strip — protobuf crash fix
    let messageToForward = stripNulls(JSON.parse(JSON.stringify(quoted)));
    let mType = getContentType(messageToForward);
    if (!mType) throw new Error("Message type detect කරගන්න බැරි වුණා.");

    // conversation → extendedTextMessage
    if (mType === "conversation") {
      const text = messageToForward.conversation;
      messageToForward = { extendedTextMessage: { text: String(text) } };
      mType = "extendedTextMessage";
    }

    // forwardingScore inject
    if (messageToForward[mType] && typeof messageToForward[mType] === "object") {
      messageToForward[mType].contextInfo = {
        ...(messageToForward[mType].contextInfo || {}),
        forwardingScore: 999,
        isForwarded: true,
      };
    }

    // ── සියලු JIDs වලට forward කරනවා ──
    let success = 0;
    let failed  = 0;

    for (const jid of targets) {
      try {
        await conn.relayMessage(String(jid), messageToForward, {
          messageId: genMsgId(),
        });
        success++;
      } catch (err) {
        console.error(`[FORWARD ERROR] ${jid}:`, err.message);
        failed++;
      }
    }

    await conn.sendMessage(from, { react: { text: "✅", key: mek.key } });

    if (targets.length > 1) {
      reply(`✅ *Forward සම්පූර්ණයි!*\n\n📤 *Success:* ${success}/${targets.length}\n❌ *Failed:* ${failed}`);
    }

  } catch (err) {
    console.error("[FORWARD ERROR]", err);
    await conn.sendMessage(from, { react: { text: "❌", key: mek.key } });
    reply(`❌ Forward failed: ${err.message}`);
  }
});
