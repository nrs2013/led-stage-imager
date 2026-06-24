// flame.ts — スペシャルエフェクト(特効)用のプロシージャル炎(フレーマー)。
// チャットで v1→v19 まで詰めて確定した「C＝濃い実写風」を独立モジュール化したもの。
// 仕様: ヒートフィールド＋パーティクルを炎パレット(白はベタ禁止/芯だけ淡黄→橙→赤)で色変換。
//   出口は細く胴は太い teardrop。単発(約1.1秒の有限ライフ)＋長押し(サスティン・離すと終わる)。
//   炎ごとに別乱数でバラバラ。内部は domain-warp + bilinear の低周波ノイズで churn(四角さ/粒感を消す)。
//   最後は散らさない(塊が昇って煙化)。
// 出力は2枚: body(前面に重ねる炎本体・透過) と glow(背景セットを照らす暖色の灯り)。
// engine 側は body を出力フレームへ source-over、glow を光マップへ lighter で重ねる。

export interface FlameParams {
  thick: number // 胴の太さ
  dense: number // 迫力(密度)
  churn: number // ゆらぎ(内部の乱れ)
  speed: number // 速さ
}

interface Shot {
  x: number
  by: number
  t0: number
  str: number
  held: boolean
  rel: number | null
  relAt: number | null
  no: number
  wmul: number
}
interface Part {
  x: number
  cx: number
  no: number
  sp: number
  y: number
  vx: number
  vy: number
  age: number
  max: number
  en: number
  bri: number
}
interface Smk {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  max: number
  r: number
}
interface Flash {
  x: number
  y: number
  t0: number
}

const FW = 640 // 内部作業解像度(16:9)。engine 側で出力サイズへ拡大する。
const FH = 360
const CELL = 2
const GW = Math.ceil(FW / CELL)
const GH = Math.ceil(FH / CELL)
const NW = 96
const NH = 96
const PN = 120 // パレット段数

function buildPalette(): Uint8Array {
  const pal = new Uint8Array(PN * 4)
  const s = [
    [0, 0, 0, 0, 0],
    [0.05, 46, 9, 2, 80],
    [0.13, 112, 22, 7, 170],
    [0.26, 168, 38, 12, 225],
    [0.42, 214, 70, 18, 250],
    [0.6, 242, 110, 30, 255],
    [0.76, 252, 154, 44, 255],
    [0.89, 255, 194, 84, 255],
    [1, 255, 238, 170, 255]
  ]
  for (let i = 0; i < PN; i++) {
    const f = i / (PN - 1)
    for (let j = 0; j < s.length - 1; j++) {
      if (f >= s[j][0] && f <= s[j + 1][0]) {
        const a = s[j]
        const b = s[j + 1]
        const u = (f - a[0]) / (b[0] - a[0] || 1)
        pal[i * 4] = a[1] + (b[1] - a[1]) * u
        pal[i * 4 + 1] = a[2] + (b[2] - a[2]) * u
        pal[i * 4 + 2] = a[3] + (b[3] - a[3]) * u
        pal[i * 4 + 3] = a[4] + (b[4] - a[4]) * u
        break
      }
    }
  }
  return pal
}

function mkCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/** 床位置(出口)の標準配置 = 写真フレーム幅に対する割合。 */
export const DEFAULT_ROW = [0.17, 0.42, 0.63, 0.79]
const ROW_STR = [1.0, 1.08, 0.85, 0.78]

export class FlameFX {
  params: FlameParams = { thick: 1.1, dense: 1.6, churn: 0.75, speed: 1.5 }

  private heat = new Float32Array(GW * GH)
  private noise = new Float32Array(NW * NH)
  private pal = buildPalette()
  private off = mkCanvas(GW, GH) // 色変換した炎(等倍)
  private offCtx: CanvasRenderingContext2D
  private img: ImageData
  private bodyCv = mkCanvas(FW, FH)
  private bodyCtx: CanvasRenderingContext2D
  private glowCv = mkCanvas(FW, FH)
  private glowCtx: CanvasRenderingContext2D

