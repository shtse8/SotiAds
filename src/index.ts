import consola from 'consola'
import { API, AdSourceStatus, type AdSourceInput, type AdUnit, AdSource, type AdmobAppPayload, type AdSourceAdapter } from './apis/admob'
import { chain, groupBy, mapValues, $op, filter, camelCase, pascalCase } from 'xdash'
import { AdFormat, type Platform } from './base'
import { getAppConfig, getConfiguredApps } from './read'
import { FirebaseManager } from './apis/firebase'
import { getAdmobAuthData, getAuthTokens } from './apis/google'
import { places } from 'googleapis/build/src/apis/places'

const authData = await getAdmobAuthData()

const tokens = await getAuthTokens({
    cookies: authData.googleAuthData.cookies,
})

if (!tokens.access_token) {
    throw new Error('No access token')
}

consola.info('tokens', tokens)

// update refresh token
const firebaseManager = new FirebaseManager(tokens.access_token)
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

const admob = new API(authData)
// const publisher = await admob.getPublisher()
// consola.info('Publisher', publisher)
// consola.info('Fetching apps')

const apps = await admob.listApps()
// consola.info('apps', apps)
const configuredApps = getConfiguredApps()
const selectedApps = apps.filter(x => x.projectId).filter(x => configuredApps.includes(x.appId!))
consola.info('selectedApps', selectedApps)

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

function stringifyAdUnitName(options: AdUnitNameParts): string {
    return `cubeage/${camelCase(options.placementId)}/${camelCase(options.format)}/${options.ecpmFloor.toFixed(2)}`
}

function parseAdFormat(format: string): AdFormat {
    return pascalCase(format) as AdFormat
}

function parseAdUnitName(name: string): AdUnitNameParts {
    const parts = name.split('/')
    return {
        placementId: camelCase(parts[1]),
        format: parseAdFormat(parts[2]),
        ecpmFloor: parseFloat(parts[3]),
    }
}

interface MediationGroupNameParts {
    appId: string

    placementId: string
    format: AdFormat
}

function stringifyMediationGroupName(options: MediationGroupNameParts): string {
    return `cubeage/${options.appId}/${camelCase(options.placementId)}/${camelCase(options.format)}`
}

function parseMediationGroupName(name: string): MediationGroupNameParts {
    const parts = name.split('/')
    return {
        appId: parts[1],
        placementId: camelCase(parts[2]),
        format: parseAdFormat(parts[3]),
    }
}

function toAdFormat(format: string): AdFormat {
    return pascalCase(format) as AdFormat
}


const adSourceData = await admob.getAdSourceData()

function deepEquals(a: any, b: any): b is typeof a {
    // Check if both are the same reference or both are null/undefined
    if (a === b) return true;
    // If either is null/undefined (but not both, as that would have returned true above), return false
    if (a == null || b == null) return false;
    // Check if both are objects (including arrays, functions, etc)
    if (typeof a === 'object' && typeof b === 'object') {
        // Check if both are instances of the same class
        if (a.constructor !== b.constructor) return false;
        // Handle Arrays
        if (Array.isArray(a)) {
            // Check array length equality
            if (a.length !== b.length) return false;
            // Recursively check each element
            for (let i = 0; i < a.length; i++) {
                if (!deepEquals(a[i], b[i])) return false;
            }
            return true;
        }
        // Handle Objects
        const aKeys = Object.keys(a);
        const bKeys = Object.keys(b);
        // Check if both objects have the same number of keys
        if (aKeys.length !== bKeys.length) return false;
        // Check if both objects have the same keys and recursively check values
        for (const key of aKeys) {
            if (!b.hasOwnProperty(key) || !deepEquals(a[key], b[key])) return false;
        }
        return true;
    }
    // If none of the above, values are of different types or not equal
    return false;
}

// apply default values
function defu<T>(source: T, defaults: Partial<T>): T {
    return Object.assign({}, defaults, source)

}

type ConfigBuilder = (x: ReturnType<typeof getAppConfig>, placement: string, format: AdFormat) => any
const ConfigMap: Partial<Record<AdSource, ConfigBuilder>> = {
    [AdSource.MetaAudienceNetwork]: (x, placement, format) => {
        const config = x.adSources[AdSource.MetaAudienceNetwork]!
        const placementConfig = config.placements[placement]?.[format]
        if (!placementConfig) {
            throw new Error(`No config found for ${AdSource.MetaAudienceNetwork} ${placement} ${format}`)
        }
        return placementConfig
    },
    [AdSource.Pangle]: (x, placement, format) => {
        const config = x.adSources[AdSource.Pangle]!
        const data = config.placements[placement]?.[format]
        if (!data) {
            throw new Error(`No config found for ${AdSource.Pangle} ${placement} ${format}`)
        }
        return {
            appid: config.appId,
            placementid: data.placementId,
        }
    },
    [AdSource.Applovin]: (x) => {
        return x.adSources[AdSource.Applovin]
    },
    [AdSource.Mintegral]: (x, placement, format) => {
        const config = x.adSources[AdSource.Mintegral]!
        const data = config.placements[placement]?.[format]
        if (!data) {
            throw new Error(`No config found for ${AdSource.Mintegral} ${placement} ${format}`)
        }
        return {
            appId: config.appId,
            appKey: config.appKey,
            placementId: data.placementId,
            adUnitId: data.adUnitId,
        }
    },
    // [AdSource.LiftoffMobile]: (x) => {
    //     return x.adSources[AdSource.LiftoffMobile]
    // },
}

