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
  { key: 'breath', label: 'BREATH' },
  { key: 'fire', label: 'FIRE' },
  { key: 'wave', label: 'WAVE' },
  { key: 'bolt', label: 'BOLT' },
  { key: 'rainbow', label: 'RAINBOW' },
  { key: 'zoompulse', label: 'ZOOM' }
]

export const FX_LABEL: Record<FxKey, string> = {
  search: 'SEARCH',
  rndsearch: 'RND SEARCH',
  chase: 'CHASE',
  strobe: 'STROBE',
  rndstrobe: 'RND STROBE',
  colorchase: 'COLOR CHASE',
  breath: 'BREATH',
  fire: 'FIRE',
  wave: 'WAVE',
  bolt: 'BOLT',
  rainbow: 'RAINBOW',
  zoompulse: 'ZOOM'
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
      lbl: 'SPEED',
      min: 5,
      max: 120,
      get: (e) => Math.round(e.fxp.search.speed * 100),
      set: (e, v) => e.setFxp('search', 'speed', v / 100),
      fmt: (v) => (100 / v).toFixed(1) + 's'
    },
    {
      lbl: 'WIDTH',
      min: 4,
      max: 60,
      get: (e) => e.fxp.search.width,
      set: (e, v) => e.setFxp('search', 'width', v),
      fmt: (v) => '±' + v + '°'
    }
  ],
  rndsearch: [
    {
      lbl: 'SPEED',
      min: 5,
      max: 120,
      get: (e) => Math.round(e.fxp.search.speed * 100),
      set: (e, v) => e.setFxp('search', 'speed', v / 100),
      fmt: (v) => (100 / v).toFixed(1) + 's'
    },
    {
      lbl: 'WIDTH',
      min: 4,
      max: 60,
      get: (e) => e.fxp.search.width,
      set: (e, v) => e.setFxp('search', 'width', v),
      fmt: (v) => '±' + v + '°'
    },
    {
      lbl: 'VARY',
      min: 0,
      max: 100,
      get: (e) => e.fxp.rndsearch.vari,
      set: (e, v) => e.setFxp('rndsearch', 'vari', v),
      fmt: (v) => v + '%'
    }
  ],
  chase: [
    {
      lbl: 'SPEED',
      min: 20,
      max: 300,
      get: (e) => Math.round(e.fxp.chase.speed * 100),
      set: (e, v) => e.setFxp('chase', 'speed', v / 100),
      fmt: (v) => '×' + (v / 100).toFixed(1)
    },
    {
      lbl: 'SOFT',
      min: 0,
      max: 100,
      get: (e) => e.fxp.chase.soft,
      set: (e, v) => e.setFxp('chase', 'soft', v),
      fmt: (v) => v + '%'
    }
  ],
  strobe: [
    {
      lbl: 'SPEED',
      min: 1,
      max: 25, // 描画60fps化(2026-07-13)に合わせ15→25Hz（ROBE実機の20〜25Hzに追随）
      get: (e) => e.fxp.strobe.speed,
      set: (e, v) => e.setFxp('strobe', 'speed', v),
      fmt: (v) => v + 'Hz'
    },
    {
      lbl: 'DUTY',
      min: 10,
      max: 70,
      get: (e) => e.fxp.strobe.duty,
      set: (e, v) => e.setFxp('strobe', 'duty', v),
      fmt: (v) => v + '%'
    }
  ],
  rndstrobe: [
    {
      lbl: 'SPEED',
      min: 2,
      max: 25,
      get: (e) => e.fxp.rndstrobe.speed,
      set: (e, v) => e.setFxp('rndstrobe', 'speed', v),
      fmt: (v) => v + '/秒'
    },
    {
      lbl: 'DENSITY',
      min: 5,
      max: 60,
      get: (e) => e.fxp.rndstrobe.dens,
      set: (e, v) => e.setFxp('rndstrobe', 'dens', v),
      fmt: (v) => v + '%'
    },
    {
      lbl: 'FLOW',
      min: 0,
      max: 100,
      get: (e) => e.fxp.rndstrobe.flow ?? 40,
      set: (e, v) => e.setFxp('rndstrobe', 'flow', v),
      fmt: (v) => v + '%'
    }
  ],
  colorchase: [
    {
      lbl: 'SPEED',
      min: 20,
      max: 600,
      get: (e) => Math.round(e.fxp.colorchase.speed * 100),
      set: (e, v) => e.setFxp('colorchase', 'speed', v / 100),
      fmt: (v) => (v / 100).toFixed(1) + '色/秒'
    },
    {
      lbl: 'BLEND',
      min: 0,
      max: 100,
      get: (e) => e.fxp.colorchase.blend,
      set: (e, v) => e.setFxp('colorchase', 'blend', v),
      fmt: (v) => (v === 0 ? 'パッ' : v + '%')
    }
  ],
  breath: [
    {
      lbl: 'SPEED',
      min: 5,
      max: 80,
      get: (e) => Math.round(e.fxp.breath.speed * 100),
      set: (e, v) => e.setFxp('breath', 'speed', v / 100),
      fmt: (v) => (100 / v).toFixed(1) + 's'
    },
    {
      lbl: 'DEPTH',
      min: 20,
      max: 100,
      get: (e) => e.fxp.breath.depth,
      set: (e, v) => e.setFxp('breath', 'depth', v),
      fmt: (v) => v + '%'
    }
  ],
  fire: [
    {
      lbl: 'SPEED',
      min: 30,
      max: 250,
      get: (e) => Math.round(e.fxp.fire.speed * 100),
      set: (e, v) => e.setFxp('fire', 'speed', v / 100),
      fmt: (v) => '×' + (v / 100).toFixed(1)
    },
    {
      lbl: 'FLICKER',
      min: 10,
      max: 100,
      get: (e) => e.fxp.fire.amount,
      set: (e, v) => e.setFxp('fire', 'amount', v),
      fmt: (v) => v + '%'
    }
  ],
  wave: [
    {
      lbl: 'SPEED',
      min: 5,
      max: 100,
      get: (e) => Math.round(e.fxp.wave.speed * 100),
      set: (e, v) => e.setFxp('wave', 'speed', v / 100),
      fmt: (v) => (100 / v).toFixed(1) + 's'
    },
    {
      lbl: 'LENGTH',
      min: 10,
      max: 100,
      get: (e) => e.fxp.wave.length,
      set: (e, v) => e.setFxp('wave', 'length', v),
      fmt: (v) => v + '%'
    }
  ],
  bolt: [
    {
      lbl: 'RATE',
      min: 10,
      max: 200,
      get: (e) => Math.round(e.fxp.bolt.rate * 100),
      set: (e, v) => e.setFxp('bolt', 'rate', v / 100),
      fmt: (v) => '×' + (v / 100).toFixed(1)
    },
    {
      lbl: 'POWER',
      min: 30,
      max: 150,
      get: (e) => e.fxp.bolt.strength,
      set: (e, v) => e.setFxp('bolt', 'strength', v),
      fmt: (v) => v + '%'
    }
  ],
  rainbow: [
    {
      lbl: 'SPEED',
      min: 3,
      max: 80,
      get: (e) => Math.round(e.fxp.rainbow.speed * 100),
      set: (e, v) => e.setFxp('rainbow', 'speed', v / 100),
      fmt: (v) => (1 / (v / 100)).toFixed(1) + 's/周'
    },
    {
      lbl: 'SPREAD',
      min: 0,
      max: 100,
      get: (e) => e.fxp.rainbow.spread,
      set: (e, v) => e.setFxp('rainbow', 'spread', v),
      fmt: (v) => (v === 0 ? '全灯同色' : v + '%')
    }
  ],
  zoompulse: [
    {
      lbl: 'SPEED',
      min: 5,
      max: 100,
      get: (e) => Math.round(e.fxp.zoompulse.speed * 100),
      set: (e, v) => e.setFxp('zoompulse', 'speed', v / 100),
      fmt: (v) => (100 / v).toFixed(1) + 's'
    },
    {
      lbl: 'AMOUNT',
      min: 10,
      max: 100,
      get: (e) => e.fxp.zoompulse.amount,
      set: (e, v) => e.setFxp('zoompulse', 'amount', v),
      fmt: (v) => v + '%'
    }
  ]
}
