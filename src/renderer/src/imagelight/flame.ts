// flame.ts — スペシャルエフェクト(特効)用の炎。2026-06-26 に Canvas2D版から
// 「ファイヤーボール(WebGL)」へ全面差し替え。チャットで実写FB1.movを実測して詰め、
// のむさん承認の確定Defaultを GLSL に焼き込んだもの（flame-fireball-proto.html と同等）。
//
// 仕様: 機械(ノズル)から細く噴射→上に向かって徐々に太く billowing→火球の頭。
//   立ち上がり速い／白コア＋オレンジ縁／下から消える・上には伸びない／煙なし。
//   churn(動き)の時計と age(寿命)を分離＝長押し中も動きが止まらない。
//   流速は炎の高さに比例（高さでスローモーにならない）。
//
// 公開APIは旧版と完全互換: body(前面炎・透過) / glow(照らし) / active / tick(now) /
//   fire(fx,fy,str) / fireRow() / startHold(fx,fy,str) / release() / params。
//   engine は body を出力へ source-over、glow を光マップへ lighter で重ねる（無改造）。

export interface FlameParams {
  thick: number // 胴の太さ → width
  dense: number // 迫力(明るさ) → bright
  churn: number // ゆらぎ(モコモコ) → roil
  speed: number // 速さ(流れの時間) → churn速度
  height: number // 背丈(炎の届く高さ) → 画面上のサイズ
  dur: number // 燃えてる時間(一発の持続) → 寿命スケール
}

interface Shot {
  nx: number // ノズル横位置 0..1
  ny: number // ノズル縦位置 0..1（床=1）
  str: number
  dir: number // 噴き出す向き（ラジアン・画面座標 0=右, -π/2=真上）
  t0: number // 発射時刻(ms)
  held: boolean
  relAt: number | null // 離した時刻(ms)
  ageAtRel: number // 離した時点のage(秒)
}

const FW = 640 // body/glow の解像度（engine 側で出力サイズへ拡大）
const FH = 360
const MAXSHOTS = 48 // 持続炎(置いた数)＋単発バーストを同時に賄える数

// --- のむさん承認の確定Default（flame-fireball-proto.html DEF と一致 2026-06-26）---
//   height/thick/dense/churn/speed/dur は FlameParams 経由で倍率調整。
//   下記は「形・色」の固定値（必要なら将来UIに出す）。
const D = {
  uHeight: 2.49, // 形の比率＆流速の基準（画面サイズとは別物）
  width: 1.08,
  neck: 0.023,
  headPeak: 0.27,
  bloomT: 0.22,
  lifeStart: 0.3,
  clearDur: 0.91,
  churn: 1.4,
  roil: 1.36,
  roilFreq: 1.57,
  orange: 0.76,
  warm: 1.0,
  bright: 0.7
}
const BASE_SCALE = 120 // height=1 のときの px/正規化単位（炎の画面上の大きさ）

/** 床位置(出口)の標準配置 = 写真フレーム幅に対する割合。 */
export const DEFAULT_ROW = [0.17, 0.42, 0.63, 0.79]
const ROW_STR = [1.0, 1.08, 0.85, 0.78]

