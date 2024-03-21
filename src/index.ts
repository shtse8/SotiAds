import consola from 'consola'
import { API, type AdUnit } from './apis/admob'
import { chain, groupBy, mapValues, $op, filter, camelCase, pascalCase } from 'xdash'
import type { AdFormat } from './base'
import { getAppConfig, getConfiguredApps } from './read'
import { FirebaseManager } from './apis/firebase'
import { getAdmobAuthData, getAuthCode } from './apis/google'

const authData = await getAdmobAuthData()
const admob = new API(authData.admobAuthData)

const code = await getAuthCode({
    cookies: authData.googleAuthData.cookies,
})

console.log('code', code)

// update refresh token

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
    return `cubeage/${camelCase(options.placementId)}/${camelCase(options.format)}/${options.ecpmFloor}`
}

function toAdFormat(format: string): AdFormat {
    return pascalCase(format) as AdFormat
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

            const resultAdUnits = new Map<number, AdUnit>()
            const toRemove: string[] = []
            for (const ecpmFloor in ecpmAdUnits) {
                const adUnits = ecpmAdUnits[ecpmFloor] || []
                if (adUnits.length > 0) {
                    const [adUnit, ...rest] = adUnits
                    if (rest.length > 0) {
                        toRemove.push(...rest.map(x => x.adUnitId))
                    }
                    resultAdUnits.set(parseFloat(ecpmFloor), adUnit)
                }
            }

            // print stats
            const toUpdate = Object.entries(resultAdUnits).filter(([ecpmFloor, adUnit]) => adUnit.ecpmFloor.value !== ecpmFloor)
            const toCreate = ecpmFloors.filter(x => !resultAdUnits.has(x))
            consola.info('Changes for', placementId, format)
            consola.info('To create', toCreate)
            consola.info('To update', toUpdate)
            consola.info('To remove', toRemove)

            if (toCreate.length === 0 && toUpdate.length === 0 && toRemove.length === 0) {
                consola.info('No changes')
            }

            // process changes

            // create ad units
            for (const ecpmFloor of toCreate) {
                const name = stringifyAdUnitName({ placementId, format: format as AdFormat, ecpmFloor })
                consola.info('Creating ad unit', name)
                try {
                    const adUnit = await admob.createAdUnit({
                        appId: app.appId!,
                        name,
                        adFormat: toAdFormat(format),
                        ecpmFloor: {
                            mode: 'Manual floor',
                            value: ecpmFloor,
                            currency: 'USD'
                        }
                    })
                    consola.success('Created ad unit', adUnit.adUnitId)
                    resultAdUnits.set(ecpmFloor, adUnit)
                } catch (e) {
                    consola.fail('Failed to create ad unit', e)
                    if (e instanceof Error && e.message.includes('Insufficient Data API quota')) {
                        consola.fail(e.message)
                        break;
                    }
                }
            }

            // update ad units
            for (const [ecpmFloor, adUnit] of toUpdate) {
                consola.info('Updating ad unit', adUnit.name, `from ${adUnit.ecpmFloor.value} to ${ecpmFloor}`)
                try {
                    await admob.updateAdUnit(adUnit.appId, adUnit.adUnitId, {
                        ecpmFloor: {
                            mode: 'Manual floor',
                            value: Number(ecpmFloor),
                            currency: 'USD'
                        }
                    })
                    consola.success('Updated ad unit', adUnit.adUnitId)
                } catch (e) {
                    consola.fail('Failed to update ad unit', e)
                }
            }

            // remove ad units
            if (toRemove.length > 0) {
                consola.info('Removing ad units', toRemove)
                try {
                    await admob.bulkRemoveAdUnits(toRemove)
                    consola.success('Removed ad units', toRemove)
                } catch (e) {
                    consola.fail('Failed to remove ad units', e)
                }
            }

            // commit changes to remote config
            consola.info('Updating remote config', placementId, format, resultAdUnits)
            await firebaseManager.updateAdUnits({
                projectId: app.projectId,
                platform: app.platform,
                placementId: placementId,
                format: toAdFormat(format),
                ecpmFloors: mapValues(Object.fromEntries(resultAdUnits), x => x.adUnitId)
            })
            consola.success('Updated remote config', placementId, format, resultAdUnits)
        }
    }
}
