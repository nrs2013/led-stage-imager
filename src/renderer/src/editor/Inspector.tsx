import { useStore } from '../state/store'
import type { BulbStyle, ChannelMode, DisplayMode, PartFamily, Shape } from '../model/types'
import { familyOfType } from '../model/part-family'
import { C, F, buttonStyle, inputStyle, fieldLabel } from '../ui/tokens'
import { channelCount } from '../dmx/channel-math'
import { addressAt, formatDmx, repeatCount } from '../dmx/address'
import { NumberField } from '../ui/NumberField'
import { shapeBounds, bulbDiameter } from './geometry'
import { BULB_DEFAULT_STYLE } from '../render/bulb'
import { NEON_FONTS, neonFont, neonSize, neonGlowAmount, neonCharCount } from '../render/neon'
import {
  marqueeSize,
  marqueePitch,
  marqueeCharCount,
  marqueeChars,
  MARQUEE_FONTS,
  marqueeFontDef
} from '../render/marquee'
import { genStars, starsDensity, starsWhiteRatio, starsSize } from '../render/stars'
import {
  festoonSag,
  festoonPitch,
  festoonDiameter,
  festoonCount,
  festoonLength,
  FESTOON_DEFAULT_GLOW
} from '../render/festoon'
import { parDiameter, blinderWidth, pattDiameter, pixelPattDiameter } from '../render/fixtures'
import { roomLampDiameter } from '../render/roomlamp'
import { streetLampDiameter } from '../render/streetlamp'
import { chandelierDiameter } from '../render/chandelier'

/** Human-readable size of a shape: spans, dot counts, lengths — diagonals included. */
function sizeText(shape: Shape): string {
  const b = shapeBounds(shape)
  if (shape.type === 'bulb') {
    return `Φ ${bulbDiameter(shape)} px`
  }
  if (shape.type === 'neon') {
    return `W ${Math.round(b.w)} × H ${Math.round(b.h)} px · ${neonCharCount(shape.text ?? '')} tubes`
  }
  if (shape.type === 'marquee') {
    return `W ${Math.round(b.w)} × H ${Math.round(b.h)} px · ${marqueeCharCount(shape.text ?? '')} chars`
  }
  if (shape.type === 'stars') {
    const f = genStars(shape)
    return `W ${Math.round(b.w)} × H ${Math.round(b.h)} px · ${f.white.length}W+${f.blue.length}B dots`
  }
  if (shape.type === 'festoon') {
    return `Wire ${Math.round(festoonLength(shape))} px · ${festoonCount(shape)} bulbs`
  }
  if (shape.type === 'parlight') return `Φ ${parDiameter(shape)} px`
  if (shape.type === 'patt') return `Φ ${pattDiameter(shape)} px`
  if (shape.type === 'pixelpatt') return `Φ ${pixelPattDiameter(shape)} px · 7 cells`
  if (shape.type === 'roomlamp') return `Φ ${roomLampDiameter(shape)} px`
  if (shape.type === 'streetlamp') return `Φ ${streetLampDiameter(shape)} px`
  if (shape.type === 'chandelier') return `Φ ${chandelierDiameter(shape)} px`
  if (shape.type === 'blinder') {
    const w = blinderWidth(shape)
    return `W ${w} × H ${w * 2} px · 8 lamps`
  }
  if (shape.type === 'image') {
    return `W ${Math.round(b.w)} × H ${Math.round(b.h)} px · ${shape.imageData ? 'photo set' : 'no photo'}`
  }
  if (shape.type === 'uplight' || shape.type === 'movinghead') {
    return `Aperture ${Math.round(shape.beamW0 ?? 14)} · Spread ${Math.round(shape.beamW1 ?? 90)} · Throw ${Math.round(shape.beamLen ?? 200)} px`
  }
  if (shape.type === 'freehand') {
    const single =
      shape.points.length === 2 &&
      shape.points[0].x === shape.points[1].x &&
      shape.points[0].y === shape.points[1].y
    const dots = single ? 1 : shape.points.length
    return `X ${Math.round(b.w) + 1} px · Y ${Math.round(b.h) + 1} px · ${dots} dots`
  }
  if (shape.type === 'line' || shape.type === 'polyline') {
    const L = Math.round(Math.hypot(b.w, b.h))
    return `X ${Math.round(b.w)} px · Y ${Math.round(b.h)} px · L ${L} px`
  }
  return `W ${Math.round(b.w)} × H ${Math.round(b.h)} px`
}

