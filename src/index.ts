import { select, multiselect, text, isCancel } from '@clack/prompts'
import { firebase_v1beta1, google } from 'googleapis'
import consola from 'consola'
import { getAdmobAuthData, API } from './admobApi'
import { entries, chain, groupBy, firstOrDefault, mapValues, flatMap, $op, filter, kebabCase, camelCase } from 'xdash'
import open from 'open'
import { createServer } from 'http'
import { getRemoteConfig, type RemoteConfigTemplate } from 'firebase-admin/remote-config'
import { refreshToken, initializeApp, getApps } from 'firebase-admin/app'
import { getQuery } from 'ufo'
import { AppPlatform } from 'firebase-admin/project-management'
import { createApp, createRouter } from 'h3'
import { chromium } from 'playwright-extra'
import stealth from 'puppeteer-extra-plugin-stealth'
import type { AdFormat, Platform } from './base'
import { getAppConfig, getConfiguredApps } from './read'

const cacheFile = Bun.file('.cache')
const authData = await cacheFile.exists() ? await (cacheFile.json() as ReturnType<typeof getAdmobAuthData>) : await getAdmobAuthData()
Bun.write(cacheFile, JSON.stringify(authData))


const admob = new API(authData.admobAuthData)


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
        if (authData.googleAuthData.cookies) {
            try {
                chromium.use(stealth())
                const browser = await chromium.launch({ headless: true })
                const page = await browser.newPage()
                const context = page.context()
                await context.addCookies(authData.googleAuthData.cookies)
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

console.log('code', code)

// update refresh token
type PlatformString = `${Platform}:${string}`;
type PromiseType<T> = T extends Promise<infer R> ? R : never;
class FirebaseManager {
    private firebaseApp = new Map<string, ReturnType<typeof initializeApp>>()
    private appFirebaseMap = new Map<PlatformString, ReturnType<typeof initializeApp>>()
    private isInitialized = false
    private access_token: string | undefined | null
    private credential = {
        getAccessToken: async () => {
            return {
                access_token: this.access_token!,
                expires_in: Date.now() + 1000 * 60 * 60,
            }
        }
    }
    private firebase: firebase_v1beta1.Firebase | undefined;

    constructor(private code: string) {
    }


    private useFirebaseApp(projectId: string) {
        if (this.firebaseApp.has(projectId)) {
            return this.firebaseApp.get(projectId)!
        }
        const app = initializeApp({
            credential: this.credential,
            projectId,
        }, projectId)
        this.firebaseApp.set(projectId, app)
        return app
    }

    createPlatformString(platform: Platform, packageName: string): PlatformString {
        return `${platform}:${packageName}` as PlatformString;
    }

    async init() {
        if (this.isInitialized) {
            return
        }
        this.isInitialized = true

        const { tokens } = await oauth2Client.getToken(code)
        this.access_token = tokens.access_token;

        oauth2Client.setCredentials(tokens)

        if (!tokens.refresh_token) {
            throw new Error('No refresh token')
        }

        this.firebase = google.firebase({
            version: 'v1beta1',
            auth: oauth2Client,
        })

        // list all projects
        // const projects = await firebase.projects.list()

        // for (const project of projects.data.results!) {
        //     console.log('searching in', project.projectId)
        //     const androidAppsResponse = await firebase.projects.androidApps.list({
        //         parent: `projects/${project.projectId}`,
        //     })

        //     if (androidAppsResponse.data.apps) {
        //         for (const app of androidAppsResponse.data.apps) {
        //             this.appFirebaseMap.set(this.createPlatformString('Android', app.packageName!), this.useFirebaseApp(project.projectId!, project.projectId!))
        //         }
        //     }

        //     const iosAppsResponse = await firebase.projects.iosApps.list({
        //         parent: `projects/${project.projectId}`,
        //     })
        //     if (iosAppsResponse.data.apps) {
        //         for (const app of iosAppsResponse.data.apps) {
        //             this.appFirebaseMap.set(this.createPlatformString('iOS', app.bundleId!), this.useFirebaseApp(project.projectId!, project.projectId!))
        //         }
        //     }
        // }
    }

    // async getApp(projectId: string, platform: Platform, packageName: string) {
    //     await this.init()

    //     return this.useFirebaseApp(projectId)

    //     // return this.appFirebaseMap.get(this.createPlatformString(platform, packageName))
    // }

    async updateRemoteConfig(projectId: string, updater: (template: RemoteConfigTemplate) => void) {
        const app = this.useFirebaseApp(projectId)
        if (!app) {
            throw new Error('App not found')
        }
        const remoteConfig = getRemoteConfig(app)
        const template = await remoteConfig.getTemplate()
        updater(template)
        if (JSON.stringify(template) === JSON.stringify(await remoteConfig.getTemplate())) {
            consola.info('No changes')
            return
        }
        await remoteConfig.publishTemplate(template)
    }

    async updateAdUnits(options: {
        projectId: string
        platform: Platform
        placementId: string
        format: AdFormat
        ecpmFloors: Record<number, string>
    }) {
        const { projectId, platform, placementId, format, ecpmFloors } = options
        await this.updateRemoteConfig(projectId, template => {
            // create Android and iOS conditions
            if (!template.conditions.some(x => x.name === platform)) {
                template.conditions.push({
                    name: platform,
                    expression: 'device.os == \'android\'',
                    tagColor: platform == 'Android' ? 'GREEN' : 'CYAN',
                })
            }

            const groupKey = `ad_placement_${camelCase(placementId)}_${camelCase(format)}_adUnitID_ecpm`
            const group = template.parameterGroups[groupKey] ??= {
                description: 'Ad placement ${placementId} values',
                parameters: {}
            }
            group.parameters ??= {}
            for (const [ecpm, adUnitId] of Object.entries(ecpmFloors)) {
                const key = groupKey + '_' + (Number(ecpm) * 10000)

                const parameter = group.parameters[key] ??= {
                    defaultValue: {
                        useInAppDefault: true
                    },
                }
                parameter.conditionalValues ??= {}
                parameter.conditionalValues[platform] = {
                    value: adUnitId
                }
            }

        })
    }
}


const firebaseManager = new FirebaseManager(code)
await firebaseManager.init()

// get all accounts
// const accounts = await admobClient.accounts.list()
// const selectedAccount = await select({
//     message: 'Select an account',
//     options: accounts.data.account!.map(x => ({
//         label: x.name!,
//         value: x,
//     })),
//     initialValue: accounts.data.account![0],
// })
// if (isCancel(selectedAccount)) {
//     process.exit(0)
// }


const apps = await admob.listApps()
// consola.info('apps', apps)
const configuredApps = getConfiguredApps()
const selectedApps = apps.filter(x => x.projectId).filter(x => configuredApps.includes(x.appId!))
console.log('selectedApps', selectedApps)

// const selectedApps = await multiselect({
//     message: 'Select apps',
//     options: apps.filter(x => x.projectId).map(x => ({
//         label: (x.name || x.appId) + ' (' + x.projectId + ' - ' + x.platform + ':' + x.packageName + ')',
//         value: x,
//     })),
//     initialValues: apps.filter(x => false) || [],
// })
// if (isCancel(selectedApps)) {
//     process.exit(0)
// }

// // prompt user to select default ecpm floors
// const ecpmFloorsStr = await text({
//     message: 'Enter default ecpm floors, separated by comma',
//     initialValue: '1000,500,300,100,90,80,70,60,50,40,30,20,10,9,8,7,6,5,4.5,4,3.5,3,2.5,2,1.5,1',
// })
// if (isCancel(ecpmFloorsStr)) {
//     process.exit(0)
// }
// const ecpmFloors = ecpmFloorsStr.split(',').map(x => parseFloat(x.trim()))
// const settings: Record<string, Partial<Record<AdFormat, number[]>>> = {
//     default: {
//         Interstitial: ecpmFloors,
//         Rewarded: ecpmFloors,
//         RewardedInterstitial: ecpmFloors,
//     }
// }

interface AdUnitNameParts {
    placementId: string
    format: AdFormat
    ecpmFloor: number
}
function parseAdUnitName(name: string): AdUnitNameParts {
    const parts = name.split('/')
    return {
        placementId: parts[1],
        format: parts[2] as AdFormat,
        ecpmFloor: parseFloat(parts[3]),
    }
}

function stringifyAdUnitName(options: AdUnitNameParts): string {
    return `cubeage/${options.placementId}/${options.format}/${options.ecpmFloor}`
}


for (const app of selectedApps) {
    const appConfig = getAppConfig(app.appId!)
    const allAdUnits = await admob.getListOfAdUnits(app.appId)
    // create a map of ad units
    const adUnitsMap = chain(allAdUnits)
        .pipe(
            $op(filter)(x => x.name.startsWith('cubeage/')),
            $op(groupBy)(x => parseAdUnitName(x.name).placementId),
            $op(mapValues)(x => chain(x)
                .pipe(
                    $op(groupBy)(x => parseAdUnitName(x.name).format),
                    $op(mapValues)(x => chain(x)
                        .pipe(
                            $op(groupBy)(x => parseAdUnitName(x.name).ecpmFloor)
                        )
                        .value()
                    )
                )
                .value()
            )) // { placementId: { format: { ecpmFloor: AdUnit[] } } }
        .value()

    consola.info('Updating ad units for', app.name)
    for (const [placementId, formats] of Object.entries(appConfig.placements)) {
        for (const [format, formatConfig] of Object.entries(formats)) {
            const ecpmFloors = formatConfig.ecpmFloors
            // get all ad units for the app and see if they match the template
            // const allAdUnits = await admobClient.accounts.adUnits.list({
            //     parent: selectedAccount.name!,
            // }).then(x => x.data.adUnits?.filter(adUnit => adUnit.appId === app.appId) || [])

            // console.log(allAdUnits)

            const ecpmAdUnits = adUnitsMap[placementId]?.[format] || {}
            // console.log('ecpmAdUnitsMap', ecpmAdUnitsMap)

            const resultAdUnits: Record<number, string> = {}
            let isInsufficientDataAPIQuota = false
            const ecpmFloorAdUnitsToRemove: string[] = []
            for (const ecpmFloor of ecpmFloors!) {
                const adUnits = ecpmAdUnits[ecpmFloor] || []
                let adUnit = firstOrDefault(adUnits, null)
                if (adUnits.length > 1) {
                    ecpmFloorAdUnitsToRemove.push(...adUnits.slice(1).map(x => x.adUnitId))
                }
                if (adUnit) {
                    // update ecpm floor
                    if (adUnit.ecpmFloor.mode === 'Manual floor' && adUnit.ecpmFloor.value !== ecpmFloor) {
                        consola.info('Updating ad unit', adUnit.name, `from ${adUnit.ecpmFloor.value} to ${ecpmFloor}`)
                        try {
                            await admob.updateAdUnit(adUnit.appId, adUnit.adUnitId, {
                                ecpmFloor: {
                                    mode: 'Manual floor',
                                    value: ecpmFloor,
                                    currency: 'USD'
                                }
                            })
                        } catch (e) {
                            console.error(e)
                        }
                    }
                } else {
                    const name = stringifyAdUnitName({ placementId, format: format as AdFormat, ecpmFloor })
                    consola.info('Creating ad unit', name)
                    if (isInsufficientDataAPIQuota) {
                        consola.fail('Insufficient Data API quota')
                        continue;
                    }
                    // create ecpm floor
                    // console.log('create', ecpmFloor)
                    try {
                        adUnit = await admob.createAdUnit({
                            appId: app.appId!,
                            name,
                            adFormat: format as AdFormat,
                            ecpmFloor: {
                                mode: 'Manual floor',
                                value: ecpmFloor,
                                currency: 'USD'
                            }
                        })
                        consola.success('Created ad unit', adUnit.adUnitId)
                    } catch (e) {
                        if (e instanceof Error && e.message.includes('Insufficient Data API quota')) {
                            consola.fail(e.message)
                            isInsufficientDataAPIQuota = true
                        } else {
                            console.error(e)
                        }
                    }
                }

                if (adUnit) {
                    resultAdUnits[ecpmFloor] = 'ca-app-pub-7587088496225646/' + adUnit?.adUnitId
                }
            }

            // remove ad units that are not in the template
            console.log('unitsToRemove', ecpmFloorAdUnitsToRemove.length)
            if (ecpmFloorAdUnitsToRemove.length > 0) {
                consola.info('Removing ad units', ecpmFloorAdUnitsToRemove)
                try {
                    await admob.bulkRemoveAdUnits(ecpmFloorAdUnitsToRemove)
                    consola.success('Removed ad units', ecpmFloorAdUnitsToRemove)
                } catch (e) {
                    consola.fail('Failed to remove ad units', ecpmFloorAdUnitsToRemove)
                }
            }
            // await bulkRemoveAdUnits(unitsToBeRemoved.map(x => x.adUnitId))


            // let ecpmFloorsMap = adUnitsMap[placementId]?.[format] || {}
            // let ecpmFloors2 = mapValues(ecpmFloorsMap, x => x.map(x => x.adUnitId)[0])
            // // update to firebase
            consola.info('Updating remote config', placementId, format, resultAdUnits)
            await firebaseManager.updateAdUnits({
                projectId: app.projectId,
                platform: app.platform,
                placementId: placementId,
                format: format as AdFormat,
                ecpmFloors: resultAdUnits
            })
            consola.success('Updated remote config', placementId, format, resultAdUnits)
        }

        // remove non-exising format ad units
        const formatAdUnitsToRemove = flatMap(
            entries(adUnitsMap[placementId] || {}),
            ([format, ecpmFloors]) => {
                if (format in formats) {
                    return []
                }
                return flatMap(entries(ecpmFloors), ([ecpmFloor, adUnits]) => adUnits)
            }
        )
        if (formatAdUnitsToRemove.length > 0) {
            consola.info('Removing ad units', formatAdUnitsToRemove.map(x => x.name))
            try {
                await admob.bulkRemoveAdUnits(formatAdUnitsToRemove.map(x => x.adUnitId))
                consola.success('Removed ad units', formatAdUnitsToRemove.map(x => x.name))
            } catch (e) {
                consola.fail('Failed to remove ad units', formatAdUnitsToRemove.map(x => x.name))
            }
        }


    }

    // remove non-exising placement ad units
    const placementAdUnitsToRemove = chain(adUnitsMap)
        .pipe(
            entries,
            $op(flatMap)(([placementId, formats]) => {
                if (placementId in settings) {
                    return []
                }
                return chain(formats)
                    .pipe(
                        entries,
                        $op(flatMap)(([format, ecpmFloors]) => chain(ecpmFloors)
                            .pipe(
                                entries,
                                $op(flatMap)(([ecpmFloor, adUnits]) => adUnits))
                            .value()
                        ))
                    .value()
            }))
        .value()

    // flatMap(
    //     entries(adUnitsMap),
    //     ([placementId, formats]) => {
    //         if (placementId in settings) {
    //             return []
    //         }
    //         return flatMap(entries(formats), ([format, ecpmFloors]) => flatMap(entries(ecpmFloors), ([ecpmFloor, adUnits]) => adUnits))
    //     }
    // )
    if (placementAdUnitsToRemove.length > 0) {
        consola.info('Removing ad units', placementAdUnitsToRemove.map(x => x.name))
        try {
            await admob.bulkRemoveAdUnits(placementAdUnitsToRemove.map(x => x.adUnitId))
            consola.success('Removed ad units', placementAdUnitsToRemove.map(x => x.name))
        } catch (e) {
            consola.fail('Failed to remove ad units', placementAdUnitsToRemove.map(x => x.name))
        }
    }


}
