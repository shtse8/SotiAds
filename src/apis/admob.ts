import consola from 'consola'
import { chromium } from 'playwright-extra'
import type { AdFormat, Platform } from '../base'
import type { AdmobAuthData, AuthData } from './google'
import stealth from 'puppeteer-extra-plugin-stealth'
import { ofetch, FetchError } from 'ofetch'
import { camelCase, difference, groupBy, inlineSwitch, isArray, mapValues, union, type PromiseResultType, type UnwrapPromise, intersection } from 'xdash'
import { string } from 'valibot'
import { bindSelf, cacheFunc, snakeCase } from 'xdash'


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
interface AdmobAPIConfig {
    auth: AdmobAuthData
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
        case 'Banner':
            body[1][14] = 0
            body[1][16] = [0, 1, 2]
            body[1][21] = true
            break
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

export interface AdUnit {
    adUnitId: string
    adUnitPublicId: string
    appId: string
    name: string
    adFormat: AdFormat
    ecpmFloor: EcpmFloor
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

export interface AdmobAppPayload {
    appId: string
    name: string
    platform: Platform
    status: 'Active' | 'Inactive'
    packageName: string
    projectId: string
}


interface AdmobPublisher {
    email: string
    publisherId: string
}

// 0 - 0000
// 1 - 0001
// 2 - 0010
// 5 - 0101
// 8 - 1000
const formatIdMap: Record<number, AdFormat> = {
    0: 'Banner',
    1: 'Interstitial',
    5: 'Rewarded',
    8: 'RewardedInterstitial'
}
const formatIdReverseMap: Partial<Record<AdFormat, number>> = Object.fromEntries(Object.entries(formatIdMap).map(([k, v]) => [v, k])) as any

const platformIdMap: Record<number, Platform> = {
    1: 'iOS',
    2: 'Android'
}
const platformIdReverseMap: Partial<Record<Platform, number>> = Object.fromEntries(Object.entries(platformIdMap).map(([k, v]) => [v, k])) as any

type AdSourceConfig = Partial<Record<Platform, Partial<Record<AdFormat, AdSourceAdapter>>>>

interface AdSourceAdapter {
    id: string,
    adSourceId: string,
    fields: string[]
}

interface AdSourceData {
    id: string,
    name: string,
    // versioning applied here, get the last item
    partnership: AdSourceConfig
    // waterfall related
    supportOptimisation: boolean,
    waterfallPartnership: Record<string, string>,
    supportOptimisation2: boolean,
    isBidding: boolean,
    mappingRequired: boolean,

}

export interface AllocationInput {
    id: string,
}

export interface AdSourceInput {
    id: string,
    allocations?: AllocationInput[],
}

export interface AllocationPayload {
    id: string,
}

export interface MediationGroupInput {
    name: string
    platform: Platform
    format: AdFormat
    adUnitIds: string[]
    adSources: AdSourceInput[]
}

export interface MediationGroupPayload {
    id: string
    name: string
    platform: Platform
    format: AdFormat
    adUnitIds: string[]
}

function defu(a: any, b: any) {
    const result = { ...a }
    for (const key in b) {
        if (result[key] === undefined) {
            result[key] = b[key]
        }
    }
    return result
}

function admobObj(data: any[]) {
    return Object.fromEntries(data.map((x, i) => [i + 1, x]).filter(x => x !== undefined))
}
export class API {
    constructor(private config: AuthData) { }

    async getPublicAdUnitId(adUnitId: string) {
        const publisher = await this.getPublisher()
        return `ca-app-${publisher.publisherId}/${adUnitId}`
    }

