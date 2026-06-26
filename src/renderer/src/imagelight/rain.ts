// rain.ts — 特効: 雨/雪（全面に降る粒）。2026-06-26 アプリ搭載。
// 承認済 試作 sfx-rain-proto.html の確定アルゴリズム＋Default を移植。
// 重要（のむさん明言）: これは「受け系」。粒そのものは色を持たず、白いアルファ(matter)だけを出す。
//   engine 側で 〔matter × 光マップ〕＝「このアプリの照明が当たった所だけ・その光の色で光る」
//   （ボリュメトリック）に合成する。当たっていない所は見えない。
// 出力1枚: matter(全面・白い粒のアルファ・透過・出力実寸)。col=0雨(筋)/1雪(点)寄りに性格が変わる。

export interface RainParams {
  amount: number // 量(粒数)
  speed: number // 落下速度（速い=雨の筋 / 遅い=雪の点）
  len: number // 筋の長さ
  wid: number // 太さ
  wind: number // 横風
  gust: number // 風のゆらぎ
  depth: number // 奥行き感（手前ほど速く大きく濃い）
  opacity: number // 濃さ
  col: number // 0=雨っぽい / 1=雪っぽい（ゆらぎ・点寄り）
  bright: number // 明るさ
}

interface Drop { x: number; y: number; layer: number; ph: number }

const MW = 1920
const MH = 1080

function mkCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

export class RainFX {
  // 承認済 試作 sfx-rain-proto.html の DEF と一致（2026-06-26）。
  params: RainParams = {
    amount: 1.73, speed: 0.98, len: 1.05, wid: 1.22, wind: 0, gust: 0,
    depth: 1.0, opacity: 0.72, col: 0.54, bright: 1.03
  }
  on = false
  private matterCv = mkCanvas(MW, MH)
  private mctx: CanvasRenderingContext2D
  private drops: Drop[] = []
  private last = 0
  private wt = 0
  private fade = 0

  constructor() {
    this.mctx = this.matterCv.getContext('2d')!
  }

  /** 白い粒のアルファ画像（色は持たない＝engine が光マップで色付け）。 */
  get matter(): HTMLCanvasElement { return this.matterCv }
  /** まだ見えている粒があるか（消えていくフェード中も true）。 */
  get active(): boolean { return this.on || this.fade > 0.01 }

  private targetCount(): number {
    return Math.round(140 + this.params.amount * 520)
  }

  private mk(): Drop {
    return { x: Math.random() * MW * 1.5 - MW * 0.25, y: Math.random() * MH, layer: Math.random(), ph: Math.random() * 6.28 }
  }

  tick(now: number): void {
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 1 / 60
    this.last = now
    this.wt += dt
    const P = this.params
    // ON/OFF フェード
    this.fade += ((this.on ? 1 : 0) - this.fade) * Math.min(1, dt * 3)
    // 量の増減（スライダー追従）
    const tc = this.on ? this.targetCount() : this.drops.length
    if (this.drops.length < tc) for (let i = this.drops.length; i < tc; i++) this.drops.push(this.mk())
    else if (this.drops.length > tc) this.drops.length = tc

    const c = this.mctx
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.clearRect(0, 0, MW, MH)
    if (this.fade <= 0.01 || this.drops.length === 0) return

    // 風（ゆらぎ込み）
    const gust = P.gust * 0.5 * (Math.sin(this.wt * 0.7) + Math.sin(this.wt * 1.9 + 1.3) * 0.5)
    const windX = (P.wind + gust) * 900
    const baseSpeed = P.speed * 1100
    // 雪寄り(col大)ほどゆらゆら大・点寄り。色は持たず白い粒（明るさで光マップ乗算に耐える）。
    const wanderK = 0.4 + 1.6 * P.col

    c.globalCompositeOperation = 'lighter'
    c.lineCap = 'round'
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i]
      const lz = 1 - P.depth * (1 - d.layer) // 奥(layer小)ほど小さく遅く暗く
      const speed = baseSpeed * lz
      const vx = windX * lz + Math.sin(this.wt * 1.3 + d.ph) * 22 * lz * wanderK
      d.x += vx * dt
      d.y += speed * dt
      if (d.y > MH + 30) { d.y = -30 - Math.random() * 40; d.x = Math.random() * MW * 1.5 - MW * 0.25 }
      if (d.x > MW * 1.25) d.x -= MW * 1.5
      else if (d.x < -MW * 0.25) d.x += MW * 1.5
      // 筋の長さ＝速度連動（速い=長い筋＝雨 / 遅い=点＝雪）。丸キャップで点も綺麗。
      const velMag = Math.hypot(vx, speed) || 1
      const streak = velMag * P.len * 0.018 * (0.6 + 0.4 * lz)
      const k = streak / velMag
      const a = Math.min(1, (0.18 + d.layer * 0.6) * P.opacity * P.bright * this.fade)
      // 白い粒（matter）＝色は光マップから付く。雪寄りは少し白く。
      const w = Math.round(235 + 20 * P.col)
      c.strokeStyle = `rgba(255,${w},${w},${a})`
      c.lineWidth = (0.7 + d.layer * 1.8) * P.wid * 1.6 // 実寸なので太さを少し補正
      c.beginPath()
      c.moveTo(d.x, d.y)
      c.lineTo(d.x - vx * k, d.y - speed * k)
      c.stroke()
    }
    c.globalCompositeOperation = 'source-over'
  }
}
