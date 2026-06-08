# DECOR STUDIO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single macOS desktop app that lets a non-coder draw electric-decoration shapes (lines, bulbs, arbitrary figures) over a chart image, assign each a DMX address (RGB, 3ch default), receive live levels from a real DMX console via Art-Net, and output only the glowing shapes (black elsewhere) into Resolume Arena via Syphon.

**Architecture:** Electron app. Main process receives Art-Net (UDP 6454) and publishes the live output frame to Syphon. Renderer (React + TypeScript + Vite) holds the chart model, the SVG editor, and the WebGL output canvas. Pure logic (Art-Net parsing, channel math, patch overlap, file I/O) lives in framework-free modules unit-tested with Vitest. The riskiest integration (Art-Net-in + Syphon-out) is proven by a Milestone-0 spike before the big build.

**Tech Stack:** Electron, electron-vite, TypeScript, React, Vitest, `dgram` (UDP), `node-syphon` (output; NDI via `grandiose` documented as fallback), WebGL (output glow), SVG (editor).

**Reference spec:** `docs/superpowers/specs/2026-06-08-decor-studio-design.md`

---

## File Structure

```
decor-studio/
  package.json
  electron.vite.config.ts          # main / preload / renderer builds
  tsconfig.json
  vitest.config.ts
  tools/
    artnet-test-sender.mjs         # dev tool: fake console, sends ArtDMX
  src/
    main/
      index.ts                     # Electron entry, windows, mode, IPC wiring
      artnet/
        artdmx-parser.ts           # pure: bytes -> {universe, sequence, data}  [TDD]
        artnet-receiver.ts         # dgram UDP listen, emits parsed packets
      output/
        syphon-publisher.ts        # node-syphon publish; chosen-in-spike pipeline
      ipc-channels.ts              # shared channel name constants
    preload/
      index.ts                     # contextBridge: artnet events, output, dialogs
    renderer/
      main.tsx                     # React root + mode switch (Edit / Live)
      model/
        types.ts                   # Shape, Fixture, Chart types  [TDD helpers]
        chart-model.ts             # createChart/addShape/updateShape helpers [TDD]
      dmx/
        channel-math.ts            # outRGB from a universe buffer + fixture  [TDD]
        patch.ts                   # channelCount, ranges, overlap detect     [TDD]
      io/
        chart-file.ts              # serialize/parse chart JSON (+image embed) [TDD]
      state/
        store.ts                   # Zustand store: chart + live dmx values
        dmx-bridge.ts              # subscribe to main Art-Net events -> store
      editor/
        EditorCanvas.tsx           # SVG canvas, pan/zoom, selection
        Underlay.tsx               # background chart image w/ opacity
        tools.ts                   # shape-creation tool state machine
        Inspector.tsx              # selected-shape props + address assign
        PatchTable.tsx             # patch list + CSV export + overlap warnings
        Toolbar.tsx                # tool buttons, mode toggle
      output/
        OutputRenderer.ts          # WebGL: draw shapes w/ glow from dmx values
        glow.ts                    # glow shader / blur helpers
        OutputWindow.tsx           # fullscreen preview window content
      test/
        ManualFaders.tsx           # per-fixture R/G/B sliders + test patterns
      ui/
        Lamp.tsx                   # receive / syphon status lamps
        SettingsDialog.tsx         # canvas size, channel order, NIC, hold/zero
  resources/
    icon.png
```

**Responsibility boundaries:**
- `artdmx-parser`, `channel-math`, `patch`, `chart-model`, `chart-file` are **pure** (no Electron, no React, no DOM) → fully unit-tested.
- `artnet-receiver`, `syphon-publisher` are thin I/O wrappers around the pure parser / chosen pipeline.
- Editor (SVG) and Output (WebGL) share the same `Shape`/`Chart` model but render differently: SVG for authoring, WebGL for the live/Syphon frame.

---

## Milestone 0 — Spike: prove Art-Net-in + Syphon-out (DE-RISK FIRST)

**Why first:** The whole app is pointless if we cannot (a) receive Art-Net and (b) push a black-background, alpha-capable frame into Resolume via Syphon on this Mac. This milestone proves the pipeline end-to-end with a trivial render and picks the final output pipeline. **Do not start Milestone 2+ until this passes.**

### Task 0.1: Scaffold the Electron + Vite + TS project

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/main.tsx`, `src/renderer/index.html`

- [ ] **Step 1: Scaffold with electron-vite (React + TS template)**

Run:
```bash
cd "/Users/nomurayuuki/Documents/decor-studio"
npm create @quick-start/electron@latest . -- --template react-ts
npm install
```
If the directory-not-empty prompt appears, choose to keep existing files (the `docs/` and `.git` must remain).

- [ ] **Step 2: Run the dev app to confirm a window opens**

Run: `npm run dev`
Expected: an Electron window opens showing the template page. Close it.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore: scaffold electron-vite react-ts project"
```

### Task 0.2: ArtDMX parser (pure, TDD)

**Files:**
- Create: `src/main/artnet/artdmx-parser.ts`
- Test: `src/main/artnet/artdmx-parser.test.ts`

- [ ] **Step 1: Add Vitest**