    async fetch(url: string, body: any = {}) {
        const { admobAuthData: auth } = this.config
        try {
            const json = await ofetch(url, {
                method: 'POST',
                headers: {
                    'content-type': 'application/x-www-form-urlencoded',
                    ...auth,
                },
                body: 'f.req=' + encodeURIComponent(JSON.stringify(body)),
                responseType: 'json'
            })
            const { 1: data, 2: error } = json
            // if (error) {
            //     throw new Error(JSON.stringify(error))
            // }
            return data
        } catch (e) {
            if (e instanceof FetchError) {
                // consola.log(e.data)
                const adMobServerException = e.data['2']
                // message: "Insufficient Data API quota. API Clients: ADMOB_APP_MONETIZATION. Quota Errors: Quota Project: display-ads-storage, Group: ADMOB_APP_MONETIZATION-ADD-AppAdUnit-perApp, User: 327352636-1598902297, Quota status: INSUFFICIENT_TOKENS"
                const message = adMobServerException.match(/message: "([^"]+)"/)?.[1]
                throw new Error('Failed to fetch: ' + message)
            } else {
                throw e
            }
        }
    }

    parseAdUnitResponse(response: any) {
        // handle ad format
        let adFormat: AdFormat
        if (response[14] == 1 && response[17] == true) {
            adFormat = 'Rewarded'
        } else if (response[14] == 8 && response[17] == true) {
            adFormat = 'RewardedInterstitial'
        } else if (response[14] == 1 && !response[17]) {
            adFormat = 'Interstitial'
        } else if (response[14] == 0 && response[21] == true) {
            adFormat = 'Banner'
        } else if (response[14] == 7 && response[15] == true) {
            adFormat = 'AppOpen'
        } else {
            throw new Error('Unknown ad format: ' + JSON.stringify(response))
        }


        // handle ecpm floors
        let ecpmFloor: EcpmFloor
        switch (response[23][1]) {
            case 1:
                ecpmFloor = {
                    mode: 'Disabled'
                }
                break
            case 2:
                ecpmFloor = {
                    mode: 'Google Optimize',
                    level: response[23][2] === 1 ? 'High' : response[23][2] === 2 ? 'Medium' : 'Low'
                }
                break
            case 3:
                ecpmFloor = {
                    mode: 'Manual floor',
                    value: response[23][3][1][1] / 1000000,
                    currency: response[23][3][1][2]
                }
                break
            default:
                throw new Error('Unknown ecpm floor mode')
        }
        return {
            adUnitId: response[1] as string,
            appId: response[2] as string,
            name: String(response[3]),
            adFormat,
            ecpmFloor,
        } as AdUnit
    }

    async getListOfAdUnits(appId: string) {
        // const [appIdPrefix, appIdShort] = appId.split('~')
        const body = {
            "1": [appId]
        }
        const json = await this.fetch("https://apps.admob.com/inventory/_/rpc/AdUnitService/List?authuser=1&authuser=1&authuser=1&f.sid=4269709555968964600", body);
        if (!Array.isArray(json) || json.length === 0) {
            return [];
        }
        const result = [] as AdUnit[];
        for (const entry of json) {
            const adUnit = this.parseAdUnitResponse(entry)
            result.push(adUnit)
        }
        return result
    }

    async createAdUnit(options: AdUnitOptions) {
        const { appId, name, adFormat, frequencyCap, ecpmFloor } = options
        // const [appIdPrefix, appIdShort] = appId.split('~')
        const body = createBody({
            appId: appId,
            name,
            adFormat,
            frequencyCap,
            ecpmFloor
        })

        const json = await this.fetch("https://apps.admob.com/inventory/_/rpc/AdUnitService/Create?authuser=1&authuser=1&authuser=1&f.sid=3583866342012525000", body);
        return this.parseAdUnitResponse(json)
    }

