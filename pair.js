import express from 'express';
import fs from 'fs';
import path from 'path';
import pino from 'pino';
import crypto from 'crypto';
import { Octokit } from '@octokit/rest';
import { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser } from '@whiskeysockets/baileys';

const router = express.Router();

import dotenv from 'dotenv';
dotenv.config();

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = 'DEXTER-ID-KING';
const GITHUB_REPO = 'PKO-MD';
const GITHUB_PATH = 'PKO/';
const octokit = new Octokit({ auth: GITHUB_TOKEN });

function removeFile(dirPath) {
    try {
        if (fs.existsSync(dirPath)) {
            fs.rmSync(dirPath, { recursive: true, force: true });
            console.log(`✅ Removed folder: ${dirPath}`);
        }
    } catch (e) {
        console.error('❌ Error removing file:', e.message);
    }
}

function generateRandomId(length = 6) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length }, () => characters.charAt(Math.floor(Math.random() * characters.length))).join('');
}

function encodeHex(str) {
    return Buffer.from(str).toString('hex');
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).json({ error: '❌ Number is required' });

    num = num.replace(/[^0-9]/g, '');
    const sessionPath = './' + num;

    console.log(`🌀 Generating session for: ${num}`);
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
        console.log(`🔑 Pairing code for ${num}: ${code}`);
        return res.json({ code });
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection } = update;
        if (connection === "open") {
            try {
                console.log('✅ WhatsApp connection established.');

                await delay(8000);

                const randomId = generateRandomId();
                const fileName = `${num}_SACHI_${randomId}.json`;
                const fullPath = path.join(sessionPath, 'creds.json');

                if (!fs.existsSync(fullPath)) {
                    console.error('❌ creds.json not found');
                    return res.status(500).json({ error: 'Session file not found' });
                }

                const fileContent = fs.readFileSync(fullPath, 'utf8');
                const base64Content = Buffer.from(fileContent).toString('base64');

                const githubResponse = await octokit.repos.createOrUpdateFileContents({
                    owner: GITHUB_OWNER,
                    repo: GITHUB_REPO,
                    path: GITHUB_PATH + fileName,
                    message: `Add session for ${num}`,
                    content: base64Content,
                    committer: { name: 'Sachi-Bot', email: 'bot@sachi.dev' },
                    author: { name: 'Sachi-Bot', email: 'bot@sachi.dev' },
                });

                if (!githubResponse || !githubResponse.status || githubResponse.status !== 201) {
                    throw new Error('GitHub file upload failed');
                }

                console.log('📤 Session uploaded to GitHub successfully.');

                const fileUrl = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/blob/main/${GITHUB_PATH}${fileName}`;
                const hexEncoded = encodeHex(fileUrl);
                const sessionString = `SACHI-MD~${hexEncoded}`;

                const userJid = jidNormalizedUser(num + '@s.whatsapp.net');
                await sock.sendMessage(userJid, { text: sessionString });

                await sock.sendMessage(userJid, {
                    text: `*SESSION GENERATED SUCCESSFULLY* ✅\n\n📦 *Session ID (Hex Encoded Link)*\n${sessionString}`
                });

                await delay(1000);
                removeFile(sessionPath);

                console.log(`✅ Process completed for ${num}`);
                process.exit(0);
            } catch (err) {
                console.error('❌ Error during session process:', err.message);
                return res.status(500).json({ error: err.message });
            }
        }
    });
});

// Global error handler
process.on('uncaughtException', err => {
    console.error('🛑 Uncaught exception:', err.message);
});

export default router;
