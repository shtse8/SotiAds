import consola from "consola"
import { google } from "googleapis"
import open from "open"
import type { Cookie } from "playwright"
import { chromium } from "playwright-extra"
import { getQuery } from "ufo"
import stealth from 'puppeteer-extra-plugin-stealth'

function convertCookiesToCookieStr(cookies: Cookie[]): string {
    return cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
}

export interface GoogleAuthData {
    cookies: Cookie[]
}


export interface AuthData {
    googleAuthData: GoogleAuthData
    admobAuthData: AdmobAuthData
}

export interface AdmobAuthData {
    'x-framework-xsrf-token': string,
    cookie: string
}

const cacheFile = Bun.file('.cache')

export async function getAdmobAuthData() {
    const authData = await cacheFile.exists()
    if (authData) {
        return await cacheFile.json() as AuthData
    }

    const result = await new Promise<AuthData>(async resolve => {

        Bun.write(cacheFile, JSON.stringify(authData))


        const browser = await chromium.launch({
            headless: false,
        })
        const page = await browser.newPage()
        await page.goto('https://apps.admob.com/')

        // watch page 
        page.on('framenavigated', async frame => {
            if (frame === page.mainFrame()) {
                if (page.url() === 'https://apps.admob.com/v2/home') {
                    console.log('new url', page.url());
                    const context = page.context()
                    const cookies = await context.cookies('https://apps.admob.com/v2/home')
                    const body = await page.content()
                    const [_, xsrfToken] = body.match(/xsrfToken: '([^']+)'/) || []
                    if (!xsrfToken) {
                        throw new Error('xsrfToken not found')
                    }
                    browser.close()
                    resolve({
                        admobAuthData: {
                            'x-framework-xsrf-token': xsrfToken,
                            cookie: convertCookiesToCookieStr(cookies)
                        },
                        googleAuthData: {
                            cookies: await context.cookies()
                        }
                    })
                }
            }
        });
    })
    Bun.write(cacheFile, JSON.stringify(result))


    return result
}

export async function getAuthTokens(options: {
    cookies?: Cookie[]
}) {
    const { cookies } = options

    const oauth2Client = new google.auth.OAuth2(
        '907470986280-5futrsa83oj7nha93giddf2akggo2l4q.apps.googleusercontent.com',
        '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',
        'http://localhost:4848/oauth2callback'
    )

    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: [
            // 'https://www.googleapis.com/auth/admob.monetization',
            // 'https://www.googleapis.com/auth/admob.readonly',
            // 'https://www.googleapis.com/auth/admob.report',
            'https://www.googleapis.com/auth/firebase',
            'https://www.googleapis.com/auth/cloud-platform',

        ]
    })


    const [{ code }] = await Promise.all([
        new Promise<{
            code: string,
            scope: string,
        }>((resolve, reject) => {
            const server = Bun.serve({
                port: 4848,
                fetch(req) {
                    const query = getQuery(req.url!) as { code: string, scope: string }
                    resolve(query)
                    server.stop()
                    return new Response('Success! You can close this window now.')
                }
            })
        }),
        (async () => {
            if (cookies) {
                try {
                    chromium.use(stealth())
                    const browser = await chromium.launch({ headless: true })
                    const page = await browser.newPage()
                    const context = page.context()
                    await context.addCookies(cookies)
                    consola.info('Going to authUrl', authUrl)
                    await page.goto(authUrl)
                    await page.waitForSelector("[data-authuser='0']")
                    consola.info('Selecting account')
                    await page.click("[data-authuser='0']")
                    await page.waitForSelector("#submit_approve_access")
                    consola.info('Approving access')
                    await page.click("#submit_approve_access")
                    await page.waitForURL(/^http:\/\/localhost:4848\/oauth2callback/, {
                        waitUntil: 'domcontentloaded'
                    })
                    consola.success('Successfully proceeded with cookies')
                    await browser.close()
                    return
                } catch (e) {
                    consola.warn('Failed to proceed with cookies', e)
                }
            }

            // prompt user to authorize
            // // open url in browser
            try {
                // prompt user a browser will be opened with specific url to authorize
                console.log('Opening browser to authorize')
                await open(authUrl)
            } catch (e) {
                // failed to open browser automatically, log the url and prompt user to open it manually
                console.log('Authorize this app by visiting this url:', authUrl)
            }
        })()
    ])

    consola.info('Got code', code)

    // refresh token
    const { tokens } = await oauth2Client.getToken(code)

    return tokens
}