    // body: f.req: {"1":{"1":"8767339703","2":"1598902297","3":"cubeage/gameEnd/ecpm/6","9":false,"11":false,"14":1,"15":true,"16":[0,1,2],"17":false,"21":false,"22":{},"23":{"1":3,"3":{"1":{"1":"1000000","2":"USD"}}},"27":{"1":1}},"2":{"1":["cpm_floor_settings"]}}
    async updateAdUnit(appId: string, adUnitId: string, options: Partial<AdUnitOptions>) {
        const { name, adFormat, frequencyCap, ecpmFloor } = options

        // get original data
        const adUnit = await this.getListOfAdUnits(appId).then(x => x.find(x => x.adUnitId === adUnitId))
        if (!adUnit) {
            throw new Error('Ad unit not found')
        }

        if (adFormat && adUnit.adFormat !== adFormat) {
            throw new Error('Ad format cannot be changed')
        }



        // const [appIdPrefix, appIdShort] = appId.split('~')
        const body = createBody(defu(options, adUnit))

        body[1][1] = adUnitId

        const updated = <string[]>[]
        if (ecpmFloor && JSON.stringify(adUnit.ecpmFloor) !== JSON.stringify(ecpmFloor)) {
            updated.push('cpm_floor_settings')
        }
        if (name && adUnit.name !== name) {
            updated.push('name')
        }
        // if (options.frequencyCap) {
        //     updated.push('frequency_cap')
        // }

        if (updated.length > 0) {
            body[2] = Object.fromEntries(updated.map((x, i) => [i + 1, [x]]))
        } else {
            return
        }

        const response = await this.fetch("https://apps.admob.com/inventory/_/rpc/AdUnitService/Update?authuser=1&authuser=1&authuser=1&f.sid=-2228407465145415000", body);
    }

    async bulkRemoveAdUnits(adUnitIds: string[]) {
        // const adUnitIdsShort = adUnitIds.map(x => x.split('/').pop())
        const json = await this.fetch(
            "https://apps.admob.com/inventory/_/rpc/AdUnitService/BulkRemove?authuser=1&authuser=1&authuser=1&f.sid=-4819060855550730000",
            {
                "1": adUnitIds,
                "2": 1
            });
    }

    async listApps(): Promise<AdmobAppPayload[]> {
        const json = await this.fetch("https://apps.admob.com/inventory/_/rpc/InventoryEntityCollectionService/GetApps?authuser=1&authuser=1&authuser=1&f.sid=-2228407465145415000")
        return json.map((x: any) => (<AdmobAppPayload>{
            appId: x[1],
            name: x[2],
            platform: x[3] == 1 ? 'iOS' : 'Android',
            status: x[19] ? 'Inactive' : 'Active',
            packageName: x[22],
            projectId: x?.[23]?.[2]?.[1]
        }))
    }

    private getPublisher = cacheFunc(bindSelf(this)._getPublisher)
    async _getPublisher() {
        const json = await this.fetch('https://apps.admob.com/publisher/_/rpc/PublisherService/Get?authuser=1&authuser=1&authuser=1&f.sid=2563678571570077000')
        return {
            email: json[1][1],
            publisherId: json[2][1]
        }
    }

    parseMediationGroupResponse(response: any) {
        return <MediationGroupPayload>{
            id: response[1],
            name: response[2],
            platform: platformIdMap[response[4][1]],
            format: formatIdMap[response[4][2]],
            adUnitIds: response[4][3] || [] as string[]
            // adSources: response[5]?.map((x: any) => ({
            //     id: x[1],
            //     adSource: x[2] as AdSource,
        }
    }

    // async getMediationGroup(id: string) {
    //     const json = await this.fetch('https://apps.admob.com/mediationGroup/_/rpc/MediationGroupService/Get?authuser=1&authuser=1&authuser=1&f.sid=-1119854189466099600', {
    //         1: id
    //     })
    //     return this.parseMediationGroupResponse(json)
    // }

    async listMediationGroups() {
        const json = await this.fetch('https://apps.admob.com/mediationGroup/_/rpc/MediationGroupService/List?authuser=1&authuser=1&authuser=1&f.sid=-2500048687334755000')
        const result = <MediationGroupPayload[]>[]
        for (const entry of json) {
            if (entry[1] === "0") {
                // we don't need admob default network
                continue;
            }
            result.push(this.parseMediationGroupResponse(entry))
        }
        return result
    }