Run: `npm i -D vitest` then create `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'node', include: ['src/**/*.test.ts'] } })
```
Add to `package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.

- [ ] **Step 2: Write the failing test**

```ts
// src/main/artnet/artdmx-parser.test.ts
import { describe, it, expect } from 'vitest'
import { parseArtDmx } from './artdmx-parser'

function buildPacket(net: number, subUni: number, data: number[]): Buffer {
  const header = Buffer.from('Art-Net\0', 'latin1')          // 8 bytes
  const opcode = Buffer.from([0x00, 0x50])                    // 0x5000 little-endian
  const protVer = Buffer.from([0x00, 0x0e])                   // 14 big-endian
  const seqPhys = Buffer.from([0x01, 0x00])                   // sequence, physical
  const addr = Buffer.from([subUni, net])                     // SubUni, Net
  const len = Buffer.from([(data.length >> 8) & 0xff, data.length & 0xff])
  return Buffer.concat([header, opcode, protVer, seqPhys, addr, len, Buffer.from(data)])
}

describe('parseArtDmx', () => {
  it('parses a valid packet and composes the universe number', () => {
    const pkt = buildPacket(1, 0x23, [10, 20, 30])
    const r = parseArtDmx(pkt)
    expect(r).not.toBeNull()
    expect(r!.universe).toBe((1 << 8) | 0x23) // 291
    expect(r!.sequence).toBe(1)
    expect(Array.from(r!.data)).toEqual([10, 20, 30])
  })

  it('returns null for a non Art-Net header', () => {
    const bad = Buffer.from('NOPE....xxxxxxxxxxxxxxxxxx')
    expect(parseArtDmx(bad)).toBeNull()
  })

  it('returns null for a non-DMX opcode (e.g. ArtPoll 0x2000)', () => {
    const pkt = buildPacket(0, 0, [1, 2])
    pkt[8] = 0x00; pkt[9] = 0x20 // overwrite opcode to 0x2000
    expect(parseArtDmx(pkt)).toBeNull()
  })

  it('truncates data to the declared length', () => {
    const pkt = buildPacket(0, 5, [1, 2, 3, 4])
    const r = parseArtDmx(pkt)
    expect(r!.data.length).toBe(4)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- artdmx-parser`
Expected: FAIL — `parseArtDmx is not a function`.

- [ ] **Step 4: Implement**

```ts
// src/main/artnet/artdmx-parser.ts
export interface ArtDmxPacket {
  universe: number   // 0..32767 (Net<<8 | SubUni)
  sequence: number
  data: Uint8Array   // length 1..512
}

const ART_NET_ID = 'Art-Net\0'
const OP_DMX = 0x5000

export function parseArtDmx(buf: Buffer): ArtDmxPacket | null {
  if (buf.length < 18) return null
  if (buf.toString('latin1', 0, 8) !== ART_NET_ID) return null
  const opcode = buf.readUInt16LE(8)        // Art-Net opcodes are little-endian
  if (opcode !== OP_DMX) return null
  const sequence = buf.readUInt8(12)
  const subUni = buf.readUInt8(14)
  const net = buf.readUInt8(15)
  const length = buf.readUInt16BE(16)       // length is big-endian
  const universe = (net << 8) | subUni
  const data = new Uint8Array(buf.subarray(18, 18 + length))
  return { universe, sequence, data }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- artdmx-parser`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(artnet): ArtDMX packet parser with tests"
```

### Task 0.3: Art-Net receiver (dgram wrapper)

**Files:**
- Create: `src/main/artnet/artnet-receiver.ts`

- [ ] **Step 1: Implement the receiver**

```ts
// src/main/artnet/artnet-receiver.ts
import { createSocket, type Socket } from 'node:dgram'
import { EventEmitter } from 'node:events'
import { parseArtDmx } from './artdmx-parser'

export const ARTNET_PORT = 6454

export class ArtNetReceiver extends EventEmitter {
  private socket: Socket | null = null
  /** @param bindAddress '0.0.0.0' for all NICs, or a specific NIC IP */
  start(bindAddress = '0.0.0.0'): void {
    this.stop()
    const sock = createSocket({ type: 'udp4', reuseAddr: true })
    sock.on('message', (msg) => {
      const pkt = parseArtDmx(msg)
      if (pkt) this.emit('dmx', pkt) // { universe, sequence, data }
    })
    sock.on('error', (err) => this.emit('error', err))
    sock.bind(ARTNET_PORT, bindAddress)
    this.socket = sock
  }
  stop(): void { this.socket?.close(); this.socket = null }
}
```

- [ ] **Step 2: Manual smoke test with the dev sender (built in Task 0.4)** — verified in Task 0.5.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(artnet): UDP receiver wrapping the parser"
```

### Task 0.4: Dev Art-Net sender (fake console)

**Files:**
- Create: `tools/artnet-test-sender.mjs`

- [ ] **Step 1: Implement a looping sender that ramps channel values**

```js
// tools/artnet-test-sender.mjs — run: node tools/artnet-test-sender.mjs [universe]
import { createSocket } from 'node:dgram'
const UNIVERSE = Number(process.argv[2] ?? 0)
const HOST = '127.0.0.1', PORT = 6454
const sock = createSocket('udp4')
let t = 0
function packet(universe, data) {
  const head = Buffer.from('Art-Net\0', 'latin1')
  const op = Buffer.from([0x00, 0x50]); const ver = Buffer.from([0x00, 0x0e])
  const seq = Buffer.from([t & 0xff, 0x00])
  const addr = Buffer.from([universe & 0xff, (universe >> 8) & 0xff])
  const len = Buffer.from([(data.length >> 8) & 0xff, data.length & 0xff])
  return Buffer.concat([head, op, ver, seq, addr, len, Buffer.from(data)])
}
setInterval(() => {
  t++
  const data = new Array(512).fill(0)
  const v = Math.floor((Math.sin(t / 20) * 0.5 + 0.5) * 255)
  data[0] = v; data[1] = 0; data[2] = 255 - v // ch1=R ramp, ch3=B inverse ramp
  sock.send(packet(UNIVERSE, data), PORT, HOST)
}, 1000 / 30)
console.log(`Sending ArtDMX to ${HOST}:${PORT} universe ${UNIVERSE} (Ctrl+C to stop)`)
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "chore(dev): Art-Net test sender tool"
```

### Task 0.5: Syphon output spike + END-TO-END proof

**Files:**
- Create: `src/main/output/syphon-publisher.ts`
- Modify: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/main.tsx`

- [ ] **Step 1: Install node-syphon and confirm it builds on this Mac**

Run: `npm i node-syphon`
Expected: native module installs/builds without error on Apple Silicon. If it fails, record the error and jump to Step 6 (fallback decision).

- [ ] **Step 2: Decide the frame pipeline (this is the spike's core question)**

Try, in order, and keep the first that works:
- **(A) Shared-texture (best):** Create a hidden offscreen `BrowserWindow` with `webPreferences: { offscreen: true }`, enable shared-texture paint, and pass the macOS IOSurface handle from the `paint` event to `node-syphon`'s Metal/IOSurface server. Renderer draws a WebGL quad.
- **(B) CPU readback (reliable fallback):** Renderer draws to WebGL, reads pixels with `gl.readPixels`, sends the `Uint8Array` (RGBA) over IPC to main, `node-syphon` publishes a CPU image server. Cap at 1920×1080/30fps for the spike.
- **(C) NDI fallback (if Syphon unusable):** Replace `node-syphon` with `grandiose` NDI send of the CPU buffer; Resolume receives via NDI.

Document the chosen path in a comment at the top of `syphon-publisher.ts`.

- [ ] **Step 3: Implement the minimal publisher for the chosen path**

```ts
// src/main/output/syphon-publisher.ts
// PIPELINE CHOSEN IN SPIKE: <A shared-texture | B CPU readback | C NDI> — fill in.
import syphon from 'node-syphon'

export class OutputPublisher {
  private server: any = null
  start(name = 'DECOR STUDIO'): void {
    // For path B (CPU): create a Metal/GL image server that accepts RGBA frames.
    this.server = new syphon.SyphonMetalServer(name) // exact class per node-syphon API confirmed in spike
  }
  publishRGBA(width: number, height: number, rgba: Uint8Array): void {
    this.server?.publishImageData?.(rgba, width, height) // exact method confirmed in spike
  }
  stop(): void { this.server?.dispose?.(); this.server = null }
}
```
(Exact `node-syphon` class/method names are confirmed during the spike and locked here; later tasks import this stable interface: `start()`, `publishRGBA()`, `stop()`.)

- [ ] **Step 4: Wire a trivial driven render**

In `main/index.ts`: start `ArtNetReceiver`, forward `dmx` packets to the renderer over IPC. In `renderer/main.tsx`: draw a fullscreen WebGL quad whose color = `(data[0], data[1], data[2])` of universe 0; push each frame to the publisher (via the chosen path). In `main/index.ts`: start `OutputPublisher`.

- [ ] **Step 5: END-TO-END acceptance test (the gate)**

Run in three terminals:
```bash
npm run dev                                # the app
node tools/artnet-test-sender.mjs 0        # fake console ramping ch1/ch3
```
Then open Resolume Arena → add a Syphon/Spout source → select "DECOR STUDIO".
Expected: a quad in Resolume whose red/blue pulse in sync with the sender. The background is black; on an Add-blend layer the black disappears.
**GATE:** This must pass (with path A, B, or C) before proceeding. If none works, stop and escalate to the user with findings.

- [ ] **Step 6: Commit the spike**

```bash
git add -A && git commit -m "spike: end-to-end Art-Net in -> Syphon out proven (pipeline=<A/B/C>)"
```

---

## Milestone 1 — Core model + DMX logic (pure, TDD)

### Task 1.1: Types and chart-model helpers

**Files:**
- Create: `src/renderer/model/types.ts`, `src/renderer/model/chart-model.ts`
- Test: `src/renderer/model/chart-model.test.ts`

- [ ] **Step 1: Define types**

```ts
// src/renderer/model/types.ts
export type ShapeType = 'line' | 'polyline' | 'freehand' | 'ellipse' | 'rect' | 'triangle' | 'star' | 'polygon'
export type DisplayMode = 'stroke' | 'fill' | 'both'
export type ChannelMode = 'rgb' | 'rgbdim' | 'dim' | 'rgbw'

export interface Point { x: number; y: number }

export interface Shape {
  id: string
  type: ShapeType
  points: Point[]            // geometry in canvas pixels
  display: DisplayMode
  strokeWidth: number
  glowRadius: number         // px
  glowIntensity: number      // 0..1
  fixedColor?: [number, number, number] // for 'dim' mode
  fixtureId?: string
}

export interface Fixture {
  id: string
  shapeId: string
  universe: number           // 0..32767
  start: number              // 1..512
  mode: ChannelMode
}

export interface Chart {
  version: 1
  id: string
  name: string
  canvas: { w: number; h: number }
  underlay: { dataUrl: string; opacity: number; visible: boolean } | null
  shapes: Shape[]
  fixtures: Fixture[]
  syphon: { name: string }
  settings: { holdOnTimeout: boolean; gamma: boolean }
}
```

- [ ] **Step 2: Write failing tests for chart-model**

```ts
// src/renderer/model/chart-model.test.ts
import { describe, it, expect } from 'vitest'
import { createChart, addShape } from './chart-model'

describe('chart-model', () => {
  it('createChart sets defaults', () => {
    const c = createChart({ w: 1920, h: 1080 })
    expect(c.version).toBe(1)
    expect(c.canvas).toEqual({ w: 1920, h: 1080 })
    expect(c.shapes).toEqual([])
    expect(c.fixtures).toEqual([])
    expect(c.syphon.name).toBe('DECOR STUDIO')
  })
  it('addShape appends a shape with an id', () => {
    const c = createChart({ w: 100, h: 100 })
    const c2 = addShape(c, { type: 'line', points: [{x:0,y:0},{x:10,y:0}] })
    expect(c2.shapes).toHaveLength(1)
    expect(c2.shapes[0].id).toBeTruthy()
    expect(c2.shapes[0].display).toBe('stroke')
  })
})
```

- [ ] **Step 3: Run, verify fail** — Run: `npm test -- chart-model` → FAIL.

- [ ] **Step 4: Implement**

```ts
// src/renderer/model/chart-model.ts
import type { Chart, Shape, ShapeType, Point } from './types'

let counter = 0
export const newId = (prefix = 'id'): string => `${prefix}_${Date.now().toString(36)}_${(counter++).toString(36)}`

export function createChart(canvas: { w: number; h: number }): Chart {
  return {
    version: 1, id: newId('chart'), name: 'Untitled', canvas,
    underlay: null, shapes: [], fixtures: [],
    syphon: { name: 'DECOR STUDIO' },
    settings: { holdOnTimeout: true, gamma: false },
  }
}

export function addShape(chart: Chart, init: { type: ShapeType; points: Point[] } & Partial<Shape>): Chart {
  const shape: Shape = {
    id: newId('shape'), display: 'stroke', strokeWidth: 6, glowRadius: 12, glowIntensity: 0.8,
    ...init,
  } as Shape
  return { ...chart, shapes: [...chart.shapes, shape] }
}
```
(Note: `newId` uses `Date.now()`; acceptable in app runtime. Tests assert truthiness, not exact value.)

- [ ] **Step 5: Run, verify pass** — Run: `npm test -- chart-model` → PASS.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(model): chart types + createChart/addShape with tests"`

### Task 1.2: channel-math (pure, TDD)

**Files:**
- Create: `src/renderer/dmx/channel-math.ts`
- Test: `src/renderer/dmx/channel-math.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/renderer/dmx/channel-math.test.ts
import { describe, it, expect } from 'vitest'
import { fixtureColor, channelCount } from './channel-math'
import type { Fixture } from '../model/types'

const uni = (over: Record<number, number>): Uint8Array => {
  const a = new Uint8Array(512); for (const k in over) a[+k] = over[k]; return a
}
const fx = (mode: Fixture['mode'], start: number, extra: Partial<Fixture> = {}): Fixture =>
  ({ id: 'f', shapeId: 's', universe: 0, start, mode, ...extra })

describe('channelCount', () => {
  it('maps modes to channel counts', () => {
    expect(channelCount('rgb')).toBe(3)
    expect(channelCount('rgbdim')).toBe(4)
    expect(channelCount('dim')).toBe(1)
    expect(channelCount('rgbw')).toBe(5)
  })
})

describe('fixtureColor', () => {
  it('rgb mode passes channels straight through (start is 1-based)', () => {
    const data = uni({ 0: 10, 1: 20, 2: 30 }) // addresses 1,2,3 -> indices 0,1,2
    expect(fixtureColor(fx('rgb', 1), data, false)).toEqual([10, 20, 30])
  })
  it('rgbdim multiplies rgb by dim/255', () => {
    const data = uni({ 0: 200, 1: 100, 2: 0, 3: 128 }) // R200 G100 B0 Dim128
    const [r, g, b] = fixtureColor(fx('rgbdim', 1), data, false)
    expect(r).toBe(Math.round(200 * 128 / 255))
    expect(g).toBe(Math.round(100 * 128 / 255))
    expect(b).toBe(0)
  })
  it('dim mode scales the fixed color', () => {
    const data = uni({ 0: 255 }) // dim full
    const f = fx('dim', 1, { fixedColor: [0, 255, 0] } as Partial<Fixture>)
    expect(fixtureColor(f, data, false)).toEqual([0, 255, 0])
  })
})
```

- [ ] **Step 2: Run, verify fail** — `npm test -- channel-math` → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/renderer/dmx/channel-math.ts
import type { Fixture, ChannelMode } from '../model/types'

export type RGB = [number, number, number]

export function channelCount(mode: ChannelMode): number {
  switch (mode) { case 'rgb': return 3; case 'rgbdim': return 4; case 'dim': return 1; case 'rgbw': return 5 }
}

const clamp = (n: number): number => (n < 0 ? 0 : n > 255 ? 255 : Math.round(n))
const gammaCorrect = (v: number): number => clamp(255 * Math.pow(v / 255, 2.2))

export function fixtureColor(fx: Fixture, data: Uint8Array, gamma: boolean): RGB {
  const i = fx.start - 1 // 1-based DMX address -> 0-based index
  let rgb: RGB
  switch (fx.mode) {
    case 'rgb': rgb = [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0]; break
    case 'rgbdim': {
      const d = (data[i + 3] ?? 0) / 255
      rgb = [clamp((data[i] ?? 0) * d), clamp((data[i + 1] ?? 0) * d), clamp((data[i + 2] ?? 0) * d)]
      break
    }
    case 'dim': {
      const d = (data[i] ?? 0) / 255, c = fx.fixedColor ?? [255, 255, 255]
      rgb = [clamp(c[0] * d), clamp(c[1] * d), clamp(c[2] * d)]
      break
    }
    case 'rgbw': {
      const w = data[i + 3] ?? 0, d = (data[i + 4] ?? 0) / 255
      rgb = [clamp(((data[i] ?? 0) + w) * d), clamp(((data[i + 1] ?? 0) + w) * d), clamp(((data[i + 2] ?? 0) + w) * d)]
      break
    }
  }
  return gamma ? [gammaCorrect(rgb[0]), gammaCorrect(rgb[1]), gammaCorrect(rgb[2])] : rgb
}
```

- [ ] **Step 4: Run, verify pass** — `npm test -- channel-math` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(dmx): channel math (rgb/rgbdim/dim/rgbw) with tests"`

### Task 1.3: patch (overlap detection, pure, TDD)

**Files:**
- Create: `src/renderer/dmx/patch.ts`
- Test: `src/renderer/dmx/patch.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/renderer/dmx/patch.test.ts
import { describe, it, expect } from 'vitest'
import { channelRange, detectOverlaps } from './patch'
import type { Fixture } from '../model/types'
const fx = (id: string, universe: number, start: number, mode: Fixture['mode']): Fixture =>
  ({ id, shapeId: id, universe, start, mode })

describe('channelRange', () => {
  it('returns inclusive [start, end] from mode width', () => {
    expect(channelRange(fx('a', 0, 1, 'rgb'))).toEqual([1, 3])
    expect(channelRange(fx('a', 0, 10, 'rgbdim'))).toEqual([10, 13])
  })
})

describe('detectOverlaps', () => {
  it('allows identical start+mode in the same universe (intentional shared)', () => {
    const a = fx('a', 0, 1, 'rgb'), b = fx('b', 0, 1, 'rgb')
    expect(detectOverlaps([a, b])).toEqual([])
  })
  it('warns on partial overlap (different start, ranges intersect)', () => {
    const a = fx('a', 0, 1, 'rgb'), b = fx('b', 0, 2, 'rgb') // [1..3] vs [2..4]
    expect(detectOverlaps([a, b])).toEqual([['a', 'b']])
  })
  it('does not warn across different universes', () => {
    const a = fx('a', 0, 1, 'rgb'), b = fx('b', 1, 1, 'rgb')
    expect(detectOverlaps([a, b])).toEqual([])
  })
})
```

- [ ] **Step 2: Run, verify fail** — `npm test -- patch` → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/renderer/dmx/patch.ts
import type { Fixture } from '../model/types'
import { channelCount } from './channel-math'

export function channelRange(fx: Fixture): [number, number] {
  return [fx.start, fx.start + channelCount(fx.mode) - 1]
}

/** Returns pairs of fixture ids that partially overlap (a warning). Identical
 *  start+mode in the same universe is allowed (intentional 一斉点灯). */
export function detectOverlaps(fixtures: Fixture[]): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (let i = 0; i < fixtures.length; i++) {
    for (let j = i + 1; j < fixtures.length; j++) {
      const a = fixtures[i], b = fixtures[j]
      if (a.universe !== b.universe) continue
      const shared = a.start === b.start && a.mode === b.mode
      if (shared) continue
      const [as, ae] = channelRange(a), [bs, be] = channelRange(b)
      if (as <= be && bs <= ae) out.push([a.id, b.id])
    }
  }
  return out
}
```

- [ ] **Step 4: Run, verify pass** — `npm test -- patch` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(dmx): patch ranges + overlap detection with tests"`

### Task 1.4: chart-file (save/load round-trip, pure, TDD)

**Files:**
- Create: `src/renderer/io/chart-file.ts`
- Test: `src/renderer/io/chart-file.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/renderer/io/chart-file.test.ts
import { describe, it, expect } from 'vitest'
import { serializeChart, parseChart } from './chart-file'
import { createChart, addShape } from '../model/chart-model'

describe('chart-file', () => {
  it('round-trips a chart through serialize/parse', () => {
    let c = createChart({ w: 1920, h: 1080 })
    c = addShape(c, { type: 'ellipse', points: [{ x: 5, y: 5 }, { x: 15, y: 15 }] })
    c.underlay = { dataUrl: 'data:image/png;base64,AAAA', opacity: 0.5, visible: true }
    const parsed = parseChart(serializeChart(c))
    expect(parsed).toEqual(c)
  })
  it('throws a clear error on malformed json', () => {
    expect(() => parseChart('{not json')).toThrow(/invalid chart file/i)
  })
  it('rejects an unsupported version', () => {
    expect(() => parseChart(JSON.stringify({ version: 99 }))).toThrow(/version/i)
  })
})
```

- [ ] **Step 2: Run, verify fail** — `npm test -- chart-file` → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/renderer/io/chart-file.ts
import type { Chart } from '../model/types'

export function serializeChart(chart: Chart): string {
  return JSON.stringify(chart, null, 2)
}

export function parseChart(json: string): Chart {
  let obj: unknown
  try { obj = JSON.parse(json) } catch { throw new Error('Invalid chart file: not valid JSON') }
  const c = obj as Partial<Chart>
  if (c.version !== 1) throw new Error(`Unsupported chart version: ${(c as any)?.version}`)
  return c as Chart
}
```

- [ ] **Step 4: Run, verify pass** — `npm test -- chart-file` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(io): chart serialize/parse round-trip with tests"`

---

## Milestone 2 — Editor (SVG authoring)

UI tasks are verified visually with the preview/screenshot workflow (per the user's "実物大で確認" rule), not unit tests. Each task ends by running `npm run dev` and confirming the described behavior on screen.

### Task 2.1: App shell + Zustand store + mode toggle

**Files:**
- Create: `src/renderer/state/store.ts`, `src/renderer/editor/Toolbar.tsx`
- Modify: `src/renderer/main.tsx`

- [ ] **Step 1: Install Zustand** — Run: `npm i zustand`
- [ ] **Step 2: Implement the store** holding `chart: Chart`, `mode: 'edit'|'live'`, `selectedId: string|null`, `dmxByUniverse: Record<number, Uint8Array>`, and actions `setChart`, `setMode`, `select`, `updateShape`, `setUniverseData`. Initialize with `createChart({ w: 1920, h: 1080 })`.
- [ ] **Step 3: `main.tsx`** renders `<Toolbar/>` (mode toggle Edit/Live + tool buttons) and switches between `<EditorCanvas/>` (edit) and the live view (later). Style follows the user's design system (細線ボタン, 黒背景; see `feedback_brutalist_vivid_design`).
- [ ] **Step 4: Verify** — `npm run dev`: window shows a black canvas area + toolbar; Edit/Live toggle flips a visible label.
- [ ] **Step 5: Commit** — `git commit -m "feat(ui): app shell, store, mode toggle"`

### Task 2.2: Underlay (load chart image, opacity)

**Files:** Create `src/renderer/editor/Underlay.tsx`; Modify `EditorCanvas.tsx`, `store.ts`, `preload/index.ts`.

- [ ] **Step 1:** Add a "下絵を読み込む" button → uses an Electron open-file dialog (via preload `openImage()` returning a data URL) → sets `chart.underlay`.
- [ ] **Step 2:** `Underlay.tsx` renders the image as the bottom SVG layer at canvas size with `opacity` slider (0–100%) and a visibility toggle.
- [ ] **Step 3: Verify** — load a PNG; it appears behind the (empty) shape layer; opacity slider dims it.
- [ ] **Step 4: Commit** — `git commit -m "feat(editor): chart-image underlay with opacity"`

### Task 2.3: EditorCanvas — pan/zoom + render shapes (SVG)

**Files:** `EditorCanvas.tsx`.

- [ ] **Step 1:** Render an SVG sized to `chart.canvas`, with mouse-wheel zoom and space-drag pan. Draw each `Shape` as the matching SVG element (`line`/`polyline`/`path`/`ellipse`/`polygon`). Selected shape gets a highlight + bounding handles.
- [ ] **Step 2:** Clicking a shape calls `select(id)`; clicking empty space deselects.
- [ ] **Step 3: Verify** — manually push two shapes into the store; both render; clicking selects; zoom/pan work.
- [ ] **Step 4: Commit** — `git commit -m "feat(editor): SVG canvas with pan/zoom + selection"`

### Task 2.4: Drawing tools (line, polyline, freehand, ellipse, rect, triangle, star, polygon)

**Files:** Create `src/renderer/editor/tools.ts`; Modify `EditorCanvas.tsx`, `Toolbar.tsx`.

- [ ] **Step 1:** Implement a tool state machine in `tools.ts`: `line` (2 clicks), `polyline`/`polygon` (clicks + double-click to finish), `freehand` (drag to sample points), `ellipse`/`rect`/`triangle`/`star` (drag to size). Each produces an `addShape(...)` call with correct `type`/`points`.
- [ ] **Step 2:** Toolbar buttons select the active tool; the canvas routes pointer events to the machine.
- [ ] **Step 3: Verify** — draw one of each shape type over the underlay; each appears and is selectable.
- [ ] **Step 4: Commit** — `git commit -m "feat(editor): shape drawing tools"`

### Task 2.5: Inspector — shape props + address assignment

**Files:** Create `src/renderer/editor/Inspector.tsx`; Modify `main.tsx`, `store.ts`.

- [ ] **Step 1:** For the selected shape: edit `display` (stroke/fill/both), `strokeWidth`, `glowRadius`, `glowIntensity`, and (for `dim` mode) `fixedColor`.
- [ ] **Step 2:** Address assignment: `universe`, `start` (1–512), `mode` (rgb default / rgbdim / dim / rgbw), and a channel-order option (`RGB` vs custom) stored per chart. Creating/editing this writes/updates the shape's `Fixture` in `chart.fixtures`. Show the computed range (e.g. "U0 / 1–3").
- [ ] **Step 3: Verify** — select a shape, assign U0 start 1 mode rgb; the range label shows "1–3".
- [ ] **Step 4: Commit** — `git commit -m "feat(editor): inspector with shape props + DMX address assignment"`

### Task 2.6: PatchTable — list, overlap warnings, CSV export

**Files:** Create `src/renderer/editor/PatchTable.tsx`.

- [ ] **Step 1:** Table of all fixtures: shape name, universe, start, mode, range, live value (color swatch). Rows flagged by `detectOverlaps` are highlighted red with a tooltip.
- [ ] **Step 2:** "CSV書き出し" button exports the table.
- [ ] **Step 3: Verify** — two partially-overlapping fixtures show a red warning; CSV downloads.
- [ ] **Step 4: Commit** — `git commit -m "feat(editor): patch table with overlap warnings + CSV"`

---

## Milestone 3 — Live render + Syphon output

### Task 3.1: OutputRenderer (WebGL, glow) driven by a color-resolver

**Files:** Create `src/renderer/output/OutputRenderer.ts`, `src/renderer/output/glow.ts`.

- [ ] **Step 1:** `OutputRenderer` takes `chart` + a `resolveColor(fixtureId) => RGB` function and draws every shape on a black background into a WebGL canvas of `chart.canvas` size. `stroke` shapes draw as thick lines, `fill` shapes as filled polygons, in the resolved color. `glow.ts` applies a separable Gaussian blur pass scaled by each shape's `glowRadius`/`glowIntensity` (additive).
- [ ] **Step 2:** The color resolver uses `fixtureColor(fixture, dmxByUniverse[fixture.universe] ?? zeros, chart.settings.gamma)`.
- [ ] **Step 3: Verify** — feed manual values (next milestone) and confirm shapes glow in the right colors on black.
- [ ] **Step 4: Commit** — `git commit -m "feat(output): WebGL renderer with additive glow"`

### Task 3.2: Live view + publish to Syphon

**Files:** Modify `main.tsx` (live mode mounts the output canvas), wire to `OutputPublisher` from Milestone 0 via the chosen pipeline.

- [ ] **Step 1:** In Live mode, mount the `OutputRenderer` canvas; each animation frame, render then hand the frame to the publisher (path A/B/C from the spike).
- [ ] **Step 2: Verify** — with the test sender running and a fixture patched to U0/ch1 rgb, the shape in Resolume (Syphon source) glows and reacts to the sender. Black stays invisible on an Add layer.
- [ ] **Step 3: Commit** — `git commit -m "feat(output): live mode renders + publishes to Syphon"`

### Task 3.3: Fullscreen preview window

**Files:** Create `src/renderer/output/OutputWindow.tsx`; Modify `main/index.ts` (open a second BrowserWindow on a chosen display).

- [ ] **Step 1:** "プレビュー全画面" opens a borderless window showing the same output canvas at 100% on a selected display.
- [ ] **Step 2: Verify** — preview window shows the glowing shapes at real size; closing it returns to the editor.
- [ ] **Step 3: Commit** — `git commit -m "feat(output): fullscreen preview window"`

---

## Milestone 4 — Receive wiring + status

### Task 4.1: dmx-bridge (Art-Net → store)

**Files:** Create `src/renderer/state/dmx-bridge.ts`; Modify `preload/index.ts`, `main/index.ts`.

- [ ] **Step 1:** Preload exposes `onDmx(cb)`; main forwards `ArtNetReceiver` `dmx` events. `dmx-bridge` subscribes and calls `setUniverseData(universe, data)` in the store. Track `lastSeenByUniverse` timestamps.
- [ ] **Step 2:** Implement hold-vs-zero: if a universe is silent past a timeout and `settings.holdOnTimeout` is false, zero it; else keep last values.
- [ ] **Step 3: Verify** — sender on U0 drives patched shapes live in the editor's live value swatches.
- [ ] **Step 4: Commit** — `git commit -m "feat(receive): Art-Net bridge into the store with hold/zero"`

### Task 4.2: Status lamps + NIC selection

**Files:** Create `src/renderer/ui/Lamp.tsx`; Modify `SettingsDialog.tsx`, `main/index.ts`.

- [ ] **Step 1:** Receive lamp per universe (green = packets within 2s, red = stale) + Syphon-output lamp. NIC selection (list `os.networkInterfaces()` IPv4 addresses) re-binds the receiver.
- [ ] **Step 2: Verify** — lamp turns green while the sender runs, red within 2s of stopping it.
- [ ] **Step 3: Commit** — `git commit -m "feat(ui): receive/syphon lamps + NIC selection"`

---

## Milestone 5 — Test tools

### Task 5.1: Manual faders + test patterns

**Files:** Create `src/renderer/test/ManualFaders.tsx`; Modify `store.ts` (manual-override layer).

- [ ] **Step 1:** Per-fixture R/G/B (and Dim where applicable) sliders that write into a manual-override buffer merged over live Art-Net (toggle: manual / live). Test patterns: 全点灯, チェイス (sequential), 番地確認 (light one fixture at a time with its address label).
- [ ] **Step 2: Verify** — with no sender running, manual sliders light shapes; chase cycles through fixtures.
- [ ] **Step 3: Commit** — `git commit -m "feat(test): manual faders + test patterns"`

---

## Milestone 6 — File management + settings

### Task 6.1: Save / load / new / duplicate + recent charts

**Files:** Modify `preload/index.ts` (save/open dialogs to disk), `Toolbar.tsx`, `store.ts`.

- [ ] **Step 1:** Save writes `serializeChart` to a `.decor.json` file (image embedded as base64). Open reads + `parseChart`. New/Duplicate. Maintain a recent-charts list in app settings.
- [ ] **Step 2: Verify** — draw + patch, save, restart app, open → identical chart (shapes, underlay, patch) restored. (Mirrors the chart-file round-trip test, now through the real dialogs.)
- [ ] **Step 3: Commit** — `git commit -m "feat(io): save/load/new/duplicate + recent charts"`

### Task 6.2: SettingsDialog (canvas size, channel order, gamma, hold/zero)

**Files:** `src/renderer/ui/SettingsDialog.tsx`.

- [ ] **Step 1:** Editable canvas W×H (free, clamp ≤ 4096×2160 with a warning), default channel order, gamma on/off, hold-vs-zero, Syphon source name. Changing canvas size re-sizes the output canvas + Syphon server.
- [ ] **Step 2: Verify** — set 3840×1080; editor + output canvases resize; Syphon source updates in Resolume.
- [ ] **Step 3: Commit** — `git commit -m "feat(settings): canvas size, channel order, gamma, hold/zero"`

---

## Milestone 7 — Packaging + acceptance

### Task 7.1: App icon + `.app` build

**Files:** `resources/icon.png`, `electron-builder` config in `package.json`.

- [ ] **Step 1:** Add `electron-builder`; configure a macOS `dir`/`dmg` target producing `DECOR STUDIO.app`. Use the suite's launch-icon convention (consistent with LED CHART PACKER).
- [ ] **Step 2:** Run: `npm run build && npx electron-builder --dir`. Expected: `DECOR STUDIO.app` opens and runs.
- [ ] **Step 3: Commit** — `git commit -m "build: package macOS .app via electron-builder"`

### Task 7.2: Acceptance test (real flow) + handoff doc

- [ ] **Step 1:** Full pass: new chart → load a real chart image → draw lines + bulbs + a few triangles → patch to U0 (rgb) → run test sender → confirm in Resolume (Add blend) that only shapes glow and react, black is invisible → save/reopen.
- [ ] **Step 2:** Write `DECOR-STUDIO-引き継ぎ-2026-06-08.md` (Japanese, plain language): how to launch, connect the console (Art-Net/LAN, IP range), pick the NIC, add the Syphon source in Resolume, draw + patch, and the manual-test workflow.
- [ ] **Step 3: Commit** — `git commit -m "docs: acceptance pass + Japanese handoff guide"`

---

## Self-Review (completed during planning)

- **Spec coverage:** §3 chart-image-first flow → 2.2; §6 shapes/tools/glow → 2.3–2.5, 3.1; §7 patch/3ch-default/overlap → 1.2–1.3, 2.5–2.6; §8 Art-Net receive/universe/hold/NIC → 0.2–0.3, 4.1–4.2; §9 output/Syphon/preview → 0.5, 3.1–3.3; §10 manual faders/patterns → 5.1; §11 save/load/embed → 1.4, 6.1; §12 launch/lamps → 4.2, 7.1; §13 errors → 0.5 (Syphon fallback), 4.1 (hold/zero), 2.6 (overlap); §15 YAGNI honored (no pixel-mapping; RGBW typed but parked). Covered.
- **Placeholder scan:** Pure-logic tasks contain full test + impl code. UI tasks intentionally use visual verification (no fake unit tests). The only deferred specifics are the exact `node-syphon` API names, which the Milestone-0 spike resolves and locks into the stable `OutputPublisher` interface — by design, not a placeholder.
- **Type consistency:** `Shape`/`Fixture`/`Chart` (types.ts) are reused everywhere; `channelCount`/`fixtureColor` (channel-math) are imported by `patch.ts` and `OutputRenderer`; `serializeChart`/`parseChart` names match across io task + file task; `OutputPublisher.{start,publishRGBA,stop}` is the single output contract from M0 through M3.
```
