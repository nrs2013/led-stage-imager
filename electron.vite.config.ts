import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // index = メインプロセス本体。depth-worker = 深度AIを別スレッドで回す worker。
        // どちらも out/main/ に出力され、worker は new Worker(join(__dirname,'depth-worker.js')) で読む。
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'depth-worker': resolve(__dirname, 'src/main/depth/depth-worker.ts')
        }
      }
    }
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