    async updateMediationGroup(id: string, options: MediationGroupInput) {
        // mediationGroup.
        const { name, platform, format, adUnitIds, adSources } = options
        const adSourceData = await this.getAdSourceData()
        const data = await this.fetch('https://apps.admob.com/mediationGroup/_/rpc/MediationGroupService/Get?authuser=1&authuser=1&authuser=1&f.sid=-1119854189466099600', {
            1: id
        })

        // update name
        if (data[2] != name) {
            data[2] = name
        }

        // update ad unit ids
        if (data[4][3] != adUnitIds) {
            data[4][3] = adUnitIds
        }

        // update ad sources
        const currentAdSources = data[5]
        const currentAdSourceIds = currentAdSources.map((x: any) => x[2])
        const newAdSourceIds = adSources.map(x => x.id)
        const toAdd = difference(newAdSourceIds, currentAdSourceIds)
        const toKeep = intersection(newAdSourceIds, currentAdSourceIds)
        if (toKeep.length != currentAdSources.length) {
            const adSourcesRequestData = [
                ...currentAdSources.filter((x: any) => toKeep.includes(x[2])),
            ]
            for (const id of toAdd) {
                const source = adSourceData[id]
                adSourcesRequestData.push({
                    2: id,
                    3: adSourceFormatReversedMap[format],
                    4: 1,
                    5: {
                        1: "10000",
                        2: 'USD'
                    },
                    6: false,
                    9: source.name,
                    11: 1,
                    14: '1'
                })
            }
            data[5] = adSourcesRequestData
        }

        const json = await this.fetch('https://apps.admob.com/mediationGroup/_/rpc/MediationGroupService/V2Update?authuser=1&authuser=1&authuser=1&f.sid=7739685128981884000', {
            1: data
        })

    }


    // {"1":"cubeage/[appid]/[platform]/[placement]/[format]","2":1,"3":{"1":2,"2":1,"3":["7023861009","6137655985","7450737654","5199058969","3738637639","7469999081","8763819327","1076900999","6512140634","2389982664","3456277041","7825222309","8342606364","1760778342","3073860019","9138303971","1904356376","7029524690","9655688034","3217438048","2842867673","4317932578","1112474290","5631014241","2425555965","1175273226","6782112687","9463228294","6298843050","4106690332","7355939703","8669021375","8039030632","2897819940","1776309966","7611924729","9352112305","4210901619","2978275641","5523983289","3672679713","5271867690","6837064958","3089391633","8150146629","2526849508","1665193972","4985761385","6628363157","4402473305"]},"4":[{"2":"1","3":1,"4":1,"5":{"1":"10000","2":"USD"},"6":false,"9":"AdMob Network","11":1,"14":"1"}]}
    async createMediationGroup(options: MediationGroupInput) {
        const { name, platform, format, adUnitIds, adSources } = options
        // const list = await this.listAdSources()
        const adSourceData = await this.getAdSourceData()
        const body = {
            1: name,
            2: 1,
            3: {
                1: 2,
                2: inlineSwitch(format)
                    .case('Interstitial', () => 1)
                    .case('Rewarded', () => 5)
                    .execute(),
                3: adUnitIds
            },
            4: [
                {
                    2: AdSource.AdmobNetwork,
                    3: 1,
                    4: 1,
                    5: {
                        1: "10000",
                        2: 'USD'
                    },
                    6: false,
                    9: adSourceData[AdSource.AdmobNetwork].name,
                    11: 1,
                    14: '1'
                },
                ...adSources.map((x) => ({
                    2: x.id,
                    3: adSourceFormatReversedMap[format],
                    4: 1,
                    5: {
                        1: "10000",
                        2: 'USD'
                    },
                    6: false,
                    9: adSourceData[x.id].name,
                    11: 1,
                    13: x.allocations?.map(x => x.id),  // allocation ids
                    14: '1'
                }))
                //     {
                //     2: "1",
                //     3: 1,
                //     4: 1,
                //     5: {
                //         1: "10000",
                //         2: 'USD'
                //     },
                //     6: false,
                //     9: 'AdMob Network',
                //     11: 1,
                //     14: '1'
                // }
            ]
        }
        // consola.log('body', body)
        const json = await this.fetch('https://apps.admob.com/mediationGroup/_/rpc/MediationGroupService/V2Create?authuser=1&authuser=1&authuser=1&f.sid=2458665903996893000', body)
        return this.parseMediationGroupResponse(json)
    }