const DISPLAY_MODES: DisplayMode[] = ['stroke', 'fill', 'both']
const CHANNEL_MODES: { id: ChannelMode; label: string }[] = [
  { id: 'rgb', label: 'RGB (3ch)' },
  { id: 'rgbdim', label: 'RGB+Dim (4ch)' },
  { id: 'dim', label: 'Dim (1ch)' },
  { id: 'rgbw4', label: 'RGBW (4ch)' },
  { id: 'rgbw', label: 'RGBW+Dim (5ch)' },
  { id: 'beam6', label: 'Beam Moving (6ch)' },
  { id: 'beam8', label: 'Beam Generic (P/T/Dim/Shut/RGB/Zoom 8ch)' },
  { id: 'beam9', label: 'Beam Generic+W (P/T/Dim/Shut/RGBW/Zoom 9ch)' }
]

/** 種別で出すmodeを絞る。照明灯体はビーム系中心、電飾は従来。
 *  現在の mode は必ず残す（選択肢から消えると <select> の値が宙に浮いて壊れるため）。 */
function modesForFamily(
  family: PartFamily,
  current: ChannelMode
): { id: ChannelMode; label: string }[] {
  const want = new Set<ChannelMode>(
    family === 'light'
      ? ['beam9', 'beam8', 'beam6', 'dim']
      : ['rgb', 'rgbdim', 'dim', 'rgbw4', 'rgbw', 'beam6']
  )
  want.add(current)
  return CHANNEL_MODES.filter((m) => want.has(m.id))
}

const rowGap = 14

