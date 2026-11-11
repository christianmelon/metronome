import { randomUUID } from 'node:crypto'
import type { Plugin } from 'vite'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

function precacheManifestPlugin(): Plugin {
  return {
    name: 'metronome-precache-manifest',
    apply: 'build',
    generateBundle(_options, bundle) {
      const resources = new Set(['./'])
      for (const fileName of Object.keys(bundle)) {
        if (fileName !== 'precache-manifest.json') {
          resources.add(fileName)
        }
      }

      this.emitFile({
        type: 'asset',
        fileName: 'precache-manifest.json',
        source: JSON.stringify([...resources]),
      })
    },
  }
}

const buildId = randomUUID()
const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1]
const base =
  process.env.GITHUB_ACTIONS === 'true' && repositoryName
    ? `/${repositoryName}/`
    : '/'

export default defineConfig({
  base,
  plugins: [vue(), precacheManifestPlugin()],
  define: {
    __APP_BUILD_ID__: JSON.stringify(buildId),
  },
})
