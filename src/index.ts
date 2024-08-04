import { program } from 'commander';
import consola from 'consola';
import { API } from './apis/admob';
import { FirebaseManager } from './apis/firebase';
import { getAdmobAuthData } from './apis/google';
import { loadConfig, getAppConfig, getConfiguredApps, getDefaultEcpmFloors } from './read';
import { AdFormat, Platform } from './base';

async function main() {
  program
    .option('-c, --config <path>', 'Path to config file', 'config.yml')
    .option('-a, --app-id <appId>', 'Specific app ID to sync')
    .parse(process.argv);

  const options = program.opts();

  // Load configuration
  await loadConfig(options.config);

  // Get authentication data
  const authData = await getAdmobAuthData();

  const admob = new API(authData);
  const firebaseManager = new FirebaseManager(authData.googleAuthData.cookies[0].value);
  await firebaseManager.init();

  const apps = await admob.listApps();
  const configuredApps = getConfiguredApps();
  const selectedApps = options.appId
    ? apps.filter(app => app.appId === options.appId)
    : apps.filter(app => configuredApps.includes(app.appId!));

  for (const app of selectedApps) {
    const appConfig = getAppConfig(app.appId!);
    const taggedConsola = consola.withTag(app.appId);
    taggedConsola.info('Updating ad units for', app.name);

    for (const [placementId, formats] of Object.entries(appConfig.placements)) {
      for (const [format, formatConfig] of Object.entries(formats)) {
        const ecpmFloors = formatConfig.ecpmFloors.length > 0
          ? formatConfig.ecpmFloors
          : getDefaultEcpmFloors();

        taggedConsola.info('Syncing ad units', placementId, format);
        try {
          const resultAdUnits = await admob.syncAdUnits(app, placementId, format as AdFormat, ecpmFloors);
          taggedConsola.success('Synced ad units');

          // Update mediation group
          taggedConsola.info('Updating mediation group', placementId, format);
          try {
            await admob.syncMediationGroup(app, placementId, format as AdFormat, Object.values(resultAdUnits).map(x => x.adUnitId), appConfig.adSources);
            taggedConsola.success('Updated mediation group');
          } catch (e) {
            taggedConsola.error('Failed to update mediation group', e);
          }

          // Update remote config
          taggedConsola.info('Updating remote config', placementId, format);
          await firebaseManager.updateAdUnits({
            projectId: app.projectId!,
            platform: app.platform as Platform,
            placementId: placementId,
            format: format as AdFormat,
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

main().catch(console.error);