import { google } from 'googleapis'
import { createServer } from 'http'
import open from 'open'
import { select, multiselect, text, isCancel } from '@clack/prompts'
import consola from 'consola'
import { chromium, type Cookie } from 'playwright'

function convertCookiesToCookieStr(cookies: Cookie[]): string {
    return cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
}

interface AdmobHeaderData {
    'x-framework-xsrf-token': string,
    cookie: string
}

const admobHeaderData = await new Promise<AdmobHeaderData>(async resolve => {
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
                    'x-framework-xsrf-token': xsrfToken,
                    cookie: convertCookiesToCookieStr(cookies)
                })
            }
        }
    });
})

consola.info('admobHeaderData', admobHeaderData)

const oauth2Client = new google.auth.OAuth2(
    '907470986280-5futrsa83oj7nha93giddf2akggo2l4q.apps.googleusercontent.com',
    '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',
    'http://localhost:4848/oauth2callback'
)

// get token
const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
        'https://www.googleapis.com/auth/admob.monetization',
        'https://www.googleapis.com/auth/admob.readonly',
        'https://www.googleapis.com/auth/admob.report',
    ]
})

// open url in browser
try {
    // prompt user a browser will be opened with specific url to authorize
    console.log('Opening browser to authorize')
    await open(authUrl)
} catch (e) {
    // failed to open browser automatically, log the url and prompt user to open it manually
    console.log('Authorize this app by visiting this url:', authUrl)
}
// prompt user to authorize

const { code } = await new Promise<{
    code: string,
    scope: string,
}>((resolve, reject) => {
    const server = createServer((req, res) => {
        if (req.url!.indexOf('/oauth2callback') > -1) {
            const qs = new URL(req.url!, 'http://localhost:4848').searchParams
            // close the server
            resolve({
                ...Object.fromEntries(qs),
            } as any)
            // respone a javascript to close the window
            res.setHeader('Content-Type', 'text/html')

            // respond with a success message
            res.end('<b>Success! You can close this window now.</b>')
            server.close()
        } else {
            res.end('Not found')
        }
    }).listen(4848)
})


const { tokens } = await oauth2Client.getToken(code)

oauth2Client.setCredentials(tokens)

const admobClient = google.admob({
    version: 'v1beta',
    auth: oauth2Client
})



// get all accounts
const accounts = await admobClient.accounts.list()
const selectedAccount = await select({
    message: 'Select an account',
    options: accounts.data.account!.map(x => ({
        label: x.name!,
        value: x,
    })),
    initialValue: accounts.data.account![0],
})
if (isCancel(selectedAccount)) {
    process.exit(0)
}


const apps = await admobClient.accounts.apps.list({
    parent: selectedAccount.name!,
})
const selectedApps = await multiselect({
    message: 'Select apps',
    options: apps.data.apps!.map(x => ({
        label: (x.linkedAppInfo?.displayName || x.name || x.appId!) + ' (' + x.platform + ')',
        value: x,
    })),
    initialValues: apps.data.apps?.filter(x => x.appApprovalState === 'APPROVED') || [],
})
if (isCancel(selectedApps)) {
    process.exit(0)
}
type AdFormat = 'Interstitial' | 'Rewarded' | 'Banner' | 'RewardedInterstitial'

// prompt user to select default ecpm floors
const ecpmFloorsStr = await text({
    message: 'Enter default ecpm floors, separated by comma',
    initialValue: '1000,500,300,100,90,80,70,60,50,40,30,20,10,9,8,7,6,5,4.5,4,3.5,3,2.5,2,1.5,1',
})
if (isCancel(ecpmFloorsStr)) {
    process.exit(0)
}
const ecpmFloors = ecpmFloorsStr.split(',').map(x => parseFloat(x.trim()))
const settings: Record<string, Partial<Record<AdFormat, number[]>>> = {
    gameEnd: {
        Interstitial: ecpmFloors,
    }
}

