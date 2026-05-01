const express = require('express')
const { default: makeWASocket, useMultiFileAuthState, Browsers } = require('@whiskeysockets/baileys')
const pino = require('pino')
const fs = require('fs')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 3000
app.use(express.json())
app.use(express.static('public'))

const activeUsers = new Map()

async function generatePair(number, res) {
    const sessionId = `temp_${number}_${Date.now()}`
    const sessionDir = `./${sessionId}`
    
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true })
    
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir)
    
    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: Browsers.macOS('Chrome'),
        syncFullHistory: false
    })

    activeUsers.set(number, { sock, sessionDir })
    let responded = false

    sock.ev.on('connection.update', async (update) => {
        const { connection } = update
        
        if (connection === 'connecting' &&!responded &&!sock.authState.creds.registered) {
            await new Promise(r => setTimeout(r, 2000))
            try {
                const code = await sock.requestPairingCode(number)
                responded = true
                res.json({ success: true, code: code, sessionId: sessionId })
            } catch (e) {
                responded = true
                res.json({ success: false, error: e.message })
                cleanup(number)
            }
        }
        
        // THIS GENERATES SESSION ID AFTER LINKING 💀
        if (connection === 'open') {
            const credsPath = path.join(sessionDir, 'creds.json')
            await new Promise(r => setTimeout(r, 3000)) // Wait for creds to save
            
            if (fs.existsSync(credsPath)) {
                const credsData = fs.readFileSync(credsPath, 'utf-8')
                const sessionID = 'VOID-MD::' + Buffer.from(credsData).toString('base64')
                
                console.log(`SESSION ID FOR ${number}: ${sessionID}`)
                
                // Send to frontend via WebSocket
                wss.clients.forEach(client => {
                    if (client.sessionId === sessionId) {
                        client.send(JSON.stringify({ 
                            sessionID, 
                            success: true,
                            message: 'Copy this to config.js'
                        }))
                    }
                })
                setTimeout(() => cleanup(number), 10000)
            }
        }
        
        if (connection === 'close') {
            cleanup(number)
        }
    })

    sock.ev.on('creds.update', saveCreds)
}

function cleanup(number) {
    if (activeUsers.has(number)) {
        const { sock, sessionDir } = activeUsers.get(number)
        try { sock?.end() } catch {}
        try { fs.rmSync(sessionDir, { recursive: true, force: true }) } catch {}
        activeUsers.delete(number)
    }
}

app.post('/pair', async (req, res) => {
    const cleanNumber = req.body.number.replace(/[^0-9]/g, '')
    await generatePair(cleanNumber, res)
})

const server = require('http').createServer(app)
const WebSocket = require('ws')
const wss = new WebSocket.Server({ server })

wss.on('connection', (ws, req) => {
    const params = new URLSearchParams(req.url.split('?')[1])
    ws.sessionId = params.get('sessionId')
})

app.use(express.static('public'))
server.listen(PORT, () => console.log(`VOID-MD Pair running 💀`))
