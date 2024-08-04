import consola from 'consola';
import { parse as parseYaml } from 'yaml';
import { API } from './apis/admob';
import { FirebaseManager } from './apis/firebase';
import { getAdmobAuthData } from './apis/google';
import { getAppConfig, getConfiguredApps } from './read';
import { parseCliArguments } from './cli';
import fs from 'fs/promises';
import path from 'path';

async function readFile(filePath: string): Promise<string> {
  if (typeof Bun !== 'undefined') {
    return await Bun.file(filePath).text();
  } else {
    return await fs.readFile(filePath, 'utf-8');
  }
}

async function main() {
  const cliOptions = parseCliArguments();

  // Load configuration
  const configPath = path.resolve(process.cwd(), cliOptions.configPath);
  const configContent = await readFile(configPath);
  const config = parseYaml(configContent);

  // Get authentication data
  const authData = await getAdmobAuthData();

  const admob = new API(authData);
  const firebaseManager = new FirebaseManager(authData.googleAuthData.cookies[0].value);
  await firebaseManager.init();

  if (cliOptions.action === 'list') {
    const apps = await admob.listApps();
    consola.info('Available apps:');
    apps.forEach(app => {
      consola.info(`${app.appId}: ${app.name} (${app.platform})`);
    });
    return;
  }

  if (cliOptions.action === 'sync') {
    const apps = await admob.listApps();
    const configuredApps = getConfiguredApps();
    const selectedApps = cliOptions.appId
      ? apps.filter(x => x.appId === cliOptions.appId)
      : apps.filter(x => x.projectId).filter(x => configuredApps.includes(x.appId!));

    for (const app of selectedApps) {
      const appConfig = getAppConfig(app.appId!);
      const taggedConsola = consola.withTag(app.appId);
      taggedConsola.info('Updating ad units for', app.name);

      for (const [placementId, formats] of Object.entries(appConfig.placements || {})) {
        for (const [format, formatConfig] of Object.entries(formats)) {
          // Multiple eCPM floors technique
          // This approach creates multiple ad units with different eCPM floors
          // for each placement and format. This allows for:
          // 1. Higher fill rates by having lower floor options
          // 2. Higher eCPM by still prioritizing higher-paying ads
          // 3. Better adaptation to varying bid landscapes
          const ecpmFloors = formatConfig.ecpmFloors;

          taggedConsola.info('Syncing ad units', placementId, format);
          try {
            const resultAdUnits = await admob.syncAdUnits(app, placementId, format, ecpmFloors);
            taggedConsola.success('Synced ad units');

            // Update mediation group
            // This ensures that all created ad units are properly organized
            // and prioritized within the AdMob mediation system
            taggedConsola.info('Updating mediation group', placementId, format);
            try {
              await admob.syncMediationGroup(app, placementId, format, Object.values(resultAdUnits).map(x => x.adUnitId));
              taggedConsola.success('Updated mediation group');
            } catch (e) {
              taggedConsola.error('Failed to update mediation group', e);
            }

            // Update remote config
            // This step synchronizes the created ad units with Firebase Remote Config
            // allowing for dynamic ad unit selection based on eCPM in the app
            taggedConsola.info('Updating remote config', placementId, format);
            await firebaseManager.updateAdUnits({
              projectId: app.projectId,
              platform: app.platform,
              placementId: placementId,
              format: format,
              ecpmFloors: Object.fromEntries(
                await Promise.all(
                  Object.entries(resultAdUnits).map(async ([ecpm, adUnit]) => [
                    ecpm,
                    await admob.getPublicAdUnitId(adUnit.adUnitId)
                  ])
                )
              )
            });
            taggedConsola.success('Updated remote config');
          } catch (e) {
            taggedConsola.error('Failed to sync ad units', e);
          }
        }
      }
    }
  }
}

main().catch(console.error);