for (const app of selectedApps) {
    console.log(app.linkedAppInfo?.displayName || app.name || app.appId!)
    for (const [placementId, formats] of Object.entries(settings)) {
        for (const [format, ecpmFloors] of Object.entries(formats)) {
            // get all ad units for the app and see if they match the template
            // const allAdUnits = await admobClient.accounts.adUnits.list({
            //     parent: selectedAccount.name!,
            // }).then(x => x.data.adUnits?.filter(adUnit => adUnit.appId === app.appId) || [])

            // console.log(allAdUnits)

            const allAdUnits = await getListOfAdUnits(app.appId!)
            const ecpmAdUnits = allAdUnits.filter(x => x.displayName!.startsWith('cubeage/' + placementId + '/ecpm/'))
            const ecpmAdUnitsMap = new Map(ecpmAdUnits.map(x => [parseFloat(x.displayName!.split('/').pop()!), x]))
            console.log('ecpmAdUnitsMap', ecpmAdUnitsMap)

            for (const ecpmFloor of ecpmFloors) {
                const adUnit = ecpmAdUnitsMap.get(ecpmFloor)
                if (adUnit) {
                    // update ecpm floor
                    if (adUnit.ecpmFloor.mode === 'Manual floor' && adUnit.ecpmFloor.value !== ecpmFloor) {
                        console.log('update', ecpmFloor)
                    }
                } else {
                    // create ecpm floor
                    console.log('create', ecpmFloor)

                    await createAdUnit({
                        appId: app.appId!,
                        displayName: `cubeage/${placementId}/ecpm/${ecpmFloor}`,
                        adFormat: format as AdFormat,
                        ecpmFloor: {
                            mode: 'Manual floor',
                            value: ecpmFloor,
                            currency: 'USD'
                        }
                    })
                }
            }

            // remove ad units that are not in the template
            const activeUnits = new Set(Array.from(ecpmAdUnitsMap.values()).map(x => x.adUnitId))
            const unitsToBeRemoved = ecpmAdUnits.filter(x => !activeUnits.has(x.adUnitId))
            console.log('unitsToBeRemoved', unitsToBeRemoved)
            // await bulkRemoveAdUnits(unitsToBeRemoved.map(x => x.adUnitId))
        }
    }
}

type DynamicObject = Record<string, any>
function createDynamicObject<T extends object>(target: T = {} as T): DynamicObject {
    const handler: ProxyHandler<T> = {
        get(target, property, receiver) {
            if (property === '__target__') {
                return target;
            }
            // return a proxy if the property doesn't exist
            if (!(property in target)) {
                const emptyObject = {};
                Reflect.set(target, property, emptyObject);
                return new Proxy(emptyObject, handler);
            }
            return Reflect.get(target, property, receiver);
        },
        set(target, property, value) {
            return Reflect.set(target, property, value);
        }
    };

    return new Proxy(target, handler);
}

type EcpmFloor = {
    mode: 'Google Optimize',
    level: 'High' | 'Medium' | 'Low'
} | {
    mode: 'Manual floor',
    value: number
    currency: 'USD'
} | {
    mode: 'Disabled'
}
/**
 * ## Ad Format
 *   Rewarded interstitial
 *   f.req: {"1":{"2":"7957499881","3":"test2","14":8,"16":[2,1],"17":true,"18":{"1":"1","2":"Reward","3":true},"23":{"1":2,"2":3},"27":{"1":1}}}
 *
 *   Interstitial
 *   f.req: {"1":{"2":"7957499881","3":"test4","14":1,"16":[0,1,2],"23":{"1":2,"2":3},"27":{"1":1}}}
 *
 *   Rewarded
 *   f.req: {"1":{"2":"7957499881","3":"test5","14":1,"16":[2,1],"17":true,"18":{"1":"1","2":"Reward","3":true},"23":{"1":2,"2":3},"27":{"1":1}}}
 *
 *   Banner
 *   f.req: {"1":{"2":"7957499881","3":"tsete6","14":0,"16":[0,1,2],"21":true,"23":{"1":2,"2":3},"27":{"1":1}}}
 * 
 * ## Ecpm Floor
 * 
 *   23: {
 *       // Mode: 1 - disabled, 2 - Google Optimize, 3 - Manual floor
 *       1: 3,
 *       // For Google Optimize: 1 - High, 2 - Medium, 3 - Low
 *       // 2: 3,
 *       // For Manual floor
 *       3: {
 *           1: {
 *               1: ecpmFloor * 1000000, "2": "USD"
 *           }
 *       }
 *   },
 * 
 */
