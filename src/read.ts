import { parse as parseYaml } from "yaml";
import type { AdFormat } from "./base";
import {
    parse, optional, string, object, picklist, record, transform,
    fallback,
    type BaseSchema, type Input, number, coerce, array, partial
} from 'valibot';
import { camelCase, pascalCase } from 'xdash';

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
    ]), pascalCase);

const placementSchema = string();
function placementsSchema<S extends BaseSchema>(adSourceConfigSchema: S) {
    return record(
        placementSchema,
        record(
            adFormatSchema,
            adSourceConfigSchema,
        ),
    )
}

const metaAdSourceConfigSchema = object({
    placements: placementsSchema(object({
        placementId: string()
    }))
})

const mintegralAdSourceConfigSchema = object({
    appId: string(),
    placements: placementsSchema(object({
        placementId: string()
    }))
})

const pangleAdSourceConfigSchema = object({
    appId: string(),
    placements: placementsSchema(object({
        placementId: string()
    }))
})

const applovinAdSourceConfigSchema = object({
    sdkKey: string(),
})

const liftoffAdSourceConfigSchema = object({
    appId: string(),
    placements: placementsSchema(object({
        placementId: string()
    }))
})

const appConfigSchema = object({
    placements: optional(placementsSchema(object({
        ecpmFloors: array(number())
    })), defaultConfig.placements),
    adSources: optional(partial(object({
        meta: optional(metaAdSourceConfigSchema),
        mintegral: optional(mintegralAdSourceConfigSchema),
        pangle: optional(pangleAdSourceConfigSchema),
        applovin: optional(applovinAdSourceConfigSchema),
        liftoff: optional(liftoffAdSourceConfigSchema)
    })))
});


export function getAppConfig(appId: string): Input<typeof appConfigSchema> {
    if (!(appId in data.apps)) {
        throw new Error(`App with id ${appId} not found`);
    }
    const app = data.apps[appId] ||= {};
    return parse(appConfigSchema, app)
}

// const config = getAppConfig("7403857423");
// console.dir(config, { depth: null });

export function getConfiguredApps() {
    return Object.keys(data.apps);
}