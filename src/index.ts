import consola from 'consola'
import { API, AdSourceStatus, type AdSourceInput, type AdUnit, AdSource } from './apis/admob'
import { chain, groupBy, mapValues, $op, filter, camelCase, pascalCase } from 'xdash'
import type { AdFormat, Platform } from './base'
import { getAppConfig, getConfiguredApps } from './read'
import { FirebaseManager } from './apis/firebase'
import { getAdmobAuthData, getAuthTokens } from './apis/google'

const authData = await getAdmobAuthData()

const tokens = await getAuthTokens({
    cookies: authData.googleAuthData.cookies,
})

if (!tokens.access_token) {
    throw new Error('No access token')
}

console.log('tokens', tokens)

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

const appId = "6975353685"
const platform: Platform = 'Android'
const placement = 'default'
const format: AdFormat = 'Interstitial'
const adUnitId = "8219263534"
const config = getAppConfig(appId)
console.log(config)

const applovin = config.adSources
console.log(applovin)
const adSourceData = await admob.getAdSourceData()

// const adSourcesInput: AdSourceInput[] = Object.values(adSourceData)
//     .filter(x => x.isBidding && !x.mappingRequired && !!x.partnership[platform]?.[format])
//     .map(x => ({ id: x.id }))
// if (config.adSources?.applovin) {
//     const allocation = await admob.updateMediationAllocation(
//         adUnitId,
//         adSourceData[AdSource.Applovin].partnership![platform]![format]!,
//         config.adSources.applovin
//     )
//     console.log("allocation", allocation)
//     adSourcesInput.push({
//         id: AdSource.Applovin,
//         allocationId: allocation.id,
//     })
// }
// console.log(adSourcesInput.length)

const mediationGroups = await admob.listMediationGroups()
const rbMeditionGroups = mediationGroups.filter(x => x.name.startsWith('cubeage/'))
const rbMeditionGroupsIndexed = chain(rbMeditionGroups)
    .pipe(
        $op(groupBy)(x => parseMediationGroupName(x.name).appId),
        $op(mapValues)(x => chain(x)
            .pipe(
                $op(groupBy)(x => parseMediationGroupName(x.name).placementId),
                $op(mapValues)(x => chain(x)
                    .pipe(
                        $op(groupBy)(x => parseMediationGroupName(x.name).format)
                    )
                    .value()
                )
            )
            .value()
        )
    )
    .value()

// for (const app of selectedApps) {
//     const appMediationGroups = rbMeditionGroupsIndexed[app.appId] || {}

// }
// console.log(rbMeditionGroupsIndexed)

// const mediationGroup = await admob.createMediationGroup({
//     name: 'cubeage/interstitial/' + Date.now(),
//     platform: platform,
//     format: format,
//     adUnitIds: [
//         adUnitId,
//     ],
//     adSources: adSourcesInput
// })
// consola.log('Created mediation group', mediationGroup)
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
    const allAdUnits = await admob.getListOfAdUnits(app.appId)
    const rbAdUnits = allAdUnits.filter(x => x.name.startsWith('cubeage/'))
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
    for (const [placementId, formats] of Object.entries(appConfig.placements || {})) {
        for (const [format, formatConfig] of Object.entries(formats)) {
            const ecpmFloors = formatConfig.ecpmFloors
            // get all ad units for the app and see if they match the template
            // const allAdUnits = await admobClient.accounts.adUnits.list({
            //     parent: selectedAccount.name!,
            // }).then(x => x.data.adUnits?.filter(adUnit => adUnit.appId === app.appId) || [])

            // console.log(allAdUnits)

            const adUnits = rbAdUnits.filter(x => {
                const parts = parseAdUnitName(x.name)
                return parts.placementId === placementId && parts.format === format
            })
            console.log(rbAdUnits)

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

            const resultAdUnits = {
                ...update
            }
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
                    resultAdUnits.set(ecpmFloor, adUnit)
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

            // commit changes to remote config
            const ecpmFloorAdUnits = {} as Record<string, string>
            for (const [ecpm, adUnit] of resultAdUnits.entries()) {
                const publicAdUnitId = await admob.getPublicAdUnitId(adUnit.adUnitId)
                ecpmFloorAdUnits[ecpm] = publicAdUnitId
                consola.info(`  ECPM ${ecpm} => ${publicAdUnitId}`)
            }
            consola.info('Updating remote config', placementId, format)
            await firebaseManager.updateAdUnits({
                projectId: app.projectId,
                platform: app.platform,
                placementId: placementId,
                format: toAdFormat(format),
                ecpmFloors: ecpmFloorAdUnits
            })
            consola.success('Updated remote config')
        }
    }
}