async function syncMediationGroup(app: AdmobAppPayload, placementId: string, format: AdFormat, adUnitIds: string[]) {
    if (adUnitIds.length <= 0) {
        return;
    }

    consola.info('Syncing mediation group', placementId, format)
    function validAdapter(adapter: AdSourceAdapter) {
        return adapter.platform === app.platform && adapter.format == format
    }

    function getAdapter(adSource: AdSource) {
        return adSourceData[adSource].adapters.find(validAdapter)
    }

    const adSources: AdSourceInput[] = Object.values(adSourceData)
        .filter(x => x.isBidding && !x.mappingRequired)
        .map(x => (<AdSourceInput>{
            id: x.id,
            adapter: x.adapters.find(validAdapter)
        }))
        .filter(x => !!x.adapter)
    consola.info('Found adSources', adSources.length)

    const config = getAppConfig(app.appId)
    for (const adSource of [
        AdSource.MetaAudienceNetwork,
        AdSource.Pangle,
        AdSource.Applovin,
        AdSource.Mintegral,
        // AdSource.LiftoffMobile
    ] as const) {
        try {
            const configBuilder = ConfigMap[adSource]
            if (!configBuilder) {
                continue;
            }
            const adaptar = getAdapter(adSource)
            if (!adaptar) {
                continue;
            }

            consola.info(`Updating ${adSource} mediation allocation`)
            const allocations = await admob.updateMediationAllocation(
                adSource,
                adUnitIds,
                adaptar,
                configBuilder(config, placementId, format)
            )
            adSources.push({
                id: adSource,
                adapter: adaptar,
                allocations: allocations,
            })
            consola.info(`Added ${adSource} ad source`)
        } catch (e) {
            if (e instanceof Error) {
                consola.fail(`Failed to add ${adSource} to ad sources.`, e.message)
            }
        }
    }


    const mediationGroupNameParts = <MediationGroupNameParts>{ appId: app.appId, placementId, format }
    const mediationGroupName = stringifyMediationGroupName(mediationGroupNameParts)
    const mediationGroups = await admob.listMediationGroups()
    const mediationGroup = mediationGroups.find(x =>
        deepEquals(parseMediationGroupName(x.name), mediationGroupNameParts)
    )

    if (mediationGroup) {
        consola.info('Updating mediation group', mediationGroup.id)
        await admob.updateMediationGroup(mediationGroup.id, {
            name: mediationGroupName,
            platform: app.platform,
            format: format,
            adUnitIds,
            adSources: adSources
        })
        consola.success('Updated mediation group')
    } else {
        consola.info('Creating mediation group', mediationGroupName)

        // if (adSources.length) {
        await admob.createMediationGroup({
            name: mediationGroupName,
            platform: app.platform,
            format: format,
            adUnitIds,
            adSources: adSources
        })
        consola.success('Created mediation group')
    }
}

