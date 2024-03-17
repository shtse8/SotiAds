import consola from 'consola'
import { chromium, type Cookie } from 'playwright'

export type AdFormat = 'Interstitial' | 'Rewarded' | 'Banner' | 'RewardedInterstitial' | 'AppOpen'
export type DynamicObject = Record<string, any>
export type EcpmFloor = {
    mode: 'Google Optimize',
    level: 'High' | 'Medium' | 'Low'
} | {
    mode: 'Manual floor',
    value: number
    currency: 'USD'
} | {
    mode: 'Disabled'
}

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
 *   App Open
 *   f.req: {"1":"7867355490","2":"3679512360","3":"App open","9":false,"11":false,"14":7,"15":true,"16":[0,1,2],"17":false,"21":false,"22":{},"23":{"1":3,"3":{"1":{"1":"2500000","2":"USD"}}},"27":{"1":1}}
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
function createBody(options: Partial<AdUnitOptions>) {
    const body = createDynamicObject()

    // handle app id
    body[1][2] = options.appId

    // handle display name
    body[1][3] = options.name

    // ecpm floor
    if (options.ecpmFloor) {
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
        case 'AppOpen':
            body[1][14] = 7
            body[1][16] = [0, 1, 2]
            body[1][15] = true
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


export async function getListOfAdUnits(appId: string, config: { admobAuthData: AdmobAuthData }) {
    const { admobAuthData } = config
    // const [appIdPrefix, appIdShort] = appId.split('~')
    const body = {
        "1": [appId]
    }
    const response = await fetch("https://apps.admob.com/inventory/_/rpc/AdUnitService/List?authuser=1&authuser=1&authuser=1&f.sid=4269709555968964600", {
        "headers": {
            "content-type": "application/x-www-form-urlencoded",
            ...admobAuthData,
        },
        "body": 'f.req=' + encodeURIComponent(JSON.stringify(body)),
        "method": "POST"
    });
    if (!response.ok) {
        const message = await getErrorMessage(response)
        throw new Error('Failed to get ad units: ' + message)
    }

    // const pubId = appId.split('~')[0].split('-')[3];
    const json = await response.json() as Record<string, any>
    if (!Array.isArray(json[1]) || json[1].length === 0) {
        return [];
    }
    const result = [];
    for (const adUnit of json[1]) {
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
        } else if (adUnit[14] == 7 && adUnit[15] == true) {
            adFormat = 'AppOpen'
        } else {
            throw new Error('Unknown ad format: ' + JSON.stringify(adUnit))
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
            adUnitId: adUnit[1],
            appId: adUnit[2],
            name: String(adUnit[3]),
            adFormat,
            ecpmFloor,
        })
    }
    return result
}


interface AdUnitOptions {
    appId: string
    name: string
    adFormat: AdFormat
    frequencyCap?: {
        impressions: number,
        durationValue: number,
        durationUnit: 'minutes' | 'hours' | 'days'
    }
    ecpmFloor: EcpmFloor
}

export async function createAdUnit(options: AdUnitOptions, config: { admobAuthData: AdmobAuthData }) {
    const { appId, name, adFormat, frequencyCap, ecpmFloor } = options
    const { admobAuthData } = config
    // const [appIdPrefix, appIdShort] = appId.split('~')
    const body = createBody({
        appId: appId,
        name,
        adFormat,
        frequencyCap,
        ecpmFloor
    })

    const response = await fetch("https://apps.admob.com/inventory/_/rpc/AdUnitService/Create?authuser=1&authuser=1&authuser=1&f.sid=3583866342012525000", {
        "headers": {
            "content-type": "application/x-www-form-urlencoded",
            ...admobAuthData,
        },
        "body": 'f.req=' + encodeURIComponent(JSON.stringify(body)),
        "method": "POST"
    });
    if (!response.ok) {
        const message = await getErrorMessage(response)
        throw new Error('Failed to create ad unit: ' + message)
    }
}

