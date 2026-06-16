/* FXグリッドの並び・ラベルと、各FXの「点いている時だけ出るツマミ」定義。
 * モックの FX_PARAMS をそのまま移植。get/set はエンジンの fxp を読み書きする。 */
import type { ImageLightEngine, FxKey } from './engine'

export const FX_BUTTONS: { key: FxKey; label: string }[] = [
  { key: 'search', label: 'SEARCH' },
  { key: 'rndsearch', label: 'RND SEARCH' },
  { key: 'chase', label: 'CHASE' },
  { key: 'strobe', label: 'STROBE' },
  { key: 'rndstrobe', label: 'RND STROBE' },
  { key: 'colorchase', label: 'COLOR CHASE' },
  { key: 'breath', label: '呼吸 BREATH' },
  { key: 'fire', label: '炎 FIRE' },
  { key: 'wave', label: '波 WAVE' },
  { key: 'bolt', label: '雷 BOLT' },
  { key: 'rainbow', label: '虹 RAINBOW' },
  { key: 'zoompulse', label: '開閉 ZOOM' }
]

export const FX_LABEL: Record<FxKey, string> = {
  search: 'SEARCH',
  rndsearch: 'RND SEARCH',
  chase: 'CHASE',
  strobe: 'STROBE',
  rndstrobe: 'RND STROBE',
  colorchase: 'COLOR CHASE',
  breath: '呼吸',
  fire: '炎',
  wave: '波',
  bolt: '雷',
  rainbow: '虹',
  zoompulse: '開閉'
}

export interface FxParamDef {
  lbl: string
  min: number
  max: number
  get: (e: ImageLightEngine) => number
  set: (e: ImageLightEngine, v: number) => void
  fmt: (v: number) => string
}

