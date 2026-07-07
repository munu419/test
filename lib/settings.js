// lib/settings.js
// Per-session bot settings (name, logo) persisted as JSON files under /data.
// Used by plugins/settings.js and read by alive.js / owner.js etc. so the
// name & logo you set with .setbotname / .setbotpic show up everywhere.

const fs = require("fs");
const path = require("path");

const SETTINGS_DIR = path.join(__dirname, "..", "data");

function ensureDir() {
  if (!fs.existsSync(SETTINGS_DIR)) fs.mkdirSync(SETTINGS_DIR, { recursive: true });
}

function getSettingsPath(sessionId) {
  return path.join(SETTINGS_DIR, `settings_${sessionId}.json`);
}

function getSettings(sessionId) {
  ensureDir();
  const file = getSettingsPath(sessionId);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function updateSettings(sessionId, patch) {
  ensureDir();
  const current = getSettings(sessionId);
  const updated = { ...current };
  for (const key of Object.keys(patch)) {
    if (patch[key] === undefined) continue; // don't overwrite with undefined
    updated[key] = patch[key];
  }
  fs.writeFileSync(getSettingsPath(sessionId), JSON.stringify(updated, null, 2));
  return updated;
}

function getBotName(sessionId, fallback) {
  return getSettings(sessionId).botName || fallback;
}

function getBotLogo(sessionId, fallback) {
  return getSettings(sessionId).botLogo || fallback;
}

module.exports = { getSettings, updateSettings, getBotName, getBotLogo };