// body: f.req: {"1":{"1":"8767339703","2":"1598902297","3":"cubeage/gameEnd/ecpm/6","9":false,"11":false,"14":1,"15":true,"16":[0,1,2],"17":false,"21":false,"22":{},"23":{"1":3,"3":{"1":{"1":"1000000","2":"USD"}}},"27":{"1":1}},"2":{"1":["cpm_floor_settings"]}}
async function updateAdUnit(
    appId: string,
    adUnitId: string,
    options: Partial<Exclude<AdUnitOptions, 'appId'>>,
    config: { admobAuthData: AdmobAuthData }) {
    const { name, adFormat, frequencyCap, ecpmFloor } = options
    const { admobAuthData } = config

    // get original data
    const adUnit = await getListOfAdUnits(appId, { admobAuthData }).then(x => x.find(x => x.adUnitId === adUnitId))
    if (!adUnit) {
        throw new Error('Ad unit not found')
    }

    // const [appIdPrefix, appIdShort] = appId.split('~')
    const body = createBody({
        ...adUnit,
        name,
        adFormat,
        frequencyCap,
        ecpmFloor
    })

    body[1][1] = adUnitId

    if (options.ecpmFloor) {
        body[2] = {
            1: ["cpm_floor_settings"]
        }
    }

    const response = await fetch("https://apps.admob.com/inventory/_/rpc/AdUnitService/Update?authuser=1&authuser=1&authuser=1&f.sid=-2228407465145415000", {
        "headers": {
            "content-type": "application/x-www-form-urlencoded",
            ...admobAuthData,
        },
        "body": 'f.req=' + encodeURIComponent(JSON.stringify(body)),
        "method": "POST"
    });
    if (!response.ok) {
        const message = await getErrorMessage(response)
        throw new Error('Failed to update ad unit: ' + message)
    }
}

async function bulkRemoveAdUnits(adUnitIds: string[], config: { admobAuthData: AdmobAuthData }) {
    const { admobAuthData: admobHeaderData } = config
    // const adUnitIdsShort = adUnitIds.map(x => x.split('/').pop())
    const body = {
        "1": adUnitIds,
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


interface AdmobAuthData {
    'x-framework-xsrf-token': string,
    cookie: string
}

function convertCookiesToCookieStr(cookies: Cookie[]): string {
    return cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
}

export function getAdmobAuthData() {
    return new Promise<AdmobAuthData>(async resolve => {
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
}

interface AdmobAppResult {
    appId: string
    name: string
    platform: 'Android' | 'iOS'
    status: 'Active' | 'Inactive'
}
export async function listApps(config: { admobAuthData: AdmobAuthData }): Promise<AdmobAppResult[]> {
    const { admobAuthData } = config
    const response = await fetch("https://apps.admob.com/inventory/_/rpc/InventoryEntityCollectionService/GetAppSnippets?authuser=1&authuser=1&authuser=1&f.sid=-2228407465145415000", {
        method: 'POST',
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
            ...admobAuthData,
        },
        body: 'f.req=' + encodeURIComponent(JSON.stringify({}))
    })
    if (!response.ok) {
        const message = await getErrorMessage(response)
        throw new Error('Failed to list apps: ' + message)
    }

    const json = await response.json() as any
    return json[1].map((x: any) => ({
        appId: x[1],
        name: x[2],
        platform: x[3] == 1 ? 'iOS' : 'Android',
        status: x[19] ? 'Inactive' : 'Active'
    }))
}

export class API {
    constructor(private admobAuthData: AdmobAuthData) { }

    async getListOfAdUnits(appId: string) {
        return await getListOfAdUnits(appId, { admobAuthData: this.admobAuthData })
    }

    async createAdUnit(options: AdUnitOptions) {
        return await createAdUnit(options, { admobAuthData: this.admobAuthData })
    }

    async updateAdUnit(appId: string, adUnitId: string, options: Partial<AdUnitOptions>) {
        return await updateAdUnit(appId, adUnitId, options, { admobAuthData: this.admobAuthData })
    }

    async bulkRemoveAdUnits(adUnitIds: string[]) {
        return await bulkRemoveAdUnits(adUnitIds, { admobAuthData: this.admobAuthData })
    }

    async listApps() {
        return await listApps({ admobAuthData: this.admobAuthData })
    }
}
