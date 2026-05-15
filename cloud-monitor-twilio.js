// Puppeteer v25 is ESM-only — use dynamic import
let puppeteer;
require('dotenv').config();
const twilio = require('twilio');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { URLSearchParams } = require('url');

async function loadPuppeteer() {
    const mod = await import('puppeteer');
    puppeteer = mod.default;
}

// ============================================================
// CONFIGURATION — Use env vars for cloud, fallback to defaults
// ============================================================
const CONFIG = {
    productUrl: process.env.PRODUCT_URL || 'https://blinkit.com/prn/x/prid/774454',
    productName: process.env.PRODUCT_NAME || 'Hot Wheels Product 774454',

    // All 6 delivery addresses
    addresses: JSON.parse(process.env.ADDRESSES || JSON.stringify([
        {
            name: 'Home (Marigold Chs, Ameya Classic Club, Virar)',
            lat: '19.4421987',
            lon: '72.8099579',
            locality: 'Thane',
            landmark: 'A-401, Marigold Chs, Ameya Classic Club, Yashavant Nagar, Virar'
        },
        {
            name: 'Sukant (Poonam Orchid, Ameya Classic Club, Virar)',
            lat: '19.4550',
            lon: '72.8050',
            locality: 'Thane',
            landmark: 'B-604, Poonam Orchid, Yashwant Nagar, Ameya Classic Club, Virar'
        },
        {
            name: 'Saiyam (Mewad Hostel, Jijamata Rd, Andheri)',
            lat: '19.1170',
            lon: '72.8470',
            locality: 'Mumbai',
            landmark: '601 Dilip Nabeda Mewad Hostel, Jijamata Road, near Freedom Inn Hotel, Andheri East'
        },
        {
            name: 'Chetan (Golf View, Sector 44A, Seawoods)',
            lat: '19.0171',
            lon: '73.0175',
            locality: 'Navi Mumbai',
            landmark: 'Chetan GPT, 603, Golf View Chs Ltd, Plot 66, Sector 44A, Seawoods'
        },
        {
            name: 'Aayush (Kanakia Park 2, Thakur Complex, Kandivali)',
            lat: '19.2050',
            lon: '72.8693',
            locality: 'Mumbai',
            landmark: 'D-204, Kanakia Park 2, Saraf Chaudhary Nagar, Thakur Complex, Kandivali E'
        },
        {
            name: 'Indrajeet (FAM CHS, Sector 11, Koparkhairane)',
            lat: '19.0965',
            lon: '73.0035',
            locality: 'Navi Mumbai',
            landmark: 'FAM CHS LTD, Sector 11, Koparkhairane, Navi Mumbai, 400709'
        },
    ])),

    // Auth cookies from your Blinkit session
    accessToken: process.env.BLINKIT_ACCESS_TOKEN || '',
    deviceId: process.env.BLINKIT_DEVICE_ID || '',

    // Twilio
    twilio: {
        accountSid: process.env.TWILIO_ACCOUNT_SID || '',
        authToken: process.env.TWILIO_AUTH_TOKEN || '',
        whatsapp: {
            from: process.env.TWILIO_WHATSAPP_FROM || '',
            to: (process.env.TWILIO_WHATSAPP_TO || '').split(',')
        },
        sms: {
            from: process.env.TWILIO_SMS_FROM || '',
            to: (process.env.TWILIO_SMS_TO || '')
        },
        voice: {
            from: process.env.TWILIO_VOICE_FROM || '',
            to: (process.env.TWILIO_VOICE_TO || '').split(',')
        }
    },

    checkInterval: parseInt(process.env.CHECK_INTERVAL_MS) || 15 * 1000,
    hourlyReportInterval: 60 * 60 * 1000,
    webhookPort: parseInt(process.env.PORT) || 3000,
};