function createBody(options: {
    appId: string,
    displayName: string,
    adFormat: AdFormat,
    frequencyCap?: {
        impressions: number,
        durationValue: number,
        durationUnit: 'minutes' | 'hours' | 'days'
    },
    ecpmFloor: EcpmFloor
}) {
    const body = createDynamicObject()

    // handle app id
    body[1][2] = options.appId

    // handle display name
    body[1][3] = options.displayName

    // ecpm floor
    switch (options.ecpmFloor.mode) {
        case 'Google Optimize':
            body[1][23] = {
                1: 2,
                2: options.ecpmFloor.level === 'High' ? 1 : options.ecpmFloor.level === 'Medium' ? 2 : 3,
            }
            break
        case 'Manual floor':
            body[1][23] = {
                1: 3,
                3: {
                    1: {
                        1: options.ecpmFloor.value * 1000000,
                        2: options.ecpmFloor.currency
                    }
                }
            }
            break
        case 'Disabled':
            body[1][23] = {
                1: 1
            }
            break
    }

    // handle ad format
    switch (options.adFormat) {
        case 'Interstitial':
            body[1][14] = 1
            body[1][16] = [0, 1, 2]
            break
        case 'Rewarded':
            body[1][14] = 1
            body[1][16] = [2, 1]
            body[1][17] = true
            body[1][18] = {
                1: '1',
                2: 'Reward',
                3: true
            }
            break
        case 'RewardedInterstitial':
            body[1][14] = 8
            body[1][16] = [2, 1]
            body[1][17] = true
            body[1][18] = {
                1: '1',
                2: 'Reward',
                3: true
            }
            break
        case 'Banner':
            body[1][14] = 0
            body[1][16] = [0, 1, 2]
            body[1][21] = true
            break
    }

    // handle frequency cap
    if (options.frequencyCap) {
        body[1][23][1] = options.frequencyCap.impressions
        body[1][23][2] = options.frequencyCap.durationValue
        switch (options.frequencyCap.durationUnit) {
            case 'minutes':
                body[1][23][1] = 1
                break
            case 'hours':
                body[1][23][1] = 2
                break
            case 'days':
                body[1][23][1] = 3
                break
        }
    }


    // unknown: always set this
    body[1][27] = {
        1: 1
    }

    return body.__target__
}


async function getListOfAdUnits(appId: string) {
    const [appIdPrefix, appIdShort] = appId.split('~')
    const body = {
        "1": [appIdShort]
    }
    const response = await fetch("https://apps.admob.com/inventory/_/rpc/AdUnitService/List?authuser=1&authuser=1&authuser=1&f.sid=4269709555968964600", {
        "headers": {
            "content-type": "application/x-www-form-urlencoded",
            ...admobHeaderData,
        },
        "body": 'f.req=' + encodeURIComponent(JSON.stringify(body)),
        "method": "POST"
    });
    if (!response.ok) {
        const message = await getErrorMessage(response)
        throw new Error('Failed to get ad units: ' + message)
    }

    const pubId = appId.split('~')[0].split('-')[3];
    const json = await response.json()
    const result = [];
    for (const adUnit of (json as any)[1]) {
        // handle ad format
        let adFormat: AdFormat
        if (adUnit[14] == 1 && adUnit[17] == true) {
            adFormat = 'Rewarded'
        } else if (adUnit[14] == 8 && adUnit[17] == true) {
            adFormat = 'RewardedInterstitial'
        } else if (adUnit[14] == 1 && !adUnit[17]) {
            adFormat = 'Interstitial'
        } else if (adUnit[14] == 0 && adUnit[21] == true) {
            adFormat = 'Banner'
        } else {
            throw new Error('Unknown ad format')
        }


        // handle ecpm floors
        let ecpmFloor: EcpmFloor
        switch (adUnit[23][1]) {
            case 1:
                ecpmFloor = {
                    mode: 'Disabled'
                }
                break
            case 2:
                ecpmFloor = {
                    mode: 'Google Optimize',
                    level: adUnit[23][2] === 1 ? 'High' : adUnit[23][2] === 2 ? 'Medium' : 'Low'
                }
                break
            case 3:
                ecpmFloor = {
                    mode: 'Manual floor',
                    value: adUnit[23][3][1][1] / 1000000,
                    currency: adUnit[23][3][1][2]
                }
                break
            default:
                throw new Error('Unknown ecpm floor mode')
        }
        result.push({
            name: `accounts/pub-${pubId}/adUnits/${adUnit[1]}`,
            adUnitId: appIdPrefix + '/' + adUnit[1],
            appId: appIdPrefix + '~' + adUnit[2],
            displayName: adUnit[3],
            adFormat,
            ecpmFloor,
        })
    }
    return result
}


