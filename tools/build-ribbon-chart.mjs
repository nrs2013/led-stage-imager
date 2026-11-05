#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { build } from 'esbuild'

const [inputPath, outputPath] = process.argv.slice(2)
if (!inputPath || !outputPath || resolve(inputPath) === resolve(outputPath)) {
  throw new Error('Usage: node tools/build-ribbon-chart.mjs input.json NEW-output.ledimager')
}
const input = JSON.parse(await readFile(inputPath, 'utf8'))
const entry = fileURLToPath(new URL('../src/renderer/src/model/ribbon-layout.ts', import.meta.url))
const bundle = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false })
const { appendRibbonMotifs } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
const chart = appendRibbonMotifs(input.chart, input.templates, input.placements)
await writeFile(outputPath, JSON.stringify(chart), { flag: 'wx' })
console.log(`Created chart proposal: ${chart.layers.length} charts, ${chart.shapes.length} shapes.`)
