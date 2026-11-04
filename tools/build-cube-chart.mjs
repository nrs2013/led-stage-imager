#!/usr/bin/env node
// Offline proposal builder. Keep production inputs and generated charts outside Git.
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { build } from 'esbuild'

const [inputPath, outputPath] = process.argv.slice(2)
if (!inputPath || !outputPath || resolve(inputPath) === resolve(outputPath)) {
  throw new Error('Usage: node tools/build-cube-chart.mjs input.json NEW-output.ledimager')
}
const input = JSON.parse(await readFile(inputPath, 'utf8'))
const entry = fileURLToPath(new URL('../src/renderer/src/model/projected-cubes.ts', import.meta.url))
const bundle = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false })
const { appendProjectedCubes } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
const chart = appendProjectedCubes(input.chart, input.templates, input.patches, input.placements, input.margin ?? 6)
// Never overwrite an existing show or an earlier proposal, even on a repeated run.
await writeFile(outputPath, JSON.stringify(chart), { flag: 'wx' })
console.log(`Created proposal: ${chart.shapes.length} shapes, ${chart.fixtures.length} fixtures.`)
