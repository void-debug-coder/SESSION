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
    
    console.log(`[${number}] Starting pair request...`)
    
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true })
    
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir)
    
    // KEY FIX: Use iOS browser. WhatsApp trusts mobile more 💀
    const sock = makeWASocket({
        logger: pino({ level: 'info' }), // Change to info to see logs
        printQRInTerminal: false,
        auth: state,
        browser: Browsers.ios('Safari'), // THIS IS THE FIX
        syncFullHistory: false,
        markOnlineOnConnect: false,
        version: [2, 3000, 1023223821] // Latest WA version
    })

    activeUsers.set(number, { sock, sessionDir })
    let responded = false

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update
        console.log(`[${number}] Connection: ${connection}`)
        
        // Request code IMMEDIATELY when socket opens, not on 'connecting'
        if (connection === 'open' &&!sock.authState.creds.registered &&!responded) {
            console.log(`[${number}] Socket open. Requesting pair code...`)
            await new Promise(r => setTimeout(r, 1000))
            
            try {
                const code = await sock.requestPairingCode(number)
                console.log(`[${number}] PAIR CODE SUCCESS: ${code}`)
                responded = true
                res.json({ success: true, code: code, sessionId: sessionId })
            } catch (e) {
                console.log(`[${number}] PAIR CODE FAILED:`, e.message)
                responded = true
                res.json({ success: false, error: `Failed: ${e.message}. Number blocked by WhatsApp.` })
                cleanup(number)
            }
        }
        
        if (connection === 'close') {
            const code = lastDisconnect?.error?.output?.statusCode
            console.log(`[${number}] Closed: ${code}`)
            if (!responded) {
                responded = true
                res.json({ success: false, error: `Connection closed: ${code}` })
            }
            cleanup(number)
        }
    })

    sock.ev.on('creds.update', saveCreds)
    
    // Timeout 20sec
    setTimeout(() => {
        if (!responded) {
            console.log(`[${number}] TIMEOUT - No response from WhatsApp`)
            responded = true
            res.json({ success: false, error: 'Timeout. WhatsApp did not respond to pairing request.' })
            cleanup(number)
        }
    }, 20000)
}

function cleanup(number) {
    if (activeUsers.has(number)) {
        const { sock, sessionDir } = activeUsers.get(number)
        try { sock?.end() } catch {}
        try { fs.rmSync(sessionDir, { recursive: true, force: true }) } catch {}
        activeUsers.delete(number)
        console.log(`[${number}] Cleaned up`)
    }
}

app.post('/pair', async (req, res) => {
    const cleanNumber = req.body.number.replace(/[^0-9]/g, '')
    console.log(`\n=== NEW REQUEST: ${cleanNumber} ===`)
    if (cleanNumber.length < 11) return res.json({ success: false, error: 'Invalid number' })
    await generatePair(cleanNumber, res)
})

const server = require('http').createServer(app)
server.listen(PORT, () => console.log(`VOID-MD Pair running 💀`))