export function Inspector(): React.JSX.Element {
  const chart = useStore((s) => s.chart)
  const selectedId = useStore((s) => s.selectedId)
  const selectedIds = useStore((s) => s.selectedIds)
  const alignShapes = useStore((s) => s.alignShapes)
  const distributeShapes = useStore((s) => s.distributeShapes)
  const updateShape = useStore((s) => s.updateShape)
  const upsertFixture = useStore((s) => s.upsertFixture)
  const bulkPatch = useStore((s) => s.bulkPatch)
  const removeShape = useStore((s) => s.removeShape)
  const removeShapes = useStore((s) => s.removeShapes)
  const setLocked = useStore((s) => s.setLocked)

  const shape = chart.shapes.find((s) => s.id === selectedId)
  const fixture = chart.fixtures.find((f) => f.shapeId === selectedId)
  const open = shape && (shape.type === 'line' || shape.type === 'polyline' || shape.type === 'freehand')

  if (!shape) {
    // multi-selection: one panel, every change lands on ALL selected fixtures at once
    // (のむさん「全選択を統括して一気にユニバースや番地を変えたい」)
    if (selectedIds.length > 1) {
      const ids = selectedIds
      const fxs = chart.fixtures.filter((f) => ids.includes(f.shapeId))
      // toggle lock for the whole selection: only "unlock" when every selected shape
      // is already locked, otherwise "lock" (mirrors the single-panel button)
      const selShapes = chart.shapes.filter((sh) => ids.includes(sh.id))
      const allLocked = selShapes.length > 0 && selShapes.every((sh) => !!sh.locked)
      const common = <K extends 'universe' | 'start'>(k: K, fallback: number): number => {
        if (!fxs.length) return fallback
        return fxs[0][k]
      }
      const ab = { ...buttonStyle({}), flex: 1, padding: '9px 0', fontSize: 12, fontFamily: F.ui }
      const abDim = (on: boolean) => ({ ...ab, opacity: on ? 1 : 0.4 })
      return (
        <aside style={asideStyle}>
          <SectionTitle>Multi</SectionTitle>
          <div style={{ fontFamily: F.mono, fontSize: 11, color: C.hint, marginBottom: 4 }}>
            {ids.length} selected · patched {fxs.length}/{ids.length}
          </div>

          <SectionTitle>Align / Distribute</SectionTitle>
          <div
            style={{ fontFamily: F.ui, fontSize: 11, color: C.faint, marginBottom: 6, lineHeight: 1.5 }}
          >
            選んだ {ids.length} 個を端／中央でそろえる・等間隔に並べる。⌘Z で戻せます。
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <button style={ab} title="左ぞろえ（左端を合わせる）" onClick={() => alignShapes('left')}>
              Left
            </button>
            <button style={ab} title="左右の中央でそろえる" onClick={() => alignShapes('hcenter')}>
              Center
            </button>
            <button style={ab} title="右ぞろえ（右端を合わせる）" onClick={() => alignShapes('right')}>
              Right
            </button>
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <button style={ab} title="上ぞろえ（上端を合わせる）" onClick={() => alignShapes('top')}>
              Top
            </button>
            <button style={ab} title="上下の中央でそろえる" onClick={() => alignShapes('vcenter')}>
              Middle
            </button>
            <button style={ab} title="下ぞろえ（下端を合わせる）" onClick={() => alignShapes('bottom')}>
              Bottom
            </button>
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: rowGap }}>
            <button
              style={abDim(ids.length >= 3)}
              disabled={ids.length < 3}
              title="左右の間隔を等しくする（3個以上・両端は固定）"
              onClick={() => distributeShapes('h')}
            >
              Distribute H
            </button>
            <button
              style={abDim(ids.length >= 3)}
              disabled={ids.length < 3}
              title="上下の間隔を等しくする（3個以上・両端は固定）"
              onClick={() => distributeShapes('v')}
            >
              Distribute V
            </button>
          </div>

          <SectionTitle>Patch</SectionTitle>
          <div
            style={{ fontFamily: F.ui, fontSize: 11, color: C.faint, marginBottom: rowGap, lineHeight: 1.5 }}
          >
            ここでの変更は選択中の全部にまとめて効きます（未パッチの物には新しくパッチ）。1本に結合は ⌘G。
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Field label="Universe" flex={1}>
              <NumberField
                value={common('universe', 0) + 1}
                min={1}
                max={32768}
                onChange={(v) => bulkPatch(ids, { universe: Math.max(0, v - 1) })}
              />
            </Field>
            <Field label="DMX Addr" flex={1}>
              <NumberField
                value={common('start', 1)}
                min={1}
                max={512}
                onChange={(v) => bulkPatch(ids, { start: v })}
              />
            </Field>
          </div>
          <Field label="Type">
            <select
              value={fxs[0]?.mode ?? 'rgb'}
              style={{ ...inputStyle, fontFamily: F.ui }}
              onChange={(e) => bulkPatch(ids, { mode: e.target.value as ChannelMode })}
            >
              {modesForFamily(
                selShapes[0] ? (selShapes[0].family ?? familyOfType(selShapes[0].type)) : 'decor',
                fxs[0]?.mode ?? 'rgb'
              ).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
          <div style={{ fontFamily: F.ui, fontSize: 11, color: C.faint }}>
            同じ番地にすれば全部が1本のフェーダーで一斉点灯になります
          </div>
          <div style={{ flex: 1 }} />
          <button
            style={{ ...buttonStyle({ active: allLocked }), width: '100%', marginTop: rowGap }}
            onClick={() => setLocked(ids, !allLocked)}
            title={
              allLocked
                ? 'まとめてロック解除（キャンバスから掴めるように戻す・⌘L）'
                : 'まとめてロック（キャンバスから掴めなくする・⌘L）'
            }
          >
            {allLocked ? `Unlock ${ids.length}` : `Lock ${ids.length}`}
          </button>
          <button
            style={{
              ...buttonStyle({ accent: '#e0726a', accentRGB: '224,114,106' }),
              width: '100%',
              marginTop: 8
            }}
            onClick={() => {
              if (
                ids.length >= 5 &&
                !window.confirm(`電飾 ${ids.length} 個を削除しますか？（⌘Zで戻せます）`)
              )
                return
              removeShapes(ids)
            }}
          >
            Delete {ids.length}
          </button>
        </aside>
      )
    }
    return (
      <aside style={asideStyle}>
        <SectionTitle>Fixture</SectionTitle>
        <div style={{ color: C.faint, fontSize: 12, fontFamily: F.ui, marginTop: 8, lineHeight: 1.7 }}>
          電飾を選ぶと、ここで形と DMX 番地を編集できます。
          <br />
          まず左上の Parts から部品をキャンバスへドラッグ、または P キーでなぞって描いてください。
        </div>
      </aside>
    )
  }

  const hasRepeat = (shape.repeat?.count ?? 1) > 1
  const setRepeat = (patch: Partial<{ count: number; dx: number; dy: number }>): void => {
    const cur = shape.repeat ?? { count: 1, dx: 10, dy: 0 }
    const next = { ...cur, ...patch }
    // count=1 でも dx/dy を保存する＝Pitch X/Y を Count に関係なく入力・保持できる
    // （以前は count=1 で undefined にしていたため、Pitch を打っても10に戻り「矢印が効かない」
    //   ように見えた）。「配列かどうか」は全箇所 count>1 で判定するので count=1 repeat は無害。
    updateShape(shape.id, {
      repeat: { count: Math.max(1, Math.round(next.count)), dx: next.dx, dy: next.dy }
    })
  }

  return (
    <aside style={asideStyle}>
      <SectionTitle>Fixture</SectionTitle>
      <div style={{ fontFamily: F.ui, fontSize: 11, color: C.label, marginBottom: 4 }}>
        Type: {(shape.family ?? familyOfType(shape.type)) === 'light' ? 'Light' : 'Decor'}
      </div>
      <div style={{ fontFamily: F.mono, fontSize: 11, color: C.hint, marginBottom: 6 }}>
        {shape.type === 'blinder' ? '8-Lamp Blinder' : shape.type.toUpperCase()} ·{' '}
        {shape.id.slice(-6)}
      </div>
      <div style={{ fontFamily: F.mono, fontSize: 12, color: C.accent, marginBottom: rowGap }}>
        {sizeText(shape)}
      </div>

      {/* bulb: glass size + texture (colour & gauge come from the console) */}
      {shape.type === 'bulb' && (
        <>
          <Field label="Diameter (dots)">
            <NumberField
              value={bulbDiameter(shape)}
              min={1}
              max={200}
              step={0.5}
              onChange={(v) => updateShape(shape.id, { diameter: v })}
            />
          </Field>
          <Field label="Texture">
            <div style={{ display: 'flex', gap: 6 }}>
              {(
                [
                  { id: 'clear', label: 'Clear' },
                  { id: 'frost', label: 'Frost' }
                ] as { id: BulbStyle; label: string }[]
              ).map((m) => (
                <button
                  key={m.id}
                  style={{
                    ...buttonStyle({ active: (shape.bulbStyle ?? BULB_DEFAULT_STYLE) === m.id }),
                    flex: 1,
                    padding: '8px 0'
                  }}
                  onClick={() => updateShape(shape.id, { bulbStyle: m.id })}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </Field>
        </>
      )}

      {/* neon: text + font + size + glow (colour & gauge come from the console,
          one address per character — the Offset field below sets the 文字間隔) */}
      {shape.type === 'neon' && (
        <>
          <Field label="Text (1 line)">
            <input
              value={shape.text ?? ''}
              placeholder="OPEN"
              style={{ ...inputStyle, fontFamily: F.ui, width: '100%', boxSizing: 'border-box' }}
              onChange={(e) => updateShape(shape.id, { text: e.target.value })}
            />
          </Field>
          <Field label="Typeface">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {NEON_FONTS.map((f) => {
                const active = neonFont(shape).id === f.id
                return (
                  <button
                    key={f.id}
                    style={{
                      ...buttonStyle({ active }),
                      padding: '8px 8px 6px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 2
                    }}
                    onClick={() => updateShape(shape.id, { fontId: f.id })}
                  >
                    <span
                      style={{
                        fontFamily: `"${f.family}"`,
                        fontWeight: f.weight,
                        fontSize: 15,
                        lineHeight: 1.15,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        maxWidth: '100%'
                      }}
                    >
                      {f.sample}
                    </span>
                    <span style={{ fontFamily: F.mono, fontSize: 8.5, opacity: 0.65 }}>
                      {f.label}
                    </span>
                  </button>
                )
              })}
            </div>
          </Field>
          <div style={{ display: 'flex', gap: 8 }}>
            <Field label="Font Size (px)" flex={1}>
              <NumberField
                value={neonSize(shape)}
                min={6}
                max={500}
                onChange={(v) => updateShape(shape.id, { fontSize: v })}
              />
            </Field>
            <Field label="Glow (%)" flex={1}>
              <NumberField
                value={neonGlowAmount(shape)}
                min={0}
                max={100}
                onChange={(v) => updateShape(shape.id, { neonGlow: v })}
              />
            </Field>
          </div>
        </>
      )}

      {/* marquee: text + letter size + bulb spacing — each letter is filled with
          bulbs, 1 letter = 1 address (per-letter chase, same idea as neon) */}
      {shape.type === 'marquee' && (
        <>
          <Field label="Text (1 line)">
            <input
              value={shape.text ?? ''}
              placeholder="STAGE"
              style={{ ...inputStyle, fontFamily: F.ui, width: '100%', boxSizing: 'border-box' }}
              onChange={(e) => updateShape(shape.id, { text: e.target.value })}
            />
          </Field>
          <Field label="Typeface">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              {MARQUEE_FONTS.map((f) => {
                const active = marqueeFontDef(shape).id === f.id
                return (
                  <button
                    key={f.id}
                    style={{
                      ...buttonStyle({ active }),
                      padding: '8px 6px 6px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 2
                    }}
                    onClick={() => updateShape(shape.id, { fontId: f.id })}
                  >
                    <span
                      style={{
                        fontFamily: `"${f.family}"`,
                        fontWeight: f.weight,
                        fontSize: 15,
                        lineHeight: 1.15,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        maxWidth: '100%'
                      }}
                    >
                      {f.sample}
                    </span>
                    <span style={{ fontFamily: F.mono, fontSize: 8.5, opacity: 0.65 }}>{f.label}</span>
                  </button>
                )
              })}
            </div>
          </Field>
          <div style={{ display: 'flex', gap: 8 }}>
            <Field label="Font Size (px)" flex={1}>
              <NumberField
                value={marqueeSize(shape)}
                min={20}
                max={600}
                onChange={(v) => updateShape(shape.id, { fontSize: v })}
              />
            </Field>
            <Field label="Bulb Spacing (px)" flex={1}>
              <NumberField
                value={marqueePitch(shape)}
                min={5}
                max={60}
                onChange={(v) => updateShape(shape.id, { bulbPitch: v })}
              />
            </Field>
          </div>
          <Field label="Per-letter color">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {marqueeChars(shape.text ?? '').map((ch, i) => {
                const col = shape.letterColors?.[i] ?? '#46423c'
                return (
                  <label
                    key={i}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 2,
                      padding: '4px 4px 0',
                      minWidth: 38,
                      cursor: 'pointer'
                    }}
                  >
                    <input
                      type="color"
                      value={col}
                      onChange={(e) => {
                        const chars = marqueeChars(shape.text ?? '')
                        const next = [...(shape.letterColors ?? [])]
                        while (next.length < chars.length) next.push('#46423c')
                        next[i] = e.target.value
                        updateShape(shape.id, { letterColors: next.slice(0, chars.length) })
                      }}
                      style={{
                        width: 30,
                        height: 26,
                        border: 'none',
                        background: 'none',
                        padding: 0,
                        cursor: 'pointer'
                      }}
                    />
                    <span style={{ fontFamily: F.mono, fontSize: 9, opacity: 0.6 }}>{ch}</span>
                  </label>
                )
              })}
            </div>
          </Field>
        </>
      )}

      {/* stars: density / white-blue mix / dot size / reshuffle (colour & gauge come
          from two desk channels — instance 0 = white sky, instance 1 = blue sky) */}
      {shape.type === 'stars' && (
        <>
          <Field label="Density">
            <NumberField
              value={starsDensity(shape)}
              min={0}
              max={100}
              onChange={(v) => updateShape(shape.id, { starDensity: v })}
            />
          </Field>
          <div style={{ display: 'flex', gap: 8 }}>
            <Field label="White Ratio (%)" flex={1}>
              <NumberField
                value={starsWhiteRatio(shape)}
                min={0}
                max={100}
                onChange={(v) => updateShape(shape.id, { starWhiteRatio: v })}
              />
            </Field>
            <Field label="Dot Size (px)" flex={1}>
              <NumberField
                value={starsSize(shape)}
                min={0.5}
                max={30}
                step={0.5}
                onChange={(v) => updateShape(shape.id, { starSize: v })}
              />
            </Field>
          </div>
          <Field label="Placement">
            <button
              style={{ ...buttonStyle({}), width: '100%' }}
              onClick={() =>
                updateShape(shape.id, { starSeed: (Math.random() * 0xffffffff) >>> 0 })
              }
            >
              Shuffle
            </button>
          </Field>
        </>
      )}

      {/* festoon: sag / pitch / glass size / glow / texture (colour & gauge come from
          the console — one address per bulb, like the ball bulb) */}
      {shape.type === 'festoon' && (
        <>
          <Field label="Sag (% of span)">
            <NumberField
              value={festoonSag(shape)}
              min={0}
              max={60}
              onChange={(v) => updateShape(shape.id, { sagPct: v })}
            />
          </Field>
          <div style={{ display: 'flex', gap: 8 }}>
            <Field label="Bulb Spacing (px)" flex={1}>
              <NumberField
                value={festoonPitch(shape)}
                min={4}
                max={500}
                onChange={(v) => updateShape(shape.id, { bulbPitch: v })}
              />
            </Field>
            <Field label="Diameter (dots)" flex={1}>
              <NumberField
                value={festoonDiameter(shape)}
                min={1}
                max={50}
                step={0.5}
                onChange={(v) => updateShape(shape.id, { diameter: v })}
              />
            </Field>
          </div>
          <Field label="Glow (%)">
            <NumberField
              value={shape.neonGlow ?? FESTOON_DEFAULT_GLOW}
              min={0}
              max={100}
              onChange={(v) => updateShape(shape.id, { neonGlow: v })}
            />
          </Field>
          <Field label="Texture">
            <div style={{ display: 'flex', gap: 6 }}>
              {(
                [
                  { id: 'clear', label: 'Clear' },
                  { id: 'frost', label: 'Frost' }
                ] as { id: BulbStyle; label: string }[]
              ).map((m) => (
                <button
                  key={m.id}
                  style={{
                    ...buttonStyle({ active: (shape.bulbStyle ?? BULB_DEFAULT_STYLE) === m.id }),
                    flex: 1,
                    padding: '8px 0'
                  }}
                  onClick={() => updateShape(shape.id, { bulbStyle: m.id })}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </Field>
        </>
      )}

      {/* photo material: pick the picture — it lights up only under a beam */}
      {shape.type === 'image' && (
        <Field label="Photo">
          <button
            style={{ ...buttonStyle({}), width: '100%', padding: '8px 0' }}
            onClick={() => {
              const input = document.createElement('input')
              input.type = 'file'
              input.accept = 'image/*'
              input.onchange = () => {
                const f = input.files?.[0]
                if (!f) return
                const fr = new FileReader()
                fr.onload = () => {
                  const dataUrl = String(fr.result)
                  const im = new Image()
                  im.onload = () => {
                    const b = shapeBounds(shape)
                    const sc = Math.min(1, 480 / Math.max(1, im.naturalWidth))
                    const w = Math.max(8, Math.round(im.naturalWidth * sc))
                    const h = Math.max(8, Math.round(im.naturalHeight * sc))
                    updateShape(shape.id, {
                      imageData: dataUrl,
                      points: [
                        { x: b.x, y: b.y },
                        { x: b.x + w, y: b.y + h }
                      ]
                    })
                  }
                  im.src = dataUrl
                }
                fr.readAsDataURL(f)
              }
              input.click()
            }}
          >
            {shape.imageData ? 'Replace Photo…' : 'Choose Photo…（PNG/JPG）'}
          </button>
        </Field>
      )}

      {/* uplight / movinghead: rigging values — the desk steers colour/gauge (+Pan/Tilt/Zoom) */}
      {(shape.type === 'uplight' || shape.type === 'movinghead') && (
        <>
          <div style={{ display: 'flex', gap: 8 }}>
            <Field label="Aperture Width (px)" flex={1}>
              <NumberField
                value={shape.beamW0 ?? 14}
                min={2}
                max={300}
                onChange={(v) => updateShape(shape.id, { beamW0: v })}
              />
            </Field>
            <Field label="Spread (px)" flex={1}>
              <NumberField
                value={shape.beamW1 ?? 90}
                min={4}
                max={1200}
                onChange={(v) => updateShape(shape.id, { beamW1: v })}
              />
            </Field>
          </div>
          <Field label="Throw Height (px)">
            <NumberField
              value={shape.beamLen ?? 200}
              min={20}
              max={3000}
              onChange={(v) => updateShape(shape.id, { beamLen: v })}
            />
          </Field>
        </>
      )}

      {/* stage fixtures: size only — colour & gauge come from the console */}
      {(shape.type === 'parlight' ||
        shape.type === 'patt' ||
        shape.type === 'pixelpatt' ||
        shape.type === 'blinder' ||
        shape.type === 'roomlamp' ||
        shape.type === 'streetlamp' ||
        shape.type === 'chandelier') && (
        <Field label={shape.type === 'blinder' ? 'Width (dots)' : 'Diameter (dots)'}>
          <NumberField
            value={
              shape.type === 'parlight'
                ? parDiameter(shape)
                : shape.type === 'patt'
                  ? pattDiameter(shape)
                  : shape.type === 'pixelpatt'
                    ? pixelPattDiameter(shape)
                    : shape.type === 'roomlamp'
                      ? roomLampDiameter(shape)
                      : shape.type === 'streetlamp'
                        ? streetLampDiameter(shape)
                        : shape.type === 'chandelier'
                          ? chandelierDiameter(shape)
                          : blinderWidth(shape)
            }
            min={6}
            max={2500}
            onChange={(v) => updateShape(shape.id, { diameter: v })}
          />
        </Field>
      )}

      {/* display mode */}
      {!open &&
        shape.type !== 'bulb' &&
        shape.type !== 'neon' &&
        shape.type !== 'stars' &&
        shape.type !== 'festoon' &&
        shape.type !== 'parlight' &&
        shape.type !== 'blinder' &&
        shape.type !== 'patt' &&
        shape.type !== 'pixelpatt' &&
        shape.type !== 'image' &&
        shape.type !== 'uplight' &&
        shape.type !== 'movinghead' &&
        shape.type !== 'roomlamp' &&
        shape.type !== 'streetlamp' &&
        shape.type !== 'chandelier' &&
        shape.type !== 'marquee' && (
        <Field label="Display">
          <div style={{ display: 'flex', gap: 6 }}>
            {DISPLAY_MODES.map((m) => (
              <button
                key={m}
                style={{ ...buttonStyle({ active: shape.display === m }), flex: 1, padding: '8px 0' }}
                onClick={() => updateShape(shape.id, { display: m })}
              >
                {m === 'stroke' ? 'Stroke' : m === 'fill' ? 'Fill' : 'Both'}
              </button>
            ))}
          </div>
        </Field>
      )}

      {shape.type !== 'bulb' &&
        shape.type !== 'neon' &&
        shape.type !== 'stars' &&
        shape.type !== 'festoon' &&
        shape.type !== 'parlight' &&
        shape.type !== 'blinder' &&
        shape.type !== 'patt' &&
        shape.type !== 'pixelpatt' &&
        shape.type !== 'marquee' && (
          <Field label="Width">
          <NumberField
            value={shape.strokeWidth}
            min={1}
            max={500}
            onChange={(v) => updateShape(shape.id, { strokeWidth: v })}
          />
        </Field>
      )}

      {/* repeat / array (neon, stars, festoon, blinder & pixelpatt ARE their own arrays) */}
      {shape.type !== 'neon' &&
        shape.type !== 'marquee' &&
        shape.type !== 'stars' &&
        shape.type !== 'festoon' &&
        shape.type !== 'blinder' &&
        shape.type !== 'pixelpatt' && (
        <div style={{ marginBottom: rowGap }}>
          <label style={fieldLabel}>Array{hasRepeat ? `  ×${shape.repeat!.count}` : ''}</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={fieldLabel}>Count</label>
              <NumberField
                value={shape.repeat?.count ?? 1}
                min={1}
                max={4096}
                onChange={(v) => setRepeat({ count: v })}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={fieldLabel}>Pitch X</label>
              <NumberField value={shape.repeat?.dx ?? 10} min={-2000} max={2000} onChange={(v) => setRepeat({ dx: v })} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={fieldLabel}>Pitch Y</label>
              <NumberField value={shape.repeat?.dy ?? 0} min={-2000} max={2000} onChange={(v) => setRepeat({ dy: v })} />
            </div>
          </div>
        </div>
      )}

      {/* 電飾のにじみ(グロー)上書き — 全体既定(Setup)に対して、この図形だけ変える */}
      {shape.type !== 'image' && shape.type !== 'uplight' && shape.type !== 'movinghead' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <Field
            label={shape.glowPx != null ? 'Glow px（この図形だけ）' : 'Glow px（全体に従う）'}
            flex={1}
          >
            <NumberField
              value={shape.glowPx ?? chart.settings.ledGlowPx ?? 0}
              min={0}
              max={50}
              onChange={(v) => updateShape(shape.id, { glowPx: Math.max(0, Math.min(50, v)) })}
            />
          </Field>
          {shape.glowPx != null && (
            <button
              style={{ ...buttonStyle({}), marginBottom: 12, whiteSpace: 'nowrap' }}
              title="この図形だけの指定をやめて、Setup の全体設定に戻す"
              onClick={() => updateShape(shape.id, { glowPx: undefined })}
            >
              全体に従う
            </button>
          )}
        </div>
      )}

      <div style={{ height: 1, background: C.border, margin: `${rowGap}px 0` }} />

      {/* DMX address */}
      <SectionTitle>Patch</SectionTitle>
      {shape.type === 'image' ? (
        <div style={{ fontSize: 11, opacity: 0.6, marginTop: 8, lineHeight: 1.6 }}>
          写真は光りません — 「スポット」をパッチして当てると浮かびます
        </div>
      ) : !fixture ? (
        <button
          style={{ ...buttonStyle({}), width: '100%', marginTop: 8 }}
          onClick={() =>
            upsertFixture(
              shape.id,
              // stars = two plain dimmer channels (White / Blue);
              // blinder = 8 cells on ONE address by default (間隔3で8球バラバラ)
              shape.type === 'stars'
                ? { mode: 'dim', fixedColor: [255, 255, 255] }
                : shape.type === 'blinder'
                  ? { addressStep: 0 }
                  : {}
            )
          }
        >
          + Patch
        </button>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Field label="Universe" flex={1}>
              <NumberField
                value={fixture.universe + 1}
                min={1}
                max={32768}
                onChange={(v) => upsertFixture(shape.id, { universe: Math.max(0, v - 1) })}
              />
            </Field>
            <Field label="DMX Addr" flex={1}>
              <NumberField
                value={fixture.start}
                min={1}
                max={Math.max(1, 513 - channelCount(fixture.mode))}
                onChange={(v) =>
                  // 使用ch数ぶん512に収まる位置まで＝はみ出したchが黙って0扱いになるのを防ぐ
                  upsertFixture(shape.id, {
                    start: Math.min(v, Math.max(1, 513 - channelCount(fixture.mode)))
                  })
                }
              />
            </Field>
          </div>

          <Field label="Type">
            <select
              value={fixture.mode}
              style={{ ...inputStyle, fontFamily: F.ui }}
              onChange={(e) => upsertFixture(shape.id, { mode: e.target.value as ChannelMode })}
            >
              {modesForFamily(shape.family ?? familyOfType(shape.type), fixture.mode).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>

          {fixture.mode === 'dim' && (
            <Field label="Color">
              <input
                type="color"
                value={rgbToHex(fixture.fixedColor ?? [255, 255, 255])}
                style={{ width: '100%', height: 30, background: C.inputBg, border: `0.5px solid ${C.border}`, borderRadius: 4 }}
                onChange={(e) => upsertFixture(shape.id, { fixedColor: hexToRgb(e.target.value) })}
              />
            </Field>
          )}

          {(hasRepeat || repeatCount(shape) > 1) && (
            <Field
              label={
                shape.type === 'neon' || shape.type === 'marquee'
                  ? `Letter step ch (0=together / default ${channelCount(fixture.mode)})`
                  : shape.type === 'stars'
                    ? `White→Blue step ch (default ${channelCount(fixture.mode)})`
                    : shape.type === 'festoon' ||
                        shape.type === 'blinder' ||
                        shape.type === 'pixelpatt'
                      ? `Address step ch (0=together / ${channelCount(fixture.mode)}=separate)`
                      : `Offset (default ${channelCount(fixture.mode)})`
              }
            >
              <NumberField
                value={fixture.addressStep ?? channelCount(fixture.mode)}
                min={0}
                max={512}
                onChange={(v) => upsertFixture(shape.id, { addressStep: v })}
              />
            </Field>
          )}

          <div
            style={{
              fontFamily: F.mono,
              fontSize: 12,
              color: C.accent,
              marginTop: 4,
              letterSpacing: '0.04em'
            }}
          >
            {(() => {
              if (shape.type === 'stars') {
                const blue = addressAt(
                  fixture.universe,
                  fixture.start,
                  fixture.mode,
                  fixture.addressStep,
                  1
                )
                return `White ${formatDmx(fixture.universe, fixture.start)} · Blue ${formatDmx(blue.universe, blue.start)}`
              }
              const reps = repeatCount(shape)
              if (reps <= 1)
                return `${formatDmx(fixture.universe, fixture.start)} – ${formatDmx(fixture.universe, fixture.start + channelCount(fixture.mode) - 1)}`
              const last = addressAt(
                fixture.universe,
                fixture.start,
                fixture.mode,
                fixture.addressStep,
                reps - 1
              )
              return `${formatDmx(fixture.universe, fixture.start)} … ${formatDmx(last.universe, last.start)} ×${reps}`
            })()}
          </div>
        </>
      )}

      <div style={{ flex: 1 }} />
      <button
        style={{ ...buttonStyle({ active: !!shape.locked }), width: '100%', marginTop: rowGap }}
        onClick={() => setLocked([shape.id], !shape.locked)}
        title="ロック中は左クリックで掴めません。解除はロック品の上で右クリック→ロック解除、下のパッチチップ→このボタン、⌘L"
      >
        {shape.locked ? 'Unlock' : 'Lock'}
      </button>
      <button
        style={{
          ...buttonStyle({ accent: '#e0726a', accentRGB: '224,114,106' }),
          width: '100%',
          marginTop: 8
        }}
        onClick={() => removeShape(shape.id)}
      >
        Delete
      </button>
    </aside>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      style={{
        fontFamily: F.ui,
        fontSize: 13,
        fontWeight: 300,
        letterSpacing: '0.24em',
        textTransform: 'uppercase',
        color: C.label,
        marginTop: 2,
        marginBottom: 9
      }}
    >
      {children}
    </div>
  )
}

function Field({
  label,
  children,
  flex
}: {
  label: string
  children: React.ReactNode
  /** Only set inside horizontal (display:flex) rows so paired fields split evenly.
   *  Standalone fields leave this unset so they don't stretch in the column aside. */
  flex?: number
}): React.JSX.Element {
  return (
    <div style={{ marginBottom: rowGap, flex }}>
      <label style={fieldLabel}>{label}</label>
      {children}
    </div>
  )
}

const asideStyle: React.CSSProperties = {
  width: '100%',
  flex: 1,
  minHeight: 0,
  background: C.panel,
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  overflowY: 'auto',
  boxSizing: 'border-box'
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const h = (n: number): string => n.toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
