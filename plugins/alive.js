const config = require('../config')
const {cmd , commands} = require('../command')
const { getBotName, getBotLogo } = require('../lib/settings')

cmd({
    pattern: "alive",
    desc: "Check bot online or no.",
    category: "main",
    react: "👋",
    filename: __filename
},
async(conn, mek, m,{from, quoted, body, isCmd, command, args, q, isGroup, sender, senderNumber, botNumber2, botNumber, pushname, isMe, isOwner, groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins, reply, sessionId}) => {
try{

const botName = getBotName(sessionId, "KAVI X MD")
const botLogo = getBotLogo(sessionId, config.ALIVE_IMG)

let des = `👋 𝙷𝚎𝚕𝚕𝚘 ${pushname} 𝙸'𝚖 𝚊𝚕𝚒𝚟𝚎 𝚗𝚘𝚠

*Im ${botName} Whatsapp Bot Create By MR KAVI🍂✨*

| *Version*: 1.0.0
| *Memory*: 38.09MB/7930MB
| *Owner*: mr kavi

මම ${botName} whatsapp bot. මම ඔයාට උදව් කරන්නේ කෙසේ ද.
මෙනුව ලබා ගැනීමට, .menu ලෙස ටයිප් කරන්න
 ඔබට බොට් ගැන යමක් දැන ගැනීමට අවශ්‍ය නම්,
.owner ලෙස ටයිප් කර ප්‍රශ්නය මා වෙත යොමු කරන්න. සුබ දිනක්

*°᭄${botName}*

> © 𝐏𝐎𝐖𝐄𝐑𝐄𝐃 𝐁𝐘 ${botName}`
return await conn.sendMessage(from,{image: {url: botLogo},caption: des},{quoted: mek})
}catch(e){
console.log(e)
reply(`${e}`)
}
})
ole.log(e)
reply(`${e}`)
}
})
