import { parse as parseYaml } from "yaml";
import type { AdFormat } from "./base";
import {
    parse, optional, string, object, picklist, record, transform,
    fallback,
    type BaseSchema, type Input, number, coerce, array, partial, type ObjectSchema, type Pipe, type RecordOutput, type StringSchema, toCustom, forward, custom, type Output
} from 'valibot';
import { camelCase, mapKeys, mapValues, pascalCase } from 'xdash';
import { AdSource } from "./apis/admob";

const file = Bun.file("config.yml");
const content = await file.text();
const data = parseYaml(content);
// print deep

const defaultConfig = data.default;
// merge default placements formats ecpm
for (const placement of Object.values(defaultConfig.placements) as any[]) {
    for (const formatId in placement) {
        const format = placement[formatId] ||= {};
        format.ecpmFloors ||= defaultConfig.ecpmFloors;
    }
}
const adFormatSchema = transform(
    picklist([
        'interstitial',
        'rewarded',
        'banner',
        'rewardedInterstitial',
        'appOpen',
        'native'
    ]), x => pascalCase(x) as AdFormat);

const placementSchema = string();
function placementsSchema<S extends ObjectSchema<any, any>>(adSourceConfigSchema: S, pipe?: Pipe<RecordOutput<StringSchema, S>>) {
    return record(
        placementSchema,
        record(
            adFormatSchema,
            adSourceConfigSchema,
        ),
        pipe
    )
}

const metaAdSourceConfigSchema = object({
    placements: placementsSchema(object({
        placementId: string()
    }))
})

const mintegralAdSourceConfigSchema = object({
    appKey: string(),
    placements: placementsSchema(object({
        appKey: optional(string()),
        placementId: string(),
        adUnitId: string(),
    }))
})

const pangleAdSourceConfigSchema = object({
    appId: string(),
    placements: placementsSchema(object({
        appId: optional(string()),
        placementId: string()
    }))
})


const applovinAdSourceConfigSchema = object({
    sdkKey: string(),
})

const liftoffAdSourceConfigSchema = object({
    appId: optional(string()),
    placements: placementsSchema(object({
        placementId: string()
    }))
})

const appConfigSchema = object({
    placements: optional(placementsSchema(object({
        ecpmFloors: array(number())
    })), defaultConfig.placements),
    adSources: transform(partial(object({
        meta: metaAdSourceConfigSchema,
        mintegral: mintegralAdSourceConfigSchema,
        pangle: pangleAdSourceConfigSchema,
        applovin: applovinAdSourceConfigSchema,
        liftoff: liftoffAdSourceConfigSchema
    })), x => ({
        [AdSource.MetaAudienceNetwork]: x.meta,
        [AdSource.Mintegral]: x.mintegral,
        [AdSource.Pangle]: x.pangle,
        [AdSource.Applovin]: x.applovin,
        [AdSource.LiftoffMobile]: x.liftoff
    })),
})

export function getAppConfig(appId: string) {
    if (!(appId in data.apps)) {
        throw new Error(`App with id ${appId} not found`);
    }
    return parse(appConfigSchema, data.apps[appId] ||= {});
}

// const config = getAppConfig("6975353685");
// config.adSources[AdSource.Pangle]?.placements['default'].Interstitial?.placementId

// console.dir(config, { depth: null });

export function getConfiguredApps() {
    return Object.keys(data.apps);
}