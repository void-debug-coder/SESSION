const express = require('express')
const { default: makeWASocket, useMultiFileAuthState, Browsers, DisconnectReason } = require('@whiskeysockets/baileys')
const pino = require('pino')
const fs = require('fs')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 3000
app.use(express.json())
app.use(express.static('public'))

let activeSocket = null
let sessionGenerated = false

async function generatePair(number, res) {
    const sessionDir = `./temp_session_${Date.now()}`
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir)
    
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir)
    
    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: Browsers.macOS('VOID-MD-PAIR')
    })

    if (!sock.authState.creds.registered) {
        try {
            const code = await sock.requestPairingCode(number)
            res.json({ success: true, code: code, message: 'Enter this code in WhatsApp > Linked Devices > Link with phone number' })
        } catch (e) {
            res.json({ success: false, error: 'Failed to get pair code. Check number format.' })
            fs.rmSync(sessionDir, { recursive: true, force: true })
            return
        }
    }

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
        if (connection === 'open') {
            console.log('Paired successfully 💀')
            const credsPath = path.join(sessionDir, 'creds.json')
            await new Promise(r => setTimeout(r, 2000)) // Wait for creds to save
            
            if (fs.existsSync(credsPath)) {
                const creds = fs.readFileSync(credsPath, 'utf-8')
                const sessionID = 'VOID-MD::' + Buffer.from(creds).toString('base64')
                
                if (activeSocket) activeSocket.send(JSON.stringify({ sessionID }))
                sessionGenerated = true
                
                setTimeout(() => {
                    sock.end()
                    fs.rmSync(sessionDir, { recursive: true, force: true })
                }, 5000)
            }
        }
        if (connection === 'close') {
            if (!sessionGenerated) {
                if (activeSocket) activeSocket.send(JSON.stringify({ error: 'Connection closed. Try again.' }))
            }
            fs.rmSync(sessionDir, { recursive: true, force: true })
        }
    })
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.post('/pair', async (req, res) => {
    const { number } = req.body
    if (!number) return res.json({ success: false, error: 'Number required' })
    
    sessionGenerated = false
    const cleanNumber = number.replace(/[^0-9]/g, '')
    await generatePair(cleanNumber, res)
})

// WebSocket for real-time session ID
const server = require('http').createServer(app)
const WebSocket = require('ws')
const wss = new WebSocket.Server({ server })

wss.on('connection', (ws) => {
    activeSocket = ws
})

server.listen(PORT, () => console.log(`VOID-MD Pair Site running on ${PORT} 💀`))