async function createAdUnit(options: {
    appId: string,
    displayName: string,
    adFormat: AdFormat,
    frequencyCap?: {
        impressions: number,
        durationValue: number,
        durationUnit: 'minutes' | 'hours' | 'days'
    },
    ecpmFloor: EcpmFloor
}) {
    const { appId, displayName, adFormat, frequencyCap, ecpmFloor } = options
    const [appIdPrefix, appIdShort] = appId.split('~')
    const body = createBody({
        appId: appIdShort,
        displayName,
        adFormat,
        frequencyCap,
        ecpmFloor
    })

    console.log(body)
    const response = await fetch("https://apps.admob.com/inventory/_/rpc/AdUnitService/Create?authuser=1&authuser=1&authuser=1&f.sid=3583866342012525000", {
        "headers": {
            "content-type": "application/x-www-form-urlencoded",
            ...admobHeaderData,
        },
        "body": 'f.req=' + encodeURIComponent(JSON.stringify(body)),
        "method": "POST"
    });
    if (!response.ok) {
        const message = await getErrorMessage(response)
        throw new Error('Failed to create ad unit: ' + message)
    }
}

async function bulkRemoveAdUnits(adUnitIds: string[]) {
    const adUnitIdsShort = adUnitIds.map(x => x.split('/').pop())
    const body = {
        "1": adUnitIdsShort,
        "2": 1
    }
    const response = await fetch("https://apps.admob.com/inventory/_/rpc/AdUnitService/BulkRemove?authuser=1&authuser=1&authuser=1&f.sid=-4819060855550730000", {
        "headers": {
            "content-type": "application/x-www-form-urlencoded",
            ...admobHeaderData,
        },
        "body": 'f.req=' + encodeURIComponent(JSON.stringify(body)),
        "method": "POST"
    });
    if (!response.ok) {
        const message = await getErrorMessage(response)
        throw new Error('Failed to remove ad units: ' + message)
    }
}

// json:
// {"2":"AdMobServerException{code\u003dCANONICAL_ERROR_RESOURCE_EXHAUSTED, message\u003dcommand_responses {\n  root_ids {\n    publisher_root_ids {\n      publisher_id: 327352636\n    }\n  }\n  status: RESOURCE_EXHAUSTED\n}\nerrors {\n  error_code: \"QUOTA_ERROR_INSUFFICIENT_QUOTA\"\n  error_details {\n    [ads.api.tangle.parameters.errordetail.ReportingJobErrorDetail.reporting_job_details] {\n      reporting_job_name: \"display-ads-tangle-coordinator-prod.server\"\n    }\n  }\n  message: \"Insufficient Data API quota. API Clients: ADMOB_APP_MONETIZATION. Quota Errors: Quota Project: display-ads-storage, Group: ADMOB_APP_MONETIZATION-ADD-AppAdUnit-perApp, User: 327352636-1598902297, Quota status: INSUFFICIENT_TOKENS\"\n  origin: INVALID_REQUEST\n}\nstatus: RESOURCE_EXHAUSTED\nserver_event_id {\n  time_usec: 1710620448693290\n  server_ip: 78029852\n  process_id: 2735394181\n}\n}","5":429,"9":8,"10":{"514648870":{"1":{"1":13109,"2":"command_responses {\n  root_ids {\n    publisher_root_ids {\n      publisher_id: 327352636\n    }\n  }\n  status: RESOURCE_EXHAUSTED\n}\nerrors {\n  error_code: \"QUOTA_ERROR_INSUFFICIENT_QUOTA\"\n  error_details {\n    [ads.api.tangle.parameters.errordetail.ReportingJobErrorDetail.reporting_job_details] {\n      reporting_job_name: \"display-ads-tangle-coordinator-prod.server\"\n    }\n  }\n  message: \"Insufficient Data API quota. API Clients: ADMOB_APP_MONETIZATION. Quota Errors: Quota Project: display-ads-storage, Group: ADMOB_APP_MONETIZATION-ADD-AppAdUnit-perApp, User: 327352636-1598902297, Quota status: INSUFFICIENT_TOKENS\"\n  origin: INVALID_REQUEST\n}\nstatus: RESOURCE_EXHAUSTED\nserver_event_id {\n  time_usec: 1710620448693290\n  server_ip: 78029852\n  process_id: 2735394181\n}\n"}}}}
async function getErrorMessage(response: Response) {
    const json = await response.json() as any
    const adMobServerException = json['2']
    // console.log(adMobServerException)
    // message: "Insufficient Data API quota. API Clients: ADMOB_APP_MONETIZATION. Quota Errors: Quota Project: display-ads-storage, Group: ADMOB_APP_MONETIZATION-ADD-AppAdUnit-perApp, User: 327352636-1598902297, Quota status: INSUFFICIENT_TOKENS"
    const errorMessage = adMobServerException.match(/message: "([^"]+)"/)?.[1]
    return errorMessage
}