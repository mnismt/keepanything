/**
 * pnpm only runs the `electron` postinstall (which downloads the binary) once its build
 * script is approved via pnpm-workspace.yaml. This guard makes a fresh clone self-heal.
 */

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const electronDir = resolve(process.cwd(), 'node_modules/electron')
if (existsSync(electronDir) && !existsSync(resolve(electronDir, 'dist'))) {
  console.log('[ensure-electron] Electron binary missing, running its install script…')
  execSync('node install.js', { cwd: electronDir, stdio: 'inherit' })
}
