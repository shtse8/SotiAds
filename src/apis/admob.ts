import {
AdFormat,
Platform,
AdSource,
type AdUnit,
type App,
type MediationGroup,
type AdSourceAdapter,
type AdSourceInput,
type MediationGroupInput,
type EcpmFloor,
listChanges,
deepEquals,
camelCase,
pascalCase,
type CreateAllocationDataInput
} from '../base';
import type { AuthData } from './google';
import consola from 'consola';
import { ofetch, FetchError } from 'ofetch';

export class API {
  private adSourceData: Record<AdSource, any> = {} as Record<AdSource, any>;
  private config: any; // Define config as a class property

  constructor(private authData: AuthData) {}

  private async fetch(url: string, body: any = {}) {
    try {
      const response = await ofetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          ...this.authData.admobAuthData,
        },
        body: 'f.req=' + encodeURIComponent(JSON.stringify(body)),
        responseType: 'json'
      });
      const { 1: data, 2: error } = response;
      if (error) {
        throw new Error(JSON.stringify(error));
      }
      return data;
    } catch (e) {
      if (e instanceof FetchError) {
        const message = e.data['2']?.match(/message: "([^"]+)"/)?.[1];
        throw new Error('Failed to fetch: ' + (message || e.message));
      } else {
        throw e;
      }
    }
  }

  async getPublicAdUnitId(adUnitId: string): Promise<string> {
    const publisher = await this.getPublisher();
    return `ca-app-${publisher.publisherId}/${adUnitId}`;
  }

  private async getPublisher() {
    const json = await this.fetch('https://apps.admob.com/publisher/_/rpc/PublisherService/Get?authuser=1&authuser=1&authuser=1&f.sid=2563678571570077000');
    return {
      email: json[1][1],
      publisherId: json[2][1]
    };
  }

  async listApps(): Promise<App[]> {
    const json = await this.fetch("https://apps.admob.com/inventory/_/rpc/InventoryEntityCollectionService/GetApps?authuser=1&authuser=1&authuser=1&f.sid=-2228407465145415000");
    return json.map((x: any) => ({
      appId: x[1],
      name: x[2],
      platform: x[3] == 1 ? Platform.iOS : Platform.Android,
      projectId: x?.[23]?.[2]?.[1]
    }));
  }

  private parseAdUnitResponse(response: any): AdUnit {
    let adFormat: AdFormat;
    if (response[14] == 1 && response[17] == true) {
      adFormat = AdFormat.Rewarded;
    } else if (response[14] == 8 && response[17] == true) {
      adFormat = AdFormat.Rewarded;
    } else if (response[14] == 1 && !response[17]) {
      adFormat = AdFormat.Interstitial;
    } else if (response[14] == 0 && response[21] == true) {
      adFormat = AdFormat.Banner;
    } else if (response[14] == 4) {
      adFormat = AdFormat.Native;
    } else {
      throw new Error('Unknown ad format: ' + JSON.stringify(response));
    }

    let ecpmFloor: EcpmFloor;
    switch (response[23][1]) {
      case 1:
        ecpmFloor = { value: 0, currency: 'USD' };
        break;
      case 2:
        ecpmFloor = { value: -1, currency: 'USD' }; // Google Optimize
        break;
      case 3:
        ecpmFloor = { value: response[23][3][1][1] / 1000000, currency: response[23][3][1][2] };
        break;
      default:
        throw new Error('Unknown ecpm floor mode');
    }

    return {
      adUnitId: response[1],
      name: response[3],
      adFormat,
      ecpmFloor,
    };
  }

  async getListOfAdUnits(appId: string): Promise<AdUnit[]> {
    const json = await this.fetch("https://apps.admob.com/inventory/_/rpc/AdUnitService/List?authuser=1&authuser=1&authuser=1&f.sid=4269709555968964600", { "1": [appId] });
    return json.map(this.parseAdUnitResponse);
  }

  async createAdUnit(appId: string, name: string, adFormat: AdFormat, ecpmFloor: EcpmFloor): Promise<AdUnit> {
    const body = this.createAdUnitRequestBody(appId, name, adFormat, ecpmFloor);
    const json = await this.fetch("https://apps.admob.com/inventory/_/rpc/AdUnitService/Create?authuser=1&authuser=1&authuser=1&f.sid=3583866342012525000", body);
    return this.parseAdUnitResponse(json);
  }

  private createAdUnitRequestBody(appId: string, name: string, adFormat: AdFormat, ecpmFloor: EcpmFloor) {
    const body: any = {
      1: {
        2: appId,
        3: name,
        27: { 1: 1 }
      }
    };

    switch (adFormat) {
      case AdFormat.Banner:
        body[1][14] = 0;
        body[1][16] = [0, 1, 2];
        body[1][21] = true;
        break;
      case AdFormat.Interstitial:
        body[1][14] = 1;
        body[1][16] = [0, 1, 2];
        break;
      case AdFormat.Rewarded:
        body[1][14] = 1;
        body[1][16] = [2, 1];
        body[1][17] = true;
        body[1][18] = { 1: '1', 2: 'Reward', 3: true };
        break;
      case AdFormat.Native:
        body[1][14] = 4;
        body[1][16] = [0, 1, 2];
        break;
    }

    if (ecpmFloor.value > 0) {
      body[1][23] = {
        1: 3,
        3: {
          1: {
            1: ecpmFloor.value * 1000000,
            2: ecpmFloor.currency
          }
        }
      };
    } else if (ecpmFloor.value === -1) {
      body[1][23] = { 1: 2 }; // Google Optimize
    } else {
      body[1][23] = { 1: 1 }; // Disabled
    }

    return body;
  }

  async updateAdUnit(adUnit: AdUnit): Promise<void> {
    const body = this.createAdUnitRequestBody(adUnit.adUnitId.split('/')[0], adUnit.name, adUnit.adFormat, adUnit.ecpmFloor);
    body[1][1] = adUnit.adUnitId.split('/')[1];
    body[2] = { 1: ['name', 'cpm_floor_settings'] };

    await this.fetch("https://apps.admob.com/inventory/_/rpc/AdUnitService/Update?authuser=1&authuser=1&authuser=1&f.sid=-2228407465145415000", body);
  }

  async syncAdUnits(app: App, placementId: string, adFormat: AdFormat, ecpmFloors: number[]): Promise<Record<number, AdUnit>> {
    const existingAdUnits = await this.getListOfAdUnits(app.appId);
    const relevantAdUnits = existingAdUnits.filter(au => 
      au.name.startsWith(`${placementId}/${adFormat}/`) && au.adFormat === adFormat
    );

    const { toAdd, toUpdate, toRemove } = listChanges(
      ecpmFloors,
      relevantAdUnits,
      (floor: number, unit: AdUnit) => unit.name.endsWith(`/${floor}`) && unit.ecpmFloor.value === floor
    );

    const resultAdUnits: Record<number, AdUnit> = {};

    // Create new ad units
    for (const floor of toAdd) {
      const name = `${placementId}/${adFormat}/${floor}`;
      const newAdUnit = await this.createAdUnit(app.appId, name, adFormat, { value: floor, currency: 'USD' });
      resultAdUnits[floor] = newAdUnit;
    }

    // Update existing ad units
    for (const [floor, existingUnit] of toUpdate) {
      if (existingUnit.ecpmFloor.value !== floor) {
        existingUnit.ecpmFloor = { value: floor, currency: 'USD' };
        await this.updateAdUnit(existingUnit);
      }
      resultAdUnits[floor] = existingUnit;
    }

    // Remove obsolete ad units
    if (toRemove.length > 0) {
      await this.bulkRemoveAdUnits(toRemove.map((unit: AdUnit) => unit.adUnitId));
    }

    return resultAdUnits;
  }

  async bulkRemoveAdUnits(adUnitIds: string[]): Promise<void> {
    await this.fetch(
      "https://apps.admob.com/inventory/_/rpc/AdUnitService/BulkRemove?authuser=1&authuser=1&authuser=1&f.sid=-4819060855550730000",
      {
        "1": adUnitIds,
        "2": 1
      }
    );
  }

  async getAdSourceData(): Promise<Record<AdSource, any>> {
    if (Object.keys(this.adSourceData).length === 0) {
      const json = await this.fetch('https://apps.admob.com/adSource/_/rpc/AdSourceService/ListAdSourceConfigurations?authuser=1&authuser=1&authuser=1&f.sid=5939125256556344000', { "1": false });
      for (const source of json) {
        const id = source[1] as AdSource;
        this.adSourceData[id] = {
          id,
          name: source[2],
          adapters: source[3]?.map((x: any) => ({
            id: x[4],
            platform: x[1] === 1 ? Platform.iOS : Platform.Android,
            format: this.mapAdFormatId(x[3]),
            fields: x[2]?.map((field: any) => field[1]) || []
          })),
          supportOptimization: source[4],
          supportBidding: source[8],
          mappingRequired: source[9] == 1,
        };
      }
    }
    return this.adSourceData;
  }

  private mapAdFormatId(formatId: number): AdFormat {
    switch (formatId) {
      case 3: return AdFormat.Rewarded;
      case 4: return AdFormat.Native;
      case 5: return AdFormat.Banner;
      case 6: return AdFormat.Interstitial;
      default: throw new Error(`Unknown ad format id: ${formatId}`);
    }
  }

  async syncMediationGroup(app: App, placementId: string, adFormat: AdFormat, adUnitIds: string[], adSources: Record<AdSource, any>): Promise<void> {
    const mediationGroups = await this.listMediationGroups();
    const groupName = `${app.appId}/${placementId}/${adFormat}`;
    const existingGroup = mediationGroups.find(g => g.name === groupName);

    const adSourceData = await this.getAdSourceData();
    const adSourceInputs: AdSourceInput[] = Object.entries(adSources)
      .map(([source, config]) => {
        const adSourceConfig = adSourceData[source as AdSource];
        const adapter = adSourceConfig.adapters.find((a: AdSourceAdapter) => a.platform === app.platform && a.format === adFormat);
        if (adapter) {
          return {
            id: source as AdSource,
            adapter,
            config
          };
        }
        return null;
      })
      .filter((input): input is AdSourceInput => input !== null);

    const mediationGroupInput: MediationGroupInput = {
      name: groupName,
      platform: app.platform,
      format: adFormat,
      adUnitIds,
      adSources: adSourceInputs,
      createAllocationData: (input: CreateAllocationDataInput) => this.createAllocationData(input)
    };

    if (existingGroup) {
      await this.updateMediationGroup(existingGroup.id, mediationGroupInput);
    } else {
      await this.createMediationGroup(mediationGroupInput);
    }
  }



  private async listMediationGroups(): Promise<MediationGroup[]> {
    const json = await this.fetch('https://apps.admob.com/mediationGroup/_/rpc/MediationGroupService/List?authuser=1&authuser=1&authuser=1&f.sid=-2500048687334755000');
    return json
      .filter((entry: any) => entry[1] !== "0")
      .map((entry: any) => ({
        id: entry[1],
        name: entry[2],
        adFormat: this.mapAdFormatId(entry[4][2]),
        adUnits: entry[4][3] || []
      }));
  }

  private async updateMediationGroup(id: string, input: MediationGroupInput): Promise<void> {
    const body = await this.createMediationGroupRequestBody(input);
    body[1][1] = id;
    await this.fetch('https://apps.admob.com/mediationGroup/_/rpc/MediationGroupService/V2Update?authuser=1&authuser=1&authuser=1&f.sid=7739685128981884000', { "1": body });
  }

  private async createMediationGroup(input: MediationGroupInput): Promise<void> {
    const body = await this.createMediationGroupRequestBody(input);
    await this.fetch('https://apps.admob.com/mediationGroup/_/rpc/MediationGroupService/V2Create?authuser=1&authuser=1&authuser=1&f.sid=2458665903996893000', body);
  }

  private async createMediationGroupRequestBody(input: MediationGroupInput): Promise<any> {
    const adSourceRequestData: any[] = [];
    for (const adSourceInput of input.adSources) {
      const data = await this.createAdSourceRequestData(adSourceInput, input.adUnitIds, input.createAllocationData);
      adSourceRequestData.push(data);
    }

    return {
      1: input.name,
      2: 1,
      3: {
        1: input.platform === Platform.iOS ? 1 : 2,
        2: this.getAdFormatId(input.format),
        3: input.adUnitIds
      },
      4: adSourceRequestData
    };
  }

  private getAdFormatId(format: AdFormat): number {
    switch (format) {
      case AdFormat.Banner: return 5;
      case AdFormat.Interstitial: return 6;
      case AdFormat.Rewarded: return 3;
      case AdFormat.Native: return 4;
      default: throw new Error(`Unknown ad format: ${format}`);
    }
  }

  private async createAdSourceRequestData(
    input: AdSourceInput,
    adUnitIds: string[]
  ): Promise<any> {
    const adSourceData = await this.getAdSourceData();
    const adSource = adSourceData[input.id];
  
    const allocations = adSource.mappingRequired
      ? await this.createAllocations(input, adUnitIds)
      : undefined;
  
    return {
      2: input.id,
      3: this.getAdFormatId(input.adapter.format),
      4: 1,
      5: {
        1: "10000",
        2: 'USD'
      },
      6: false,
      9: adSource.name,
      11: 1,
      13: allocations,
      14: input.adapter.id
    };
  }

  private async createAllocations(
    input: AdSourceInput,
    adUnitIds: string[]
  ): Promise<string[]> {
    if (adUnitIds.length === 0) {
      return [];
    }
  
    const allocationInputs = adUnitIds.map(adUnitId => ({
      adSourceId: input.id,
      adUnitId: adUnitId,
      adapter: input.adapter,
      data: this.createAllocationData({ input, adUnitId })
    }));
  
    return this.updateMediationAllocation(allocationInputs);
  }

  private createAllocationData({ input, adUnitId }: CreateAllocationDataInput): Record<string, string> {
    const { id, adapter: { format } } = input;
    const placementId = this.getPlacementIdForAdUnit(adUnitId);

    switch (id) {
      case AdSource.MetaAudienceNetwork:
        const adSourceConfig = this.config.adSources[AdSource.MetaAudienceNetwork]!;
        const placementConfig = adSourceConfig.placements[placementId]?.[format];
        if (!placementConfig) {
          throw new Error(`No config found for ${AdSource.MetaAudienceNetwork} ${placementId} ${format}`);
        }
        return {
          placementId: placementConfig.placementId
        };
      case AdSource.Pangle:
        const pangleConfig = this.config.adSources[AdSource.Pangle];
        if (!pangleConfig) {
          throw new Error(`No config found for ${AdSource.Pangle}`);
        }
        const panglePlacement = pangleConfig.placements[placementId]?.[format];
        if (!panglePlacement) {
          throw new Error(`No config found for ${AdSource.Pangle} ${placementId} ${format}`);
        }
        return {
          appid: pangleConfig.appId,
          placementid: panglePlacement.placementId
        };
      case AdSource.Applovin:
        const applovinConfig = this.config.adSources[AdSource.Applovin];
        if (!applovinConfig) {
          throw new Error(`No config found for ${AdSource.Applovin}`);
        }
        return {
          sdkKey: applovinConfig.sdkKey
        };
      case AdSource.Mintegral:
        const mintegralConfig = this.config.adSources[AdSource.Mintegral];
        if (!mintegralConfig) {
          throw new Error(`No config found for ${AdSource.Mintegral}`);
        }
        const mintegralPlacement = mintegralConfig.placements[placementId]?.[format];
        if (!mintegralPlacement) {
          throw new Error(`No config found for ${AdSource.Mintegral} ${placementId} ${format}`);
        }
        return {
          appId: mintegralConfig.appId,
          appKey: mintegralConfig.appKey,
          placementId: mintegralPlacement.placementId,
          adUnitId: mintegralPlacement.adUnitId
        };
      case AdSource.LiftoffMobile:
        const liftoffConfig = this.config.adSources[AdSource.LiftoffMobile];
        if (!liftoffConfig) {
          throw new Error(`No config found for ${AdSource.LiftoffMobile}`);
        }
        const liftoffPlacement = liftoffConfig.placements[placementId]?.[format];
        if (!liftoffPlacement) {
          throw new Error(`No config found for ${AdSource.LiftoffMobile} ${placementId} ${format}`);
        }
        return {
          appid: liftoffConfig.appId,
          placementId: liftoffPlacement.placementId
        };
      default:
        throw new Error(`Unknown ad source ${id}`);
    }
  }

  private async updateMediationAllocation(inputs: any[]): Promise<string[]> {
    const json = await this.fetch('https://apps.admob.com/mediationAllocation/_/rpc/MediationAllocationService/Update?authuser=1&authuser=1&authuser=1&f.sid=2153727026438702600', {
      1: inputs.map(input => ({
        1: "-1",
        3: input.adSourceId,
        4: input.adapter.fields.map((x: string) => ({
          1: x,
          2: input.data[camelCase(x)]
        })),
        12: input.adUnitId,
        15: "",
        16: input.adapter.id,
      })),
      2: [],
    });
    return json.map((x: any) => x[1]);
  }

  private getPlacementIdForAdUnit(adUnitId: string): string {
    // Implement logic to extract placement ID from ad unit ID
    // This is a placeholder implementation
    const parts = adUnitId.split('/');
    return parts[parts.length - 2]; // Assumes format like "app/placement/format/ecpm"
  }

  async getAdSourceStatus(adSourceId: AdSource): Promise<string> {
    const json = await this.fetch('https://apps.admob.com/adSource/_/rpc/AdSourceService/Get?authuser=1&authuser=1&authuser=1&f.sid=-6670505226462283000', {
      1: adSourceId
    });
    const statusMap: Record<number, string> = {
      0: 'Not Available',
      1: 'Idle',
      2: 'Pending',
      3: 'Active',
      4: 'Started Agreement',
      5: 'Rejected'
    };
    return statusMap[json[2]] || 'Unknown';
  }

  async getReportingData(appId: string, startDate: string, endDate: string): Promise<any> {
    const json = await this.fetch('https://apps.admob.com/reporting/_/rpc/ReportingService/GenerateReport?authuser=1&authuser=1&authuser=1&f.sid=-6923932103619097000', {
      1: {
        1: [appId],
        2: {
          1: startDate,
          2: endDate
        },
        3: [1, 2, 3, 4, 5, 6, 7, 8],
        4: 2,
        5: 1,
        7: 1
      }
    });
    return json;
  }

  // Add any additional methods you need for AdMob interactions here
}

// Helper functions (if needed)
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

// Export any additional types or constants if needed
export const AD_FORMATS = [AdFormat.Banner, AdFormat.Interstitial, AdFormat.Rewarded, AdFormat.Native];