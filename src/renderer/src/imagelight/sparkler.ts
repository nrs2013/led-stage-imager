// sparkler.ts — 特効: コールドスパーク(火花フォンテン)。点灯中ずっと噴き続ける(連続噴出)。
// 2026-06-26 全面作り直し: のむさん評価「画質が悪い／設定ができない」を受けて、
//   ① 描画解像度を 640×360 → 出力実寸 1920×1080 に上げた（極細の火花が3倍拡大でボケる問題を解消）
//   ② 物理・見た目を 承認済 試作 flame-sparkler-proto.html に忠実に合わせ直した
//      （upV=760 / grav=1300 / wander / bloom立ち上がり / 丸い溶けた粒(arc)＋尾＋根元フラッシュ）
//   ③ パラメータを SparklerParams に出して UI から調整できるようにした（size=大きさ 等）
// 仕様: 下から噴き上がり、上がりきった火花は落ちず頂点で焼き切れて消える(apex burnout)。
//   銀白〜金の細かい火花＋短い尾＋チリチリ瞬き(crackle)＋たまにはじけ(pop)。
// 出力2枚: body(前面の火花・透過・高解像) / glow(セットを照らす灯り・低解像でぼかす＝軽い)。
//   engine は flame と同じ配線で合成（glow→光マップ lighter / body→前面 source-over）。

export interface SparklerParams {
  rate: number // 量(密度)
  height: number // 噴き上がり
  spread: number // 広がり(角度)
  grav: number // 頂点までの減速(重力)
  wander: number // 横ゆらぎ(初速のばらつき)
  life: number // 火花の寿命
  trail: number // 尾の長さ
  size: number // 火花の大きさ
  crackle: number // チリチリ瞬き
  pop: number // はじけ(分裂)
  warm: number // 色(0=金 / 1=白)
  bright: number // 明るさ
}

interface Spk {
  x: number; y: number; vx: number; vy: number
  life: number; max: number; sz: number
  tw: number; twf: number; hot: number
  apex: number | null; child: boolean; up: boolean
}

// 描画(=シミュレーション)空間。engine の出力内部解像度 IW×IH と一致させる（拡大ボケを無くす）。
const BW = 1920
const BH = 1080
// glow(照らし)は低解像でぼかす＝blurのコストを抑える。出力時に engine が拡大（柔らかいので拡大OK）。
const GW = 640
const GH = 360
const CAP = 6000

function mkCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

export class SparklerFX {
  // 承認済 試作 flame-sparkler-proto.html の DEF と一致（2026-06-26）。
  params: SparklerParams = {
    rate: 1.98, height: 1.38, spread: 0.1, grav: 1.0, wander: 0.3, life: 1.0,
    trail: 1.0, size: 1.0, crackle: 1.0, pop: 0.5, warm: 0.68, bright: 1.3
  }
  private bodyCv = mkCanvas(BW, BH)
  private glowCv = mkCanvas(GW, GH)
  private bctx: CanvasRenderingContext2D
  private gctx: CanvasRenderingContext2D
  private parts: Spk[] = []
  private pts: { x: number; y: number; dir: number }[] = []
  private last = 0
  private rem = 0
  private warmth = 0 // 噴出の立ち上がり(bloom) 0→1

  constructor() {
    this.bctx = this.bodyCv.getContext('2d')!
    this.gctx = this.glowCv.getContext('2d')!
  }

  get body(): HTMLCanvasElement { return this.bodyCv }
  get glow(): HTMLCanvasElement { return this.glowCv }
  get active(): boolean { return this.parts.length > 0 }

  /** 点灯中の sparkler 灯体の位置(0..1)＋向き(rad,既定=真上)を渡す＝そこから連続噴出。
   *  空なら噴出停止(残粒は燃え切る)。 */
  setActive(points: { fx: number; fy: number; dir?: number }[]): void {
    this.pts = points.map((p) => ({ x: p.fx * BW, y: p.fy * BH, dir: p.dir ?? -Math.PI / 2 }))
  }

  private emit(n: number, vigor: number): void {
    if (!this.pts.length) return
    const P = this.params
    const upV = 760 * P.height * vigor // 試作と同じ初速(px/s @1920幅)
    for (let i = 0; i < n; i++) {
      const o = this.pts[(Math.random() * this.pts.length) | 0]
      const ang = o.dir + (Math.random() - 0.5) * P.spread * 2 // 噴き出す向き＝灯体の向き
      const sp = upV * (0.62 + Math.random() * 0.5)
      this.parts.push({
        x: o.x + (Math.random() - 0.5) * 6 * BW / 1000, y: o.y,
        vx: Math.cos(ang) * sp + (Math.random() - 0.5) * 60 * P.wander, vy: Math.sin(ang) * sp,
        life: 0, max: (0.9 + Math.random() * 0.9) * P.life, sz: (0.5 + Math.random() * 0.9) * P.size,
        tw: Math.random() * 6.28, twf: 18 + Math.random() * 26, hot: 0.7 + Math.random() * 0.3,
        apex: null, child: false, up: Math.sin(ang) < -0.4 // 上向き噴出のときだけ頂点焼き切れ
      })
      if (this.parts.length > CAP) this.parts.shift()
    }
  }