export const FX_PARAMS: Record<FxKey, FxParamDef[]> = {
  search: [
    {
      lbl: '速さ',
      min: 5,
      max: 120,
      get: (e) => Math.round(e.fxp.search.speed * 100),
      set: (e, v) => e.setFxp('search', 'speed', v / 100),
      fmt: (v) => (100 / v).toFixed(1) + 's'
    },
    {
      lbl: '幅',
      min: 4,
      max: 60,
      get: (e) => e.fxp.search.width,
      set: (e, v) => e.setFxp('search', 'width', v),
      fmt: (v) => '±' + v + '°'
    }
  ],
  rndsearch: [
    {
      lbl: '速さ',
      min: 5,
      max: 120,
      get: (e) => Math.round(e.fxp.search.speed * 100),
      set: (e, v) => e.setFxp('search', 'speed', v / 100),
      fmt: (v) => (100 / v).toFixed(1) + 's'
    },
    {
      lbl: '幅',
      min: 4,
      max: 60,
      get: (e) => e.fxp.search.width,
      set: (e, v) => e.setFxp('search', 'width', v),
      fmt: (v) => '±' + v + '°'
    },
    {
      lbl: 'ばらつき',
      min: 0,
      max: 100,
      get: (e) => e.fxp.rndsearch.vari,
      set: (e, v) => e.setFxp('rndsearch', 'vari', v),
      fmt: (v) => v + '%'
    }
  ],
  chase: [
    {
      lbl: '速さ',
      min: 20,
      max: 300,
      get: (e) => Math.round(e.fxp.chase.speed * 100),
      set: (e, v) => e.setFxp('chase', 'speed', v / 100),
      fmt: (v) => '×' + (v / 100).toFixed(1)
    },
    {
      lbl: 'やわらか',
      min: 0,
      max: 100,
      get: (e) => e.fxp.chase.soft,
      set: (e, v) => e.setFxp('chase', 'soft', v),
      fmt: (v) => v + '%'
    }
  ],
  strobe: [
    {
      lbl: '速さ',
      min: 1,
      max: 15,
      get: (e) => e.fxp.strobe.speed,
      set: (e, v) => e.setFxp('strobe', 'speed', v),
      fmt: (v) => v + 'Hz'
    },
    {
      lbl: '点灯率',
      min: 10,
      max: 70,
      get: (e) => e.fxp.strobe.duty,
      set: (e, v) => e.setFxp('strobe', 'duty', v),
      fmt: (v) => v + '%'
    }
  ],
  rndstrobe: [
    {
      lbl: '速さ',
      min: 2,
      max: 25,
      get: (e) => e.fxp.rndstrobe.speed,
      set: (e, v) => e.setFxp('rndstrobe', 'speed', v),
      fmt: (v) => v + '/秒'
    },
    {
      lbl: '密度',
      min: 5,
      max: 60,
      get: (e) => e.fxp.rndstrobe.dens,
      set: (e, v) => e.setFxp('rndstrobe', 'dens', v),
      fmt: (v) => v + '%'
    },
    {
      lbl: '流れ',
      min: 0,
      max: 100,
      get: (e) => e.fxp.rndstrobe.flow ?? 40,
      set: (e, v) => e.setFxp('rndstrobe', 'flow', v),
      fmt: (v) => v + '%'
    }
  ],
  colorchase: [
    {
      lbl: '速さ',
      min: 20,
      max: 600,
      get: (e) => Math.round(e.fxp.colorchase.speed * 100),
      set: (e, v) => e.setFxp('colorchase', 'speed', v / 100),
      fmt: (v) => (v / 100).toFixed(1) + '色/秒'
    },
    {
      lbl: 'なじみ',
      min: 0,
      max: 100,
      get: (e) => e.fxp.colorchase.blend,
      set: (e, v) => e.setFxp('colorchase', 'blend', v),
      fmt: (v) => (v === 0 ? 'パッ' : v + '%')
    }
  ],
  breath: [
    {
      lbl: '速さ',
      min: 5,
      max: 80,
      get: (e) => Math.round(e.fxp.breath.speed * 100),
      set: (e, v) => e.setFxp('breath', 'speed', v / 100),
      fmt: (v) => (100 / v).toFixed(1) + 's'
    },
    {
      lbl: '深さ',
      min: 20,
      max: 100,
      get: (e) => e.fxp.breath.depth,
      set: (e, v) => e.setFxp('breath', 'depth', v),
      fmt: (v) => v + '%'
    }
  ],
  fire: [
    {
      lbl: '速さ',
      min: 30,
      max: 250,
      get: (e) => Math.round(e.fxp.fire.speed * 100),
      set: (e, v) => e.setFxp('fire', 'speed', v / 100),
      fmt: (v) => '×' + (v / 100).toFixed(1)
    },
    {
      lbl: '揺れ',
      min: 10,
      max: 100,
      get: (e) => e.fxp.fire.amount,
      set: (e, v) => e.setFxp('fire', 'amount', v),
      fmt: (v) => v + '%'
    }
  ],
  wave: [
    {
      lbl: '速さ',
      min: 5,
      max: 100,
      get: (e) => Math.round(e.fxp.wave.speed * 100),
      set: (e, v) => e.setFxp('wave', 'speed', v / 100),
      fmt: (v) => (100 / v).toFixed(1) + 's'
    },
    {
      lbl: '波の長さ',
      min: 10,
      max: 100,
      get: (e) => e.fxp.wave.length,
      set: (e, v) => e.setFxp('wave', 'length', v),
      fmt: (v) => v + '%'
    }
  ],
  bolt: [
    {
      lbl: '頻度',
      min: 10,
      max: 200,
      get: (e) => Math.round(e.fxp.bolt.rate * 100),
      set: (e, v) => e.setFxp('bolt', 'rate', v / 100),
      fmt: (v) => '×' + (v / 100).toFixed(1)
    },
    {
      lbl: '強さ',
      min: 30,
      max: 150,
      get: (e) => e.fxp.bolt.strength,
      set: (e, v) => e.setFxp('bolt', 'strength', v),
      fmt: (v) => v + '%'
    }
  ],
  rainbow: [
    {
      lbl: '速さ',
      min: 3,
      max: 80,
      get: (e) => Math.round(e.fxp.rainbow.speed * 100),
      set: (e, v) => e.setFxp('rainbow', 'speed', v / 100),
      fmt: (v) => (1 / (v / 100)).toFixed(1) + 's/周'
    },
    {
      lbl: 'ばらし',
      min: 0,
      max: 100,
      get: (e) => e.fxp.rainbow.spread,
      set: (e, v) => e.setFxp('rainbow', 'spread', v),
      fmt: (v) => (v === 0 ? '全灯同色' : v + '%')
    }
  ],
  zoompulse: [
    {
      lbl: '速さ',
      min: 5,
      max: 100,
      get: (e) => Math.round(e.fxp.zoompulse.speed * 100),
      set: (e, v) => e.setFxp('zoompulse', 'speed', v / 100),
      fmt: (v) => (100 / v).toFixed(1) + 's'
    },
    {
      lbl: '開き幅',
      min: 10,
      max: 100,
      get: (e) => e.fxp.zoompulse.amount,
      set: (e, v) => e.setFxp('zoompulse', 'amount', v),
      fmt: (v) => v + '%'
    }
  ]
}