    async deleteMediationGroups(ids: string[]) {
        const json = await this.fetch('https://apps.admob.com/mediationGroup/_/rpc/MediationGroupService/BulkStatusChange?authuser=1&authuser=1&authuser=1&f.sid=-4151608546174543400', {
            1: ids,
            // 1 - enable
            // 2 - pause
            // 3 - remove
            2: 3
        })
    }

    async listAdSources(): Promise<AdSource[]> {
        const json = await this.fetch('https://apps.admob.com/adSource/_/rpc/AdSourceService/ListAdSourceConfigurations?authuser=1&authuser=1&authuser=1&f.sid=5939125256556344000', {
            1: false
        })
        const adSourceData = await this.getAdSourceData()
        return json.map((x: any) => ({
            id: x[1],
            name: adSourceData[x[1]].name,
            status: adSourceStatusMap[x[2]] || AdSourceStatus.NotAvailable,
            data: x
        }))
    }


    async updateMediationAllocation(adUnitIds: string[], adapter: AdSourceAdapter, data: Record<string, string>): Promise<AllocationPayload[]> {
        // validate input
        const inputFields = Object.keys(data).map(camelCase)
        const requiredFields = adapter.fields.map(camelCase)
        const missingFields = difference(requiredFields, inputFields)
        if (missingFields.length > 0) {
            throw new Error('Missing fields: ' + missingFields.join(', '))
        }

        const json = await this.fetch('https://apps.admob.com/mediationAllocation/_/rpc/MediationAllocationService/Update?authuser=1&authuser=1&authuser=1&f.sid=2153727026438702600', {
            1: adUnitIds.map(x => ({
                1: "-1",
                3: adapter.adSourceId,
                4: adapter.fields.map(x => ({
                    1: x,
                    2: data[camelCase(x)] // we always use camel
                })),
                12: x,
                15: "",
                16: adapter.id,
            })),
            2: [],
        })
        /*
        [
            {
                "1": "9952063278640290",
                "2": true,
                "3": "395",
                "4": [
                    {
                        "1": "appid",
                        "2": "1234"
                    },
                    {
                        "1": "placementid",
                        "2": "1234"
                    }
                ],
                "5": {
                    "1": {
                        "1": "-2",
                        "2": "XXX"
                    }
                },
                "7": false,
                "9": false,
                "10": 6,
                "11": "1711108683809",
                "12": "8219263534",
                "15": "",
                "16": "479"
            }
        ]
        */
        return json.map((x: any) => (<AllocationPayload>{
            id: x[1],
        }))
    }

    readonly getPageData = cacheFunc(bindSelf(this)._getPageData)
    async _getPageData() {
        const { cookies } = this.config.googleAuthData
        chromium.use(stealth())
        const browser = await chromium.launch({ headless: true })
        const page = await browser.newPage()
        const context = page.context()
        await context.addCookies(cookies)
        // consola.info('Going to authUrl', )
        await page.goto('https://apps.admob.com/v2/home')
        // execute js
        // @ts-ignore
        const result = await page.evaluate(() => amrpd);
        const json = JSON.parse(result)
        await browser.close()
        return json
    }

