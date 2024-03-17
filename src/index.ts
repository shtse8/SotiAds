import { select, multiselect, text, isCancel } from '@clack/prompts'
import consola from 'consola'
import { getAdmobAuthData, API, type AdFormat } from './api'
import { entries, chain, groupBy, firstOrDefault, mapValues, flatMap, $op } from 'xdash'

const admobHeaderData = await getAdmobAuthData()
consola.info('admobHeaderData', admobHeaderData)
const admob = new API(admobHeaderData)

// const oauth2Client = new google.auth.OAuth2(
//     '907470986280-5futrsa83oj7nha93giddf2akggo2l4q.apps.googleusercontent.com',
//     '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',
//     'http://localhost:4848/oauth2callback'
// )

// // get token
// const authUrl = oauth2Client.generateAuthUrl({
//     access_type: 'offline',
//     scope: [
//         'https://www.googleapis.com/auth/admob.monetization',
//         'https://www.googleapis.com/auth/admob.readonly',
//         'https://www.googleapis.com/auth/admob.report',
//     ]
// })

// // open url in browser
// try {
//     // prompt user a browser will be opened with specific url to authorize
//     console.log('Opening browser to authorize')
//     await open(authUrl)
// } catch (e) {
//     // failed to open browser automatically, log the url and prompt user to open it manually
//     console.log('Authorize this app by visiting this url:', authUrl)
// }
// // prompt user to authorize

// const { code } = await new Promise<{
//     code: string,
//     scope: string,
// }>((resolve, reject) => {
//     const server = createServer((req, res) => {
//         if (req.url!.indexOf('/oauth2callback') > -1) {
//             const qs = new URL(req.url!, 'http://localhost:4848').searchParams
//             // close the server
//             resolve({
//                 ...Object.fromEntries(qs),
//             } as any)
//             // respone a javascript to close the window
//             res.setHeader('Content-Type', 'text/html')

//             // respond with a success message
//             res.end('<b>Success! You can close this window now.</b>')
//             server.close()
//         } else {
//             res.end('Not found')
//         }
//     }).listen(4848)
// })


// const { tokens } = await oauth2Client.getToken(code)

// oauth2Client.setCredentials(tokens)

// const admobClient = google.admob({
//     version: 'v1beta',
//     auth: oauth2Client
// })



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

const selectedApps = await multiselect({
    message: 'Select apps',
    options: apps.map(x => ({
        label: (x.name || x.appId) + ' (' + x.platform + ')' + (x.status === 'Active' ? '' : ' - ' + x.status),
        value: x,
    })),
    initialValues: apps.filter(x => x.status === 'Active') || [],
})
if (isCancel(selectedApps)) {
    process.exit(0)
}

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
    const allAdUnits = await admob.getListOfAdUnits(app.appId)
    // create a map of ad units
    const adUnitsMap = chain(allAdUnits)
        .pipe(
            $op(groupBy)(x => parseAdUnitName(x.name).placementId)
        )
        .pipe(
            $op(mapValues)(x => chain(x)
                .pipe($op(groupBy)(x => parseAdUnitName(x.name).format))
                .pipe($op(mapValues)(x => chain(x)
                    .pipe($op(groupBy)(x => parseAdUnitName(x.name).ecpmFloor))
                    .value()
                ))
                .value()
            ))
        .value()

    consola.info('Updating ad units for', app.name)
    for (const [placementId, formats] of Object.entries(settings)) {
        for (const [format, ecpmFloors] of Object.entries(formats)) {
            // get all ad units for the app and see if they match the template
            // const allAdUnits = await admobClient.accounts.adUnits.list({
            //     parent: selectedAccount.name!,
            // }).then(x => x.data.adUnits?.filter(adUnit => adUnit.appId === app.appId) || [])

            // console.log(allAdUnits)

            const ecpmAdUnits = adUnitsMap[placementId]?.[format] || {}
            // console.log('ecpmAdUnitsMap', ecpmAdUnitsMap)

            let isInsufficientDataAPIQuota = false
            const ecpmFloorAdUnitsToRemove: string[] = []
            for (const ecpmFloor of ecpmFloors!) {
                const adUnits = ecpmAdUnits[ecpmFloor] || []
                const adUnit = firstOrDefault(adUnits, null)
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
                        await admob.createAdUnit({
                            appId: app.appId!,
                            name,
                            adFormat: format as AdFormat,
                            ecpmFloor: {
                                mode: 'Manual floor',
                                value: ecpmFloor,
                                currency: 'USD'
                            }
                        })
                        consola.success('Created ad unit', name)
                    } catch (e) {
                        if (e instanceof Error && e.message.includes('Insufficient Data API quota')) {
                            consola.fail(e.message)
                            isInsufficientDataAPIQuota = true
                        } else {
                            console.error(e)
                        }
                    }
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
        .pipe(entries)
        .pipe($op(flatMap)(([placementId, formats]) => {
            if (placementId in settings) {
                return []
            }
            return chain(formats)
                .pipe(entries)
                .pipe($op(flatMap)(([format, ecpmFloors]) => chain(ecpmFloors)
                    .pipe(entries)
                    .pipe($op(flatMap)(([ecpmFloor, adUnits]) => adUnits))
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