// GLSL は float リテラルに小数点が必須（"1" は不可・"1.0" にする）
const flt = (n: number): string => {
  const s = String(n)
  return s.includes('.') || s.includes('e') ? s : s + '.0'
}
const VS = `attribute vec2 a; void main(){ gl_Position=vec4(a,0.,1.); }`
const FS = `
precision highp float;
uniform vec2 uRes;
uniform vec2 uNozzle;
uniform float uTime,uAge,uStr,uScale,uWidth,uBright,uRoil,uChurnSpd,uOrange,uLifeStart,uClearDur,uDir;
float hash(vec2 p){p=fract(p*vec2(123.34,345.45));p+=dot(p,p+34.345);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);
 float a=hash(i),b=hash(i+vec2(1.,0.)),c=hash(i+vec2(0.,1.)),d=hash(i+vec2(1.,1.));
 return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);}
float fbm(vec2 p){float v=0.,a=0.55;for(int i=0;i<6;i++){v+=a*noise(p);p=p*2.02+vec2(1.7,9.2);a*=0.5;}return v;}
float fbm4(vec2 p){float v=0.,a=0.55;for(int i=0;i<4;i++){v+=a*noise(p);p=p*2.02+vec2(1.7,9.2);a*=0.5;}return v;}
vec2 curl(vec2 p){float e=0.06;
 float x=fbm(p+vec2(0.,e))-fbm(p-vec2(0.,e)); float y=fbm(p+vec2(e,0.))-fbm(p-vec2(e,0.));
 return vec2(x,-y)/(2.*e);}
const float HGT=${flt(D.uHeight)};
const float NECK=${flt(D.neck)};
const float HEADP=${flt(D.headPeak)};
const float BLOOMT=${flt(D.bloomT)};
const float ROILF=${flt(D.roilFreq)};
const float WARM=${flt(D.warm)};
vec3 fireball(float px, float py){
 float age=uAge;
 float bloom=smoothstep(0.0,BLOOMT,age);
 float headC=0.20+0.42*bloom;
 float peak=mix(0.07,HEADP,bloom)*uWidth;
 float neck=NECK*uWidth;
 float fadeIn=smoothstep(0.02,0.10,age);
 float h=clamp(py/(0.82*HGT),-0.08,1.5);
 float vsp=HGT*uChurnSpd;
 vec2 cc=curl(vec2(px*3.0, py*3.0 - uTime*1.8*vsp));
 float wx=px+0.06*cc.x, wy=py+0.06*cc.y;
 float nb=fbm(vec2(wx*4.5*ROILF+3.0, wy*4.5*ROILF - uTime*2.5*vsp));
 float nb2=fbm4(vec2(wx*9.5*ROILF-5.0, wy*9.5*ROILF - uTime*3.6*vsp));
 float roil=0.62*nb+0.38*nb2;
 float widen=smoothstep(0.0,headC,h);
 float taper=1.0-smoothstep(headC+0.12,headC+0.55,h);
 float halfw=max(neck+(peak-neck)*widen*(0.35+0.65*taper),0.012);
 float xr=px/halfw; float radial=exp(-2.5*xr*xr);
 float headw=smoothstep(0.25,0.85,h);
 float dens=clamp(radial*(0.85+(0.4+0.5*headw)*(roil-0.5)*2.0*uRoil)
                  - smoothstep(0.30,1.05,abs(xr))*(1.0-roil)*(0.9+0.8*headw), 0.0, 1.7);
 float base_on=smoothstep(-0.07,0.03,h);
 float fray=smoothstep(headC+0.15+0.30*roil, headC+0.62, h);
 float vert=base_on*(1.0-fray);
 float clearFront=-0.18+2.0*smoothstep(uLifeStart, uLifeStart+uClearDur, age);
 float hj=h+(roil-0.5)*0.42;
 float clearGate=smoothstep(clearFront-0.04, clearFront+0.26, hj);
 dens=dens*vert*fadeIn*clearGate;
 float coolAge=1.2-0.5*smoothstep(uLifeStart, uLifeStart+uClearDur*0.85, age);
 float heat=pow(max(dens*(1.55-0.7*abs(xr)-0.25*headw)*coolAge,0.0),1.08);
 float e=heat*2.6*uBright;
 float whi_lo=1.55+0.85*uOrange, whi_hi=2.30+0.85*uOrange;
 float w_red=1.0-smoothstep(0.10,0.55,e);
 float w_white=smoothstep(whi_lo,whi_hi,e);
 float w_org=clamp(1.0-w_red-w_white,0.0,1.0);
 vec3 col=(w_red*vec3(1.20,0.25,0.04)+w_org*vec3(1.95,0.72,0.15)+w_white*vec3(2.60,2.35,2.05))*e;
 col.r*=1.0+(0.5-WARM)*0.30; col.b*=1.0+(WARM-0.5)*0.40;
 return col;
}
void main(){
 vec2 uv=gl_FragCoord.xy/uRes;
 float sx=uv.x*uRes.x;
 float sy=(1.0-uv.y)*uRes.y;       // 上下を flame.ts と合わせる(上=小さいy)
 float nx=uNozzle.x*uRes.x;
 float ny=uNozzle.y*uRes.y;
 float py=(ny-sy)/uScale;          // ノズルから上が +
 float px=(sx-nx)/uScale;
 // 噴き出す向き: 既定 -π/2(真上)なら無回転。サンプル座標を回して炎を傾ける。
 float ph=uDir+1.5707963;
 float cs=cos(ph), sn=sin(ph);
 float lpx=px*cs - py*sn;
 float lpy=px*sn + py*cs;
 vec3 col=fireball(lpx,lpy)*uStr;
 float a=clamp(max(max(col.r,col.g),col.b),0.0,1.0);
 gl_FragColor=vec4(col,a);
}`

function mkCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

export class FlameFX {
  params: FlameParams = { thick: 1.0, dense: 1.0, churn: 1.0, speed: 1.0, height: 1.0, dur: 1.0 }

  private bodyGL = mkCanvas(FW, FH) // WebGL: 火球本体(透過)
  private glowCv = mkCanvas(FW, FH) // Canvas2D: 照らし用(ぼかし)
  private glowCtx: CanvasRenderingContext2D
  private gl: WebGLRenderingContext | null
  private prog: WebGLProgram | null = null
  private u: Record<string, WebGLUniformLocation | null> = {}
  private shots: Shot[] = []
  private heldShot: Shot | null = null
  private t0 = 0
  private ok = false

  constructor() {
    this.glowCtx = this.glowCv.getContext('2d')!
    const gl = (this.bodyGL.getContext('webgl', {
      premultipliedAlpha: false,
      alpha: true,
      antialias: false
    }) || null) as WebGLRenderingContext | null
    this.gl = gl
    if (gl) {
      try {
        this.initGL(gl)
        this.ok = true
      } catch (e) {
        console.error('[flame] WebGL init failed', e)
        this.ok = false
      }
    }
  }

  private initGL(gl: WebGLRenderingContext): void {
    const sh = (t: number, s: string): WebGLShader => {
      const x = gl.createShader(t)!
      gl.shaderSource(x, s)
      gl.compileShader(x)
      if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x) || 'shader')
      return x
    }
    const p = gl.createProgram()!
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS))
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS))
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link')
    this.prog = p
    gl.useProgram(p)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(p, 'a')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    const names = ['uRes', 'uNozzle', 'uTime', 'uAge', 'uStr', 'uScale', 'uWidth', 'uBright',
      'uRoil', 'uChurnSpd', 'uOrange', 'uLifeStart', 'uClearDur', 'uDir']
    for (const n of names) this.u[n] = gl.getUniformLocation(p, n)
    gl.viewport(0, 0, FW, FH)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE) // 加算（複数の火球を重ねる）
  }

  get body(): HTMLCanvasElement {
    return this.bodyGL
  }
  get glow(): HTMLCanvasElement {
    return this.glowCv
  }
  get active(): boolean {
    return this.shots.length > 0
  }

  // ---- トリガー ----
  private mk(fx: number, fy: number, str: number, held: boolean, dir: number): Shot {
    const s: Shot = { nx: fx, ny: fy, str, dir, t0: this.now, held, relAt: null, ageAtRel: 0 }
    if (this.shots.length >= MAXSHOTS) this.shots.shift()
    this.shots.push(s)
    return s
  }
  fire(fx: number, fy = 1, str = 1, dir = -Math.PI / 2): void {
    this.mk(fx, fy, str, false, dir)
  }
  fireRow(): void {
    for (let i = 0; i < DEFAULT_ROW.length; i++) this.mk(DEFAULT_ROW[i], 1, ROW_STR[i], false, -Math.PI / 2)
  }
  startHold(fx: number, fy = 1, str = 1, dir = -Math.PI / 2): void {
    this.heldShot = this.mk(fx, fy, str, true, dir)
  }
  release(): void {
    if (this.heldShot) {
      const s = this.heldShot
      s.ageAtRel = this.shotAge(s)
      s.relAt = this.now
      s.held = false
      this.heldShot = null
    }
  }

  // ---- 持続モード（火花と同じ「置いて点いていれば出続ける」を炎にも）----
  // 点灯中の炎マーク(0..1＋向き)を毎フレーム渡す＝各点で炎を燃やし続ける。
  // 点が消えた(=消灯/別ステップ)ら、その炎は自然に燃え尽きる。
  private sustained = new Map<string, Shot>()
  setSustain(points: { fx: number; fy: number; dir?: number; str?: number }[]): void {
    const seen = new Set<string>()
    for (const p of points) {
      const k = p.fx.toFixed(4) + ',' + p.fy.toFixed(4)
      seen.add(k)
      const cur = this.sustained.get(k)
      if (!cur || cur.relAt != null) {
        const s = this.mk(p.fx, p.fy, p.str ?? 1, true, p.dir ?? -Math.PI / 2)
        this.sustained.set(k, s)
      } else {
        cur.dir = p.dir ?? cur.dir // 向き(TILT)変更を反映
        cur.str = p.str ?? cur.str
      }
    }
    // 消えた点の炎は離して燃え尽きさせる
    for (const [k, s] of this.sustained) {
      if (!seen.has(k)) {
        if (s.held) {
          s.ageAtRel = this.shotAge(s)
          s.relAt = this.now
          s.held = false
        }
        this.sustained.delete(k)
      }
    }
  }

  private now = 0
  private get lifeStart(): number {
    return D.lifeStart * this.params.dur
  }
  private get clearDur(): number {
    return D.clearDur * this.params.dur
  }
  private shotAge(s: Shot): number {
    const el = (this.now - s.t0) / 1000
    if (s.held) return Math.min(el, Math.max(0.05, this.lifeStart - 0.05))
    if (s.relAt != null) return s.ageAtRel + (this.now - s.relAt) / 1000
    return el
  }

  /** 1フレーム進める＋ body/glow を更新。engine の renderFrame から毎フレーム。 */
  tick(now: number): void {
    if (!this.t0) this.t0 = now
    this.now = now
    const lifeEnd = this.lifeStart + this.clearDur + 0.5
    for (let i = this.shots.length - 1; i >= 0; i--) {
      if (this.shotAge(this.shots[i]) > lifeEnd) this.shots.splice(i, 1)
    }
    this.renderBody(now)
    this.renderGlow()
  }

  private renderBody(now: number): void {
    const gl = this.gl
    if (!gl || !this.ok || !this.prog) return
    gl.useProgram(this.prog)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (this.shots.length === 0) return
    const P = this.params
    const t = (now - this.t0) / 1000
    gl.uniform2f(this.u.uRes, FW, FH)
    gl.uniform1f(this.u.uTime, t)
    gl.uniform1f(this.u.uWidth, D.width * P.thick)
    gl.uniform1f(this.u.uBright, D.bright * P.dense)
    gl.uniform1f(this.u.uRoil, D.roil * P.churn)
    gl.uniform1f(this.u.uChurnSpd, D.churn * P.speed)
    gl.uniform1f(this.u.uOrange, D.orange)
    gl.uniform1f(this.u.uLifeStart, this.lifeStart)
    gl.uniform1f(this.u.uClearDur, this.clearDur)
    const scale = BASE_SCALE * P.height
    for (const s of this.shots) {
      gl.uniform2f(this.u.uNozzle, s.nx, s.ny)
      gl.uniform1f(this.u.uAge, this.shotAge(s))
      gl.uniform1f(this.u.uStr, s.str)
      gl.uniform1f(this.u.uScale, scale)
      gl.uniform1f(this.u.uDir, s.dir)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
  }

  private renderGlow(): void {
    const c = this.glowCtx
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.globalCompositeOperation = 'source-over'
    c.globalAlpha = 1
    c.clearRect(0, 0, FW, FH)
    if (this.shots.length === 0) return
    c.globalCompositeOperation = 'lighter'
    c.filter = 'blur(22px)'
    c.globalAlpha = 0.5
    c.drawImage(this.bodyGL, 0, 0, FW, FH)
    c.filter = 'blur(10px)'
    c.globalAlpha = 0.6
    c.drawImage(this.bodyGL, 0, 0, FW, FH)
    c.filter = 'none'
    c.globalAlpha = 1
  }
}
