const { cmd } = require('../command');
const { getRandom } = require('../lib/functions2');
const axios = require('axios');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const fixed_thumb_url = "https://files.catbox.moe/04jdju.jpg";
const cinesubz_footer = "✫☘ KAVI X MD 𝐌𝐎𝐕𝐈𝐄 𝐇𝐎𝐌𝐄☢️☘";

const TWO_GB = 2 * 1024 * 1024 * 1024;
const PART_SIZE_GB = 1;

// ───────── Thumbnail ─────────
async function makeThumbnail(url) {
    try {
        console.log("🖼️ Generating thumbnail...");
        const img = await axios.get(url, { responseType: "arraybuffer", timeout: 15000 });
        return await sharp(img.data).resize(300).jpeg({ quality: 65 }).toBuffer();
    } catch (e) {
        console.log("❌ Thumbnail error:", e.message);
        return null;
    }
}

// ───────── Stream Download ─────────
async function downloadFullFile(url, savePath, progressCallback) {
    const response = await axios({
        method: 'GET',
        url,
        responseType: 'stream',
        headers: { 'User-Agent': 'Mozilla/5.0' },
        maxContentLength: Infinity,
        maxBodyLength: Infinity
    });

    const totalSize = parseInt(response.headers['content-length'] || 0);
    let downloaded = 0;
    let lastPercent = -1;

    return new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(savePath);
        response.data.on('data', (chunk) => {
            downloaded += chunk.length;
            if (totalSize) {
                const percent = Math.floor((downloaded / totalSize) * 100);
                if (percent !== lastPercent) {
                    lastPercent = percent;
                    progressCallback(percent);
                }
            }
        });
        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

// ───────── File Size Check ─────────
async function getRemoteFileSize(url) {
    try {
        const res = await axios.head(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (res.headers['content-length']) return parseInt(res.headers['content-length']);

        const res2 = await axios.get(url, {
            headers: { 'Range': 'bytes=0-0', 'User-Agent': 'Mozilla/5.0' },
            responseType: 'arraybuffer'
        });
        const range = res2.headers['content-range'];
        if (range) return parseInt(range.split('/')[1]);

        return 0;
    } catch (e) {
        console.log(`❌ [SIZE CHECK ERROR] ${e.message}`);
        return 0;
    }
}

// ───────── Main Command ─────────
cmd({
    pattern: "download2",
    alias: ["downurl"],
    react: "🔰",
    desc: "Download with original file name, thumbnail and footer.",
    category: "downloader",
    filename: __filename
},
async (conn, mek, m, { from, q, reply }) => {
    try {
        if (!q) return reply("❗ කරුණාකර download link එකක් ලබා දෙන්න.");

        let link = q.trim();
        const urlPattern = /^(https?:\/\/[^\s]+)/;
        if (!urlPattern.test(link)) return reply("❗ URL එක වැරදියි.");

        console.log(`\n╔══════════════════════════════════════╗`);
        console.log(`║         📥 URL DOWNLOADER            ║`);
        console.log(`╚══════════════════════════════════════╝`);
        console.log(`🔗 URL: ${link}`);

        await conn.sendMessage(from, { react: { text: "⏳", key: m.key } });

        // Pixeldrain fix
        if (link.includes("pixeldrain.com/u/")) {
            console.log("🔗 Pixeldrain link detected, converting...");
            const fileId = link.split('/').pop();
            link = `https://pixeldrain.com/api/file/${fileId}?download`;
        }

        // File name ගැනීම
        let fileName = "KAVI-X-MD-File.mp4";

        try {
            console.log("🌐 Fetching server headers...");
            const response = await axios.head(link, {
                maxRedirects: 10,
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });

            if (response.headers['content-disposition']) {
                const disposition = response.headers['content-disposition'];
                const match = disposition.match(/filename=(?:["']([^"']+)["']|([^;]+))/);
                if (match) {
                    fileName = match[1] || match[2];
                    console.log(`🏷️ File name from header: ${fileName}`);
                }
            }
        } catch (e) {
            console.log("⚠️ Could not get header, trying URL...");
        }

        if (fileName === "KAVI-X-MD-File.mp4") {
            try {
                const urlName = new URL(link).pathname.split('/').pop();
                if (urlName) {
                    fileName = decodeURIComponent(urlName);
                    console.log(`🏷️ File name from URL: ${fileName}`);
                }
            } catch (e) {}
        }

        console.log(`📄 Final File Name: ${fileName}`);

        // File size check
        const fileSizeBytes = await getRemoteFileSize(link);
        const fileSizeMB = (fileSizeBytes / (1024 * 1024)).toFixed(2);
        console.log(`💾 File Size: ${fileSizeMB} MB (${fileSizeBytes} bytes)`);

        const thumb = await makeThumbnail(fixed_thumb_url);
        const info = `🎬 *${fileName}*\n\n${cinesubz_footer}`;
        console.log(`📝 Caption: ${info}`);

        // ✅ 2GB යටතේ — Direct send
        if (fileSizeBytes <= TWO_GB || fileSizeBytes === 0) {
            console.log(`✅ File under 2GB — Sending directly...`);
            await reply(`*📤 Sending file...*\n\n*📄 Name:* ${fileName}\n*💾 Size:* ${fileSizeMB} MB`);

            await conn.sendMessage(from, {
                document: { url: link },
                mimetype: "video/mp4",
                fileName: fileName,
                jpegThumbnail: thumb || undefined,
                caption: info
            }, { quoted: mek });

            await conn.sendMessage(from, { react: { text: "✅", key: m.key } });
            console.log("✅ Process completed successfully.");
            return;
        }

        // ✅ 2GB ඉහළින් — Download + RAR parts
        console.log(`\n⚠️  File is over 2GB (${fileSizeMB} MB) — Starting RAR split process...`);
        await reply(`*📥 File is ${fileSizeMB} MB — Downloading for RAR split...*\n*Please wait...*`);

        const tempDir = `./temp_${getRandom('')}`;
        fs.mkdirSync(tempDir, { recursive: true });
        const tempFilePath = path.join(tempDir, fileName);

        console.log(`📂 Temp Dir : ${tempDir}`);
        console.log(`⬇️  Downloading...`);

        await downloadFullFile(link, tempFilePath, async (percent) => {
            const filled = Math.floor(percent / 5);
            const empty = 20 - filled;
            const bar = '█'.repeat(filled) + '░'.repeat(empty);
            process.stdout.write(`\r⬇️  [${bar}] ${percent}%   `);

            if ([25, 50, 75, 100].includes(percent)) {
                await reply(`*⬇️ Downloading... ${percent}%*`);
            }
        });

        console.log(`\n✅ Download complete!`);
        console.log(`\n🗜️  Creating RAR parts (${PART_SIZE_GB}GB each)...`);
        await reply('*🗜️ Creating RAR parts... Please wait...*');

        // Smart baseName
        const rawBaseName = path.basename(fileName, path.extname(fileName));
        const cleanName = rawBaseName
            .replace(/[^a-zA-Z0-9_\-]/g, '_')
            .replace(/_{2,}/g, '_')
            .replace(/^_|_$/g, '')
            .substring(0, 50);

        const baseName = cleanName.length <= 2
            ? `sayura_file_${getRandom('')}`
            : cleanName;

        console.log(`📝 RAR Base Name : ${baseName}`);

        const rarBasePath = path.join(tempDir, baseName);
        await execPromise(`rar a -v${PART_SIZE_GB}g -m0 "${rarBasePath}.rar" "${tempFilePath}"`);

        const partFiles = fs.readdirSync(tempDir)
            .filter(f => f.startsWith(baseName) && (f.endsWith('.rar') || f.match(/\.r\d+$/)))
            .sort()
            .map(f => path.join(tempDir, f));

        console.log(`\n📦 Total Parts : ${partFiles.length}`);
        partFiles.forEach((p, i) => {
            const size = (fs.statSync(p).size / (1024 * 1024)).toFixed(2);
            console.log(`   Part ${i + 1}: ${path.basename(p)} — ${size} MB`);
        });

        await reply(`*📦 ${partFiles.length} RAR parts ready! Sending...*`);

        // Original file delete
        fs.unlinkSync(tempFilePath);
        console.log(`\n🗑️  Original file deleted (disk save)`);

        // Parts send
        for (let i = 0; i < partFiles.length; i++) {
            const partPath = partFiles[i];
            const partName = path.basename(partPath);
            const partSizeMB = (fs.statSync(partPath).size / (1024 * 1024)).toFixed(2);

            console.log(`\n📤 Sending Part ${i + 1}/${partFiles.length}: ${partName} (${partSizeMB} MB)`);
            await reply(`*📤 Sending Part ${i + 1}/${partFiles.length}...*`);

            await conn.sendMessage(from, {
                document: fs.readFileSync(partPath),
                fileName: partName,
                mimetype: 'application/x-rar-compressed',
                jpegThumbnail: thumb || undefined,
                caption: `*Part ${i + 1}/${partFiles.length}*\n📁 ${partName}\n\n${cinesubz_footer}`
            }, { quoted: mek });

            console.log(`✅ Part ${i + 1}/${partFiles.length} sent! Deleting...`);
            fs.unlinkSync(partPath);
            await new Promise(r => setTimeout(r, 2000));
        }

        fs.rmSync(tempDir, { recursive: true, force: true });

        console.log(`\n╔══════════════════════════════════════╗`);
        console.log(`║   ✅ ALL PARTS SENT SUCCESSFULLY!    ║`);
        console.log(`╚══════════════════════════════════════╝\n`);

        await conn.sendMessage(from, { react: { text: "✅", key: m.key } });
        await reply(`*✅ Done! ${partFiles.length} RAR parts sent!*\n\n*📌 Extract කරන්න:*\n1️⃣ Part 1 WinRAR වලින් open කරන්න\n2️⃣ Extract කළාම original file එනවා ✅`);

    } catch (e) {
        console.log("❌ CRITICAL ERROR:", e);
        reply(`❌ Error: ${e.message}`);
    }
});
ERROR:", e);
        reply(`❌ Error: ${e.message}`);
    }
});
