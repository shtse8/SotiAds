export enum AdFormat {
    Banner = 'banner',
    Interstitial = 'interstitial',
    Rewarded = 'rewarded',
    RewardedInterstitial = 'rewardedInterstitial',
    Native = 'native',
    AppOpen = 'appOpen'
  }
  
  export enum Platform {
    Android = 'Android',
    iOS = 'iOS'
  }
  
  export enum AdSource {
    AdmobNetwork = "1",
    MetaAudienceNetwork = "88",
    Mintegral = "403",
    Pangle = "395",
    Applovin = "85",
    LiftoffMobile = "82",
    // Add other ad sources as needed
  }
  
  export interface EcpmFloor {
    value: number;
    currency: string;
  }
  
  export interface AdUnit {
    adUnitId: string;
    name: string;
    adFormat: AdFormat;
    ecpmFloor: EcpmFloor;
  }
  
  export interface App {
    appId: string;
    name: string;
    platform: Platform;
    projectId?: string;
  }
  
  export interface MediationGroup {
    id: string;
    name: string;
    adFormat: AdFormat;
    adUnits: string[];
  }
  
  export interface AdSourceConfig {
    placementId?: string;
    adUnitId?: string;
    appId?: string;
    appKey?: string;
    sdkKey?: string;
    gameId?: string;
    zoneId?: string;
  }
  
  export interface PlacementConfig {
    ecpmFloors: number[];
  }
  
  export interface FormatConfig {
    [AdFormat.Banner]?: PlacementConfig;
    [AdFormat.Interstitial]?: PlacementConfig;
    [AdFormat.Rewarded]?: PlacementConfig;
    [AdFormat.RewardedInterstitial]?: PlacementConfig;
    [AdFormat.Native]?: PlacementConfig;
    [AdFormat.AppOpen]?: PlacementConfig;
  }
  
  export interface AppConfig {
    placements?: {
      [placementId: string]: FormatConfig;
    };
    adSources: {
      [source in AdSource]?: {
        placements?: {
          [placementId: string]: {
            [format in AdFormat]?: AdSourceConfig;
          };
        };
      } & AdSourceConfig;
    };
  }
  
  export interface Config {
    default: {
      ecpmFloors: number[];
    };
    apps: {
      [appId: string]: AppConfig;
    };
    globalAdNetworks?: {
      [network: string]: {
        appId?: string;
        appKey?: string;
      };
    };
  }
  
  export interface AdSourceAdapter {
    id: string;
    platform: Platform;
    format: AdFormat;
    fields: string[];
  }
  
  export interface CreateAllocationDataInput {
    input: AdSourceInput;
    adUnitId: string;
  }
  
  export interface AdSourceInput {
    id: AdSource;
    adapter: AdSourceAdapter;
    config: any; // You might want to define a more specific type for config
  }
  
  export interface MediationGroupInput {
    name: string;
    platform: Platform;
    format: AdFormat;
    adUnitIds: string[];
    adSources: AdSourceInput[];
    createAllocationData: (input: CreateAllocationDataInput) => Record<string, string>;
  }
  
  export interface FirebaseUpdateAdUnitsInput {
    projectId: string;
    platform: Platform;
    placementId: string;
    format: AdFormat;
    ecpmFloors: Record<number, string>;
  }
  
  export interface listChangesPayload<S, T> {
    toAdd: S[];
    toUpdate: [S, T][]; // [source, target]
    toRemove: T[];
  }
  
  export function listChanges<S, T>(
    source: S[],
    target: T[],
    comparator: (a: S, b: T) => boolean = (a: any, b: any) => a === b
  ): listChangesPayload<S, T> {
    const sourceCountMap = new Map<S, number>();
    source.forEach(s => {
      sourceCountMap.set(s, (sourceCountMap.get(s) || 0) + 1);
    });
  
    const toAdd: S[] = [];
    const toUpdate: [S, T][] = [];
    const toRemove: T[] = [];
    const matchedTargets = new Set<T>();
  
    target.forEach(t => {
      let foundMatch = false;
  
      for (const [s, count] of sourceCountMap) {
        if (comparator(s, t)) {
          if (!matchedTargets.has(t)) {
            toUpdate.push([s, t]);
            matchedTargets.add(t);
            foundMatch = true;
  
            if (count === 1) {
              sourceCountMap.delete(s);
            } else {
              sourceCountMap.set(s, count - 1);
            }
            break;
          }
        }
      }
  
      if (!foundMatch) {
        toRemove.push(t);
      }
    });
  
    sourceCountMap.forEach((count, s) => {
      for (let i = 0; i < count; i++) {
        toAdd.push(s);
      }
    });
  
    return { toAdd, toUpdate, toRemove };
  }
  
  export function deepEquals(a: any, b: any): boolean {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (typeof a !== 'object' || typeof b !== 'object') return false;
  
    const keysA = Object.keys(a), keysB = Object.keys(b);
  
    if (keysA.length !== keysB.length) return false;
  
    for (const key of keysA) {
      if (!keysB.includes(key)) return false;
      if (!deepEquals(a[key], b[key])) return false;
    }
  
    return true;
  }
  
  export function camelCase(str: string): string {
    return str.replace(/[-_]([a-z])/g, (_, letter) => letter.toUpperCase());
  }
  
  export function pascalCase(str: string): string {
    const camel = camelCase(str);
    return camel.charAt(0).toUpperCase() + camel.slice(1);
  }