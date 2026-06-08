import puppeteer from 'puppeteer';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

(async () => {
    const browser = await puppeteer.launch({
        headless: false,
        args: ['--no-sandbox', '--window-size=1280,800'],
        userDataDir: './.browser_session'
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    if (process.env.COC_COOKIE) {
        const cookies = process.env.COC_COOKIE.split(';').map(c => {
            const parts = c.trim().split('=');
            return {
                name: parts[0],
                value: parts.slice(1).join('='),
                domain: 'developer.clashofclans.com'
            };
        }).filter(c => c.name);
        await page.browserContext().setCookie(...cookies);
        console.log('Loaded cookies from .env');
    }

    if (process.env.COC_EMAIL && process.env.COC_PASSWORD) {
        console.log("Using Email/Password from .env to log in...");
        await page.goto('https://developer.clashofclans.com/#/login', { waitUntil: 'networkidle0' });

        try {
            await page.waitForSelector('#email', { timeout: 5000 });
            await page.type('#email', process.env.COC_EMAIL);
            await page.type('#password', process.env.COC_PASSWORD);

            const [response] = await Promise.all([
                page.waitForResponse(res => res.url().includes('/api/login') || res.url().includes('/api/account'), { timeout: 10000 }).catch(() => null),
                page.evaluate(() => {
                    const btn = document.querySelector('button[type="submit"]') || document.querySelector('.btn-primary');
                    if (btn) btn.click();
                })
            ]);
            console.log("Logged in successfully!");
        } catch (err) {
            console.log("Already logged in or login form not found.", err.message);
        }
    }

    console.log("Navigating to the documentation...");
    await page.goto('https://developer.clashofclans.com/#/documentation', { waitUntil: 'networkidle0', timeout: 15000 });

    console.log("Waiting for iframe to load...");
    try {
        const iframeElement = await page.waitForSelector('iframe', { timeout: 15000 });
        const frame = await iframeElement.contentFrame();

        // Wait for Swagger UI to initialize AND for the spec to be fully downloaded
        await frame.waitForFunction(() => {
            if (!window.ui || !window.ui.specSelectors || !window.ui.specSelectors.specJson) return false;
            const spec = window.ui.specSelectors.specJson().toJS();
            return spec && spec.paths && Object.keys(spec.paths).length > 0;
        }, { timeout: 15000 });

        const swaggerJson = await frame.evaluate(() => window.ui.specSelectors.specJson().toJS());

        if (swaggerJson) {
            fs.writeFileSync('swagger.json', JSON.stringify(swaggerJson, null, 2));

            if (swaggerJson.definitions) {
                fs.writeFileSync('models.json', JSON.stringify(swaggerJson.definitions, null, 2));
            }

            if (swaggerJson.paths) {
                const endpoints = [];
                for (const [path, methods] of Object.entries(swaggerJson.paths)) {
                    for (const [method, details] of Object.entries(methods)) {
                        endpoints.push({
                            category: details.tags?.[0] || "general",
                            method: method.toUpperCase(),
                            path: path,
                            description: details.summary || details.description || ""
                        });
                    }
                }
                fs.writeFileSync('endpoints.json', JSON.stringify(endpoints, null, 2));
                console.log(`Successfully extracted ${endpoints.length} endpoints and ${Object.keys(swaggerJson.definitions).length} models.`);
            }
        } else {
            console.error("Failed to extract Swagger JSON.");
        }

    } catch (e) {
        console.error("Scraping failed:", e.message);
        process.exit(1);
    }

    await browser.close();
})();