  private shots: Shot[] = []
  private parts: Part[] = []
  private smoke: Smk[] = []
  private flashes: Flash[] = []
  private frame = 0
  private heldShot: Shot | null = null

  constructor() {
    this.offCtx = this.off.getContext('2d')!
    this.img = this.offCtx.createImageData(GW, GH)
    this.bodyCtx = this.bodyCv.getContext('2d')!
    this.glowCtx = this.glowCv.getContext('2d')!
    for (let i = 0; i < this.noise.length; i++) this.noise[i] = Math.random()
  }

  /** 前面に重ねる炎本体(透過)。engine は出力フレームへ source-over で drawImage。 */
  get body(): HTMLCanvasElement {
    return this.bodyCv
  }
  /** 背景セットを照らす暖色の灯り。engine は光マップへ lighter で drawImage。 */
  get glow(): HTMLCanvasElement {
    return this.glowCv
  }
  /** 今この瞬間、描くもの(炎 or 煙)があるか。無ければ engine 側で合成をスキップできる。 */
  get active(): boolean {
    return this.parts.length > 0 || this.smoke.length > 0 || this.shots.length > 0
  }

  // ---- bilinear noise (格子感を消す) ----
  private samp(u: number, v: number): number {
    const x0 = Math.floor(u)
    const y0 = Math.floor(v)
    const fx = u - x0
    const fy = v - y0
    let ix = x0 % NW
    if (ix < 0) ix += NW
    let iy = y0 % NH
    if (iy < 0) iy += NH
    const ix1 = (ix + 1) % NW
    const iy1 = (iy + 1) % NH
    const a = this.noise[iy * NW + ix]
    const b = this.noise[iy * NW + ix1]
    const c = this.noise[iy1 * NW + ix]
    const d = this.noise[iy1 * NW + ix1]
    const t = a + (b - a) * fx
    const bo = c + (d - c) * fx
    return t + (bo - t) * fy
  }
  // domain-warp した低周波ノイズ(内部 churn 用)
  private nz(x: number, y: number, no: number): number {
    const sp = this.params.speed
    const wx = (this.samp(x * 0.018 + no, y * 0.018 - this.frame * 0.2 * sp) - 0.5) * 7
    const wy = (this.samp(x * 0.018 + no + 40, y * 0.018 - this.frame * 0.2 * sp + 9) - 0.5) * 7
    return (
      this.samp((x + wx) * 0.05 + no, (y + wy) * 0.05 - this.frame * 0.5 * sp) * 0.7 +
      this.samp((x + wx) * 0.095 + no * 1.7 + 31, (y + wy) * 0.095 - this.frame * 0.85 * sp + 17) * 0.3
    )
  }

  // ---- トリガー（fx,fy は 0..1 の横位置/縦位置＝炎の出る場所＝ノズル） ----
  private mk(fx: number, fy: number, str: number, held: boolean, relAt: number | null): Shot {
    const by = Math.max(8, Math.min(FH - 2, fy * FH))
    const s: Shot = {
      x: fx * FW,
      by,
      t0: this.frame,
      str,
      held,
      rel: null,
      relAt,
      no: Math.random() * 577,
      wmul: 0.82 + Math.random() * 0.42
    }
    this.shots.push(s)
    this.flashes.push({ x: s.x, y: s.by, t0: this.frame })
    return s
  }
  /** 一発(単発)。fx,fy=0..1（fy 未指定は床=1）。 */
  fire(fx: number, fy = 1, str = 1): void {
    this.mk(fx, fy, str, false, null)
  }
  /** 標準の4本を時間差で一斉発射(単発・床)。 */
  fireRow(): void {
    for (let i = 0; i < DEFAULT_ROW.length; i++) {
      const s = this.mk(DEFAULT_ROW[i], 1, ROW_STR[i], false, null)
      s.t0 = this.frame + i * 5
    }
  }
  /** 長押し開始(サスティン)。release() で終わる。 */
  startHold(fx: number, fy = 1, str = 1): void {
    this.heldShot = this.mk(fx, fy, str, true, null)
  }
  /** 長押し終了。 */
  release(): void {
    if (this.heldShot) {
      this.heldShot.held = false
      this.heldShot.rel = this.frame
      this.heldShot = null
    }
  }

