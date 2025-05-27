import express from 'express';
import fs from 'fs';
import pino from 'pino';
import crypto from 'crypto';
import { Octokit } from '@octokit/rest';
import { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser } from '@whiskeysockets/baileys';

const router = express.Router();

// Setup your GitHub Personal Access Token and repo info
const GITHUB_TOKEN = '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';
const GITHUB_OWNER = 'SACHI-MD';
const GITHUB_REPO = 'SESSION-DATA';
const GITHUB_PATH = 'sessions/'; // Subfolder inside repo
const octokit = new Octokit({ auth: GITHUB_TOKEN });

function removeFile(path) {
    try {
        if (!fs.existsSync(path)) return false;
        fs.rmSync(path, { recursive: true, force: true });
    } catch (e) {
        console.error('Error removing file:', e);
    }
}

function generateRandomId(length = 6) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

function encodeHex(str) {
    return Buffer.from(str).toString('hex');
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).send({ error: 'Number is required' });
    num = num.replace(/[^0-9]/g, '');
    let sessionPath = './' + num;

    removeFile(sessionPath);

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    const sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
        },
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
        browser: Browsers.ubuntu('Chrome'),
    });

    if (!sock.authState.creds.registered) {
        await delay(2000);
        const code = await sock.requestPairingCode(num);
        return res.send({ code });
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on("connection.update", async (update) => {
        const { connection } = update;

        if (connection === "open") {
            await delay(8000);
            const randomId = generateRandomId();
            const fileName = `${num}_SACHI_${randomId}.json`;
            const fullPath = sessionPath + '/creds.json';
            const fileContent = fs.readFileSync(fullPath, 'utf8');

            try {
                // Upload to GitHub
                const { data } = await octokit.repos.createOrUpdateFileContents({
                    owner: GITHUB_OWNER,
                    repo: GITHUB_REPO,
                    path: GITHUB_PATH + fileName,
                    message: `Add session for ${num}`,
                    content: Buffer.from(fileContent).toString('base64'),
                    committer: { name: 'Sachi-Bot', email: 'bot@sachi.dev' },
                    author: { name: 'Sachi-Bot', email: 'bot@sachi.dev' }
                });

                // Encode URL to hex
                const fileUrl = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/blob/main/${GITHUB_PATH}${fileName}`;
                const hexEncoded = encodeHex(fileUrl);
                const sessionString = `SACHI-MD~${hexEncoded}`;

                const userJid = jidNormalizedUser(num + '@s.whatsapp.net');
                await sock.sendMessage(userJid, { text: sessionString });

                await sock.sendMessage(userJid, { text: `
*SESSION GENERATED SUCCESSFULLY* ✅

📦 *Session ID (Hex Encoded Link)*  
${sessionString}` });

                await delay(500);
                removeFile(sessionPath);
                process.exit(0);
            } catch (err) {
                console.error('GitHub upload failed:', err.message);
                return res.status(500).send({ error: 'GitHub upload failed' });
            }
        }
    });
});

// Global error handler
process.on('uncaughtException', err => {
    console.error('Uncaught exception:', err);
});

export default router;
