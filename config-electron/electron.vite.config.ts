import { resolve } from 'path'
import { copyFileSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// The WASAPI loopback worker is spawned as a standalone child process and is not
// imported anywhere, so the bundler never picks it up. Copy it next to the main
// bundle (out/main) so `join(__dirname, 'loopback-worker.js')` resolves in both
// dev and packaged builds.
function copyLoopbackWorker() {
  return {
    name: 'copy-loopback-worker',
    closeBundle() {
      copyFileSync(
        resolve('src/main/audio/loopback-worker.js'),
        resolve('out/main/loopback-worker.js')
      )
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copyLoopbackWorker()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: resolve('src/renderer'),
    build: {
      rollupOptions: {
        input: resolve('src/renderer/index.html')
      }
    },
    plugins: [react()]
  }
})