  private emit(s: Shot, ms: number): void {
    const st = s.str
    const rate = Math.round((ms < 100 ? 40 : 27) * this.params.dense)
    const climb = ms < 100 ? 1.1 : 1
    const bw = (7 + this.params.thick * 26) * st * s.wmul
    for (let i = 0; i < rate; i++) {
      this.parts.push({
        x: s.x + (Math.random() - 0.5) * 3.2,
        cx: s.x,
        no: s.no,
        sp: (Math.random() - 0.5) * bw,
        y: s.by - Math.random() * 5,
        vx: (Math.random() - 0.5) * 0.1,
        vy: -(7.4 + Math.random() * 3.4) * st * climb,
        age: 0,
        max: 52 + Math.random() * 26,
        en: 6.8 + Math.random() * 1.8,
        bri: 0.88 + Math.random() * 0.16
      })
    }
  }
  private dep(px: number, py: number, e: number): void {
    const gx = (px / CELL) | 0
    const gy = (py / CELL) | 0
    if (gx < 2 || gx >= GW - 2 || gy < 1 || gy >= GH - 1) return
    const c = gy * GW + gx
    const h = this.heat
    h[c] += e
    h[c - 1] += e * 0.55
    h[c + 1] += e * 0.55
    h[c - 2] += e * 0.26
    h[c + 2] += e * 0.26
    h[c - GW] += e * 0.55
    h[c + GW] += e * 0.22
  }