async function syncAdUnits(app: AdmobAppPayload, placementId: string, format: AdFormat, ecpmFloors: number[]) {
    const allAdUnits = await admob.getListOfAdUnits(app.appId)
    const rbAdUnits = allAdUnits.filter(x => x.name.startsWith('cubeage/'))

    const adUnits = rbAdUnits.filter(x => {
        const parts = parseAdUnitName(x.name)
        return parts.placementId === placementId && parts.format === format
    })

    const { create, update, remove } = sync(
        ecpmFloors,
        x => x,
        adUnits,
        x => parseAdUnitName(x.name).ecpmFloor
    )
    consola.info('Changes for', placementId, format)
    console.info(' create', create)
    console.info(' update', [...update.values()].map(x => parseAdUnitName(x.name).ecpmFloor))
    console.info(' remove', remove)

    const resultAdUnits = Object.fromEntries(update.entries()) as Record<number, AdUnit>
    // if (create.length === 0 && update.length === 0 && remove.length === 0) {
    //     consola.info('No changes')
    // }

    // process changes

    // create ad units
    for (const ecpmFloor of create) {
        const name = stringifyAdUnitName({ placementId, format: format as AdFormat, ecpmFloor })
        consola.info('Creating ad unit', name)
        try {
            const adUnit = await admob.createAdUnit({
                appId: app.appId!,
                name,
                adFormat: parseAdFormat(format),
                ecpmFloor: {
                    mode: 'Manual floor',
                    value: ecpmFloor,
                    currency: 'USD'
                }
            })
            consola.success('Created ad unit', adUnit.adUnitId)
            resultAdUnits[ecpmFloor] = adUnit
        } catch (e) {
            if (e instanceof Error && e.message.includes('Insufficient Data API quota')) {
                consola.fail('Failed to create ad unit: Insufficient Data API quota')
                break;
            } else {
                consola.fail('Failed to create ad unit', e)
            }
        }
    }

    // update ad units
    for (const [ecpmFloor, adUnit] of update) {
        const name = stringifyAdUnitName({ placementId, format: format as AdFormat, ecpmFloor })
        const needUpdates =
            // name
            adUnit.name !== name ||
            // ecpm floor
            adUnit.ecpmFloor.mode !== 'Manual floor' ||
            adUnit.ecpmFloor.value !== ecpmFloor
        if (!needUpdates) {
            consola.info('No need to update ad unit', adUnit.name)
            continue
        }

        consola.info('Updating ad unit')
        try {
            await admob.updateAdUnit(adUnit.appId, adUnit.adUnitId, {
                name,
                ecpmFloor: {
                    mode: 'Manual floor',
                    value: Number(ecpmFloor),
                    currency: 'USD'
                }
            })
            consola.success('Updated ad unit', adUnit.adUnitId)
        } catch (e) {
            if (e instanceof Error) {
                consola.fail('Failed to update ad unit:', e.message)
            }
        }
    }

    // remove ad units
    if (remove.length > 0) {
        const removeIds = remove.map(x => x.adUnitId)
        consola.info('Removing ad units', removeIds)
        try {
            await admob.bulkRemoveAdUnits(removeIds)
            consola.success('Removed ad units', removeIds)
        } catch (e) {
            consola.fail('Failed to remove ad units', e)
        }
    }

    // done
    consola.success('Successfully updated ad units')

    return resultAdUnits
}

interface SyncPayload<S, T, K> {
    create: S[]
    update: Map<K, T>
    remove: T[]
}
function sync<S, T, K>(
    source: S[],
    getSourceKey: (x: S) => K,
    target: T[],
    getTargetKey: (x: T) => K
): SyncPayload<S, T, K> {
    const sourceKeys = new Set(source.map(getSourceKey))
    const targetKeys = new Set(target.map(getTargetKey))
    const create = source.filter(x => !targetKeys.has(getSourceKey(x)))
    const update = new Map<K, T>()
    const remove = target.filter(x => !sourceKeys.has(getTargetKey(x)))
    for (const x of target) {
        if (sourceKeys.has(getTargetKey(x))) {
            update.set(getTargetKey(x), x)
        }
    }
    return { create, update, remove }
}

for (const app of selectedApps) {
    const appConfig = getAppConfig(app.appId!)
    consola.info('Updating ad units for', app.name)
    for (const [placementId, formats] of Object.entries(appConfig.placements || {})) {
        for (const [format, formatConfig] of Object.entries(formats)) {
            const ecpmFloors = formatConfig.ecpmFloors

            consola.info('Syncing ad units', placementId, format)
            try {
                const resultAdUnits = await syncAdUnits(app, placementId, toAdFormat(format), ecpmFloors)
                consola.success('Synced ad units')

                // commit changes to remote config
                const ecpmFloorAdUnits = {} as Record<string, string>
                for (const [ecpm, adUnit] of Object.entries(resultAdUnits)) {
                    const publicAdUnitId = await admob.getPublicAdUnitId(adUnit.adUnitId)
                    ecpmFloorAdUnits[ecpm] = publicAdUnitId
                    consola.info(`  ECPM ${ecpm} => ${publicAdUnitId}`)
                }

                // update mediation group
                consola.info('Updating mediation group', placementId, format)
                try {
                    await syncMediationGroup(app, placementId, parseAdFormat(format), Object.values(resultAdUnits).map(x => x.adUnitId))
                    consola.success('Updated mediation group')
                } catch (e) {
                    consola.fail('Failed to update mediation group')
                }

                // update remote config
                consola.info('Updating remote config', placementId, format)
                await firebaseManager.updateAdUnits({
                    projectId: app.projectId,
                    platform: app.platform,
                    placementId: placementId,
                    format: toAdFormat(format),
                    ecpmFloors: ecpmFloorAdUnits
                })
                consola.success('Updated remote config')
            } catch (e) {
                consola.fail('Failed to sync ad units', e)
            }
        }
    }
}
