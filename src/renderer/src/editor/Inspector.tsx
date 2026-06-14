import { useStore } from '../state/store'
import type { BulbStyle, ChannelMode, DisplayMode, Shape } from '../model/types'
import { C, F, buttonStyle, inputStyle, fieldLabel } from '../ui/tokens'
import { channelCount } from '../dmx/channel-math'
import { addressAt, formatDmx, repeatCount } from '../dmx/address'
import { NumberField } from '../ui/NumberField'
import { shapeBounds, bulbDiameter } from './geometry'
import { BULB_DEFAULT_STYLE } from '../render/bulb'
import { NEON_FONTS, neonFont, neonSize, neonGlowAmount, neonCharCount } from '../render/neon'
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

/** Human-readable size of a shape: spans, dot counts, lengths — diagonals included. */
function sizeText(shape: Shape): string {
  const b = shapeBounds(shape)
  if (shape.type === 'bulb') {
    return `Φ ${bulbDiameter(shape)} px`
  }
  if (shape.type === 'neon') {
    return `W ${Math.round(b.w)} × H ${Math.round(b.h)} px · ${neonCharCount(shape.text ?? '')} 管`
  }
  if (shape.type === 'stars') {
    const f = genStars(shape)
    return `W ${Math.round(b.w)} × H ${Math.round(b.h)} px · 白${f.white.length}+青${f.blue.length} 粒`
  }
  if (shape.type === 'festoon') {
    return `ワイヤー ${Math.round(festoonLength(shape))} px · ${festoonCount(shape)} 球`
  }
  if (shape.type === 'parlight') return `Φ ${parDiameter(shape)} px`
  if (shape.type === 'patt') return `Φ ${pattDiameter(shape)} px`
  if (shape.type === 'pixelpatt') return `Φ ${pixelPattDiameter(shape)} px · 7セル`
  if (shape.type === 'blinder') {
    const w = blinderWidth(shape)
    return `W ${w} × H ${w * 2} px · 8球`
  }
  if (shape.type === 'image') {
    return `W ${Math.round(b.w)} × H ${Math.round(b.h)} px · ${shape.imageData ? '写真あり' : '写真未設定'}`
  }
  if (shape.type === 'uplight') {
    return `出口 ${Math.round(shape.beamW0 ?? 14)} · 広がり ${Math.round(shape.beamW1 ?? 90)} · 届く高さ ${Math.round(shape.beamLen ?? 200)} px`
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
  { id: 'rgbw', label: 'RGBW (5ch)' },
  { id: 'beam6', label: 'Beam ムービング (6ch)' }
]

const rowGap = 14

export function Inspector(): React.JSX.Element {
  const chart = useStore((s) => s.chart)
  const selectedId = useStore((s) => s.selectedId)
  const selectedIds = useStore((s) => s.selectedIds)
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
      const common = <K extends 'universe' | 'start'>(k: K, fallback: number): number => {
        if (!fxs.length) return fallback
        return fxs[0][k]
      }
      return (
        <aside style={asideStyle}>
          <SectionTitle>Multi</SectionTitle>
          <div style={{ fontFamily: F.mono, fontSize: 11, color: C.hint, marginBottom: 4 }}>
            {ids.length} fixtures selected · patched {fxs.length}/{ids.length}
          </div>
          <div
            style={{ fontFamily: F.ui, fontSize: 11, color: C.faint, marginBottom: rowGap, lineHeight: 1.5 }}
          >
            ここでの変更は選択中の全部にまとめて効きます（未パッチの物には新しくパッチ）。1本に結合は ⌘G。
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Field label="Universe">
              <NumberField
                value={common('universe', 0)}
                min={0}
                max={32767}
                onChange={(v) => bulkPatch(ids, { universe: v })}
              />
            </Field>
            <Field label="DMX Addr">
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
              {CHANNEL_MODES.map((m) => (
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
            style={{ ...buttonStyle({}), width: '100%', marginTop: rowGap }}
            onClick={() => setLocked(ids, true)}
            title="まとめてロック（キャンバスから掴めなくする・⌘L）"
          >
            🔒 Lock {ids.length}
          </button>
          <button
            style={{
              ...buttonStyle({ accent: '#e0726a', accentRGB: '224,114,106' }),
              width: '100%',
              marginTop: 8
            }}
            onClick={() => removeShapes(ids)}
          >
            Delete {ids.length}
          </button>
        </aside>
      )
    }
    return (
      <aside style={asideStyle}>
        <SectionTitle>Fixture</SectionTitle>
        <div style={{ color: C.faint, fontSize: 12, fontFamily: F.ui, marginTop: 8 }}>
          Select a fixture to edit its shape and DMX patch.
        </div>
      </aside>
    )
  }

  const hasRepeat = (shape.repeat?.count ?? 1) > 1
  const setRepeat = (patch: Partial<{ count: number; dx: number; dy: number }>): void => {
    const cur = shape.repeat ?? { count: 1, dx: 10, dy: 0 }
    const next = { ...cur, ...patch }
    updateShape(shape.id, {
      repeat: next.count > 1 ? { count: next.count, dx: next.dx, dy: next.dy } : undefined
    })
  }

  return (
    <aside style={asideStyle}>
      <SectionTitle>Fixture</SectionTitle>
      <div style={{ fontFamily: F.mono, fontSize: 11, color: C.hint, marginBottom: 6 }}>
        {shape.type === 'blinder' ? '8灯ミニブル' : shape.type.toUpperCase()} ·{' '}
        {shape.id.slice(-6)}
      </div>
      <div style={{ fontFamily: F.mono, fontSize: 12, color: C.accent, marginBottom: rowGap }}>
        {sizeText(shape)}
      </div>

      {/* bulb: glass size + texture (colour & gauge come from the console) */}
      {shape.type === 'bulb' && (
        <>
          <Field label="径（ドット）">
            <NumberField
              value={bulbDiameter(shape)}
              min={1}
              max={200}
              step={0.5}
              onChange={(v) => updateShape(shape.id, { diameter: v })}
            />
          </Field>
          <Field label="質感">
            <div style={{ display: 'flex', gap: 6 }}>
              {(
                [
                  { id: 'clear', label: 'クリア' },
                  { id: 'frost', label: 'フロスト' }
                ] as { id: BulbStyle; label: string }[]
              ).map((m) => (
                <button
                  key={m.id}
                  style={{
                    ...buttonStyle({ active: (shape.bulbStyle ?? BULB_DEFAULT_STYLE) === m.id }),
                    flex: 1,
                    padding: '6px 0'
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
          <Field label="テキスト（1行）">
            <input
              value={shape.text ?? ''}
              placeholder="OPEN"
              style={{ ...inputStyle, fontFamily: F.ui, width: '100%', boxSizing: 'border-box' }}
              onChange={(e) => updateShape(shape.id, { text: e.target.value })}
            />
          </Field>
          <Field label="書体">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {NEON_FONTS.map((f) => {
                const active = neonFont(shape).id === f.id
                return (
                  <button
                    key={f.id}
                    style={{
                      ...buttonStyle({ active }),
                      padding: '6px 4px 4px',
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
            <Field label="文字サイズ (px)">
              <NumberField
                value={neonSize(shape)}
                min={6}
                max={500}
                onChange={(v) => updateShape(shape.id, { fontSize: v })}
              />
            </Field>
            <Field label="グロウ (%)">
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

      {/* stars: density / white-blue mix / dot size / reshuffle (colour & gauge come
          from two desk channels — instance 0 = white sky, instance 1 = blue sky) */}
      {shape.type === 'stars' && (
        <>
          <Field label="密度（スライダー：右でワサワサ・左でまばら）">
            <NumberField
              value={starsDensity(shape)}
              min={0}
              max={100}
              onChange={(v) => updateShape(shape.id, { starDensity: v })}
            />
          </Field>
          <div style={{ display: 'flex', gap: 8 }}>
            <Field label="白の割合 (%)">
              <NumberField
                value={starsWhiteRatio(shape)}
                min={0}
                max={100}
                onChange={(v) => updateShape(shape.id, { starWhiteRatio: v })}
              />
            </Field>
            <Field label="粒の大きさ (px)">
              <NumberField
                value={starsSize(shape)}
                min={0.5}
                max={30}
                step={0.5}
                onChange={(v) => updateShape(shape.id, { starSize: v })}
              />
            </Field>
          </div>
          <Field label="配置">
            <button
              style={{ ...buttonStyle({}), width: '100%' }}
              onClick={() =>
                updateShape(shape.id, { starSeed: (Math.random() * 0xffffffff) >>> 0 })
              }
            >
              シャッフル（散り方を変える）
            </button>
          </Field>
        </>
      )}

      {/* festoon: sag / pitch / glass size / glow / texture (colour & gauge come from
          the console — one address per bulb, like the ball bulb) */}
      {shape.type === 'festoon' && (
        <>
          <Field label="たわみ（張った長さの %）">
            <NumberField
              value={festoonSag(shape)}
              min={0}
              max={60}
              onChange={(v) => updateShape(shape.id, { sagPct: v })}
            />
          </Field>
          <div style={{ display: 'flex', gap: 8 }}>
            <Field label="球の間隔 (px)">
              <NumberField
                value={festoonPitch(shape)}
                min={4}
                max={500}
                onChange={(v) => updateShape(shape.id, { bulbPitch: v })}
              />
            </Field>
            <Field label="径（ドット）">
              <NumberField
                value={festoonDiameter(shape)}
                min={1}
                max={50}
                step={0.5}
                onChange={(v) => updateShape(shape.id, { diameter: v })}
              />
            </Field>
          </div>
          <Field label="グロウ (%)">
            <NumberField
              value={shape.neonGlow ?? FESTOON_DEFAULT_GLOW}
              min={0}
              max={100}
              onChange={(v) => updateShape(shape.id, { neonGlow: v })}
            />
          </Field>
          <Field label="質感">
            <div style={{ display: 'flex', gap: 6 }}>
              {(
                [
                  { id: 'clear', label: 'クリア' },
                  { id: 'frost', label: 'フロスト' }
                ] as { id: BulbStyle; label: string }[]
              ).map((m) => (
                <button
                  key={m.id}
                  style={{
                    ...buttonStyle({ active: (shape.bulbStyle ?? BULB_DEFAULT_STYLE) === m.id }),
                    flex: 1,
                    padding: '6px 0'
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
        <Field label="写真素材">
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
            {shape.imageData ? '写真を差し替える…' : '写真を選ぶ…（PNG/JPG）'}
          </button>
        </Field>
      )}

      {/* uplight: rigging values — the desk steers colour/gauge (+Pan/Tilt/Zoom in 6ch) */}
      {shape.type === 'uplight' && (
        <>
          <div style={{ display: 'flex', gap: 8 }}>
            <Field label="出口の幅 (px)">
              <NumberField
                value={shape.beamW0 ?? 14}
                min={2}
                max={300}
                onChange={(v) => updateShape(shape.id, { beamW0: v })}
              />
            </Field>
            <Field label="広がり (px)">
              <NumberField
                value={shape.beamW1 ?? 90}
                min={4}
                max={1200}
                onChange={(v) => updateShape(shape.id, { beamW1: v })}
              />
            </Field>
          </div>
          <Field label="届く高さ (px)">
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
        shape.type === 'blinder') && (
        <Field label={shape.type === 'blinder' ? '幅（ドット）· 高さは自動で2倍' : '径（ドット）'}>
          <NumberField
            value={
              shape.type === 'parlight'
                ? parDiameter(shape)
                : shape.type === 'patt'
                  ? pattDiameter(shape)
                  : shape.type === 'pixelpatt'
                    ? pixelPattDiameter(shape)
                    : blinderWidth(shape)
            }
            min={6}
            max={800}
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
        shape.type !== 'uplight' && (
        <Field label="Display">
          <div style={{ display: 'flex', gap: 6 }}>
            {DISPLAY_MODES.map((m) => (
              <button
                key={m}
                style={{ ...buttonStyle({ active: shape.display === m }), flex: 1, padding: '6px 0' }}
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
        shape.type !== 'pixelpatt' && (
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
              <NumberField value={shape.repeat?.dx ?? 10} onChange={(v) => setRepeat({ dx: v })} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={fieldLabel}>Pitch Y</label>
              <NumberField value={shape.repeat?.dy ?? 0} onChange={(v) => setRepeat({ dy: v })} />
            </div>
          </div>
        </div>
      )}

      <div style={{ height: 1, background: C.border, margin: `${rowGap}px 0` }} />

      {/* DMX address */}
      <SectionTitle>Patch</SectionTitle>
      {shape.type === 'image' ? (
        <div style={{ fontSize: 11, opacity: 0.6, marginTop: 8, lineHeight: 1.6 }}>
          写真は光りません — 「照らし」をパッチして当てると浮かびます
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
            <Field label="Universe">
              <NumberField
                value={fixture.universe}
                min={0}
                max={32767}
                onChange={(v) => upsertFixture(shape.id, { universe: v })}
              />
            </Field>
            <Field label="DMX Addr">
              <NumberField
                value={fixture.start}
                min={1}
                max={512}
                onChange={(v) => upsertFixture(shape.id, { start: v })}
              />
            </Field>
          </div>

          <Field label="Type">
            <select
              value={fixture.mode}
              style={{ ...inputStyle, fontFamily: F.ui }}
              onChange={(e) => upsertFixture(shape.id, { mode: e.target.value as ChannelMode })}
            >
              {CHANNEL_MODES.map((m) => (
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
                shape.type === 'neon'
                  ? `文字間隔 ch（0=一斉 / 既定 ${channelCount(fixture.mode)}）`
                  : shape.type === 'stars'
                    ? `白→青 間隔 ch（既定 ${channelCount(fixture.mode)}）`
                    : shape.type === 'festoon' ||
                        shape.type === 'blinder' ||
                        shape.type === 'pixelpatt'
                      ? `番地間隔 ch（0=一斉 / ${channelCount(fixture.mode)}でバラバラ）`
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
        {shape.locked ? 'ロック解除' : 'ロック（キャンバスから掴めなくする）'}
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
        fontFamily: F.display,
        fontSize: 15,
        letterSpacing: '0.1em',
        color: C.white,
        marginBottom: 6
      }}
    >
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ marginBottom: rowGap, flex: 1 }}>
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
