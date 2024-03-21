import type { firebase_v1beta1 } from "googleapis";
import type { AdFormat, Platform } from "../base";
import { refreshToken, initializeApp, getApps } from 'firebase-admin/app'
import { getRemoteConfig, type RemoteConfigTemplate } from "firebase-admin/remote-config";
import consola from "consola";
import { camelCase } from 'xdash'

type PlatformString = `${Platform}:${string}`;
type PromiseType<T> = T extends Promise<infer R> ? R : never;

export class FirebaseManager {
    private firebaseApp = new Map<string, ReturnType<typeof initializeApp>>()
    private appFirebaseMap = new Map<PlatformString, ReturnType<typeof initializeApp>>()
    private isInitialized = false
    private credential = {
        getAccessToken: async () => {
            return {
                access_token: this.access_token!,
                expires_in: Date.now() + 1000 * 60 * 60,
            }
        }
    }
    // private firebase: firebase_v1beta1.Firebase | undefined;

    constructor(private access_token: string) {
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

        // const { tokens } = await oauth2Client.getToken(code)
        // this.access_token = tokens.access_token;

        // oauth2Client.setCredentials(tokens)

        // if (!tokens.refresh_token) {
        //     throw new Error('No refresh token')
        // }

        // this.firebase = google.firebase({
        //     version: 'v1beta1',
        //     auth: oauth2Client,
        // })

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
