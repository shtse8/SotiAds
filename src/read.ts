import { parse } from "yaml";

const file = Bun.file("config.yml");
const content = await file.text();
const data = parse(content);
// print deep

const defaultConfig = data.default;
// merge default placements formats ecpm
for (const placement of Object.values(defaultConfig.placements)) {
    for (const formatId in placement) {
        const format = placement[formatId] ||= {};
        format.ecpmFloors ||= defaultConfig.ecpmFloors;
    }
}
interface AppConfig {
    placements: {
        [placementId: string]: {
            [formatId: string]: {
                ecpmFloors: number[];
            };
        };
    };

}
export function getAppConfig(appId: string): AppConfig {
    const app = data.apps[appId]
    const placements = app.placements ||= defaultConfig.placements;
    return app
}

// const config = getAppConfig(6975353685);
// console.dir(config, { depth: null });

export function getConfiguredApps() {
    return Object.keys(data.apps);
}