  /** 1フレーム進める＋ body / glow を更新する。engine の renderFrame から毎フレーム呼ぶ。 */
  tick(): void {
    this.frame++
    const sp = this.params.speed
    const churn = this.params.churn
    const h = this.heat
    for (let i = 0; i < h.length; i++) h[i] *= 0.83

    // shots: 発射タイミング・サスティン・残炎の寿命管理
    for (let si = this.shots.length - 1; si >= 0; si--) {
      const s = this.shots[si]
      const ms = (this.frame - s.t0) * 16.67
      if (ms < 0) continue
      const emitting = s.held ? true : s.rel ? false : ms <= 560
      if (emitting) this.emit(s, ms)
      const dead = s.held
        ? false
        : s.rel
          ? (this.frame - s.rel) * 16.67 > 820
          : ms > 1300
      if (dead) this.shots.splice(si, 1)
    }

    // particles
    const cap = 7000
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i]
      p.age++
      const tt = p.age / p.max
      if (tt >= 1) {
        if (Math.random() < 0.09)
          this.smoke.push({
            x: p.x,
            y: p.y,
            vx: (Math.random() - 0.5) * 0.3,
            vy: -0.7 - Math.random() * 0.6,
            age: 0,
            max: 22 + Math.random() * 22,
            r: 8 + Math.random() * 8
          })
        this.parts.splice(i, 1)
        continue
      }
      const env = Math.pow(Math.min(1, tt * 2.2), 0.5)
      const ny = p.y * 0.045 - this.frame * 0.38 * sp
      const wob = this.samp(11 + p.no, ny) - 0.5
      const cshift = this.samp(60 + p.no, ny * 0.8 + 5) - 0.5
      const widthMul = Math.max(0.68, 1 + wob * 0.85 * churn)
      const target = p.cx + cshift * 3.5 * churn + p.sp * env * widthMul
      const amp = (0.05 + tt * tt * 0.38) * sp
      p.vx += (Math.random() - 0.5) * amp + (target - p.x) * 0.06 * (1 - tt * 0.3)
      p.vx *= 0.9
      p.vy *= 0.975
      p.x += p.vx
      p.y += p.vy
      const nf = 1 - churn * 0.55 * (1 - this.nz(p.x, p.y, p.no))
      const en = p.en * (1 - tt * 0.4) * p.bri * nf
      this.dep(p.x, p.y, en)
    }
    if (this.parts.length > cap) this.parts.splice(0, this.parts.length - cap)

    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const m = this.smoke[i]
      m.age++
      if (m.age >= m.max) {
        this.smoke.splice(i, 1)
        continue
      }
      m.x += m.vx
      m.y += m.vy
      m.r += 0.4
    }

    // heat -> 色(等倍 off)
    const d = this.img.data
    const pal = this.pal
    for (let i = 0; i < h.length; i++) {
      const hv = h[i]
      let idx = 0
      if (hv > 0) {
        const f = 1 - Math.exp(-hv * 0.09)
        idx = (f * (PN - 1)) | 0
        if (idx > PN - 1) idx = PN - 1
      }
      const pi = idx * 4
      const o = i * 4
      d[o] = pal[pi]
      d[o + 1] = pal[pi + 1]
      d[o + 2] = pal[pi + 2]
      d[o + 3] = pal[pi + 3]
    }
    this.offCtx.putImageData(this.img, 0, 0)

    this.renderBody()
    this.renderGlow()
  }

  // 前面の炎本体(透過)。煙→bloom→本体→点火フラッシュ。
  private renderBody(): void {
    const c = this.bodyCtx
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.globalCompositeOperation = 'source-over'
    c.globalAlpha = 1
    c.clearRect(0, 0, FW, FH)
    // 煙(薄い暖色グレー)
    for (let i = 0; i < this.smoke.length; i++) {
      const m = this.smoke[i]
      const a = (1 - m.age / m.max) * 0.11
      c.globalAlpha = a
      const sg = c.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r)
      sg.addColorStop(0, 'rgba(74,56,48,1)')
      sg.addColorStop(1, 'rgba(74,56,48,0)')
      c.fillStyle = sg
      c.beginPath()
      c.arc(m.x, m.y, m.r, 0, 7)
      c.fill()
    }
    // bloom(halo)
    c.globalCompositeOperation = 'lighter'
    c.filter = 'blur(6px)'
    c.globalAlpha = 0.24
    c.drawImage(this.off, 0, 0, GW, GH, 0, 0, FW, FH)
    c.filter = 'none'
    // 本体(わずかにスムージング)
    c.globalCompositeOperation = 'source-over'
    c.globalAlpha = 1
    c.filter = 'blur(1.5px)'
    c.drawImage(this.off, 0, 0, GW, GH, 0, 0, FW, FH)
    c.filter = 'none'
    // 点火フラッシュ(根元の白)
    c.globalCompositeOperation = 'lighter'
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const fl = this.flashes[i]
      const fms = (this.frame - fl.t0) * 16.67
      if (fms < 0) continue
      if (fms > 140) {
        this.flashes.splice(i, 1)
        continue
      }
      const fa = 1 - fms / 140
      const rd = 9 + fms * 0.2
      const rg = c.createRadialGradient(fl.x, fl.y, 0, fl.x, fl.y, rd)
      rg.addColorStop(0, 'rgba(255,242,210,' + fa * 0.8 + ')')
      rg.addColorStop(1, 'rgba(255,150,60,0)')
      c.fillStyle = rg
      c.beginPath()
      c.arc(fl.x, fl.y, rd, 0, 7)
      c.fill()
    }
    c.globalAlpha = 1
  }

  // 背景セットを照らす暖色の灯り(広めにぼかした炎)。光マップへ lighter で乗せる。
  private renderGlow(): void {
    const c = this.glowCtx
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.globalCompositeOperation = 'source-over'
    c.globalAlpha = 1
    c.clearRect(0, 0, FW, FH)
    c.globalCompositeOperation = 'lighter'
    c.filter = 'blur(22px)'
    c.globalAlpha = 0.5
    c.drawImage(this.off, 0, 0, GW, GH, 0, 0, FW, FH)
    c.filter = 'blur(10px)'
    c.globalAlpha = 0.6
    c.drawImage(this.off, 0, 0, GW, GH, 0, 0, FW, FH)
    c.filter = 'none'
    c.globalAlpha = 1
  }
}
