import {app} from 'electron'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
const devDataFolder = process.env.UZ_DEV_DATA_FOLDER
if (devDataFolder) {
  app.setPath('userData', path.join(app.getPath('appData'), devDataFolder))
}
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else if (__UZ_DEV_MAIN_BUNDLE__) {
  void import(pathToFileURL(__UZ_DEV_MAIN_BUNDLE__).href)
} else {
  throw new Error(
    'The packaged shell loads a verified bundle (ADR 0007); not built yet.'
  )
}
