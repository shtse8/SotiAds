import { parse as parseYaml } from "yaml";
import { AdFormat, Platform } from "./base";
import {
  parse,
  object,
  string,
  number,
  array,
  record,
  union,
  optional,
  literal,
} from "valibot";
import fs from "fs/promises";
import path from "path";

export interface AdSourceConfig {
  placements: Record<string, Record<AdFormat, { placementId: string; adUnitId?: string }>>;
  appId?: string;
  appKey?: string;
  sdkKey?: string;
  gameId?: string;
  zoneId?: string;
}

export interface PlacementConfig {
  ecpmFloors: number[];
}

export interface AppConfig {
  placements: Record<string, Record<AdFormat, PlacementConfig>>;
  adSources: Record<string, AdSourceConfig>;
}

export interface GlobalAdNetworkConfig {
  appId?: string;
  appKey?: string;
}

export interface Config {
  default: {
    ecpmFloors: number[];
  };
  apps: Record<string, AppConfig>;
  globalAdNetworks?: Record<string, GlobalAdNetworkConfig>;
}

const adFormatSchema = union([
  literal("banner"),
  literal("interstitial"),
  literal("rewarded"),
  literal("native"),
]);

const placementConfigSchema = object({
  ecpmFloors: array(number()),
});

const adSourceConfigSchema = object({
  placements: record(
    string(),
    record(adFormatSchema, object({ 
      placementId: string(),
      adUnitId: optional(string()),
    }))
  ),
  appId: optional(string()),
  appKey: optional(string()),
  sdkKey: optional(string()),
  gameId: optional(string()),
  zoneId: optional(string()),
});

const appConfigSchema = object({
  placements: record(string(), record(adFormatSchema, placementConfigSchema)),
  adSources: record(string(), adSourceConfigSchema),
});

const globalAdNetworkConfigSchema = object({
  appId: optional(string()),
  appKey: optional(string()),
});

const configSchema = object({
  default: object({
    ecpmFloors: array(number()),
  }),
  apps: record(string(), appConfigSchema),
  globalAdNetworks: optional(record(string(), globalAdNetworkConfigSchema)),
});

let config: Config;

export async function loadConfig(configPath: string): Promise<void> {
  const configContent = await fs.readFile(path.resolve(process.cwd(), configPath), 'utf-8');
  const parsedConfig = parseYaml(configContent);
  config = parse(configSchema, parsedConfig);
}

export function getAppConfig(appId: string): AppConfig {
  if (!config) {
    throw new Error("Config not loaded. Call loadConfig first.");
  }
  const appConfig = config.apps[appId];
  if (!appConfig) {
    throw new Error(`App with id ${appId} not found in config.`);
  }
  return appConfig;
}

export function getConfiguredApps(): string[] {
  if (!config) {
    throw new Error("Config not loaded. Call loadConfig first.");
  }
  return Object.keys(config.apps);
}

export function getDefaultEcpmFloors(): number[] {
  if (!config) {
    throw new Error("Config not loaded. Call loadConfig first.");
  }
  return config.default.ecpmFloors;
}

export function getGlobalAdNetworkConfig(network: string): GlobalAdNetworkConfig | undefined {
  if (!config) {
    throw new Error("Config not loaded. Call loadConfig first.");
  }
  return config.globalAdNetworks?.[network];
}