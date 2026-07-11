// lowsmoke.ts — 特効: ロースモーク（ドライアイス床煙）。2026-06-26 アプリ搭載。
// 2026-07-11 リアル化（承認済モック「ロースモーク 比較.html」の改善案を移植）:
//   流れ込み=吹き出し口(cx)から前線(env)が床を這って広がる／波打つ天面／縁からこぼれ落ちる(spill)／
//   濃い塊と切れ間のコントラスト(tear)。
// 重要（のむさん明言）: これも「受け系」。煙そのものは色を持たず、白い濃度(matter=alpha)だけを出す。
//   engine 側で 〔matter × 光マップ〕＝「照明が当たった所だけ・その光の色で光る」に合成する。
// 配置ゾーン: 中心X(cx)・床の高さ(floory)・横幅(width=半幅)・厚み(top) で床煙の溜まる箱を指定。
//   溜まり(env)はゆっくり溜まる/引く＝そのまま前線の進み/引きになる。出力は matter(白・透過)。

export interface LowSmokeParams {
  cx: number // 中心X 0..1
  floory: number // 床の高さ 0..1（下=0）
  width: number // 半幅 0..0.6
  top: number // 厚み 0..0.9
  density: number // 濃さ
  accum: number // 溜まる速さ（大きいほどゆっくり）
  soft: number // 上端のやわらかさ
  billow: number // もくもく(ドメインワープ)
  speed: number // 動く速さ
  drift: number // 横流れ
  scale: number // 雲の細かさ
  gray: number // 0=白 / 1=灰
  bright: number // 明るさ
  spill: number // 縁からこぼれ落ちる長さ 0..1
  tear: number // 切れ間（濃淡のコントラスト）0..1
}

const MW = 1920
const MH = 1080

const VS = `attribute vec2 a; void main(){ gl_Position=vec4(a,0.,1.); }`
const FS = `
precision highp float;
uniform vec2 uRes;
uniform float uTime,uCx,uFloorY,uHalfW,uTop,uDensity,uBillow,uScale,uSpeed,uDrift,uSoft,uGray,uBright,uOn,uSpill,uTear;
float hash(vec2 p){p=fract(p*vec2(123.34,345.45));p+=dot(p,p+34.345);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);
 float a=hash(i),b=hash(i+vec2(1.,0.)),c=hash(i+vec2(0.,1.)),d=hash(i+vec2(1.,1.));
 return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);}
float fbm(vec2 p){float v=0.,a=0.55;for(int i=0;i<6;i++){v+=a*noise(p);p=p*2.02+vec2(1.7,9.2);a*=0.5;}return v;}
void main(){
 vec2 uv=gl_FragCoord.xy/uRes;          // y=0下, y=1上
 float x=uv.x, y=uv.y, t=uTime;
 float lx=(x-uCx)/max(uHalfW,0.02);
 float d=abs(lx);
 float dir=sign(lx);
 // 流れ込み: 吹き出し口(cx)から前線(=溜まりenv)が左右へ這って広がる。先端はやわらかい
 float front=0.15+1.15*uOn;
 float frontEdge=1.0-smoothstep(front-0.30,front,d);
 float hAbove=y-uFloorY;
 // 波打つ天面（2つの速度の波＋fbmゆらぎ）。前線の先端ほど低い
 float wave=sin(x*24.0-t*uSpeed*1.9)*0.5+sin(x*9.0+t*uSpeed*1.1)*0.5;
 float topVar=wave*0.030*uBillow+(fbm(vec2(x*3.0+t*uDrift*0.08,t*uSpeed*0.05))-0.5)*0.30*uBillow;
 float tip=0.35+0.65*smoothstep(front,front-0.55,d);
 float hTop=uTop*tip*(0.25+0.75*uOn)+topVar;
 float vUp=smoothstep(hTop,hTop-(0.03+uSoft*0.30),hAbove);
 float vLo=smoothstep(-0.05,0.015,hAbove);
 // 雲: 吹き出し口から外向きに這う流れ＋ドメインワープ
 vec2 p=vec2(x*uScale-dir*t*uSpeed*0.11, y*uScale*2.0-t*uSpeed*0.035);
 vec2 wv2=vec2(fbm(p*0.55+vec2(t*uSpeed*0.05,0.0)),fbm(p*0.55+vec2(7.7,-t*uSpeed*0.05)));
 float n=fbm(p+(wv2-0.5)*2.1*uBillow);
 float nf=fbm(p*2.8+11.0);
 float cloudRaw=mix(n,n*nf,0.5);
 // 切れ間: コントラストを上げ、薄い所はスッと抜ける
 float cloud=pow(clamp(cloudRaw*1.30,0.0,1.0),1.0+uTear*2.4);
 float floorB=clamp(1.0-hAbove/max(hTop,0.05),0.0,1.0);
 float dens=frontEdge*vUp*vLo*(0.25+0.75*floorB)*(0.20+1.10*cloud)*uDensity;
 // 縁からこぼれ: 床より下、所々から舌状に垂れ落ちる。降りるほど揺れて薄くなる。
 // max()で重ねる＝床の継ぎ目に硬い線を作らない
 float xw=x+(fbm(vec2(x*4.0,y*2.2-t*uSpeed*0.22))-0.5)*0.07;
 float col=fbm(vec2(xw*17.0,3.3));
 float tongue=smoothstep(0.46,0.85,col);
 float len=0.06+uSpill*0.50;
 float below=smoothstep(0.0,-0.02,hAbove);
 float fall=smoothstep(-len,-0.01,hAbove);
 float flow=fbm(vec2(xw*10.0,y*3.4+t*uSpeed*0.32));
 float reach=1.0-smoothstep(front*0.9-0.25,front*0.9,d);
 float spill=below*reach*tongue*fall*(0.25+0.85*flow)*uDensity*0.75*uOn;
 dens=max(dens,spill);
 dens=clamp(dens,0.0,1.0);
 vec3 base=mix(vec3(0.95,0.96,1.0), vec3(0.58,0.60,0.66), uGray)*uBright;
 gl_FragColor=vec4(base, dens);          // 煙以外は透明(alpha=dens)。色は光マップから付く。
}`

function mkCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

export class LowSmokeFX {
  // 既定値＝承認済モック「ロースモーク 比較.html」（2026-07-11）の見た目。
  params: LowSmokeParams = {
    cx: 0.55, floory: 0.42, width: 0.32, top: 0.22, density: 1.0, accum: 8.1,
    soft: 0.55, billow: 0.40, speed: 1.0, drift: 0.3, scale: 3.5, gray: 0.15, bright: 1.0,
    spill: 0.55, tear: 0.35
  }
  on = false
  private matterCv = mkCanvas(MW, MH)
  private gl: WebGLRenderingContext | null
  private prog: WebGLProgram | null = null
  private u: Record<string, WebGLUniformLocation | null> = {}
  private ok = false
  private t0 = 0
  private last = 0
  private env = 0 // 溜まり 0..1

  constructor() {
    const gl = (this.matterCv.getContext('webgl', {
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
        console.error('[lowsmoke] WebGL init failed', e)
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
    const names = ['uRes', 'uTime', 'uCx', 'uFloorY', 'uHalfW', 'uTop', 'uDensity', 'uBillow',
      'uScale', 'uSpeed', 'uDrift', 'uSoft', 'uGray', 'uBright', 'uOn', 'uSpill', 'uTear']
    for (const n of names) this.u[n] = gl.getUniformLocation(p, n)
    gl.viewport(0, 0, MW, MH)
    gl.disable(gl.BLEND)
  }

  /** 白い濃度のアルファ画像（色は持たない＝engine が光マップで色付け）。 */
  get matter(): HTMLCanvasElement { return this.matterCv }
  /** 溜まりが残っているか（OFFでも引ききるまで true）。 */
  get active(): boolean { return this.on || this.env > 0.01 }

  tick(now: number): void {
    const gl = this.gl
    if (!gl || !this.ok || !this.prog) return
    if (!this.t0) this.t0 = now
    // 長く OFF だった後の再開は this.last が古く dt が巨大 → 初回扱いにして1コマ目の飛びを防ぐ。
    const gap = now - this.last
    const dt = !this.last || gap > 250 ? 1 / 60 : Math.min(0.05, gap / 1000)
    this.last = now
    const P = this.params
    // 溜まり: ON でゆっくり溜まる / OFF で引く
    const rate = this.on ? 1 / Math.max(0.2, P.accum) : -1 / 3.0
    this.env = Math.max(0, Math.min(1, this.env + rate * dt))
    gl.useProgram(this.prog)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (this.env <= 0.001) return
    const t = (now - this.t0) / 1000
    gl.uniform2f(this.u.uRes, MW, MH)
    gl.uniform1f(this.u.uTime, t)
    gl.uniform1f(this.u.uCx, P.cx)
    gl.uniform1f(this.u.uFloorY, P.floory)
    gl.uniform1f(this.u.uHalfW, P.width)
    gl.uniform1f(this.u.uTop, P.top)
    gl.uniform1f(this.u.uDensity, P.density)
    gl.uniform1f(this.u.uBillow, P.billow)
    gl.uniform1f(this.u.uScale, P.scale)
    gl.uniform1f(this.u.uSpeed, P.speed)
    gl.uniform1f(this.u.uDrift, P.drift)
    gl.uniform1f(this.u.uSoft, P.soft)
    gl.uniform1f(this.u.uGray, P.gray)
    gl.uniform1f(this.u.uBright, P.bright)
    gl.uniform1f(this.u.uOn, this.env)
    gl.uniform1f(this.u.uSpill, P.spill ?? 0.55) // 旧保存(項目なし)でも既定で動く
    gl.uniform1f(this.u.uTear, P.tear ?? 0.35)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  /** 今すぐ満タンに（溜め直し）。 */
  refill(): void {
    this.env = 0
    this.on = true
  }
}