// ============================================================
// CLOUD MONITOR
// ============================================================
class CloudBlinkitMonitor {
    constructor() {
        this.browser = null;
        this.page = null;
        this.twilioClient = null;
        this.isMonitoring = false;
        this.checkCount = 0;
        this.stockHistory = {};
        this.lastHourlyReport = Date.now();
        this.consecutiveErrors = 0;
        this.lastResults = [];        // Store latest results for status queries
        this.startTime = Date.now();  // Track uptime

        // Init Twilio
        try {
            this.twilioClient = twilio(CONFIG.twilio.accountSid, CONFIG.twilio.authToken);
            console.log('✅ Twilio initialized');
        } catch (e) {
            console.error('❌ Twilio failed:', e.message);
        }
    }

    /**
     * Launch a single headless browser
     */
    async launchBrowser() {
        console.log('🌐 Launching headless browser...');

        this.browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-extensions',
                '--no-first-run',
            ],
            executablePath: process.env.CHROME_PATH || undefined,
        });

        console.log('✅ Headless browser ready');
    }

    /**
     * Set location cookies for a specific address
     */
    async setAddressCookies(address) {
        const cookieDomain = '.blinkit.com';
        const cookies = [
            { name: 'gr_1_lat', value: address.lat, domain: cookieDomain, path: '/' },
            { name: 'gr_1_lon', value: address.lon, domain: cookieDomain, path: '/' },
            { name: 'gr_1_locality', value: address.locality, domain: cookieDomain, path: '/' },
            { name: 'gr_1_landmark', value: encodeURIComponent(address.landmark), domain: cookieDomain, path: '/' },
            { name: 'gr_1_accessToken', value: CONFIG.accessToken, domain: cookieDomain, path: '/' },
            { name: 'gr_1_deviceId', value: CONFIG.deviceId, domain: cookieDomain, path: '/' },
        ];

        await this.page.setCookie(...cookies);
    }

    /**
     * Check product availability for one address (uses fresh page each time)
     */
    async checkForAddress(address) {
        const startTime = Date.now();
        let page = null;

        try {
            // Create fresh page for this check
            page = await this.browser.newPage();

            await page.setViewport({ width: 1366, height: 768 });
            await page.setUserAgent(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
            );

            // Set cookies for this address
            const cookieDomain = '.blinkit.com';
            await page.setCookie(
                { name: 'gr_1_lat', value: address.lat, domain: cookieDomain, path: '/' },
                { name: 'gr_1_lon', value: address.lon, domain: cookieDomain, path: '/' },
                { name: 'gr_1_locality', value: address.locality, domain: cookieDomain, path: '/' },
                { name: 'gr_1_landmark', value: encodeURIComponent(address.landmark), domain: cookieDomain, path: '/' },
                { name: 'gr_1_accessToken', value: CONFIG.accessToken, domain: cookieDomain, path: '/' },
                { name: 'gr_1_deviceId', value: CONFIG.deviceId, domain: cookieDomain, path: '/' },
            );

            // Navigate to product page
            await page.goto(CONFIG.productUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 20000
            });

            // Wait for dynamic content
            await new Promise(r => setTimeout(r, 3000));

            // Extract page text
            const pageText = await page.evaluate(() => document.body?.innerText || '');
            const elapsed = Date.now() - startTime;

            if (!pageText || pageText.trim().length === 0) {
                return {
                    addressName: address.name, inStock: false,
                    stockMessage: 'Page Empty', icon: '⚠️', responseTime: elapsed
                };
            }

            // Try to get product name
            let productName = CONFIG.productName;
            try {
                const h1Text = await page.evaluate(() => {
                    const h1 = document.querySelector('h1');
                    return h1 ? h1.innerText.trim() : '';
                });
                if (h1Text) productName = h1Text;
            } catch (e) { }

            // Check stock status
            const lowerText = pageText.toLowerCase();

            if (lowerText.includes('coming soon')) {
                return { addressName: address.name, inStock: false, stockMessage: 'Coming Soon', productName, icon: '⏳', responseTime: elapsed };
            }

            if (lowerText.includes('out of stock') || lowerText.includes('currently unavailable') ||
                lowerText.includes('not available') || lowerText.includes('sold out')) {
                return { addressName: address.name, inStock: false, stockMessage: 'Out of Stock', productName, icon: '❌', responseTime: elapsed };
            }

            // Check for Add to Cart button
            const hasAddButton = await page.evaluate(() => {
                const buttons = document.querySelectorAll('button:not([disabled]), [role="button"]:not([disabled])');
                for (const btn of buttons) {
                    const text = btn.innerText?.toLowerCase() || '';
                    if ((text.includes('add') || text.includes('cart')) &&
                        text.length < 20 &&
                        btn.offsetParent !== null) {
                        return btn.innerText.trim();
                    }
                }
                return null;
            });

            if (hasAddButton) {
                return {
                    addressName: address.name, inStock: true,
                    stockMessage: `IN STOCK (${hasAddButton})`, productName,
                    icon: '✅', responseTime: elapsed
                };
            }

            return { addressName: address.name, inStock: false, stockMessage: 'Status Unclear', productName, icon: '❓', responseTime: elapsed };

        } catch (error) {
            const elapsed = Date.now() - startTime;
            return {
                addressName: address.name, inStock: false,
                stockMessage: `Error: ${error.message.substring(0, 50)}`,
                icon: '⚠️', responseTime: elapsed
            };
        } finally {
            // Always close the page
            try { if (page) await page.close(); } catch (e) { }
        }
    }

    /**
     * Run one check cycle across all addresses
     */
    async runCheckCycle() {
        this.checkCount++;
        const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

        console.log(`\n${'='.repeat(65)}`);
        console.log(`🔍 Check #${this.checkCount} — ${timestamp}`);
        console.log(`⚡ Checking ${CONFIG.addresses.length} address(es)...`);
        console.log('='.repeat(65));

        const results = [];
        const newStockItems = [];

        // Check each address sequentially (one page, swap cookies)
        for (const address of CONFIG.addresses) {
            const result = await this.checkForAddress(address);
            result.productUrl = CONFIG.productUrl;
            result.timestamp = new Date().toISOString();
            results.push(result);

            console.log(`   ${result.icon} [${result.addressName}] ${result.stockMessage} (${result.responseTime}ms)`);

            if (result.inStock) {
                const key = `${CONFIG.productUrl}_${address.name}`;
                if (!this.stockHistory[key]) {
                    newStockItems.push(result);
                    this.stockHistory[key] = true;
                }
            }
        }

        // Error tracking
        const errorCount = results.filter(r => r.stockMessage.startsWith('Error')).length;
        if (errorCount === results.length) {
            this.consecutiveErrors++;
            if (this.consecutiveErrors >= 10) {
                console.log('🔴 10+ consecutive failures — restarting browser...');
                await this.restartBrowser();
            }
        } else {
            this.consecutiveErrors = 0;
        }

        // Store latest results for WhatsApp status queries
        this.lastResults = results;

        // Notifications
        if (newStockItems.length > 0) {
            console.log(`\n🚨 ${newStockItems.length} NEW in-stock location(s)!`);
            await this.sendStockNotification(newStockItems);
        }

        // Summary
        const inStockCount = results.filter(r => r.inStock).length;
        const avgTime = Math.round(results.reduce((s, r) => s + (r.responseTime || 0), 0) / results.length);
        console.log(`\n📊 In Stock: ${inStockCount}/${results.length} | Avg: ${avgTime}ms | Next: ${new Date(Date.now() + CONFIG.checkInterval).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}`);

        // Hourly report
        if (Date.now() - this.lastHourlyReport >= CONFIG.hourlyReportInterval) {
            await this.sendHourlyReport(results);
            this.lastHourlyReport = Date.now();
        }
    }

    async restartBrowser() {
        try {
            if (this.browser) await this.browser.close();
        } catch (e) { }
        this.consecutiveErrors = 0;
        await this.launchBrowser();
    }

    // ============================================================
    // TWILIO NOTIFICATIONS
    // ============================================================

    async sendTwilioWhatsApp(message) {
        if (!this.twilioClient) return;

        for (const toNumber of CONFIG.twilio.whatsapp.to) {
            try {
                const result = await this.twilioClient.messages.create({
                    body: message,
                    from: CONFIG.twilio.whatsapp.from,
                    to: toNumber.trim()
                });
                console.log(`   📱 WhatsApp → ${toNumber.trim()} ✅`);
            } catch (error) {
                console.error(`   📱 WhatsApp → ${toNumber.trim()} ❌ ${error.message}`);
            }
        }
    }

    async sendStockNotification(items) {
        // WhatsApp message
        let msg = `🚨 *HOT WHEELS ALERT!* 🚨\n\n`;
        msg += `🎉 *IN STOCK at ${items.length} location(s)!*\n\n`;

        const locationNames = [];
        for (const item of items) {
            msg += `📦 *${item.productName || CONFIG.productName}*\n`;
            msg += `📍 ${item.addressName}\n`;
            msg += `🔗 ${CONFIG.productUrl}\n\n`;
            locationNames.push(item.addressName);
        }
        msg += `⏰ ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\n🏃‍♂️ *ORDER NOW!*`;

        await this.sendTwilioWhatsApp(msg);

        // SMS with stock location
        const smsMsg = `🚨 HOT WHEELS IN STOCK!\n📦 ${CONFIG.productName}\n📍 WHERE: ${locationNames.join(', ')}\n🔗 ${CONFIG.productUrl}\n⏰ ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}\nORDER NOW!`;
        await this.sendSMS(smsMsg);

        await this.makePhoneCalls(items);
    }

    async sendSMS(message) {
        // India blocks SMS from US Twilio numbers (DLT regulation)
        // Using WhatsApp instead — already working via sandbox
        if (!this.twilioClient) return;

        try {
            const result = await this.twilioClient.messages.create({
                body: message,
                from: CONFIG.twilio.whatsapp.from,
                to: `whatsapp:${CONFIG.twilio.sms.to}`
            });
            console.log(`   💬 WhatsApp alert → ${CONFIG.twilio.sms.to} ✅ (SID: ${result.sid})`);
        } catch (error) {
            console.error(`   💬 WhatsApp alert → ${CONFIG.twilio.sms.to} ❌ ${error.message}`);
        }
    }

    async sendHourlyReport(latestResults) {
        console.log('📊 Sending hourly report...');

        let msg = `📊 *HOURLY STATUS*\n`;
        msg += `⏰ ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\n\n`;
        msg += `🔍 Checks so far: ${this.checkCount}\n`;
        msg += `📦 Product: ${CONFIG.productName}\n\n`;

        if (latestResults) {
            for (const r of latestResults) {
                msg += `${r.icon} ${r.addressName}: ${r.stockMessage}\n`;
            }
        }

        const inStockKeys = Object.keys(this.stockHistory);
        if (inStockKeys.length > 0) {
            msg += `\n🎉 *Was in stock at:* ${inStockKeys.map(k => k.split('_').pop()).join(', ')}`;
        } else {
            msg += `\n❌ Not in stock anywhere yet\n⏳ Monitoring continues...`;
        }

        await this.sendTwilioWhatsApp(msg);
    }

    async makePhoneCalls(items) {
        if (!this.twilioClient) return;

        const locations = items.map(i => i.addressName.split('(')[0].trim()).join(', ');
        const message = `Hot Wheels alert! Product is in stock at ${locations}. Check WhatsApp for link.`;

        for (const phone of CONFIG.twilio.voice.to) {
            try {
                await this.twilioClient.calls.create({
                    twiml: `<Response><Say>${message}</Say></Response>`,
                    to: phone.trim(),
                    from: CONFIG.twilio.voice.from
                });
                console.log(`   📞 Call → ${phone.trim()} ✅`);
            } catch (error) {
                console.error(`   📞 Call → ${phone.trim()} ❌ ${error.message}`);
            }
        }
    }

    /**
     * Send a startup test SMS so you know the script is alive
     */
    async sendStartupTest() {
        const msg = `✅ Blinkit Monitor STARTED!\n📦 ${CONFIG.productName}\n🌐 Checking ${CONFIG.addresses.length} locations every ${CONFIG.checkInterval / 1000}s\n📍 ${CONFIG.addresses.map(a => a.name.split('(')[0].trim()).join(', ')}\n⏰ ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`;
        console.log('\n📤 Sending startup WhatsApp...');
        await this.sendSMS(msg);
    }

    // ============================================================
    // WHATSAPP COMMAND WEBHOOK
    // Text "status", "check", or "help" to get a reply
    // ============================================================

    handleWhatsAppCommand(command) {
        const cmd = command.toLowerCase().trim();
        const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        const uptimeMs = Date.now() - this.startTime;
        const uptimeHrs = Math.floor(uptimeMs / 3600000);
        const uptimeMins = Math.floor((uptimeMs % 3600000) / 60000);

        if (cmd === 'status' || cmd === 'st') {
            let reply = `📊 *MONITOR STATUS*\n⏰ ${now}\n⏱️ Uptime: ${uptimeHrs}h ${uptimeMins}m\n🔍 Checks done: ${this.checkCount}\n📦 ${CONFIG.productName}\n\n`;

            if (this.lastResults.length > 0) {
                reply += `*Latest check:*\n`;
                for (const r of this.lastResults) {
                    reply += `${r.icon} ${r.addressName}: ${r.stockMessage}\n`;
                }
            } else {
                reply += `⏳ No checks completed yet\n`;
            }

            const inStockKeys = Object.keys(this.stockHistory);
            if (inStockKeys.length > 0) {
                reply += `\n🎉 *Was in stock at:* ${inStockKeys.map(k => k.split('_').pop()).join(', ')}`;
            }

            return reply;

        } else if (cmd === 'help' || cmd === 'hi' || cmd === 'hello') {
            return `🤖 *Blinkit Monitor Commands*\n\n` +
                `📊 *status* — Current stock status at all locations\n` +
                `🔍 *check* — Trigger an immediate check\n` +
                `📍 *locations* — List all monitored addresses\n` +
                `📦 *product* — Show product being monitored\n` +
                `⏱️ *uptime* — How long the monitor has been running\n` +
                `❓ *help* — Show this menu`;

        } else if (cmd === 'check' || cmd === 'now') {
            // Trigger immediate check (async, reply first)
            setTimeout(() => this.runCheckCycle().catch(() => {}), 100);
            return `🔍 Running immediate check across ${CONFIG.addresses.length} locations...\nYou'll get an alert if anything is in stock!`;

        } else if (cmd === 'locations' || cmd === 'loc') {
            let reply = `📍 *Monitored Locations (${CONFIG.addresses.length}):*\n\n`;
            CONFIG.addresses.forEach((a, i) => {
                reply += `${i + 1}. ${a.name}\n`;
            });
            return reply;

        } else if (cmd === 'product') {
            return `📦 *Monitoring:*\n${CONFIG.productName}\n🔗 ${CONFIG.productUrl}`;

        } else if (cmd === 'uptime') {
            return `⏱️ *Uptime:* ${uptimeHrs}h ${uptimeMins}m\n🔍 *Checks:* ${this.checkCount}\n⏰ *Started:* ${new Date(this.startTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`;

        } else {
            return `❓ Unknown command: "${command}"\n\nType *help* to see available commands.`;
        }
    }

    startWebhookServer() {
        const server = http.createServer((req, res) => {
            if (req.method === 'POST' && req.url === '/webhook') {
                let body = '';
                req.on('data', chunk => { body += chunk.toString(); });
                req.on('end', () => {
                    try {
                        const params = new URLSearchParams(body);
                        const incomingMsg = params.get('Body') || '';
                        const from = params.get('From') || '';

                        console.log(`\n📩 WhatsApp command from ${from}: "${incomingMsg}"`);

                        const reply = this.handleWhatsAppCommand(incomingMsg);

                        // Reply with TwiML
                        const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${reply}</Message></Response>`;
                        res.writeHead(200, { 'Content-Type': 'text/xml' });
                        res.end(twiml);

                        console.log(`   ✅ Replied to ${from}`);
                    } catch (err) {
                        console.error('   ❌ Webhook error:', err.message);
                        res.writeHead(500);
                        res.end();
                    }
                });
            } else if (req.method === 'GET' && req.url === '/health') {
                // Health check endpoint
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    status: 'running',
                    uptime: Date.now() - this.startTime,
                    checks: this.checkCount,
                    product: CONFIG.productName,
                    addresses: CONFIG.addresses.length
                }));
            } else {
                res.writeHead(200);
                res.end('Blinkit Monitor is running ✅');
            }
        });

        server.listen(CONFIG.webhookPort, () => {
            console.log(`\n🌐 Webhook server on port ${CONFIG.webhookPort}`);
            console.log(`   📩 WhatsApp webhook: http://YOUR_EC2_IP:${CONFIG.webhookPort}/webhook`);
            console.log(`   💚 Health check:     http://YOUR_EC2_IP:${CONFIG.webhookPort}/health`);
        });
    }

    // ============================================================
    // MAIN
    // ============================================================

    async start() {
        await loadPuppeteer();

        console.log('');
        console.log('═'.repeat(65));
        console.log('  🚀  CLOUD BLINKIT MONITOR  —  Puppeteer Headless + Twilio');
        console.log('═'.repeat(65));
        console.log(`  📦 Product : ${CONFIG.productName}`);
        console.log(`  🔗 URL     : ${CONFIG.productUrl}`);
        console.log(`  🌐 Addresses: ${CONFIG.addresses.length}`);
        CONFIG.addresses.forEach((a, i) => console.log(`     ${i + 1}. ${a.name}`));
        console.log(`  ⏱️  Interval: ${CONFIG.checkInterval / 1000}s`);
        console.log(`  📱 Twilio  : WhatsApp + SMS + Phone calls`);
        console.log(`  💬 Alerts  : ${CONFIG.twilio.sms.to}`);
        console.log(`  🌐 Webhook : port ${CONFIG.webhookPort} (text "status" on WhatsApp)`);
        console.log(`  💾 Mode    : Headless (no GUI needed)`);
        console.log('═'.repeat(65));

        // Send startup WhatsApp
        await this.sendStartupTest();

        await this.launchBrowser();

        // Start webhook for WhatsApp commands
        this.startWebhookServer();

        this.isMonitoring = true;

        // First check immediately
        await this.runCheckCycle();

        // Continuous loop
        const interval = setInterval(async () => {
            if (this.isMonitoring) {
                try {
                    await this.runCheckCycle();
                } catch (err) {
                    console.error('❌ Cycle error:', err.message);
                    try { await this.restartBrowser(); } catch (e) { }
                }
            }
        }, CONFIG.checkInterval);

        // Graceful shutdown
        const shutdown = async () => {
            console.log('\n🛑 Shutting down...');
            this.isMonitoring = false;
            clearInterval(interval);
            try { if (this.browser) await this.browser.close(); } catch (e) { }
            console.log('✅ Stopped.');
            process.exit(0);
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

        console.log('\n✅ Monitor is running. Press Ctrl+C to stop.\n');
    }
}

// Run
const monitor = new CloudBlinkitMonitor();
monitor.start().catch(err => {
    console.error('❌ Fatal:', err);
    process.exit(1);
});

