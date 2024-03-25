import consola from 'consola'
import { API, AdSourceStatus, type AdSourceInput, type AdUnit, AdSource, type AdmobAppPayload, type AdSourceAdapter, type CreateAllocationDataInput, type EcpmFloor } from './apis/admob'
import { chain, groupBy, mapValues, $op, filter, camelCase, pascalCase } from 'xdash'
import { AdFormat, type Platform, listChanges } from './base'
import { getAppConfig, getConfiguredApps } from './read'
import { FirebaseManager } from './apis/firebase'
import { getAdmobAuthData, getAuthTokens } from './apis/google'
import { places } from 'googleapis/build/src/apis/places'
import { deepEquals } from 'bun'

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
    [AdSource.LiftoffMobile]: (x, placement, format) => {
        const config = x.adSources[AdSource.LiftoffMobile]!
        const data = config.placements[placement]?.[format]
        if (!data) {
            throw new Error(`No config found for ${AdSource.LiftoffMobile} ${placement} ${format}`)
        }
        return {
            appid: config.appId,
            placementId: data.placementId,
        }
    },
}

async function syncMediationGroup(app: AdmobAppPayload, placementId: string, format: AdFormat, adUnitIds: string[]) {
    if (adUnitIds.length <= 0) {
        return;
    }

    consola.info('Syncing mediation group', placementId, format)
    function validAdapter(adapter: AdSourceAdapter) {
        return adapter.platform === app.platform && adapter.format == format
    }


    const config = getAppConfig(app.appId)
    const adSources: AdSourceInput[] = Object.values(adSourceData)
        .filter(x => x.isBidding)
        .filter(x => !x.mappingRequired || x.id in config.adSources)
        .map(x => (<AdSourceInput>{
            id: x.id,
            adapter: x.adapters.find(validAdapter)
        }))
        .filter(x => !!x.adapter)
    consola.info('Found adSources', adSources.length)

    // const config = getAppConfig(app.appId)
    // for (const adSource of Object.keys(config.adSources) as AdSource[]) {
    //     try {
    //         const configBuilder = ConfigMap[adSource]
    //         if (!configBuilder) {
    //             continue;
    //         }
    //         const adaptar = getAdapter(adSource)
    //         if (!adaptar) {
    //             continue;
    //         }

    //         consola.info(`Updating ${adSource} mediation allocation`)
    //         const allocations = await admob.updateMediationAllocation(
    //             adSource,
    //             adUnitIds,
    //             adaptar,
    //             configBuilder(config, placementId, format)
    //         )
    //         adSources.push({
    //             id: adSource,
    //             adapter: adaptar,
    //             allocations: allocations,
    //         })
    //         consola.info(`Added ${adSource} ad source`)
    //     } catch (e) {
    //         if (e instanceof Error) {
    //             consola.fail(`Failed to add ${adSource} to ad sources.`, e.message)
    //         }
    //     }
    // }


    const mediationGroupNameParts = <MediationGroupNameParts>{ appId: app.appId, placementId, format }
    const mediationGroupName = stringifyMediationGroupName(mediationGroupNameParts)
    const mediationGroups = await admob.listMediationGroups()
    const mediationGroup = mediationGroups.find(x =>
        deepEquals(parseMediationGroupName(x.name), mediationGroupNameParts)
    )

    function createAllocationData({ input: { id, adapter: { format } } }: CreateAllocationDataInput): Record<string, string> {
        switch (id) {
            case AdSource.MetaAudienceNetwork:
                const adSourceConfig = config.adSources[AdSource.MetaAudienceNetwork]!
                const placementConfig = adSourceConfig.placements[placementId]?.[format]
                if (!placementConfig) {
                    throw new Error(`No config found for ${AdSource.MetaAudienceNetwork} ${placementId} ${format}`)
                }
                return {
                    placementId: placementConfig.placementId
                }
            case AdSource.Pangle:
                const pangleConfig = config.adSources[AdSource.Pangle]
                if (!pangleConfig) {
                    throw new Error(`No config found for ${AdSource.Pangle}`)
                }
                const panglePlacement = pangleConfig.placements[placementId]?.[format]
                if (!panglePlacement) {
                    throw new Error(`No config found for ${AdSource.Pangle} ${placementId} ${format}`)
                }
                return {
                    appid: pangleConfig.appId,
                    placementid: panglePlacement.placementId
                }
            case AdSource.Applovin:
                const applovinConfig = config.adSources[AdSource.Applovin]
                if (!applovinConfig) {
                    throw new Error(`No config found for ${AdSource.Applovin}`)
                }
                return {
                    sdkKey: applovinConfig.sdkKey
                }
            case AdSource.Mintegral:
                const mintegralConfig = config.adSources[AdSource.Mintegral]
                if (!mintegralConfig) {
                    throw new Error(`No config found for ${AdSource.Mintegral}`)
                }
                const mintegralPlacement = mintegralConfig.placements[placementId]?.[format]
                if (!mintegralPlacement) {
                    throw new Error(`No config found for ${AdSource.Mintegral} ${placementId} ${format}`)
                }
                return {
                    appId: mintegralConfig.appId,
                    appKey: mintegralConfig.appKey,
                    placementId: mintegralPlacement.placementId,
                    adUnitId: mintegralPlacement.adUnitId
                }
            case AdSource.LiftoffMobile:
                const liftoffConfig = config.adSources[AdSource.LiftoffMobile]
                if (!liftoffConfig) {
                    throw new Error(`No config found for ${AdSource.LiftoffMobile}`)
                }
                const liftoffPlacement = liftoffConfig.placements[placementId]?.[format]
                if (!liftoffPlacement) {
                    throw new Error(`No config found for ${AdSource.LiftoffMobile} ${placementId} ${format}`)
                }
                return {
                    appid: liftoffConfig.appId,
                    placementId: liftoffPlacement.placementId
                }
            default:
                throw new Error(`Unknown ad source ${id}`)
        }
    }
    if (mediationGroup) {
        consola.info('Updating mediation group', mediationGroup.id)
        await admob.updateMediationGroup(mediationGroup.id, {
            name: mediationGroupName,
            platform: app.platform,
            format: format,
            adUnitIds,
            adSources: adSources,
            createAllocationData,
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
            adSources: adSources,
            createAllocationData,
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

    const { toAdd, toUpdate, toRemove } = listChanges(
        ecpmFloors,
        adUnits,
        (a, b) => a === parseAdUnitName(b.name).ecpmFloor
    )
    consola.info('Changes for', placementId, format)
    console.info(' create', toAdd)
    console.info(' update', toUpdate.map(([s, d]) => parseAdUnitName(d.name).ecpmFloor))
    console.info(' remove', toRemove)

    const resultAdUnits = Object.fromEntries(toUpdate) as Record<number, AdUnit>
    // if (create.length === 0 && update.length === 0 && remove.length === 0) {
    //     consola.info('No changes')
    // }

    function getEcpmFloorData(value: number): EcpmFloor {
        return value > 0 ? {
            mode: 'Manual floor',
            value: value,
            currency: 'USD'
        } : {
            mode: 'Disabled'
        }
    }
    // process changes

    // create ad units
    for (const ecpmFloor of toAdd) {
        const name = stringifyAdUnitName({ placementId, format: format as AdFormat, ecpmFloor })
        consola.info('Creating ad unit', name)
        try {
            const adUnit = await admob.createAdUnit({
                appId: app.appId!,
                name,
                adFormat: parseAdFormat(format),
                ecpmFloor: getEcpmFloorData(ecpmFloor)
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
    for (const [ecpmFloor, adUnit] of toUpdate) {
        const name = stringifyAdUnitName({ placementId, format: format as AdFormat, ecpmFloor })
        const ecpmFloorData = getEcpmFloorData(ecpmFloor)
        const needUpdates =
            // name
            adUnit.name !== name
            // ecpm floor
            || !deepEquals(adUnit.ecpmFloor, ecpmFloorData)
        if (!needUpdates) {
            // consola.info('No need to update ad unit', adUnit.name)
            continue
        }

        consola.info('Updating ad unit')
        try {
            await admob.updateAdUnit(adUnit.appId, adUnit.adUnitId, {
                name,
                ecpmFloor: ecpmFloorData
            })
            consola.success('Updated ad unit', adUnit.adUnitId)
        } catch (e) {
            if (e instanceof Error) {
                consola.fail('Failed to update ad unit:', e.message)
            }
        }
    }

    // remove ad units
    if (toRemove.length > 0) {
        const removeIds = toRemove.map(x => x.adUnitId)
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