    readonly getAdSourceData = cacheFunc(bindSelf(this)._getAdSourceData)
    async _getAdSourceData(): Promise<Record<string, AdSourceData>> {
        const pageData = await this.getPageData()
        const adSources = {} as Record<string, any>
        function createAdapters(adSourceId: string, config: any): AdSourceConfig {
            if (!config) {
                return {}
            }
            return mapValues(
                groupBy(
                    config,
                    (x: any) => platformIdMap[x[1]]
                ),
                (x: any) => mapValues(
                    groupBy(
                        x,
                        (x: any) => adSourceFormatMap[x[3]]
                    )
                    , x => {
                        const firstEntry = x[0]
                        return (<AdSourceAdapter>{
                            id: firstEntry[4],
                            adSourceId: adSourceId,
                            fields: firstEntry[2]?.map((x: any) => x[1]) || []
                        })
                    }
                )
            )
        }
        for (const adSource of pageData[10][1]) {
            const id = adSource[1]
            adSources[id] = <AdSourceData>{
                id: id,
                name: adSource[2],
                // versioning applied here, get the last item
                partnership: createAdapters(id, adSource[3]),
                // waterfall related
                supportOptimisation: adSource[4],
                waterfallPartnership: adSource[5] && isArray(adSource[5]) ? Object.fromEntries(adSource[5].map((x: any) => [x[1], x[2]])) : undefined,
                supportOptimisation2: adSource[6],
                isBidding: adSource[8],
                mappingRequired: adSource[9] == 1,
                unknown: adSource[10],
                // data: adSource
            }
        }
        return adSources
    }
}

// 3 - rewarded
// 4 - native
// 5 - banner
// 6 - interstitial
// 7 - rewarded interstitial
// Meta - 3, 4, 5, 6, 7
// Liftoff - 3, 5, 6, 7
// Applovin - 3, 6
// AdColony - 3, 5, 6 
const adSourceFormatMap: Record<number, AdFormat> = {
    3: 'Rewarded',
    4: 'Native',
    5: 'Banner',
    6: 'Interstitial',
    7: 'RewardedInterstitial'
}
const adSourceFormatReversedMap = Object.fromEntries(Object.entries(adSourceFormatMap).map(([x, y]) => [y, x]))


// interface AdSource {
//     id: string,
//     name: AdSourceName,
//     status: AdSourceStatus
// }

export enum AdSourceStatus {
    NotAvailable,
    Idle,
    Pending,
    Active,
    StartedAgreement,
    Rejected,
}
const adSourceStatusMap: Record<number, AdSourceStatus> = {
    0: AdSourceStatus.NotAvailable,
    1: AdSourceStatus.Idle,
    2: AdSourceStatus.Pending,
    3: AdSourceStatus.Active,
    4: AdSourceStatus.StartedAgreement,
    5: AdSourceStatus.Rejected,
}
const adSourceStatusReverseMap: Record<AdSourceStatus, number> = Object.fromEntries(Object.entries(adSourceStatusMap).map(([k, v]) => [v, k])) as any

export enum AdSource {
    AdmobNetwork = "1",
    AdGeneration = "104",
    AdColony = "84",
    Applovin = "85",
    ChocolatePlatform = "101",
    EMX = "396",
    Equativ = "111",
    Fluct = "94",
    ImproveDigital = "95",
    IndexExchange = "71",
    InMobiExchange = "118",
    LiftoffMobile = "82",
    MediaNet = "103",
    MetaAudienceNetwork = "88",
    Mintegral = "403",
    Mobfox = "110",
    OneTagExchange = "397",
    OpenX = "75",
    Pangle = "395",
    PubMatic = "93",
    Rubicon = "86",
    Sharethrough = "108",
    Smaato = "70",
    Sonobi = "107",
    Tapjoy = "81",
    UnrulyX = "92",
    VerveGroup = "404",
    Yieldmo = "106",
    YieldOne = "109",
}

interface AdSourcePangleConfig {
    placementId: string
    appId: string
}