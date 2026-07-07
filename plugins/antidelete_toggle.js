const { cmd } = require('../command');
const fs   = require('fs');
const path = require('path');

// data folder නැත්නම් හදනවා
const dataFolder = path.join(__dirname, '../data');
if (!fs.existsSync(dataFolder)) {
  fs.mkdirSync(dataFolder, { recursive: true });
}

// ================= Per-Session State Helpers =================
function getStateFile(sessionId) {
  return path.join(__dirname, `../data/antidelete_state_${sessionId}.json`);
}

function loadState(sessionId) {
  try {
    const file = getStateFile(sessionId);
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {}
  return {};
}

function saveState(sessionId, state) {
  try {
    fs.writeFileSync(getStateFile(sessionId), JSON.stringify(state, null, 2));
  } catch (e) {}
}

// ================= Command =================
cmd({
  pattern:  'antidelete',
  alias:    ['antidel'],
  desc:     'AntiDelete on/off කිරීම',
  category: 'group',
  react:    '🗑️',
  filename: __filename
}, async (conn, mek, m, { from, args, isOwner, reply, sessionId }) => {

  const subCmd = args[0]?.toLowerCase();

  // Status show
  if (!subCmd || (subCmd !== 'on' && subCmd !== 'off')) {
    const state   = loadState(sessionId);
    const current = state[from] === true ? '✅ ON' : '❌ OFF';
    return reply(
`🗑️ *AntiDelete Status*

📍 *Chat:* ${from}
🔘 *Status:* ${current}

Usage:
• *.antidelete on*  — Enable
• *.antidelete off* — Disable`
    );
  }

  if (!isOwner) {
    return reply('❌ මේ command එක Owner ට විතරයි.');
  }

  const state = loadState(sessionId);

  if (subCmd === 'on') {
    state[from] = true;
    saveState(sessionId, state);
    return reply('✅ *AntiDelete ON!*\nDeleted messages recover කරනවා.');
  }

  if (subCmd === 'off') {
    state[from] = false;
    saveState(sessionId, state);
    return reply('❌ *AntiDelete OFF!*\nDeleted messages recover කරන්නේ නෑ.');
  }
});