  tick(now: number): void {
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 1 / 60
    this.last = now
    const P = this.params
    // 立ち上がり(bloom): 点灯し始めは少なく、〜0.15秒で全開。消灯したら即0へ。
    if (this.pts.length) this.warmth = Math.min(1, this.warmth + dt / 0.15)
    else this.warmth = 0
    if (this.pts.length) {
      const vigor = 0.85 + 0.3 * this.warmth
      // 試作の単点 26*rate*60/秒 を点の数だけ。立ち上がりで密度も上げる。
      this.rem += this.pts.length * 26 * P.rate * this.warmth * dt * 60
      const n = Math.floor(this.rem)
      this.rem -= n
      if (n > 0) this.emit(Math.min(n, 700), vigor)
    }
    const grav = 1300 * P.grav
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const s = this.parts[i]
      s.life += dt
      if (s.life >= s.max) { this.parts.splice(i, 1); continue }
      s.vy += grav * dt
      s.vx *= Math.pow(0.985, dt * 60)
      s.x += s.vx * dt
      s.y += s.vy * dt
      if (s.up && s.apex === null && s.vy > -8) s.apex = s.life // 上がりきり＝頂点(上向きのみ)
      if (s.apex !== null) {
        const burn = 1 - (s.life - s.apex) / 0.2 // 頂点から0.2秒で焼き切れ
        if (burn <= 0) { this.parts.splice(i, 1); continue }
      }
      if (s.y < -30 || s.y > BH + 20) { this.parts.splice(i, 1); continue }
      if (P.pop > 0 && !s.child && Math.random() < 0.006 * P.pop * dt * 60) {
        const tt = s.life / s.max
        if (tt > 0.2 && tt < 0.7) {
          for (let k = 0; k < 3; k++) {
            this.parts.push({
              x: s.x, y: s.y, vx: s.vx * 0.4 + (Math.random() - 0.5) * 160, vy: s.vy * 0.4 + (Math.random() - 0.5) * 160,
              life: 0, max: 0.18 + Math.random() * 0.22, sz: s.sz * 0.7, tw: Math.random() * 6.28,
              twf: 30 + Math.random() * 30, hot: 1, apex: null, child: true, up: false
            })
          }
        }
      }
    }
    this.renderBody(now)
    this.renderGlow()
  }

  private renderBody(now: number): void {
    const c = this.bctx
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.clearRect(0, 0, BW, BH)
    c.globalCompositeOperation = 'lighter'
    c.lineCap = 'round'
    const P = this.params
    const warm = P.warm
    const trailF = P.trail * 0.05
    for (let i = 0; i < this.parts.length; i++) {
      const s = this.parts[i]
      const tt = s.life / s.max
      let burn = 1
      if (s.apex !== null) burn = Math.max(0, 1 - (s.life - s.apex) / 0.2)
      const tw = 1 + Math.sin(now * 0.001 * s.twf + s.tw) * 0.5 * P.crackle
      const heat = Math.max(0, 1 - tt * 0.85) * burn
      const a = Math.min(1.7, heat * tw * s.hot * P.bright)
      if (a <= 0.01) continue
      const G = Math.min(255, Math.round(205 + 50 * heat))
      const B = Math.min(255, Math.round(45 + 175 * warm + 55 * heat))
      // 尾（速度方向に短い筋）
      if (trailF > 0) {
        c.strokeStyle = `rgba(255,${G},${B},${a * 0.55})`
        c.lineWidth = s.sz * 0.8
        c.beginPath()
        c.moveTo(s.x, s.y)
        c.lineTo(s.x - s.vx * trailF, s.y - s.vy * trailF)
        c.stroke()
      }
      // 頭（丸い溶けた粒）＝「線だけ」だと引っかき傷に見える問題の本命
      c.fillStyle = `rgba(255,${G},${B},${a})`
      c.beginPath()
      c.arc(s.x, s.y, s.sz, 0, 6.283)
      c.fill()
    }
    // 噴出口の白フラッシュ（根元）
    if (this.pts.length && this.warmth > 0.02) {
      for (const o of this.pts) {
        const rad = 30 * (0.6 + 0.4 * this.warmth)
        const rg = c.createRadialGradient(o.x, o.y, 0, o.x, o.y, rad)
        rg.addColorStop(0, `rgba(255,240,200,${0.5 * this.warmth})`)
        rg.addColorStop(1, 'rgba(255,180,80,0)')
        c.fillStyle = rg
        c.beginPath()
        c.arc(o.x, o.y, rad, 0, 6.283)
        c.fill()
      }
    }
  }

  private renderGlow(): void {
    const c = this.gctx
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.clearRect(0, 0, GW, GH)
    if (!this.parts.length) return
    c.globalCompositeOperation = 'lighter'
    c.filter = 'blur(14px)'
    c.globalAlpha = 0.55
    c.drawImage(this.bodyCv, 0, 0, BW, BH, 0, 0, GW, GH)
    c.filter = 'blur(6px)'
    c.globalAlpha = 0.6
    c.drawImage(this.bodyCv, 0, 0, BW, BH, 0, 0, GW, GH)
    c.filter = 'none'
    c.globalAlpha = 1
  }
}
