import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ImageLightEngine, LW, LH, IW, IH, MAX_BEAMS, type FxKey } from './engine'
import { COLORS, hexToRgb, rgbToHex, sameRgb, type RGB3 } from './colors'
import { FX_BUTTONS, FX_LABEL, FX_PARAMS } from './fxdefs'
import { DECOR_NONDIR } from './decor-pattern'
import type { DecorPatternKind, DecorEffect, DecorDirection } from './decor-pattern'
import { fileToDataUrl } from '../io/image-pick'
import { useStore } from '../state/store'

interface DecorApi {
  publishFrame?: (width: number, height: number, buffer: Uint8ClampedArray) => void
  getStatus?: () => Promise<{
    hasClients: boolean
    syphonAvailable: boolean
    platform: string
    midiIn?: number
  }>
  reportMidiInputs?: (names: string[]) => void
  saveImageLightShow?: (
    json: string,
    media: { file: string; dataUrl: string }[],
    name: string
  ) => Promise<string | null>
  openImageLightShow?: () => Promise<
    { json: string; media: Record<string, string> } | { error: string } | null
  >
  autosaveImageLightWrite?: (
    json: string,
    media: { file: string; dataUrl: string }[]
  ) => Promise<boolean>
  autosaveImageLightRead?: () => Promise<{ json: string; media: Record<string, string> } | null>
  onMidiMessage?: (cb: (msg: [number, number, number]) => void) => void
}
const getApi = (): DecorApi | undefined => (window as unknown as { api?: DecorApi }).api

// ショートカットは「物理キー(e.code)」基準＝IME(日本語入力)や配列に左右されず、A〜Z・記号・
// スペース等どのキーでも割り当て・呼び出しできる。修飾キー単体（Shift等）は無視する。
const MOD_CODE = /^(Shift|Control|Alt|Meta|OS|Fn)/
const shortcutCode = (e: KeyboardEvent): string | null => {
  const c = e.code
  return !c || MOD_CODE.test(c) ? null : c
}
/** 物理キーコードをバッジ用の短いラベルへ（KeyA→A／Digit1→1／矢印→↑ 等）。 */
const codeLabel = (code: string | null): string => {
  if (!code) return ''
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Numpad')) return '№' + code.slice(6)
  const m: Record<string, string> = {
    Space: '␣',
    Enter: '⏎',
    Tab: '⇥',
    Comma: ',',
    Period: '.',
    Slash: '/',
    Semicolon: ';',
    Quote: "'",
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Minus: '-',
    Equal: '=',
    Backquote: '`',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→'
  }
  return m[code] ?? code
}

/** 電飾エフェクト一覧（流れ方）。[キー, 略号, 和名, 一言]。方向(順/逆/往復/中央)は別軸。 */
const DECOR_FX: [DecorEffect, string, string, string][] = [
  ['chase', 'CHASE', 'チェイス', '1本ずつ流れる'],
  ['theater', 'THEATER', 'とびとび', 'N本おきに走る'],
  ['comet', 'COMET', 'コメット', '頭が明るく尾を引く'],
  ['meteor', 'METEOR', '流星', '一筋スッと流れる'],
  ['wave', 'WAVE', 'ウェーブ', '明暗の波がうねる'],
  ['fill', 'FILL', 'フィル', '端から塗り潰す'],
  ['rainbow', 'RAINBOW', 'レインボー', '虹色が流れる'],
  ['grad', 'GRAD', '2色グラデ', '色1↔色2が流れる'],
  ['sparkle', 'SPARKLE', 'きらめき', 'ランダムに瞬く'],
  ['twinkle', 'TWINKLE', 'ちらちら', 'やわらかく瞬く'],
  ['strobe', 'STROBE', 'ストロボ', '全体が高速点滅'],
  ['alt', 'ALT', '交互点滅', '2組が交互に点く'],
  ['pulse', 'PULSE', '同時点滅', '全体が呼吸']
]
const DECOR_DIRS: [DecorDirection, string][] = [
  ['fwd', 'FWD'],
  ['rev', 'REV'],
  ['ping', 'BOUNCE'],
  ['center', 'CENTER']
]

/** 画像照明モード本体。自前のエンジン（モック移植）を駆動し、frame を Syphon へ流しつつ
 *  画面に表示する。PLAY=本番（叩くだけ）／BUILD=明かり作り。 */
export function ImageLightingMode({ onExit }: { onExit: () => void }): React.JSX.Element {
  // エンジンはマウント中で1個だけ（useStateの遅延初期化で生成）
  const [engine] = useState(() => new ImageLightEngine())
  // エンジン状態の変化で再描画
  const engineVersion = useSyncExternalStore(engine.subscribe, engine.getVersion, engine.getVersion)
  const autoRestoredRef = useRef(false) // 起動時の自動復元が済むまで自動保存しない（空で上書き防止）
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 🔴 最重要データ事故ガード: このセッションでユーザーが実際に触る(クリック/キー)まで
  // 自動保存しない。起動時に何が自動で現れても(default灯体/シーン復元/race)、触ってなければ
  // 前回データ(il-autosave)を絶対に潰さない。触った瞬間から今のセッションを保存する。
  const userTouchedRef = useRef(false)
  useEffect(() => {
    const mark = (): void => {
      userTouchedRef.current = true
    }
    window.addEventListener('pointerdown', mark, true)
    window.addEventListener('keydown', mark, true)
    return () => {
      window.removeEventListener('pointerdown', mark, true)
      window.removeEventListener('keydown', mark, true)
    }
  }, [])

  // シーン名のインライン編集（null=非編集中）
  const [editingNameIdx, setEditingNameIdx] = useState<number | null>(null)
  const [editingNameValue, setEditingNameValue] = useState<string>('')
  // 本番PLAYは廃止し編集に統合＝常に編集モード（モード切替なし）。
  const [uiMode, setUiMode] = useState<'play' | 'build'>('build')
  const uiModeRef = useRef(uiMode)
  useEffect(() => {
    uiModeRef.current = uiMode
    forceRenderRef.current = true // モード切替でマーカー表示が変わる→1回描き直す
  }, [uiMode])

  // 検出した MIDI 入力名をメイン（下部バーの「MIDI IN」表示）へ通知する配線だけ用意。
  // ※ initMidi() は起動時には呼ばない。Electron の requestMIDIAccess はユーザー操作(クリック)
  //   起点でないと解決しないため、LEARN(◎)クリック時に初めて初期化する（engine 側で実行）。
  useEffect(() => {
    engine.onMidiInputs = (names) => getApi()?.reportMidiInputs?.(names)
    // CoreMIDI(ネイティブ)から届く MIDI を engine の共通処理へ。LEARN も発火もこれで動く。
    getApi()?.onMidiMessage?.((msg) => engine.handleMidiMessage(msg[0], msg[1], msg[2]))
  }, [engine])

  // 起動時は前回データを自動で開かない＝普通のアプリと同じ「開いたら真っ白」
  //（SHOW MODE と同じ作法・のむさん確定）。前回分は userData/il-autosave に残る＝消さない
  // （下の自動保存は“中身が空のうちは書かない”ので、触らなければ前回データは潰れない）。
  // 復帰したい時は上部バーの「前回を開く」から。
  useEffect(() => {
    autoRestoredRef.current = true
  }, [])

  // 変更があるたびに全状態を userData へ自動保存（復元完了後・1.2秒デバウンス）。
  // これで再起動・クラッシュしても、シーン/配置/明かり/設定が丸ごと残る。
  useEffect(() => {
    if (!autoRestoredRef.current) return
    const api = getApi()
    if (!api?.autosaveImageLightWrite) return
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(async () => {
      try {
        // 🔴 最重要: このセッションでユーザーが触るまでは絶対に書かない（起動時の自動現出/
        // race でも前回データを潰さない）。
        if (!userTouchedRef.current) return
        // さらに“本物の中身”がある時だけ書く（デフォルト灯体だけの状態では書かない）。
        if (!engine.hasSaveableContent()) return
        const { json, media } = await engine.serializeShow()
        await api.autosaveImageLightWrite!(json, media)
      } catch {
        /* 失敗は無視（次の変更で再試行） */
      }
    }, 1200)
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    }
  }, [engineVersion, engine])

  const displayRef = useRef<HTMLCanvasElement>(null)
  const viewRef = useRef({ scale: 1, dpr: 1, ox: 0, oy: 0 })
  const draggingRef = useRef(false)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null) // ドラッグ開始時のポインタ（吸着の基準）
  const rubberRef = useRef<{ x0: number; y0: number; x1: number; y1: number; add: boolean } | null>(
    null
  )
  const fileInputRef = useRef<HTMLInputElement>(null)
  const maskInputRef = useRef<HTMLInputElement>(null)
  const imageMotifInputRef = useRef<HTMLInputElement>(null)
  const colorPickRef = useRef<HTMLInputElement>(null)
  // 写真の 4 辺スケールワープ — どの辺をつかんでいるか + 開始位置 + ドラッグ開始時の box
  const warpDragRef = useRef<{
    edge: 'top' | 'bottom' | 'left' | 'right'
    start: { x: number; y: number }
    initBox: { x: number; y: number; w: number; h: number }
  } | null>(null)
  // ピース作成中のドラッグ矩形（LW×LH 座標系）
  const pieceCreateRef = useRef<{
    start: { x: number; y: number }
    end: { x: number; y: number }
  } | null>(null)
  // 既存ピースの編集ドラッグ — 隅(corner)を引っ張る or 中央(body)で平行移動
  type CornerIdx = 0 | 1 | 2 | 3
  const pieceDragRef = useRef<
    | {
        mode: 'corner'
        pieceId: string
        cornerIdx: CornerIdx
        start: { x: number; y: number }
        initCorner: { x: number; y: number }
      }
    | {
        mode: 'body'
        pieceId: string
        start: { x: number; y: number }
        initCorners: [
          { x: number; y: number },
          { x: number; y: number },
          { x: number; y: number },
          { x: number; y: number }
        ]
      }
    | null
  >(null)
  // 静止画は描き直さない（カクつき防止）ためのフラグ: 最後に描いたversion＋強制描画フラグ
  const lastVRef = useRef(-1)
  const forceRenderRef = useRef(true)
  const [renaming, setRenaming] = useState<{ i: number; value: string } | null>(null)

  // ---- 表示キャンバスのサイズ追従
  useEffect(() => {
    const cv = displayRef.current
    if (!cv) return
    const fit = (): void => {
      const r = cv.parentElement!.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      cv.width = Math.max(1, Math.round(r.width * dpr))
      cv.height = Math.max(1, Math.round(r.height * dpr))
      const scale = Math.min(cv.width / LW, cv.height / LH)
      viewRef.current = {
        scale,
        dpr,
        ox: (cv.width - LW * scale) / 2,
        oy: (cv.height - LH * scale) / 2
      }
      forceRenderRef.current = true // サイズが変わったら1回描き直す
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(cv.parentElement!)
    return () => ro.disconnect()
  }, [])

  // ---- Syphon クライアント有無を1秒ごとに確認。フェイルオープン＝迷ったら「送る」。
  //  ネイティブのリークは根本修正済みなので、未接続時に送信を省くのは「無駄なIPC削減」
  //  だけが目的。取得失敗・getStatus 不在・状態不明のときは必ず送る側に倒す＝本番で
  //  Resolume への出力が黙って止まる事故を防ぐ（Resolume が来ていない確証があるときだけ省く）。
  const syphonReadyRef = useRef(true)
  // ヘッダの生存ランプ用：MIDI入力が来ているか・出力(Resolume等)が受け取っているか。
  const [live, setLive] = useState<{ midiIn: boolean; out: boolean }>({ midiIn: false, out: false })
  const [showKeys, setShowKeys] = useState(false) // 操作キー一覧オーバーレイ
  const [presetOpen, setPresetOpen] = useState(false) // 設定コンソールの「設定（解像度/落ち込み）」を開くか
  const showKeysRef = useRef(showKeys)
  useEffect(() => {
    showKeysRef.current = showKeys
  }, [showKeys])
  const [hudTab, setHudTab] = useState<'cue' | 'light' | 'decor' | 'setup' | 'sfx'>('cue') // 編集モード右パネルのタブ
  // 特効(SFX)タブ。設定値は engine が唯一の正＝スライダーは engine を直接読み書きする
  //（ローカルmirror state を持たない＝保存復元・MIDIでズレない）。UIだけの状態は下記2つ。
  const [sfxType, setSfxType] = useState<'flame' | 'sparkler' | 'rain' | 'smoke'>('flame')
  const [showAdv, setShowAdv] = useState(false) // 「詳しく」（細かい設定）の開閉
  const hudTabRef = useRef(hudTab)
  useEffect(() => {
    hudTabRef.current = hudTab
    forceRenderRef.current = true // タブ切替で特効マーカー表示が変わる→1回描き直す
  }, [hudTab])
  useEffect(() => {
    const api = getApi()
    if (!api?.getStatus) return // getStatus が無くてもデフォルト true のまま＝送る
    const poll = async (): Promise<void> => {
      try {
        const s = await api.getStatus!()
        // Syphon が動いていてクライアント未接続のときだけ送信を省く。それ以外は送る。
        syphonReadyRef.current = s.syphonAvailable ? s.hasClients : true
        setLive({ midiIn: (s.midiIn ?? 0) > 0, out: !!s.syphonAvailable && !!s.hasClients })
      } catch {
        syphonReadyRef.current = true // 取得失敗 → 送る側に倒す
      }
    }
    poll()
    const iv = setInterval(poll, 1000)
    return () => clearInterval(iv)
  }, [])

  // ---- 30fps: 描画 → Syphon publish → 画面へ転写（＋BUILDだけマーカー）
  useEffect(() => {
    const cv = displayRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')!
    const api = getApi()
    let raf = 0
    let lastPublish = 0
    let lastRender = 0
    // 出力(Syphon/NDI)の重い読み出し(getImageData)は、連続アニメ中は最大このfpsに間引く。
    const PUBLISH_MIN_MS = 1000 / 30
    // 描画(renderFrame)もアニメ中は上限fpsに間引く。灯体ごとの重い処理を半分にしてカクつき防止。
    // 出力は元々30fpsなので体感は変わらず、操作プレビューだけ60→30になるが十分滑らか。
    const RENDER_MIN_MS = 1000 / 30
    const tick = (now: number): void => {
      raf = requestAnimationFrame(tick)
      // 静止画は描き直さない＝無駄処理を省く。FX/動画/フェード中、ラバーバンド中、状態変化、
      // または強制フラグ（初回・リサイズ・モード切替）の時だけ描く。
      const v = engine.getVersion()
      const animating =
        engine.isAnimating() ||
        rubberRef.current != null ||
        pieceCreateRef.current != null
      if (!animating && v === lastVRef.current && !forceRenderRef.current) return
      // 連続アニメ中は描画を上限fpsに間引く（単発変更・強制描画は即・出力は元々30fps）。
      if (animating && !forceRenderRef.current && now - lastRender < RENDER_MIN_MS) return
      lastRender = now
      forceRenderRef.current = false
      lastVRef.current = v
      engine.renderFrame(now)
      // まず画面へ（軽い・毎フレーム）。重い出力読み出しは後で間引いて行う。
      const { scale, ox, oy } = viewRef.current
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, cv.width, cv.height)
      ctx.setTransform(scale / (IW / LW), 0, 0, scale / (IH / LH), ox, oy)
      ctx.drawImage(engine.frame, 0, 0)
      if (uiModeRef.current === 'build') {
        // マスクのアルファ境界線を細い線で重ねる（BUILD のときだけ表示）。
        // 写真の box に contain fit するので、写真とマスクが同じ位置・同じ大きさで重なる。
        const mb = engine.getMaskDisplayBox()
        if (engine.maskEdgeCanvas && mb) {
          ctx.drawImage(
            engine.maskEdgeCanvas,
            0,
            0,
            engine.maskEdgeCanvas.width,
            engine.maskEdgeCanvas.height,
            mb.x,
            mb.y,
            mb.w,
            mb.h
          )
        }
        drawMarkers(ctx, engine, scale) // この後 transform は (scale, ox, oy) のまま
        drawWarpHandles(ctx, engine, scale, warpDragRef.current?.edge ?? null)
        drawPieceOverlays(ctx, engine, scale)
        drawPieceCreating(ctx, pieceCreateRef.current, scale)
        const rb = rubberRef.current
        if (rb) {
          const x = Math.min(rb.x0, rb.x1)
          const y = Math.min(rb.y0, rb.y1)
          ctx.strokeStyle = 'rgba(120,255,160,0.9)'
          ctx.lineWidth = 1.5 / scale
          ctx.setLineDash([6 / scale, 4 / scale])
          ctx.strokeRect(x, y, Math.abs(rb.x1 - rb.x0), Math.abs(rb.y1 - rb.y0))
          ctx.setLineDash([])
          ctx.fillStyle = 'rgba(120,255,160,0.10)'
          ctx.fillRect(x, y, Math.abs(rb.x1 - rb.x0), Math.abs(rb.y1 - rb.y0))
        }
        drawSnapGuides(ctx, engine, scale)
      }
      // 出力(Syphon/NDI)の重い読み出しは、連続アニメ中は最大30fpsに間引く（単発変更は即送る）。
      // フェイルオープン：未接続が確証できる時だけ省く。
      if (syphonReadyRef.current && api?.publishFrame) {
        if (!animating || now - lastPublish >= PUBLISH_MIN_MS) {
          lastPublish = now
          api.publishFrame(engine.outW, engine.outH, engine.readOutputRGBA())
        }
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [engine])

  // ---- デモ画像は入れない（空で始める）。素材はのむさんがドロップ／＋から読み込む
  useEffect(() => {
    if (import.meta.env.DEV)
      (window as unknown as { __ilEngine?: ImageLightEngine }).__ilEngine = engine
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- 後始末: 閉じる前に保存＋動画の解放
  useEffect(
    () => () => {
      engine.flushSave()
      engine.disposeMedia()
    },
    [engine]
  )

  // ---- ⌘Z/⌘C/⌘V をエンジンの Undo/Redo/Copy/Paste へ橋渡し（App のメニューから呼ばれる）
  useEffect(() => {
    useStore.getState().setImageLightHandlers({
      undo: () => engine.undo(),
      redo: () => engine.redo(),
      copy: () => engine.copyBeam(),
      paste: () => engine.pasteBeam()
    })
    return () => useStore.getState().setImageLightHandlers(null)
  }, [engine])

  // ---- 各FXツマミに「MIDI CC(0..1) → 実値」の反映関数を登録（物理つまみで動かせるように）
  useEffect(() => {
    const map = new Map<string, (v01: number) => void>()
    ;(Object.keys(FX_PARAMS) as FxKey[]).forEach((key) => {
      FX_PARAMS[key].forEach((def, idx) => {
        map.set(key + '.' + idx, (v01) =>
          def.set(engine, Math.round(def.min + (def.max - def.min) * v01))
        )
      })
    })
    // 選択灯体の PAN/TILT/ZOOM・寸法も物理つまみ(MIDI CC)で動かせるよう登録
    map.set('pose.pan', (v01) => engine.setPan(Math.round(-90 + 180 * v01)))
    map.set('pose.tilt', (v01) => engine.setTilt(Math.round(-180 + 360 * v01)))
    map.set('pose.zoom', (v01) => engine.setZoom((15 + (400 - 15) * v01) / 100))
    map.set('rig.w0', (v01) => engine.setRig('w0', Math.round(8 + (180 - 8) * v01)))
    map.set('rig.w1', (v01) => engine.setRig('w1', Math.round(20 + (700 - 20) * v01)))
    map.set('rig.len', (v01) => engine.setRig('len', Math.round(80 + (1000 - 80) * v01)))
    // 特効(SFX)の全ツマミも MIDI で動かせるよう登録（◎で Learn して物理つまみ/フェーダーに割当）
    for (const grp of Object.values(SFX_PARAMS)) {
      for (const p of [...grp.core, ...grp.more]) {
        map.set(p.id, (v01) => p.set(engine, p.min + (p.max - p.min) * v01))
      }
    }
    engine.setParamApply(map)
  }, [engine])

  // ---- キーボード（本番キー＋シーンのショートカット）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      // 操作キー一覧を開いている間は本番操作にキーを流さない（Esc/?で閉じるだけ）。
      if (showKeysRef.current) {
        if (e.key === 'Escape' || e.key === '?') {
          setShowKeys(false)
          e.preventDefault()
        }
        return
      }
      if (engine.learnPattern != null) {
        if (e.key === 'Escape') {
          engine.setLearnPattern(null)
          e.preventDefault()
          return
        }
        const lc = shortcutCode(e)
        if (!lc) return // 修飾キー単体は無視して待ち続ける
        engine.assignShortcut(engine.learnPattern, lc, null) // どのキーでもOK（物理キー基準）
        e.preventDefault()
        return
      }
      // シーン LEARN 待機中：Esc で中止だけ受ける（割当は MIDI 入力のみ）
      if (engine.learnScene != null) {
        if (e.key === 'Escape') {
          engine.setLearnScene(null)
          e.preventDefault()
        }
        return
      }
      // 特別ストロボ LEARN 待機中：Esc で中止（割当は MIDI ノートのみ）。
      if (engine.learnStrobe) {
        if (e.key === 'Escape') {
          engine.setLearnStrobe(false)
          e.preventDefault()
        }
        return
      }
      // FX LEARN 待機中：Esc で中止、それ以外のキーでそのFXに割当
      if (engine.learnFx != null) {
        if (e.key === 'Escape') {
          engine.setLearnFx(null)
          e.preventDefault()
          return
        }
        const lc = shortcutCode(e)
        if (!lc) return // 修飾キー単体は無視
        engine.assignFxShortcut(engine.learnFx, lc, null)
        e.preventDefault()
        return
      }
      if (e.key === '?') {
        setShowKeys(true)
        e.preventDefault()
        return
      }
      const code = shortcutCode(e)
      // BUILD: ピース選択中の Delete はピース削除（灯体より優先）
      if (
        (e.code === 'Delete' || e.code === 'Backspace') &&
        uiModeRef.current === 'build' &&
        engine.selectedPieceId
      ) {
        engine.removeSelectedPiece()
        e.preventDefault()
        return
      }
      // BUILD: ピース作成モード中は Escape で抜けられる
      if (e.key === 'Escape' && engine.pieceCreating) {
        engine.setPieceCreating(false)
        e.preventDefault()
        return
      }
      // BUILD: Delete / Backspace で選択中の灯体を削除（PLAY中・全選択(ALL)時は無効＝誤爆防止）
      if (
        (e.code === 'Delete' || e.code === 'Backspace') &&
        uiModeRef.current === 'build' &&
        engine.selected.length > 0 &&
        !engine.isAllSelected()
      ) {
        engine.removeSelected()
        e.preventDefault()
        return
      }
      // 入力欄で文字編集中は奪わない（名前入力など）。
      const tgt = e.target as HTMLElement | null
      const typing =
        !!tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)
      // BUILD: ⌘A / Ctrl+A で灯体を全選択
      if (!typing && uiModeRef.current === 'build' && (e.metaKey || e.ctrlKey) && e.code === 'KeyA') {
        engine.selectAll()
        e.preventDefault()
        return
      }
      // BUILD: 矢印キーで選択中の灯体を微調整（Shiftで大きく＝10px）。
      // PLAY では従来通り ↑↓=マスター明るさ / ←→=写真切替。
      if (
        !typing &&
        uiModeRef.current === 'build' &&
        (e.code === 'ArrowUp' ||
          e.code === 'ArrowDown' ||
          e.code === 'ArrowLeft' ||
          e.code === 'ArrowRight')
      ) {
        const step = e.shiftKey ? 10 : 1
        const dx = e.code === 'ArrowLeft' ? -step : e.code === 'ArrowRight' ? step : 0
        const dy = e.code === 'ArrowUp' ? -step : e.code === 'ArrowDown' ? step : 0
        engine.moveSelectedBy(dx, dy)
        e.preventDefault()
        return
      }
      const pi = code ? engine.patterns.findIndex((p) => p && p.key === code) : -1
      if (pi >= 0) {
        engine.applyPattern(pi)
        e.preventDefault()
        return
      }
      // 割り当て済みのキーで FX を ON/OFF
      const fk = code
        ? (Object.keys(engine.fxKey) as FxKey[]).find((k) => engine.fxKey[k] === code)
        : undefined
      if (fk) {
        engine.fxToggle(fk)
        e.preventDefault()
        return
      }
      // 割り当て済みのキーでプリセット色を適用
      const ck = code ? Object.keys(engine.colorKey).find((h) => engine.colorKey[h] === code) : undefined
      if (ck) {
        engine.setColor(hexToRgb(ck))
        e.preventDefault()
        return
      }
      if (e.key === 'Escape') engine.panicFade()
      else if (e.code === 'Digit0' || e.code === 'Numpad0') engine.blackout()
      else if (e.code === 'KeyF') engine.fullOn()
      else if (e.code === 'ArrowUp') {
        engine.setMaster(engine.st.master + 0.05)
        e.preventDefault()
      } else if (e.code === 'ArrowDown') {
        engine.setMaster(engine.st.master - 0.05)
        e.preventDefault()
      } else if (e.code === 'ArrowRight') engine.nextScene(1)
      else if (e.code === 'ArrowLeft') engine.nextScene(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [engine])

  // ---- 仕込み操作（ステージ上のポインタ）
  const evPos = (e: React.PointerEvent | React.MouseEvent): { x: number; y: number } => {
    const cv = displayRef.current!
    const r = cv.getBoundingClientRect()
    const { scale, dpr, ox, oy } = viewRef.current
    return {
      x: ((e.clientX - r.left) * dpr - ox) / scale,
      y: ((e.clientY - r.top) * dpr - oy) / scale
    }
  }
  const onStageDown = (e: React.PointerEvent): void => {
    if (uiMode !== 'build') return // PLAYではステージは触らない（写真は下の棚をクリック）
    const p = evPos(e)
    // 0a. ピース作成モード — 写真の box 内ドラッグで新規ピース矩形を切り出す
    if (engine.pieceCreating) {
      const wb0 = engine.box
      if (wb0 && p.x >= wb0.x && p.x <= wb0.x + wb0.w && p.y >= wb0.y && p.y <= wb0.y + wb0.h) {
        pieceCreateRef.current = { start: p, end: p }
        ;(e.target as Element).setPointerCapture?.(e.pointerId)
        return
      }
      // 写真外をクリック → 作成モードを解除して通常処理へ落とす
      engine.setPieceCreating(false)
    }
    // 0b. 既存ピース：選択中のピースなら 4 隅ハンドルチェック → 隅ドラッグ
    const sel = engine.selectedPieceId
    const scene = engine.activeScene >= 0 ? engine.scenes[engine.activeScene] : null
    const selPiece = sel && scene?.pieces ? scene.pieces.find((pp) => pp.id === sel) : null
    if (selPiece) {
      const HH = 14 // 隅ハンドルヒット半径（LW 単位）
      for (let i = 0; i < 4; i++) {
        const c = selPiece.corners[i]
        if (Math.abs(p.x - c.x) < HH && Math.abs(p.y - c.y) < HH) {
          pieceDragRef.current = {
            mode: 'corner',
            pieceId: selPiece.id,
            cornerIdx: i as CornerIdx,
            start: p,
            initCorner: { x: c.x, y: c.y }
          }
          ;(e.target as Element).setPointerCapture?.(e.pointerId)
          return
        }
      }
    }
    // 0c. 既存ピース：内側クリックで選択 + body ドラッグ
    const picked = engine.pickPieceAt(p)
    if (picked) {
      engine.selectPiece(picked.id)
      pieceDragRef.current = {
        mode: 'body',
        pieceId: picked.id,
        start: p,
        initCorners: [
          { x: picked.corners[0].x, y: picked.corners[0].y },
          { x: picked.corners[1].x, y: picked.corners[1].y },
          { x: picked.corners[2].x, y: picked.corners[2].y },
          { x: picked.corners[3].x, y: picked.corners[3].y }
        ]
      }
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
      return
    }
    // 0d. ピース外をクリックしたら選択を解除（次のロジックには進む）
    if (engine.selectedPieceId) engine.selectPiece(null)
    // 写真の 4 辺ワープハンドル — 灯体より先に判定（ハンドル優先）
    const wb = engine.box
    if (wb) {
      const HIT = 16 // LW 座標系で ±16px
      const handles: {
        edge: 'top' | 'bottom' | 'left' | 'right'
        x: number
        y: number
      }[] = [
        { edge: 'top', x: wb.x + wb.w / 2, y: wb.y },
        { edge: 'bottom', x: wb.x + wb.w / 2, y: wb.y + wb.h },
        { edge: 'left', x: wb.x, y: wb.y + wb.h / 2 },
        { edge: 'right', x: wb.x + wb.w, y: wb.y + wb.h / 2 }
      ]
      for (const h of handles) {
        if (Math.abs(p.x - h.x) < HIT && Math.abs(p.y - h.y) < HIT) {
          warpDragRef.current = { edge: h.edge, start: p, initBox: { ...wb } }
          ;(e.target as Element).setPointerCapture?.(e.pointerId)
          return
        }
      }
    }
    const beams = engine.beams
    // 番号下のM/S（クリックでトグル）
    for (let i = beams.length - 1; i >= 0; i--) {
      const b = beams[i]
      if (Math.abs(p.y - (b.y + 17)) < 11) {
        if (Math.abs(p.x - (b.x - 11)) < 10) {
          engine.selectBeam(i)
          engine.toggleMute(i)
          return
        }
        if (Math.abs(p.x - (b.x + 11)) < 10) {
          engine.selectBeam(i)
          engine.toggleSolo(i)
          return
        }
      }
    }
    // ヒットは「手前に見えている方」から探す（描画は配列の後ろが手前）。
    // モチーフは見た目に合わせてヒット半径を motifDiam/2 に拡大。
    // さらに、いま選択中の灯体を最優先＝コピー直後の群を確実につかめる。
    const hitR = (b: typeof beams[0]) => b.motif ? Math.max(30, (b.motifDiam ?? 200) / 2) : 30
    const hitRY = (b: typeof beams[0]) => b.motif ? Math.max(24, (b.motifDiam ?? 200) / 2) : 24
    let hit = -1
    for (let i = beams.length - 1; i >= 0; i--) {
      const b = beams[i]
      if (
        engine.isSelected(i) &&
        Math.abs(p.x - b.x) < hitR(b) &&
        Math.abs(p.y - b.y) < hitRY(b)
      ) {
        hit = i
        break
      }
    }
    if (hit < 0)
      for (let i = beams.length - 1; i >= 0; i--) {
        const b = beams[i]
        if (Math.abs(p.x - b.x) < hitR(b) && Math.abs(p.y - b.y) < hitRY(b)) {
          hit = i
          break
        }
      }
    if (hit >= 0) {
      if (e.shiftKey) {
        engine.toggleSelectBeam(hit) // Shift+クリック＝選択に足す/外す（ドラッグはしない）
      } else {
        if (!engine.isSelected(hit)) engine.selectBeam(hit) // 未選択をつかんだら単独選択
        if (e.altKey) engine.duplicateSelectedInPlace() // ⌥ドラッグ＝複製して動かす（元は残る）
        engine.beginDrag()
        draggingRef.current = true // 選択ぜんぶをまとめてドラッグ移動（吸着つき）
        dragStartRef.current = p
      }
    } else if ((e.metaKey || e.ctrlKey) && beams.length < MAX_BEAMS) {
      // タブ連動: SFXタブなら選んでる特効を、それ以外は照明を ⌘+クリックで追加（誤爆防止）。
      // 雨/雪・スモークは「受け系」で置く灯体ではない＝⌘+クリックでは何も置かない。
      if (hudTab === 'sfx') {
        if (sfxType === 'flame' || sfxType === 'sparkler') engine.addMotifAuto(sfxType, p.x, p.y)
      } else engine.addFixtureAt(p.x, p.y)
      engine.beginDrag()
      draggingRef.current = true
      dragStartRef.current = p
    } else {
      // 空きを四角ドラッグ＝ラバーバンドで範囲選択（Shiftで追加選択）
      rubberRef.current = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, add: e.shiftKey }
    }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }
  const onStageMove = (e: React.PointerEvent): void => {
    const p = evPos(e)
    // ピース作成中：矩形を拡大していくだけ（確定は onStageUp）
    if (pieceCreateRef.current) {
      pieceCreateRef.current.end = p
      return
    }
    // ピース編集ドラッグ：隅 or 中央
    if (pieceDragRef.current) {
      const d = pieceDragRef.current
      if (d.mode === 'corner') {
        engine.updatePieceCorner(d.pieceId, d.cornerIdx, {
          x: d.initCorner.x + (p.x - d.start.x),
          y: d.initCorner.y + (p.y - d.start.y)
        })
      } else {
        const dx = p.x - d.start.x
        const dy = p.y - d.start.y
        for (let i = 0; i < 4; i++) {
          engine.updatePieceCorner(d.pieceId, i as CornerIdx, {
            x: d.initCorners[i].x + dx,
            y: d.initCorners[i].y + dy
          })
        }
      }
      return
    }
    // 写真の 4 辺ワープドラッグ — 灯体ドラッグより先に処理
    if (warpDragRef.current) {
      const { edge, start, initBox } = warpDragRef.current
      const MIN = 20 // LW 座標系での最小サイズ
      let nx = initBox.x
      let ny = initBox.y
      let nw = initBox.w
      let nh = initBox.h
      if (edge === 'top') {
        const cap = Math.min(p.y - start.y, initBox.h - MIN)
        ny = initBox.y + cap
        nh = initBox.h - cap
      } else if (edge === 'bottom') {
        nh = Math.max(MIN, initBox.h + (p.y - start.y))
      } else if (edge === 'left') {
        const cap = Math.min(p.x - start.x, initBox.w - MIN)
        nx = initBox.x + cap
        nw = initBox.w - cap
      } else if (edge === 'right') {
        nw = Math.max(MIN, initBox.w + (p.x - start.x))
      }
      engine.setActiveSceneWarpBox({ x: nx, y: ny, w: nw, h: nh })
      return
    }
    if (rubberRef.current) {
      rubberRef.current.x1 = p.x
      rubberRef.current.y1 = p.y
      return
    }
    if (!draggingRef.current || !dragStartRef.current) return
    // 開始位置からの総移動量を渡す＝engine 側で整列・等間隔へ吸着する。
    // Shift を押している間は吸着もガイドも一時 OFF（Figma の ⌘ と同じ役回り）。
    engine.dragTo(p.x - dragStartRef.current.x, p.y - dragStartRef.current.y, !e.shiftKey)
  }
  const onStageUp = (): void => {
    // ピース作成の確定：写真 box 上の矩形を mat 絶対座標に逆変換して engine に渡す
    if (pieceCreateRef.current) {
      const { start, end } = pieceCreateRef.current
      pieceCreateRef.current = null
      const scene =
        engine.activeScene >= 0 ? engine.scenes[engine.activeScene] : null
      const box = engine.box
      if (scene && scene.mat && box) {
        const minX = Math.max(box.x, Math.min(start.x, end.x))
        const maxX = Math.min(box.x + box.w, Math.max(start.x, end.x))
        const minY = Math.max(box.y, Math.min(start.y, end.y))
        const maxY = Math.min(box.y + box.h, Math.max(start.y, end.y))
        const w = maxX - minX
        const h = maxY - minY
        if (w > 6 && h > 6) {
          // LW×LH 上の矩形 → mat 絶対座標へ
          const sx = ((minX - box.x) / box.w) * scene.mat.width
          const sy = ((minY - box.y) / box.h) * scene.mat.height
          const sw = (w / box.w) * scene.mat.width
          const sh = (h / box.h) * scene.mat.height
          engine.addPieceFromSrcRect({ x: sx, y: sy, w: sw, h: sh })
        }
      }
      // 作成は 1 回で終わり — 連続作成するなら呼び出し側がトグル維持
      engine.setPieceCreating(false)
      return
    }
    if (pieceDragRef.current) {
      pieceDragRef.current = null
      return
    }
    if (warpDragRef.current) {
      warpDragRef.current = null
      return
    }
    const rb = rubberRef.current
    if (rb) {
      const minX = Math.min(rb.x0, rb.x1)
      const maxX = Math.max(rb.x0, rb.x1)
      const minY = Math.min(rb.y0, rb.y1)
      const maxY = Math.max(rb.y0, rb.y1)
      if (maxX - minX > 6 || maxY - minY > 6) {
        const ids = engine.beams
          .map((b, i) => (b.x >= minX && b.x <= maxX && b.y >= minY && b.y <= maxY ? i : -1))
          .filter((i) => i >= 0)
        engine.setSelection(ids, rb.add)
      } else if (!rb.add) {
        engine.setSelection([]) // 空きをただクリック＝選択解除
      }
      rubberRef.current = null
    }
    if (draggingRef.current) engine.endDrag()
    draggingRef.current = false
    dragStartRef.current = null
  }

  // ---- 写真の読み込み（クリック/ドロップ）
  const loadFiles = async (files: FileList | File[]): Promise<void> => {
    for (const f of Array.from(files)) {
      const base = f.name.replace(/\.[^.]+$/, '')
      if (f.type.startsWith('image/')) {
        const url = await fileToDataUrl(f)
        if (url) await engine.addPhoto(url, base)
      } else if (f.type.startsWith('video/')) {
        // 動画は重いので dataURL でなく ObjectURL（即再生・メモリ効率）
        await engine.addVideo(URL.createObjectURL(f), base)
      }
    }
  }

  // ---- 公演まるごと保存/開く（フォルダ＋写真/動画）。show.json＋media/ を1フォルダに。
  const [showMsg, setShowMsg] = useState<string | null>(null)
  const flash = (m: string): void => {
    setShowMsg(m)
    window.setTimeout(() => setShowMsg((cur) => (cur === m ? null : cur)), 2600)
  }
  const saveShow = async (): Promise<void> => {
    const a = getApi()
    if (!a?.saveImageLightShow) return
    flash('保存中…')
    try {
      const { json, media } = await engine.serializeShow()
      const path = await a.saveImageLightShow(json, media, 'show')
      flash(path ? '保存しました' : 'キャンセル')
    } catch {
      flash('保存に失敗')
    }
  }
  const openShow = async (): Promise<void> => {
    const a = getApi()
    if (!a?.openImageLightShow) return
    flash('読込中…')
    try {
      const res = await a.openImageLightShow()
      if (!res) return flash('キャンセル')
      if ('error' in res) return flash(res.error)
      const ok = await engine.restoreShow(res.json, res.media)
      flash(ok ? '開きました' : '読込に失敗')
    } catch {
      flash('読込に失敗')
    }
  }
  const ref = engine.ref()
  const colorLocked = engine.colorOwnedByFx()
  const activeFx = FX_BUTTONS.filter((b) => engine.fxState(b.key))
  const masterPct = Math.round(engine.st.master * 100)
  const outCapLabel = engine.outCap >= 3840 ? '高精細' : engine.outCap >= 2560 ? 'バランス' : 'なめらか'
  const falloffLabel = engine.falloffPow >= 4 ? 'きつめ' : engine.falloffPow >= 2.5 ? '標準' : 'ソフト'
  const depthStat = engine.activeDepthStatus()
  const depthStatLabel =
    depthStat === 'ready'
      ? 'READY'
      : depthStat === 'pending'
        ? 'COMPUTING…'
        : depthStat === 'failed'
          ? 'FAILED'
          : '—'
  const ms = engine.muteSoloCount() // ソロ/ミュート中の台数（注意表示・全解除ボタン用）
  const curCue = engine.activePattern >= 0 ? engine.patterns[engine.activePattern] : null // 今アクティブな明かり

  return (
    <div
      className="il-root"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        if (e.dataTransfer?.files?.length) loadFiles(e.dataTransfer.files)
      }}
    >
      <style>{IL_CSS}</style>
      {showKeys && (
        <div className="il-learn-overlay" onClick={() => setShowKeys(false)}>
          <div className="il-keys-card" onClick={(e) => e.stopPropagation()}>
            <div className="il-learn-eyebrow">KEYS — 操作キー一覧</div>
            <table className="il-keys-tbl">
              <tbody>
                <tr>
                  <th>シーン切替</th>
                  <td>サムネをクリック／覚えさせた MIDI／← →</td>
                </tr>
                <tr>
                  <th>明かり（番号）</th>
                  <td>数字キー 1〜9 など／覚えさせたキー・MIDI</td>
                </tr>
                <tr>
                  <th>灯体を追加</th>
                  <td>⌘＋クリック</td>
                </tr>
                <tr>
                  <th>複数選択</th>
                  <td>Shift＋クリック／空きを四角ドラッグで囲む</td>
                </tr>
                <tr>
                  <th>全選択</th>
                  <td>⌘A</td>
                </tr>
                <tr>
                  <th>微調整（位置）</th>
                  <td>矢印キー／Shift＋矢印で大きく（選択中）</td>
                </tr>
                <tr>
                  <th>削除</th>
                  <td>Delete（選択中）</td>
                </tr>
                <tr>
                  <th>コピー／貼り付け</th>
                  <td>⌘C → ⌘V</td>
                </tr>
                <tr>
                  <th>パニック（ふわっと消し）</th>
                  <td>Esc</td>
                </tr>
                <tr>
                  <th>暗転（即）</th>
                  <td>0</td>
                </tr>
                <tr>
                  <th>全点灯</th>
                  <td>F</td>
                </tr>
                <tr>
                  <th>マスター上下</th>
                  <td>↑ ↓</td>
                </tr>
                <tr>
                  <th>この一覧</th>
                  <td>?（背景クリックでも閉じる）</td>
                </tr>
              </tbody>
            </table>
            <button className="il-learn-cancel" onClick={() => setShowKeys(false)}>
              閉じる（Esc / ?）
            </button>
          </div>
        </div>
      )}
      <header className="il-header">
        <h1>
          LIGHT SKETCH
          <span
            style={{
              fontFamily: "'Noto Sans JP',sans-serif",
              fontSize: 11,
              color: 'var(--il-dim)',
              letterSpacing: 0,
              marginLeft: 8
            }}
          >
            かんたんモード
          </span>
        </h1>
        <small>写真はクリック・明かりはシーン・困ったらESC</small>
        <div style={{ flex: 1 }} />
        <span
          className="il-lamp"
          title={live.midiIn ? 'MIDI入力：受信中' : 'MIDI入力：なし（卓/ケーブルを確認）'}
        >
          <i className={live.midiIn ? 'on' : ''} />
          MIDI
        </span>
        <span
          className="il-lamp"
          title={
            live.out
              ? '出力：Resolume等が受け取っています'
              : '出力：受け手なし（Resolume/Syphon未接続）'
          }
        >
          <i className={live.out ? 'on' : ''} />
          出力
        </span>
        {showMsg && (
          <span style={{ fontSize: 11, color: 'var(--il-green)', marginRight: 8 }}>{showMsg}</span>
        )}
        <button
          className="il-mini"
          onClick={() => setShowKeys(true)}
          title="操作キーの一覧を開く（? キーでも開きます）"
        >
          SHORTCUT
        </button>
        <button className="il-mini" onClick={saveShow} title="公演まるごとフォルダに保存（写真/動画も一緒）">
          保存
        </button>
        <button className="il-mini" onClick={openShow} title="保存した公演フォルダを開く（写真も明かりも復元）">
          開く
        </button>
        <button className="il-mini" onClick={onExit}>
          ← SHOW MODEへ
        </button>
      </header>

      <div className="il-main">
        <div className="il-stage">
          <canvas
            ref={displayRef}
            className="il-cv"
            style={{ cursor: uiMode === 'build' ? 'crosshair' : 'default' }}
            onPointerDown={onStageDown}
            onPointerMove={onStageMove}
            onPointerUp={onStageUp}
          />
          {engine.scenes.length === 0 && (
            <div className="il-empty">
              <div className="il-empty-big" onClick={() => fileInputRef.current?.click()}>
                <span style={{ fontFamily: "'Bebas Neue',sans-serif", letterSpacing: '0.16em' }}>
                  LOAD PHOTO / VIDEO
                </span>
                <br />
                <span
                  style={{
                    fontFamily: "'Noto Sans JP',sans-serif",
                    fontSize: 11,
                    color: 'var(--il-faint)',
                    fontWeight: 400,
                    letterSpacing: 0
                  }}
                >
                  写真・動画を選ぶ（ドロップでもOK）
                </span>
              </div>
              <div className="il-empty-sub">
                セット写真やループ動画を読み込むと、ここで灯体が照らします（クリックでも選べます）
              </div>
              <button className="il-mini" style={{ marginTop: 8 }} onClick={() => engine.addEmptyScene()}>
                空の背景を追加（モチーフだけ使う）
              </button>
            </div>
          )}
          {uiMode === 'build' && (
            <div className="il-hint">
              <b>⌘+クリック＝追加</b> ／ クリック＝選択 ／ <b>Shift+クリック＝複数選択</b> ／{' '}
              <b>空きを四角ドラッグ＝囲んで選択</b> ／ ドラッグ＝移動（選択ぜんぶ）
              <br />
              <b>Delete＝削除</b> ／ <b>⌘C→⌘V＝コピペ</b>（複数まとめて）／ 番号の下の <b>M</b>
              ＝消す・<b>S</b>＝これだけ
              <br />
              下の <b>＋ボタン</b>やモチーフ（街灯・電球など）の各ボタンでも追加できます
            </div>
          )}
          <div className="il-scenes">
            {engine.scenes.map((s, i) => (
              <div
                key={i}
                className={'il-sc-wrap' + (i === engine.activeScene ? ' on' : '')}
              >
                <button
                  className={'il-sc' + (i === engine.activeScene ? ' on' : '')}
                  onClick={() => engine.selectScene(i)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    if (
                      window.confirm(
                        'この写真を消しますか？この写真に紐づく灯体の配置も消えます（⌘Zで戻せます）'
                      )
                    )
                      engine.removeScene(i)
                  }}
                  title={s.name + '（右クリックで削除）'}
                >
                  <ThumbCanvas thumb={s.thumb} />
                  {s.kind === 'video' && <span className="il-sc-vid">▶</span>}
                  {uiMode === 'build' && (
                  <>
                  <span
                    className="il-sc-del"
                    title="この素材を棚から削除"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (
                        window.confirm(
                          'この写真を消しますか？この写真に紐づく灯体の配置も消えます（⌘Zで戻せます）'
                        )
                      )
                        engine.removeScene(i)
                    }}
                  >
                    ×
                  </span>
                  <span
                    className={
                      'il-sc-learn' + (engine.learnScene === i ? ' on' : '') +
                      (s.midiNote != null && engine.learnScene !== i ? ' assigned' : '')
                    }
                    title={
                      engine.learnScene === i
                        ? 'MIDI 入力待ち中（クリックで中止）'
                        : s.midiNote != null
                        ? `MIDI Note ${s.midiNote} 割当済（クリックで再 LEARN）`
                        : 'LEARN — このシーンを呼ぶ MIDI を覚えさせる'
                    }
                    onClick={(e) => {
                      e.stopPropagation()
                      engine.setLearnScene(engine.learnScene === i ? null : i)
                    }}
                  >
                    {engine.learnScene === i ? '◎' : s.midiNote != null ? `♪${s.midiNote}` : '◎'}
                  </span>
                  </>
                  )}
                </button>
                {editingNameIdx === i ? (
                  <input
                    className="il-sc-name-input"
                    value={editingNameValue}
                    autoFocus
                    onChange={(e) => setEditingNameValue(e.target.value)}
                    onBlur={() => {
                      engine.renameScene(i, editingNameValue)
                      setEditingNameIdx(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        engine.renameScene(i, editingNameValue)
                        setEditingNameIdx(null)
                      } else if (e.key === 'Escape') {
                        setEditingNameIdx(null)
                      }
                      e.stopPropagation()
                    }}
                  />
                ) : (
                  <div
                    className="il-sc-name"
                    title="ダブルクリックで名前を変える"
                    onDoubleClick={() => {
                      setEditingNameValue(s.name)
                      setEditingNameIdx(i)
                    }}
                  >
                    {s.name}
                  </div>
                )}
              </div>
            ))}
            <button className="il-sc-add" onClick={() => fileInputRef.current?.click()}>
              ＋ 写真／動画を追加
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files) loadFiles(e.target.files)
              e.target.value = ''
            }}
          />
        </div>

        {uiMode === 'play' ? (
          // ===================== 本番 PLAY =====================
          <aside className="il-panel">
            <div className="il-deskhead">
              <b>本番 PLAY</b>
              <span>明かり＝下のボタン or ショートカット</span>
              <div style={{ flex: 1 }} />
              <button className="il-mini" onClick={() => setUiMode('build')}>
                明かり作りへ →
              </button>
            </div>
            <div className="il-livebtns">
              <button
                className="il-livebtn blackout"
                onClick={() => engine.blackout()}
                title="即座に暗転（キー: 0）"
              >
                暗転
              </button>
              <button
                className="il-livebtn panic"
                onClick={() => engine.panicFade()}
                title="ふわっと消す（キー: Esc）"
              >
                パニック
              </button>
              <button
                className="il-livebtn full"
                onClick={() => engine.fullOn()}
                title="全部点ける（キー: F）"
              >
                全点灯
              </button>
              <button
                className="il-livebtn undo"
                onClick={() => engine.undo()}
                title="ひとつ前に戻す（⌘Z）"
              >
                戻す
              </button>
            </div>
            {(ms.mute > 0 || ms.solo > 0) && (
              <button
                className="il-msnotice"
                onClick={() => engine.clearAllMuteSolo()}
                title="押すと全部の M（消す）/ S（これだけ）を解除します"
              >
                {[ms.solo > 0 ? `ソロ中 ${ms.solo}台` : '', ms.mute > 0 ? `ミュート中 ${ms.mute}台` : '']
                  .filter(Boolean)
                  .join('・')}{' '}
                — 押して全解除
              </button>
            )}
            <StrobeSpecial engine={engine} />
            <div className="il-toggles">
              <button
                className={'il-toggle' + (engine.lightOnly ? ' on' : '')}
                onClick={() => engine.setLightOnly(!engine.lightOnly)}
                title="ON=写真を使わず光だけを出力(Syphon/NDI)（Arena側で 映像×光）。OFF=写真照らし"
              >
                光だけ出力
              </button>
            </div>
            <div className="il-toggles">
              <span className="il-falloff-lbl">切替</span>
              <button
                className={'il-toggle' + (engine.sceneFadeMode === 'cut' ? ' on' : '')}
                onClick={() => engine.setSceneFadeMode('cut')}
                title="シーンを即座に切替（カット）"
              >
                カット
              </button>
              <button
                className={'il-toggle' + (engine.sceneFadeMode === 'fade' ? ' on' : '')}
                onClick={() => engine.setSceneFadeMode('fade')}
                title="シーンをフェードで切替（時間は下のスライダー）"
              >
                フェード
              </button>
            </div>
            {engine.sceneFadeMode === 'fade' && (
              <div className="il-frow">
                <span className="il-falloff-lbl">時間</span>
                <input
                  type="range"
                  min={0.2}
                  max={5}
                  step={0.1}
                  value={engine.sceneFadeMs / 1000}
                  onChange={(e) => engine.setSceneFadeMs(Math.round(+e.target.value * 1000))}
                />
                <div className="il-val">{(engine.sceneFadeMs / 1000).toFixed(1)}秒</div>
              </div>
            )}
            <div className="il-playpats">
              {engine.patterns.map((p, i) => (
                <button
                  key={i}
                  className={
                    'il-patbig' + (p ? '' : ' empty') + (engine.activePattern === i ? ' on' : '')
                  }
                  onClick={() => p && engine.applyPattern(i)}
                >
                  <span className="pn">{i + 1}</span>
                  <span className="pname">{p ? p.name : '（空き）'}</span>
                  <span className="pkey">
                    {p
                      ? [codeLabel(p.key), p.midi != null ? 'N' + p.midi : '']
                          .filter(Boolean)
                          .join(' ')
                      : ''}
                  </span>
                </button>
              ))}
            </div>
            <div className="il-lbl">
              MASTER
            </div>
            <div className="il-frow">
              <input
                type="range"
                min={0}
                max={100}
                value={masterPct}
                onChange={(e) => engine.setMaster(+e.target.value / 100)}
              />
              <div className="il-val">{masterPct}%</div>
              <button
                className={'il-mini' + (engine.masterLearn ? ' learnon il-blink' : '')}
                onClick={() => engine.setMasterLearn(!engine.masterLearn)}
              >
                {engine.masterLearn ? '◎' : engine.masterMidi != null ? 'CC' + engine.masterMidi : '◎'}
              </button>
            </div>
            {engine.beams.some((b) => b.motif) && (
              <>
                <hr />
                <div className="il-lbl">MOTIF</div>
                <div className="il-frow" style={{ gap: 4, marginBottom: 6 }}>
                  <span style={{ width: 64, fontSize: 11, color: 'var(--il-txt)', flexShrink: 0 }}>
                    Chase
                  </span>
                  <button
                    className={'il-mini' + (engine.motifChase ? ' learnon' : '')}
                    style={{ flex: 1, padding: '2px 6px', fontSize: 11 }}
                    onClick={() => engine.setMotifChase(!engine.motifChase)}
                  >
                    {engine.motifChase ? 'Running (tap to stop)' : 'Chase motifs'}
                  </button>
                </div>
                {engine.beams.map((b, i) => {
                  if (!b.motif) return null
                  const label: Record<string, string> = {
                    streetlamp: 'Street', chandelier: 'Chandelier', marquee: 'Marquee', image: 'Image',
                    bulb: 'Bulb', parlight: 'PAR', blinder: 'Mini', patt: 'PAT', pixelpatt: 'PixelPAT',
                    stars: 'Star', festoon: 'Banner', flame: 'FLAMER', sparkler: 'SPARKLER'
                  }
                  return (
                    <div key={i} className="il-frow" style={{ gap: 4, marginBottom: 3 }}>
                      <span style={{ width: 64, fontSize: 11, color: 'var(--il-txt)', flexShrink: 0 }}>
                        {label[b.motif] ?? b.motif}
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round(b.gauge * 100)}
                        style={{ flex: 1 }}
                        onChange={(e) => engine.setBeamGauge(i, +e.target.value / 100)}
                      />
                      <div className="il-val small">{Math.round(b.gauge * 100)}%</div>
                      <button
                        className={'il-mini' + (b.mute ? ' learnon' : '')}
                        style={{ padding: '1px 5px', fontSize: 10 }}
                        onClick={() => engine.toggleMute(i)}
                      >
                        {b.mute ? 'OFF' : 'ON'}
                      </button>
                    </div>
                  )
                })}
              </>
            )}
          </aside>
        ) : (
          // ===================== 明かり作り BUILD =====================
          <aside className="il-panel il-panel--hud">
            <input
              ref={maskInputRef}
              type="file"
              accept="image/png,image/webp,image/*"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const file = e.target.files?.[0]
                e.target.value = '' // 同じファイル再選択でも発火させる
                if (!file) return
                try {
                  const dataUrl = await fileToDataUrl(file)
                  await engine.setMaskFromDataUrl(dataUrl)
                  engine.setDecor({ enabled: true }) // チャートを読んだら電飾を自動でON
                  if (engine.scenes.length === 0) engine.addEmptyScene() // 背景が無ければ空背景を出して電飾が見えるように
                } catch {
                  /* 読込失敗は無視 */
                }
              }}
            />
            <input
              ref={imageMotifInputRef}
              type="file"
              accept="image/png,image/webp,image/*"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                try {
                  const dataUrl = await fileToDataUrl(file)
                  if (dataUrl) engine.addImageMotif(dataUrl)
                } catch {
                  /* 読込失敗は無視 */
                }
              }}
            />
            <div className="il2hud-head">
              <div className="il2hud-hero">
                <div className="il2hud-cue">
                  <span className="il2hud-cuelbl">NOW</span>
                  <span className="il2hud-cuename">{curCue ? curCue.name : '—'}</span>
                  <span className="il2hud-cueidx">
                    {engine.activePattern >= 0
                      ? 'CUE ' + String(engine.activePattern + 1).padStart(2, '0')
                      : 'LIVE'}
                  </span>
                </div>
                <div className="il2hud-master">
                  <span className="il2hud-mlbl">MASTER</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={masterPct}
                    onChange={(e) => engine.setMaster(+e.target.value / 100)}
                  />
                  <span className="il2hud-mval">
                    {masterPct}
                    <i>%</i>
                  </span>
                  <button
                    className={'il-mini' + (engine.masterLearn ? ' learnon il-blink' : '')}
                    onClick={() => engine.setMasterLearn(!engine.masterLearn)}
                    title="明るさ(MASTER)に MIDI CC を割当（◎を押してフェーダーを動かす）"
                  >
                    {engine.masterLearn
                      ? '◎'
                      : engine.masterMidi != null
                        ? 'CC' + engine.masterMidi
                        : '◎'}
                  </button>
                </div>
              </div>
              <div className="il2hud-tabs">
                <button
                  className={'il2hud-tab' + (hudTab === 'cue' ? ' on' : '')}
                  onClick={() => setHudTab('cue')}
                >
                  CUE<i>流す</i>
                </button>
                <button
                  className={'il2hud-tab' + (hudTab === 'light' ? ' on' : '')}
                  onClick={() => setHudTab('light')}
                >
                  LIGHT<i>照明</i>
                </button>
                <button
                  className={'il2hud-tab' + (hudTab === 'decor' ? ' on' : '')}
                  onClick={() => setHudTab('decor')}
                >
                  DECOR<i>電飾</i>
                </button>
                <button
                  className={'il2hud-tab' + (hudTab === 'sfx' ? ' on' : '')}
                  onClick={() => setHudTab('sfx')}
                >
                  SFX<i>特効</i>
                </button>
                <button
                  className={'il2hud-tab' + (hudTab === 'setup' ? ' on' : '')}
                  onClick={() => setHudTab('setup')}
                >
                  SETUP<i>設定</i>
                </button>
              </div>
            </div>

            <div className="il2hud-scroll">
            <div className="il2-console">
              {hudTab === 'sfx' && (
                <div className="il2-sec">
                  <div className="il2-eb">
                    <span className="il2-kind">特効</span>
                    <b>SFX</b>
                  </div>

                  <div className="il2-subtabs">
                    <button className={'il2-subtab' + (sfxType === 'flame' ? ' on' : '')} onClick={() => setSfxType('flame')}>FLAMER</button>
                    <button className={'il2-subtab' + (sfxType === 'sparkler' ? ' on' : '')} onClick={() => setSfxType('sparkler')}>SPARKLER</button>
                    <button className={'il2-subtab' + (sfxType === 'rain' ? ' on' : '')} onClick={() => setSfxType('rain')}>RAIN/SNOW</button>
                    <button className={'il2-subtab' + (sfxType === 'smoke' ? ' on' : '')} onClick={() => setSfxType('smoke')}>SMOKE</button>
                  </div>

                  {(sfxType === 'flame' || sfxType === 'sparkler') ? (
                    <>
                      <div className="il-lbl" style={{ marginTop: 6, opacity: 0.6 }}>
                        ⌘+CLICK to place · always on while lit · PLACED {sfxType === 'flame' ? engine.flamePlacedCount : engine.sparklerPlacedCount}
                      </div>
                      {engine.hasSfxSelected && (
                        <PoseRow label="TILT" min={-180} max={180} value={engine.selectedTilt}
                          fmt={(v) => v + '°'} onChange={(v) => engine.setTilt(v)} engine={engine} learnId="pose.tilt" />
                      )}
                    </>
                  ) : (
                    <>
                      <div className="il2-act" style={{ flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                        {sfxType === 'rain' ? (
                          <button className={'il-livebtn big' + (engine.rainOn ? ' on' : '')} onClick={() => engine.setRainOn(!engine.rainOn)}>
                            {engine.rainOn ? 'ON' : 'OFF'}
                          </button>
                        ) : (
                          <>
                            <button className={'il-livebtn big' + (engine.lowSmokeOn ? ' on' : '')} onClick={() => engine.setLowSmokeOn(!engine.lowSmokeOn)}>
                              {engine.lowSmokeOn ? 'ON' : 'OFF'}
                            </button>
                            <button className="il-mini" onClick={() => engine.lowSmokeRefill()} title="今すぐ満タンに溜め直す">REFILL</button>
                          </>
                        )}
                      </div>
                      <div className="il-lbl" style={{ marginTop: 4, opacity: 0.6 }}>Shows only where light hits — turn lights ON first.</div>
                    </>
                  )}

                  {SFX_PARAMS[sfxType].core.map((p) => (
                    <SfxRow key={p.id} engine={engine} p={p} />
                  ))}

                  {SFX_PARAMS[sfxType].more.length > 0 && (
                    <>
                      <button className="il-mini" style={{ marginTop: 6 }} onClick={() => setShowAdv(!showAdv)}>
                        MORE {showAdv ? '▲' : '▼'}
                      </button>
                      {showAdv && SFX_PARAMS[sfxType].more.map((p) => (
                        <SfxRow key={p.id} engine={engine} p={p} />
                      ))}
                    </>
                  )}

                  {sfxType === 'flame' && (
                    <div className="il2-act" style={{ flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                      <button className="il-mini" onClick={() => engine.flameFireAll()} title="一発ドカンと大きく出す（任意）">BURST</button>
                    </div>
                  )}

                  {(sfxType === 'flame' || sfxType === 'sparkler') && (
                    <SeqGrid engine={engine} />
                  )}
                </div>
              )}
              {hudTab === 'cue' && (
                <>
              <div className="il2-sec">
                <div className="il2-eb">
                  <span className="il2-kind">本番</span>
                  <b>CUE</b>
                </div>
                <div className="il-playpats">
                  {engine.patterns.map((p, i) => (
                    <button
                      key={i}
                      className={
                        'il-patbig' + (p ? '' : ' empty') + (engine.activePattern === i ? ' on' : '')
                      }
                      onClick={() => p && engine.applyPattern(i)}
                    >
                      <span className="pn">{i + 1}</span>
                      <span className="pname">{p ? p.name : '（空き）'}</span>
                      <span className="pkey">
                        {p
                          ? [codeLabel(p.key), p.midi != null ? 'N' + p.midi : '']
                              .filter(Boolean)
                              .join(' ')
                          : ''}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="il-toggles">
                  <span className="il-falloff-lbl">切替</span>
                  <button
                    className={'il-toggle' + (engine.sceneFadeMode === 'cut' ? ' on' : '')}
                    onClick={() => engine.setSceneFadeMode('cut')}
                    title="シーンを即座に切替（カット）"
                  >
                    カット
                  </button>
                  <button
                    className={'il-toggle' + (engine.sceneFadeMode === 'fade' ? ' on' : '')}
                    onClick={() => engine.setSceneFadeMode('fade')}
                    title="シーンをフェードで切替（時間は下）"
                  >
                    フェード
                  </button>
                </div>
                {engine.sceneFadeMode === 'fade' && (
                  <div className="il-frow">
                    <span className="il-falloff-lbl">時間</span>
                    <input
                      type="range"
                      min={0.2}
                      max={5}
                      step={0.1}
                      value={engine.sceneFadeMs / 1000}
                      onChange={(e) => engine.setSceneFadeMs(Math.round(+e.target.value * 1000))}
                    />
                    <div className="il-val">{(engine.sceneFadeMs / 1000).toFixed(1)}秒</div>
                  </div>
                )}
                {engine.beams.some((b) => b.motif) && (
                  <div className="il-frow" style={{ gap: 4, marginTop: 6 }}>
                    <span style={{ width: 64, fontSize: 11, color: 'var(--il-txt)', flexShrink: 0 }}>
                      モチーフ
                    </span>
                    <button
                      className={'il-mini' + (engine.motifChase ? ' learnon' : '')}
                      style={{ flex: 1, padding: '2px 6px', fontSize: 11 }}
                      onClick={() => engine.setMotifChase(!engine.motifChase)}
                    >
                      {engine.motifChase ? 'Running (tap to stop)' : 'Chase motifs'}
                    </button>
                  </div>
                )}
              </div>
              <div className="il2-sec">
                <div className="il2-eb">
                  <span className="il2-kind">量</span>
                  <b>スモーク</b>
                </div>
                <div className="il2-fader">
                  <span className="il2-nm">LEVEL</span>
                  <input
                    type="range"
                    min={0}
                    max={30}
                    value={engine.st.smoke}
                    onChange={(e) => engine.setSmoke(+e.target.value)}
                  />
                  <span className="il2-vv">{engine.st.smoke}</span>
                </div>
              </div>
                </>
              )}
              {hudTab === 'setup' && (
                <>
              <div className="il2-sec">
                <div className="il2-eb">
                  <span className="il2-kind">入 / 切</span>
                  <b>OUTPUT</b>
                </div>
                <button
                  className={'il2-switch' + (engine.lightOnly ? ' on' : '')}
                  onClick={() => engine.setLightOnly(!engine.lightOnly)}
                  title="ON=写真を使わず光だけを出力(Syphon/NDI)（Arena側で 映像×光）。OFF=写真照らし"
                >
                  <span className="il2-sw-track">
                    <span className="il2-sw-knob" />
                  </span>
                  <span className="il2-sw-nm">LIGHT ONLY<i>光だけ</i></span>
                  <span className="il2-sw-st">{engine.lightOnly ? 'ON' : 'OFF'}</span>
                </button>
              </div>

              <div className="il2-sec">
                <div className="il2-eb">
                  <span className="il2-kind">立体</span>
                  <b>DEPTH</b>
                </div>
                <div className="il2-segrow">
                  <span className="il2-seglbl">3D</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(engine.depthStrength * 100)}
                    onChange={(e) => engine.setDepthStrength(+e.target.value / 100)}
                    title="背景写真の奥行きで光の乗り方を変える（0=今まで通り／上げるほど手前が明るく奥が落ちて立体的に見える）。写真を読み込むと自動で奥行きを計算します。"
                    style={{ flex: 1 }}
                  />
                  <span className="il2-pv">{Math.round(engine.depthStrength * 100)}</span>
                </div>
                <div className="il2-segrow">
                  <span className="il2-seglbl">WIDTH</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(engine.depthWidth * 100)}
                    onChange={(e) => engine.setDepthWidth(+e.target.value / 100)}
                    title="彫りの太さ。小さい=細部(窓枠/フチ)中心、大きい=柱など面で太く出る。動かすと即反映。"
                    style={{ flex: 1 }}
                  />
                  <span className="il2-pv">{Math.round(engine.depthWidth * 100)}</span>
                </div>
                <div className="il2-segrow">
                  <span className="il2-seglbl">SHADOW</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(engine.depthShadow * 100)}
                    onChange={(e) => engine.setDepthShadow(+e.target.value / 100)}
                    title="出っ張りの上に落ちる影。0=自然(影なし)。上げると下から光のリアルな落ち影。上げ過ぎると作り物っぽくなるので控えめが◎。"
                    style={{ flex: 1 }}
                  />
                  <span className="il2-pv">{Math.round(engine.depthShadow * 100)}</span>
                </div>
                <button
                  className={'il2-switch' + (engine.showDepth ? ' on' : '')}
                  onClick={() => engine.setShowDepth(!engine.showDepth)}
                  title="ON=立体感に実際に使う“彫り(凹凸)”を強調表示。中立=灰/出っ張り=明/凹み=暗。柱や窓が浮けば効いてる証拠。AIの生グラデ(下が明るい)は使ってないのでここにも出ない。出力(Syphon)は通常のまま。"
                >
                  <span className="il2-sw-track">
                    <span className="il2-sw-knob" />
                  </span>
                  <span className="il2-sw-nm">
                    DEPTH MAP<i>確認</i>
                  </span>
                  <span className="il2-sw-st">{engine.showDepth ? 'ON' : 'OFF'}</span>
                </button>
                <div className="il2-segrow">
                  <span className="il2-seglbl">STATUS</span>
                  <span className="il2-pv">{depthStatLabel}</span>
                </div>
              </div>

              <div className="il2-sec">
                <div className="il2-eb">
                  <span className="il2-kind">道具</span>
                  <b>TOOLS</b>
                </div>
                <div className="il2-tiles">
                  <button
                    className={'il2-tile' + (engine.pieceCreating ? ' on' : '')}
                    onClick={() => engine.setPieceCreating(!engine.pieceCreating)}
                    title="写真の上をドラッグしてピースを切り出し"
                  >
                    ピース
                  </button>
                </div>
                {(engine.isActiveSceneWarped() || engine.selectedPieceId) && (
                  <div className="il2-minirow">
                    {engine.isActiveSceneWarped() && (
                      <button
                        className="il-mini"
                        onClick={() => engine.setActiveSceneWarpBox(null)}
                        title="写真のワープをリセット"
                      >
                        ワープ解除
                      </button>
                    )}
                    {engine.selectedPieceId && (
                      <button
                        className="il-mini"
                        onClick={() => engine.removeSelectedPiece()}
                        title="選択中のピースを削除（Deleteでも）"
                      >
                        ピース削除
                      </button>
                    )}
                  </div>
                )}
              </div>

                </>
              )}
              {hudTab === 'decor' && (
              <div className="il2-sec">
                <div className="il2-eb">
                  <span className="il2-kind">電飾</span>
                  <b>DECOR</b>
                </div>
                <button
                  className={'il2-switch' + (engine.decor.enabled ? ' on' : '')}
                  onClick={() => engine.setDecor({ enabled: !engine.decor.enabled })}
                  title="マスク(アルファ)の中に電飾パターンを描く（卓なし・見た目だけ／公演ファイルに保存）"
                >
                  <span className="il2-sw-track">
                    <span className="il2-sw-knob" />
                  </span>
                  <span className="il2-sw-nm">DECOR<i>電飾</i></span>
                  <span className="il2-sw-st">{engine.decor.enabled ? 'ON' : 'OFF'}</span>
                </button>
                <div className="il2-minirow">
                  <button
                    className={'il-mini' + (engine.maskImage ? ' learnon' : '')}
                    style={{ flex: 1, textAlign: 'center' }}
                    onClick={() => maskInputRef.current?.click()}
                    title="アルファ付きチャート（透過PNG）を読み込む＝電飾の土台"
                  >
                    {engine.maskImage ? 'CHART LOADED' : 'LOAD CHART'}
                  </button>
                  {engine.maskImage && (
                    <button
                      className="il-mini"
                      style={{ flexShrink: 0, minWidth: 58 }}
                      onClick={() => engine.setMaskFromDataUrl(null)}
                      title="チャートを外す"
                    >
                      CLEAR
                    </button>
                  )}
                </div>
                {!engine.maskImage && (
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 11,
                      lineHeight: 1.4,
                      color: 'var(--il-faint)',
                      letterSpacing: '0.02em'
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "'Bebas Neue',sans-serif",
                        letterSpacing: '0.08em',
                        color: 'var(--il-dim)'
                      }}
                    >
                      LOAD ALPHA CHART
                    </span>
                    <br />
                    透過チャートを読み込むと電飾が出ます
                  </div>
                )}
                <div className="il2-eb" style={{ marginTop: 9 }}>
                  <span className="il2-kind">形</span>
                  <b>PATTERN</b>
                </div>
                <div className="il2-tiles">
                  {(
                    [
                      ['h', 'STRIPE H'],
                      ['v', 'STRIPE V'],
                      ['outline', 'OUTLINE'],
                      ['dot', 'DOTS'],
                      ['grid', 'GRID'],
                      ['diag', 'DIAG'],
                      ['brick', 'BRICK'],
                      ['checker', 'CHECK'],
                      ['ring', 'RINGS']
                    ] as [DecorPatternKind, string][]
                  ).map(([k, lbl]) => (
                    <button
                      key={k}
                      className={'il2-tile' + (engine.decor.kind === k ? ' on' : '')}
                      onClick={() => engine.setDecor({ kind: k })}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
                <div className="il2-eb" style={{ marginTop: 9 }}>
                  <span className="il2-kind">動き</span>
                  <b>MOTION</b>
                </div>
                <div className="il2-fxgrid">
                  {DECOR_FX.map(([k, ab, n, ds]) => (
                    <button
                      key={k}
                      className={'il2-tile' + (engine.decor.effect === k ? ' on' : '')}
                      onClick={() => engine.setDecor({ effect: k })}
                      title={n + ' — ' + ds}
                    >
                      {ab}
                    </button>
                  ))}
                </div>
                <div className="il2-eb" style={{ marginTop: 9 }}>
                  <span className="il2-kind">向き</span>
                  <b>DIRECTION</b>
                  {DECOR_NONDIR.includes(engine.decor.effect) && (
                    <span style={{ fontSize: 10, color: 'var(--il-faint)', marginLeft: 'auto' }}>
                      N/A
                    </span>
                  )}
                </div>
                <div
                  className={'il2-seg' + (DECOR_NONDIR.includes(engine.decor.effect) ? ' dis' : '')}
                >
                  {DECOR_DIRS.map(([d, lbl]) => (
                    <button
                      key={d}
                      className={engine.decor.direction === d ? 'on' : ''}
                      onClick={() => engine.setDecor({ direction: d })}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
                <div className="il2-eb" style={{ marginTop: 9 }}>
                  <span className="il2-kind">色</span>
                  <b>COLOR</b>
                </div>
                <div className="il2-minirow">
                  <label
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 11,
                      color: 'var(--il-dim)'
                    }}
                  >
                    <input
                      type="color"
                      value={rgbToHex(engine.decor.color1)}
                      onChange={(e) => engine.setDecor({ color1: hexToRgb(e.target.value) })}
                      style={{
                        width: 30,
                        height: 24,
                        padding: 0,
                        border: '0.5px solid var(--il-line)',
                        background: 'transparent',
                        borderRadius: 4
                      }}
                    />
                    C1
                  </label>
                  <label
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 11,
                      color: 'var(--il-dim)'
                    }}
                  >
                    <input
                      type="color"
                      value={rgbToHex(engine.decor.color2)}
                      onChange={(e) => engine.setDecor({ color2: hexToRgb(e.target.value) })}
                      style={{
                        width: 30,
                        height: 24,
                        padding: 0,
                        border: '0.5px solid var(--il-line)',
                        background: 'transparent',
                        borderRadius: 4
                      }}
                    />
                    C2
                  </label>
                  <button
                    className="il-mini"
                    onClick={() => engine.setDecor({ playing: !engine.decor.playing })}
                    title="色の流れを再生／停止"
                  >
                    {engine.decor.playing ? 'STOP' : 'PLAY'}
                  </button>
                </div>
                <div className="il2-eb" style={{ marginTop: 9 }}>
                  <span className="il2-kind">設定</span>
                  <b>DETAIL</b>
                </div>
                <div className="il2-fader">
                  <span className="il2-nm">COLORS</span>
                  <input
                    type="range"
                    min={2}
                    max={16}
                    value={engine.decor.channels}
                    onChange={(e) => engine.setDecor({ channels: +e.target.value })}
                  />
                  <span className="il2-vv">{engine.decor.channels}</span>
                </div>
                <div className="il2-fader">
                  <span className="il2-nm">WIDTH</span>
                  <input
                    type="range"
                    min={1}
                    max={20}
                    value={engine.decor.thickness}
                    onChange={(e) => engine.setDecor({ thickness: +e.target.value })}
                  />
                  <span className="il2-vv">{engine.decor.thickness}</span>
                </div>
                <div className="il2-fader">
                  <span className="il2-nm">GAP</span>
                  <input
                    type="range"
                    min={4}
                    max={48}
                    value={engine.decor.lineSpacing}
                    onChange={(e) => engine.setDecor({ lineSpacing: +e.target.value })}
                  />
                  <span className="il2-vv">{engine.decor.lineSpacing}</span>
                </div>
                <div className="il2-fader">
                  <span className="il2-nm">SPEED</span>
                  <input
                    type="range"
                    min={2}
                    max={30}
                    value={Math.round(engine.decor.speed * 10)}
                    onChange={(e) => engine.setDecor({ speed: +e.target.value / 10 })}
                  />
                  <span className="il2-vv">{engine.decor.speed.toFixed(1)}</span>
                </div>
              </div>

              )}
              {hudTab === 'setup' && (
              <div className="il2-sec">
                <div className="il2-eb">
                  <span className="il2-kind">設定</span>
                  <b>PRESET</b>
                </div>
                <button className="il2-preset" onClick={() => setPresetOpen(!presetOpen)}>
                  <span className="il2-pi">
                    <span className="il2-pk">解像度</span>
                    <span className="il2-pv">{outCapLabel}</span>
                  </span>
                  <span className="il2-pi">
                    <span className="il2-pk">落ち込み</span>
                    <span className="il2-pv">{falloffLabel}</span>
                  </span>
                  <span className="il2-chev">{presetOpen ? '▾' : '▸'}</span>
                </button>
                {presetOpen && (
                  <div className="il2-presetbody">
                    <div className="il2-segrow">
                      <span className="il2-seglbl">RES</span>
                      <div className="il2-seg">
                        {(
                          [
                            { label: 'なめらか', px: 1920 },
                            { label: 'バランス', px: 2560 },
                            { label: '高精細', px: 3840 }
                          ] as const
                        ).map(({ label, px }) => (
                          <button
                            key={label}
                            className={'il2-segbtn' + (engine.outCap === px ? ' on' : '')}
                            onClick={() => engine.setOutCap(px)}
                            title="NDI/Syphon出力の解像度。低いほど動きが滑らか・高いほど精細（本番=高精細／動き重視=なめらか）"
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="il2-segrow">
                      <span className="il2-seglbl">FALLOFF</span>
                      <div className="il2-seg">
                        {(
                          [
                            { label: 'ソフト', pow: 1.5 },
                            { label: '標準', pow: 2.5 },
                            { label: 'きつめ', pow: 4 }
                          ] as const
                        ).map(({ label, pow }) => (
                          <button
                            key={label}
                            className={'il2-segbtn' + (engine.falloffPow === pow ? ' on' : '')}
                            onClick={() => engine.setFalloff(pow)}
                            title="ビームの落ち込みの強さ（手前を明るく・奥を暗く）"
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
              )}
              {hudTab === 'light' && ref && (
                <div className="il2-sec">
                  <div className="il2-eb">
                    <span className="il2-kind">選択灯体</span>
                    <b>SELECTED</b>
                  </div>
                  <RigRow
                    label="出口幅"
                    min={8}
                    max={180}
                    value={ref?.w0 ?? 40}
                    onChange={(v) => engine.setRig('w0', v)}
                    engine={engine}
                    learnId="rig.w0"
                  />
                  <RigRow
                    label="広がり"
                    min={20}
                    max={700}
                    value={ref?.w1 ?? 260}
                    onChange={(v) => engine.setRig('w1', v)}
                    engine={engine}
                    learnId="rig.w1"
                  />
                  <RigRow
                    label="伸び"
                    min={80}
                    max={1000}
                    value={ref?.len ?? 600}
                    onChange={(v) => engine.setRig('len', v)}
                    engine={engine}
                    learnId="rig.len"
                  />
                  <div className="il2-act">
                    <button
                      className="il-mini"
                      onClick={() => engine.removeSelected()}
                      title="Delete / Backspace キーでも消せます"
                    >
                      Delete  (Del)
                    </button>
                  </div>
                </div>
              )}
            </div>

            {hudTab === 'light' && (
              <>
            <StrobeSpecial engine={engine} />

            <div className="il-card">
              <div className="il-cardhd">
                <span className="il-stepn">1</span>Select
              </div>
              <div className="il-strip">
                <button
                  className={'il-fxall' + (engine.isAllSelected() ? ' on' : '')}
                  onClick={() => engine.selectAll()}
                  title="全灯まとめて"
                >
                  <span className="nm">ALL</span>
                </button>
                {engine.beams.map((b, i) => (
                  <button
                    key={i}
                    className={
                      'il-fix' +
                      (engine.isSelected(i) ? ' on' : '') +
                      (b.mute ? ' muted' : '') +
                      (b.solo ? ' soloed' : '')
                    }
                    onClick={(ev) =>
                      ev.shiftKey ? engine.toggleSelectBeam(i) : engine.selectBeam(i)
                    }
                    title={'灯体 ' + (i + 1)}
                  >
                    <span className="nm">{i + 1}</span>
                    <span
                      className="dot"
                      style={{ background: `rgb(${b.color[0]},${b.color[1]},${b.color[2]})` }}
                    />
                    <span className="ms">
                      <b
                        className={'m' + (b.mute ? ' on' : '')}
                        onClick={(e) => {
                          e.stopPropagation()
                          engine.toggleMute(i)
                        }}
                      >
                        M
                      </b>
                      <b
                        className={'s' + (b.solo ? ' on' : '')}
                        onClick={(e) => {
                          e.stopPropagation()
                          engine.toggleSolo(i)
                        }}
                      >
                        S
                      </b>
                    </span>
                  </button>
                ))}
                {engine.beams.length < MAX_BEAMS && (
                  <button
                    className="il-fix addfx"
                    onClick={() => engine.addFixtureAuto()}
                    title="灯体を追加"
                  >
                    <span className="nm">＋</span>
                  </button>
                )}
              </div>
              <div className="il-lbl" style={{ marginTop: 8 }}>ALIGN（選んだ灯体をそろえる）</div>
              <div className="il2-act" style={{ flexWrap: 'wrap', gap: 4 }}>
                <button className="il-mini il-icn" title="左ぞろえ" onClick={() => engine.alignLeft()}><AlignIcon kind="left" /></button>
                <button className="il-mini il-icn" title="左右中央でそろえる" onClick={() => engine.alignCenterX()}><AlignIcon kind="cx" /></button>
                <button className="il-mini il-icn" title="右ぞろえ" onClick={() => engine.alignRight()}><AlignIcon kind="right" /></button>
                <button className="il-mini il-icn" title="上ぞろえ" onClick={() => engine.alignTop()}><AlignIcon kind="top" /></button>
                <button className="il-mini il-icn" title="上下中央でそろえる" onClick={() => engine.alignMiddle()}><AlignIcon kind="my" /></button>
                <button className="il-mini il-icn" title="下ぞろえ" onClick={() => engine.alignBottom()}><AlignIcon kind="bottom" /></button>
                <button className="il-mini il-icn" title="横に等間隔（3つ以上選ぶ）" onClick={() => engine.distributeX()}><AlignIcon kind="dx" /></button>
                <button className="il-mini il-icn" title="縦に等間隔（3つ以上選ぶ）" onClick={() => engine.distributeY()}><AlignIcon kind="dy" /></button>
              </div>
              <div className="il-lbl" style={{ marginTop: 6 }}>Add</div>
            <div className="il-frow" style={{ gap: 4, flexWrap: 'wrap' }}>
              {([
                { type: 'streetlamp' as const, label: 'Street' },
                { type: 'chandelier' as const, label: 'Chandelier' },
                { type: 'marquee' as const, label: 'Marquee' },
                { type: 'bulb' as const, label: 'Bulb' },
                { type: 'parlight' as const, label: 'PAR' },
                { type: 'blinder' as const, label: 'Mini' },
                { type: 'patt' as const, label: 'PAT' },
                { type: 'pixelpatt' as const, label: 'PixelPAT' },
                { type: 'stars' as const, label: 'Star' },
                { type: 'festoon' as const, label: 'Banner' },
              ]).map(({ type, label }) => (
                <button
                  key={type}
                  className="il-mini"
                  disabled={engine.beams.length >= MAX_BEAMS}
                  onClick={() => engine.addMotifAuto(type)}
                >
                  {label}
                </button>
              ))}
              <button
                className="il-mini"
                disabled={engine.beams.length >= MAX_BEAMS}
                onClick={() => imageMotifInputRef.current?.click()}
                title="画像生成などで作ったリアルな発光画像（黒背景）を灯体として読み込む。明るさだけで光ります"
              >
                画像
              </button>
            </div>
            </div>

            <div className="il-card">
              <div className="il-cardhd">
                <span className="il-stepn">2</span>Build
              </div>
            {ref?.motif && (
              <>
                <div className="il-lbl">
                  MOTIF SIZE
                </div>
                <div className="il-frow">
                  <input
                    type="range"
                    min={4}
                    max={600}
                    value={ref.motifDiam ?? 200}
                    onChange={(e) => engine.setMotifDiam(+e.target.value)}
                  />
                  <div className="il-val big">{ref.motifDiam ?? 200}px</div>
                </div>
                {ref.motif === 'marquee' && (
                  <>
                    <div className="il-lbl">
                      TEXT
                    </div>
                    <div className="il-frow">
                      <input
                        type="text"
                        value={ref.motifText ?? 'LIVE'}
                        maxLength={16}
                        style={{ flex: 1, background: 'var(--il-inset)', color: 'var(--il-txt)', border: '0.5px solid var(--il-line)', padding: '2px 6px', fontSize: 13 }}
                        onChange={(e) => engine.setMotifText(e.target.value)}
                      />
                    </div>
                    <div className="il-lbl">
                      CHASE SPEED
                    </div>
                    <div className="il-frow">
                      <input
                        type="range"
                        min={1}
                        max={40}
                        value={Math.round(ref.motifSpeed ?? 8)}
                        onChange={(e) => engine.setMotifSpeed(+e.target.value)}
                      />
                      <div className="il-val big">{Math.round(ref.motifSpeed ?? 8)}</div>
                    </div>
                    <div className="il-frow" style={{ gap: 6 }}>
                      <button
                        className={'il-mini' + (ref.motifReverse ? ' learnon' : '')}
                        onClick={() => engine.setMotifReverse(!ref.motifReverse)}
                      >
                        {ref.motifReverse ? '← 逆方向' : '→ 正方向'}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}

            <div className="il-lbl">
              GAUGE
            </div>
            <div className="il-frow">
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round((ref?.gauge ?? 0) * 100)}
                onChange={(e) => engine.setGauge(+e.target.value)}
              />
              <div className="il-val big">{Math.round((ref?.gauge ?? 0) * 100)}%</div>
            </div>

            <div className="il-lbl">COLOR</div>
            <div className="il-swatches" style={{ opacity: colorLocked ? 0.6 : 1 }}>
              {COLORS.map((cc) => (
                <span className="il-sw-cell" key={cc.hex}>
                  <button
                    className={ref && sameRgb(ref.color, cc.rgb) ? 'on' : ''}
                    style={{ background: cc.hex }}
                    draggable
                    onDragStart={(e) =>
                      e.dataTransfer.setData('application/x-il-color', JSON.stringify(cc.rgb))
                    }
                    onClick={() => {
                      if (!colorLocked) engine.setColor(cc.rgb.slice() as RGB3)
                    }}
                    title="クリックで適用／ドラッグで流す色へ"
                  />
                </span>
              ))}
            </div>
            <div
              className="il-frow"
              style={{
                marginTop: 3,
                opacity: colorLocked ? 0.4 : 1,
                pointerEvents: colorLocked ? 'none' : 'auto'
              }}
            >
              <input
                ref={colorPickRef}
                type="color"
                value={ref ? rgbToHex(ref.color) : '#ffa848'}
                className="il-colorpick"
                onChange={(e) => engine.setColor(hexToRgb(e.target.value))}
              />
              <span className="il-hex">{ref ? rgbToHex(ref.color).toUpperCase() : ''}</span>
              <button
                className="il-mini"
                onClick={() => {
                  if (colorPickRef.current)
                    engine.addUserColor(hexToRgb(colorPickRef.current.value))
                }}
              >
                ★保存
              </button>
            </div>
            <div className="il-swatches">
              {engine.userColors.map((rgb, i) => (
                <button
                  key={i}
                  style={{ background: `rgb(${rgb[0]},${rgb[1]},${rgb[2]})` }}
                  title={
                    rgbToHex(rgb).toUpperCase() +
                    '（クリック適用／ドラッグで流す色へ／右クリック削除）'
                  }
                  draggable
                  onDragStart={(e) =>
                    e.dataTransfer.setData('application/x-il-color', JSON.stringify(rgb))
                  }
                  onClick={() => engine.setColor(rgb.slice() as RGB3)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    engine.removeUserColor(i)
                  }}
                />
              ))}
            </div>

            <div className="il-lbl">
              PAN / TILT / ZOOM
            </div>
            <PoseRow
              label="PAN"
              min={-90}
              max={90}
              value={ref?.pan ?? 0}
              fmt={(v) => v + '°'}
              onChange={(v) => engine.setPan(v)}
              engine={engine}
              learnId="pose.pan"
            />
            <PoseRow
              label="TILT"
              min={-180}
              max={180}
              value={ref?.tilt ?? 0}
              fmt={(v) => v + '°'}
              onChange={(v) => engine.setTilt(v)}
              engine={engine}
              learnId="pose.tilt"
            />
            <PoseRow
              label="ZOOM"
              min={15}
              max={400}
              value={Math.round((ref?.zoom ?? 1) * 100)}
              fmt={(v) => '×' + (v / 100).toFixed(2)}
              onChange={(v) => engine.setZoom(v / 100)}
              engine={engine}
              learnId="pose.zoom"
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="il-mini" onClick={() => engine.home()}>
                Home
              </button>
            </div>
            </div>

            <div className="il-card">
              <div className="il-cardhd">
                <span className="il-stepn">3</span>Effect
              </div>
            <div className="il-fxgrid">
              {FX_BUTTONS.map((b) => {
                const learning = engine.learnFx === b.key
                const assigned = engine.fxMidi[b.key] != null || engine.fxKey[b.key] != null
                return (
                  <div key={b.key} className={'il-fxcell' + (engine.fxState(b.key) ? ' on' : '')}>
                    <span className="il-fx-led" aria-hidden="true" />
                    <button className="il-fxbtn" onClick={() => engine.fxToggle(b.key)}>
                      {b.label}
                    </button>
                    <button
                      className={'il-fx-learn' + (learning ? ' on' : assigned ? ' assigned' : '')}
                      title={
                        learning
                          ? '待機中… MIDIノートかキーを入力（Escで中止）'
                          : assigned
                            ? '割当済み（クリックで再割当・右クリックで解除）'
                            : 'MIDI/キーを割当'
                      }
                      onClick={(e) => {
                        e.stopPropagation()
                        engine.setLearnFx(learning ? null : b.key)
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        engine.clearFxShortcut(b.key)
                      }}
                    >
                      ◎
                    </button>
                  </div>
                )
              })}
            </div>
            <div className="il-fxparams">
              {activeFx.map((b) => (
                <FxParamBlock key={b.key} engine={engine} fxKey={b.key} />
              ))}
              {engine.fxState('colorchase') && <ChasePaletteEditor engine={engine} />}
            </div>
            </div>

            <div className="il-card">
              <div className="il-cardhd">
                <span className="il-stepn">4</span>明かりに保存
              </div>
            <button
              className="il-mini"
              style={{
                alignSelf: 'flex-start',
                borderColor: engine.armedSave ? 'var(--il-amber)' : '',
                color: engine.armedSave ? 'var(--il-amber)' : ''
              }}
              onClick={() => engine.toggleArmSave()}
            >
              {engine.armedSave
                ? '↓ 保存する番号をクリック（取消はもう一度）'
                : '● いまの明かりをシーンへ保存'}
            </button>
            <div className="il-buildpats">
              {engine.patterns.map((p, i) => (
                <div
                  key={i}
                  className={'il-patrow' + (engine.armedSave ? ' armed' : '')}
                  onClick={() => {
                    // armed保存で、その番号に既に明かりが入っているときだけ上書き確認（空きは確認なし）
                    if (
                      engine.armedSave &&
                      engine.patterns[i] &&
                      !window.confirm(`番号 ${i + 1} を上書きしますか？（⌘Zで戻せます）`)
                    )
                      return
                    engine.patternSlotClick(i)
                  }}
                >
                  <span className="pn">{i + 1}</span>
                  <span className="pname" onClick={(e) => e.stopPropagation()}>
                    {renaming?.i === i ? (
                      <input
                        autoFocus
                        value={renaming.value}
                        onChange={(e) => setRenaming({ i, value: e.target.value })}
                        onKeyDown={(e) => {
                          e.stopPropagation()
                          if (e.key === 'Enter') {
                            engine.renamePattern(i, renaming.value)
                            setRenaming(null)
                          } else if (e.key === 'Escape') setRenaming(null)
                        }}
                        onBlur={() => {
                          engine.renamePattern(i, renaming.value)
                          setRenaming(null)
                        }}
                      />
                    ) : (
                      <span
                        style={{ cursor: p ? 'text' : 'default' }}
                        onDoubleClick={(e) => {
                          e.stopPropagation()
                          if (p) setRenaming({ i, value: p.name })
                        }}
                      >
                        {p ? p.name : '（空き）'}
                      </span>
                    )}
                  </span>
                  <span className="pkey">
                    {p
                      ? [codeLabel(p.key), p.midi != null ? 'N' + p.midi : '']
                          .filter(Boolean)
                          .join(' ')
                      : ''}
                  </span>
                  <button
                    className={
                      'il-ic' +
                      (engine.learnPattern === i ? ' learnon' : '') +
                      (p && (p.key || p.midi != null) && engine.learnPattern !== i
                        ? ' assigned'
                        : '')
                    }
                    title={
                      engine.learnPattern === i
                        ? '割当待ち（キーかMIDIを押す・もう一度で中止）'
                        : p && (p.key || p.midi != null)
                          ? '割当済み（クリックで再割当）'
                          : 'LEARN — このシーンを呼ぶキー/MIDIを覚えさせる'
                    }
                    onClick={(e) => {
                      e.stopPropagation()
                      if (!p) return
                      engine.setLearnPattern(engine.learnPattern === i ? null : i)
                    }}
                  >
                    {engine.learnPattern === i
                      ? '◎'
                      : p && (p.key || p.midi != null)
                        ? [codeLabel(p.key), p.midi != null ? 'N' + p.midi : '']
                            .filter(Boolean)
                            .join(' ')
                        : '○'}
                  </button>
                  <button
                    className="il-ic"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (p) setRenaming({ i, value: p.name })
                    }}
                  >
                    ✎
                  </button>
                  {p && (
                    <button
                      className="il-ic del"
                      title="この明かりを消す（⌘Zで戻せる）"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (window.confirm(`番号 ${i + 1} の明かりを消しますか？（⌘Zで戻せます）`))
                          engine.clearPattern(i)
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
              <button className="il-mini" onClick={() => engine.addSceneSlot()}>
                ＋ シーンを追加
              </button>
              {engine.patterns.length > 9 &&
                engine.patterns[engine.patterns.length - 1] === null && (
                  <button className="il-mini" onClick={() => engine.removeLastSceneSlot()}>
                    − 空きを減らす
                  </button>
                )}
            </div>
            </div>
              </>
            )}
            </div>

            <div className="il2hud-foot">
              {(ms.mute > 0 || ms.solo > 0) && (
                <button
                  className="il-msnotice"
                  onClick={() => engine.clearAllMuteSolo()}
                  title="押すと全部の M（消す）/ S（これだけ）を解除します"
                >
                  {[ms.solo > 0 ? `ソロ中 ${ms.solo}台` : '', ms.mute > 0 ? `ミュート中 ${ms.mute}台` : '']
                    .filter(Boolean)
                    .join('・')}{' '}
                  — 押して全解除
                </button>
              )}
              <div className="il-livebtns">
                <button
                  className="il-livebtn blackout"
                  onClick={() => engine.blackout()}
                  title="即座に暗転（キー: 0）"
                >
                  暗転
                </button>
                <button
                  className="il-livebtn panic"
                  onClick={() => engine.panicFade()}
                  title="ふわっと消す（キー: Esc）"
                >
                  パニック
                </button>
                <button
                  className="il-livebtn full"
                  onClick={() => engine.fullOn()}
                  title="全部点ける（キー: F）"
                >
                  全点灯
                </button>
                <button
                  className="il-livebtn undo"
                  onClick={() => engine.undo()}
                  title="ひとつ前に戻す（⌘Z）"
                >
                  戻す
                </button>
              </div>
            </div>
          </aside>
        )}
      </div>
      {engine.learnScene !== null && (
        <div className="il-learn-overlay" onClick={() => engine.setLearnScene(null)}>
          <div className="il-learn-card" onClick={(e) => e.stopPropagation()}>
            <div className="il-learn-eyebrow">SCENE LEARN</div>
            <div className="il-learn-big">何か MIDI を押してください</div>
            <div className="il-learn-scene">
              シーン：<b>{engine.scenes[engine.learnScene]?.name ?? ''}</b>
            </div>
            <div className="il-learn-hint">Esc キー／背景クリックで中止</div>
            <button className="il-learn-cancel" onClick={() => engine.setLearnScene(null)}>
              キャンセル
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ===== 小物 =====
/** 特別ボタン：マスター・ランダムストロボ。今の出力に上から点滅をかける（非破壊・トグル）＋MIDIラーン＋速さ。 */
function StrobeSpecial({ engine }: { engine: ImageLightEngine }): React.JSX.Element {
  const on = engine.strobeOverride
  const learning = engine.learnStrobe
  const assigned = engine.strobeMidi != null
  return (
    <>
      <div className="il-strobebox">
        <button
          className={'il-strobebtn' + (on ? ' on' : '')}
          onClick={() => engine.toggleStrobeOverride()}
          title="今の絵に上からランダムストロボ。もう一度押すと元のシーンに戻る"
        >
          Random Strobe
        </button>
        <button
          className={'il-fx-learn' + (learning ? ' on' : assigned ? ' assigned' : '')}
          title={
            learning
              ? '待機中… MIDIノートを入力（Escで中止）'
              : assigned
                ? 'MIDI割当済み（クリックで再割当・右クリックで解除）'
                : 'MIDIを割当'
          }
          onClick={(e) => {
            e.stopPropagation()
            engine.setLearnStrobe(!learning)
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            engine.clearStrobeShortcut()
          }}
        >
          ◎
        </button>
      </div>
      <div className="il-frow">
        <span className="il-falloff-lbl">Speed</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(engine.strobeRate * 100)}
          onChange={(e) => engine.setStrobeRate(+e.target.value / 100)}
        />
        <div className="il-val small">{Math.round(engine.strobeRate * 100)}</div>
      </div>
    </>
  )
}
function PoseRow({
  label,
  min,
  max,
  value,
  fmt,
  onChange,
  engine,
  learnId
}: {
  label: string
  min: number
  max: number
  value: number
  fmt: (v: number) => string
  onChange: (v: number) => void
  engine?: ImageLightEngine
  learnId?: string
}): React.JSX.Element {
  const learning = !!engine && !!learnId && engine.learnParam === learnId
  const cc = engine && learnId ? engine.paramMidi[learnId] : undefined
  return (
    <div className="il-frow">
      <span className="il-lbl" style={{ width: 34 }}>
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
      />
      <div className="il-val small">{fmt(value)}</div>
      {engine && learnId && (
        <button
          className={'il-cc' + (learning ? ' learnon' : cc != null ? ' set' : '')}
          title="MIDIつまみに割り当て（押してから物理つまみを回す／右クリックで解除）"
          onClick={() => engine.setLearnParam(learning ? null : learnId)}
          onContextMenu={(e) => {
            e.preventDefault()
            engine.clearParamMidi(learnId)
          }}
        >
          {learning ? '…' : cc != null ? 'CC' + cc : '◎'}
        </button>
      )}
    </div>
  )
}

function RigRow({
  label,
  min,
  max,
  value,
  onChange,
  engine,
  learnId
}: {
  label: string
  min: number
  max: number
  value: number
  onChange: (v: number) => void
  engine?: ImageLightEngine
  learnId?: string
}): React.JSX.Element {
  const learning = !!engine && !!learnId && engine.learnParam === learnId
  const cc = engine && learnId ? engine.paramMidi[learnId] : undefined
  return (
    <div className="il-frow" style={{ marginTop: 4 }}>
      <span className="il-lbl" style={{ width: 52 }}>
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
      />
      <div className="il-val small">{Math.round(value)}</div>
      {engine && learnId && (
        <button
          className={'il-cc' + (learning ? ' learnon' : cc != null ? ' set' : '')}
          title="MIDIつまみに割り当て（押してから物理つまみを回す／右クリックで解除）"
          onClick={() => engine.setLearnParam(learning ? null : learnId)}
          onContextMenu={(e) => {
            e.preventDefault()
            engine.clearParamMidi(learnId)
          }}
        >
          {learning ? '…' : cc != null ? 'CC' + cc : '◎'}
        </button>
      )}
    </div>
  )
}

function FxParamBlock({
  engine,
  fxKey
}: {
  engine: ImageLightEngine
  fxKey: FxKey
}): React.JSX.Element {
  const defs = FX_PARAMS[fxKey]
  return (
    <>
      <div className="il-fxh">— {FX_LABEL[fxKey]}</div>
      {defs.map((p, idx) => {
        const v = p.get(engine)
        const pid = fxKey + '.' + idx
        const cc = engine.paramMidi[pid]
        const learning = engine.learnParam === pid
        return (
          <div className="il-frow" key={idx}>
            <span className="il-lbl" style={{ width: 52 }}>
              {p.lbl}
            </span>
            <input
              type="range"
              min={p.min}
              max={p.max}
              value={v}
              onChange={(e) => p.set(engine, +e.target.value)}
            />
            <div className="il-val small">{p.fmt(v)}</div>
            <button
              className={'il-cc' + (learning ? ' learnon' : cc != null ? ' set' : '')}
              title="MIDIつまみに割り当て（押してから物理つまみを回す）"
              onClick={() => engine.setLearnParam(learning ? null : pid)}
            >
              {learning ? '…' : cc != null ? 'CC' + cc : '◎'}
            </button>
          </div>
        )
      })}
    </>
  )
}

/** カラフルチェイスで流す色並びの編集。COLOR欄の色をここへドラッグ＆ドロップで追加。
 *  空なら固定8色ぜんぶで流れる。チップをクリックで削除。色並び＝流れる順番。 */
function ChasePaletteEditor({ engine }: { engine: ImageLightEngine }): React.JSX.Element {
  const [over, setOver] = useState(false)
  const pal = engine.chasePalette
  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setOver(false)
    const raw = e.dataTransfer.getData('application/x-il-color')
    if (!raw) return
    try {
      const rgb = JSON.parse(raw) as RGB3
      if (Array.isArray(rgb) && rgb.length === 3) engine.addChaseColor(rgb)
    } catch {
      /* 不正なドロップは無視 */
    }
  }
  return (
    <div className="il-chasepal">
      <div className="il-chasepal-h">
        流す色（上のCOLORからドラッグ）
        {pal.length > 0 && (
          <button className="il-chasepal-clear" onClick={() => engine.clearChasePalette()}>
            クリア
          </button>
        )}
      </div>
      <div
        className={'il-chasepal-drop' + (over ? ' over' : '')}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        {pal.length === 0 ? (
          <span className="il-chasepal-empty">ここに色をドラッグ（空＝8色ぜんぶで流れます）</span>
        ) : (
          pal.map((rgb, i) => (
            <span
              key={i}
              className="il-chasepal-chip"
              style={{ background: `rgb(${rgb[0]},${rgb[1]},${rgb[2]})` }}
              title="クリックで削除"
              onClick={() => engine.removeChaseColor(i)}
            />
          ))
        )}
      </div>
    </div>
  )
}

/** 写真棚サムネ（オフスクリーン canvas を表示用に転写）。 */
function ThumbCanvas({ thumb }: { thumb: HTMLCanvasElement }): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    c.width = 184
    c.height = 104
    c.getContext('2d')?.drawImage(thumb, 0, 0)
  }, [thumb])
  return <canvas ref={ref} />
}

/** SFXツマミ1個の定義（MIDI Learn・スライダー共通で使う唯一の正）。 */
export interface SfxParamDef {
  id: string // MIDI割当ID（'sfx.flame.height' 等）
  label: string
  min: number
  max: number
  step: number
  get: (e: ImageLightEngine) => number
  set: (e: ImageLightEngine, v: number) => void
}
const sp = (
  id: string, label: string, min: number, max: number, step: number,
  get: (e: ImageLightEngine) => number, set: (e: ImageLightEngine, v: number) => void
): SfxParamDef => ({ id, label, min, max, step, get, set })

/** 特効の全ツマミ（種類ごとに 主要core / 詳しくmore）。MIDI登録もUI描画もこれを使う。 */
export const SFX_PARAMS: Record<'flame' | 'sparkler' | 'rain' | 'smoke', { core: SfxParamDef[]; more: SfxParamDef[] }> = {
  flame: {
    core: [
      sp('sfx.flame.height', 'HEIGHT', 0.4, 2.2, 0.05, (e) => e.getFlameParams().height, (e, v) => e.setFlameParams({ height: v })),
      sp('sfx.flame.thick', 'WIDTH', 0.5, 2.4, 0.05, (e) => e.getFlameParams().thick, (e, v) => e.setFlameParams({ thick: v }))
    ],
    more: [
      sp('sfx.flame.dense', 'POWER', 0.4, 2, 0.05, (e) => e.getFlameParams().dense, (e, v) => e.setFlameParams({ dense: v })),
      sp('sfx.flame.churn', 'CHURN', 0.3, 2, 0.05, (e) => e.getFlameParams().churn, (e, v) => e.setFlameParams({ churn: v })),
      sp('sfx.flame.speed', 'SPEED', 0.3, 2, 0.05, (e) => e.getFlameParams().speed, (e, v) => e.setFlameParams({ speed: v }))
    ]
  },
  sparkler: {
    core: [
      sp('sfx.spark.size', 'SIZE', 0.4, 2.5, 0.05, (e) => e.getSparklerParams().size, (e, v) => e.setSparklerParams({ size: v })),
      sp('sfx.spark.rate', 'RATE', 0.4, 3, 0.05, (e) => e.getSparklerParams().rate, (e, v) => e.setSparklerParams({ rate: v })),
      sp('sfx.spark.height', 'HEIGHT', 0.3, 2.2, 0.05, (e) => e.getSparklerParams().height, (e, v) => e.setSparklerParams({ height: v }))
    ],
    more: [
      sp('sfx.spark.spread', 'SPREAD', 0, 0.6, 0.02, (e) => e.getSparklerParams().spread, (e, v) => e.setSparklerParams({ spread: v })),
      sp('sfx.spark.trail', 'TRAIL', 0, 2, 0.05, (e) => e.getSparklerParams().trail, (e, v) => e.setSparklerParams({ trail: v })),
      sp('sfx.spark.bright', 'BRIGHT', 0.6, 2, 0.05, (e) => e.getSparklerParams().bright, (e, v) => e.setSparklerParams({ bright: v })),
      sp('sfx.spark.warm', 'COLOR', 0, 1, 0.02, (e) => e.getSparklerParams().warm, (e, v) => e.setSparklerParams({ warm: v }))
    ]
  },
  rain: {
    core: [
      sp('sfx.rain.col', 'RAIN/SNOW', 0, 1, 0.02, (e) => e.getRainParams().col, (e, v) => e.setRainParams({ col: v })),
      sp('sfx.rain.amount', 'AMOUNT', 0.2, 3, 0.05, (e) => e.getRainParams().amount, (e, v) => e.setRainParams({ amount: v })),
      sp('sfx.rain.opacity', 'OPACITY', 0.1, 1.5, 0.05, (e) => e.getRainParams().opacity, (e, v) => e.setRainParams({ opacity: v }))
    ],
    more: [
      sp('sfx.rain.speed', 'SPEED', 0.2, 2.2, 0.05, (e) => e.getRainParams().speed, (e, v) => e.setRainParams({ speed: v })),
      sp('sfx.rain.len', 'LENGTH', 0.2, 2.5, 0.05, (e) => e.getRainParams().len, (e, v) => e.setRainParams({ len: v })),
      sp('sfx.rain.wid', 'WIDTH', 0.4, 3, 0.05, (e) => e.getRainParams().wid, (e, v) => e.setRainParams({ wid: v })),
      sp('sfx.rain.wind', 'WIND', -1, 1, 0.05, (e) => e.getRainParams().wind, (e, v) => e.setRainParams({ wind: v }))
    ]
  },
  smoke: {
    core: [
      sp('sfx.smoke.density', 'DENSITY', 0.2, 2, 0.05, (e) => e.getLowSmokeParams().density, (e, v) => e.setLowSmokeParams({ density: v })),
      sp('sfx.smoke.cx', 'POS X', 0, 1, 0.01, (e) => e.getLowSmokeParams().cx, (e, v) => e.setLowSmokeParams({ cx: v })),
      sp('sfx.smoke.floory', 'FLOOR', 0, 0.9, 0.01, (e) => e.getLowSmokeParams().floory, (e, v) => e.setLowSmokeParams({ floory: v })),
      sp('sfx.smoke.width', 'WIDTH', 0.05, 0.6, 0.01, (e) => e.getLowSmokeParams().width, (e, v) => e.setLowSmokeParams({ width: v })),
      sp('sfx.smoke.top', 'HEIGHT', 0.03, 0.6, 0.01, (e) => e.getLowSmokeParams().top, (e, v) => e.setLowSmokeParams({ top: v }))
    ],
    more: [
      sp('sfx.smoke.billow', 'BILLOW', 0, 0.4, 0.01, (e) => e.getLowSmokeParams().billow, (e, v) => e.setLowSmokeParams({ billow: v })),
      sp('sfx.smoke.speed', 'DRIFT', 0.2, 2.5, 0.05, (e) => e.getLowSmokeParams().speed, (e, v) => e.setLowSmokeParams({ speed: v }))
    ]
  }
}

/** SFXツマミ1行（横1列＝密）。スライダー＋値＋MIDI Learn(◎)。 */
function SfxRow({ engine, p }: { engine: ImageLightEngine; p: SfxParamDef }): React.JSX.Element {
  const value = p.get(engine)
  const cc = engine.paramMidi[p.id]
  const learning = engine.learnParam === p.id
  return (
    <div className="il-frow">
      <span className="il-lbl" style={{ width: 60 }}>{p.label}</span>
      <input type="range" min={p.min} max={p.max} step={p.step} value={value}
        onChange={(e) => p.set(engine, parseFloat(e.target.value))} />
      <div className="il-val small">{value.toFixed(2)}</div>
      <button
        className={'il-cc' + (learning ? ' learnon' : cc != null ? ' set' : '')}
        title="MIDIつまみ/フェーダーに割り当て（押して物理を動かす／右クリックで解除）"
        onClick={() => engine.setLearnParam(learning ? null : p.id)}
        onContextMenu={(e) => { e.preventDefault(); engine.clearParamMidi(p.id) }}
      >
        {learning ? '…' : cc != null ? 'CC' + cc : '◎'}
      </button>
    </div>
  )
}

/** 特効ステップシーケンサー（ドラムマシン風の格子）。行＝置いた炎/火花、列＝ステップ。 */
function SeqGrid({ engine }: { engine: ImageLightEngine }): React.JSX.Element {
  const marks = engine.sfxMarks
  const steps = engine.sfxSeqStepCount
  const head = engine.sfxSeqPlaying ? engine.sfxSeqIndexNow : -1
  const cols = Array.from({ length: steps }, (_, i) => i)
  const seqMs = engine.sfxSeqMs
  return (
    <div className="il-seq">
      <div className="il-lbl"><b>STEP SEQUENCER</b>（マスをタップ）</div>
      <div className="il2-act" style={{ flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
        <button
          className={'il-mini' + (engine.sfxSeqPlaying ? ' on' : '')}
          onClick={() => engine.setSfxSeqPlay(!engine.sfxSeqPlaying)}
          title="組んだステップをテンポで自動ループ"
        >
          {engine.sfxSeqPlaying ? '■ STOP' : '▶ PLAY'}
        </button>
        <button className="il-mini" onClick={() => engine.setSfxSeqStepCount(steps - 1)} title="ステップを1つ減らす">−</button>
        <span className="il-lbl" style={{ minWidth: 64, textAlign: 'center' }}>{steps} STEPS</span>
        <button className="il-mini" onClick={() => engine.setSfxSeqStepCount(steps + 1)} title="ステップを1つ増やす">＋</button>
        <button className="il-mini" onClick={() => engine.sfxSeqClearCells()} title="マスを全部消す">CLEAR</button>
      </div>
      <div className="il-lbl" style={{ marginTop: 6 }}>SPEED {Math.round(seqMs)}ms / step</div>
      <input
        type="range"
        min="80"
        max="1500"
        step="10"
        value={seqMs}
        onChange={(e) => engine.setSfxSeqMs(parseFloat(e.target.value))}
      />
      {marks.length === 0 ? (
        <div className="il-lbl" style={{ marginTop: 8, opacity: 0.7 }}>
          Place FLAMER / SPARKLER (⌘+click) to add rows here.
        </div>
      ) : (
        <div className="il-seqgrid">
          <div className="il-seqhead">
            {cols.map((c) => (
              <div key={c} className={'il-seqnum' + (c === head ? ' head' : '')}>{c + 1}</div>
            ))}
          </div>
          {marks.map((m) => (
            <div className="il-seqrow" key={m.id}>
              <div className="il-seqlbl">
                <span style={{ color: m.motif === 'flame' ? '#ff9636' : '#e6e4b4' }}>
                  {m.motif === 'flame' ? 'F' : 'S'}
                </span>
                {m.idx + 1}
              </div>
              {cols.map((c) => (
                <button
                  key={c}
                  className={
                    'il-cell ' +
                    (m.motif === 'flame' ? 'flame' : 'spark') +
                    (engine.isSfxStepOn(m.id, c) ? ' on' : '') +
                    (c === head ? ' head' : '')
                  }
                  onClick={() => engine.toggleSfxStep(m.id, c)}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** 整列ボタンの絵アイコン（揃った形を実際に描く＝一目で分かる）。currentColorで色追従。 */
function AlignIcon({ kind }: { kind: 'left' | 'cx' | 'right' | 'top' | 'my' | 'bottom' | 'dx' | 'dy' }): React.JSX.Element {
  const f = 'currentColor'
  const guide = { stroke: f, strokeWidth: 1, opacity: 0.55, strokeDasharray: '1.5 1.5' }
  let body: React.JSX.Element
  switch (kind) {
    case 'left':
      body = (<>
        <rect x="1.5" y="2" width="1.4" height="12" fill={f} />
        <rect x="3.6" y="4" width="9" height="2.4" fill={f} />
        <rect x="3.6" y="9" width="5.5" height="2.4" fill={f} />
      </>); break
    case 'right':
      body = (<>
        <rect x="13.1" y="2" width="1.4" height="12" fill={f} />
        <rect x="3.5" y="4" width="9" height="2.4" fill={f} />
        <rect x="7" y="9" width="5.5" height="2.4" fill={f} />
      </>); break
    case 'cx':
      body = (<>
        <line x1="8" y1="1.5" x2="8" y2="14.5" {...guide} />
        <rect x="3.5" y="4" width="9" height="2.4" fill={f} />
        <rect x="5.25" y="9" width="5.5" height="2.4" fill={f} />
      </>); break
    case 'top':
      body = (<>
        <rect x="2" y="1.5" width="12" height="1.4" fill={f} />
        <rect x="4" y="3.6" width="2.4" height="9" fill={f} />
        <rect x="9" y="3.6" width="2.4" height="5.5" fill={f} />
      </>); break
    case 'bottom':
      body = (<>
        <rect x="2" y="13.1" width="12" height="1.4" fill={f} />
        <rect x="4" y="3.5" width="2.4" height="9" fill={f} />
        <rect x="9" y="7" width="2.4" height="5.5" fill={f} />
      </>); break
    case 'my':
      body = (<>
        <line x1="1.5" y1="8" x2="14.5" y2="8" {...guide} />
        <rect x="4" y="3.5" width="2.4" height="9" fill={f} />
        <rect x="9" y="5.25" width="2.4" height="5.5" fill={f} />
      </>); break
    case 'dx':
      body = (<>
        <rect x="2.3" y="3" width="2" height="10" fill={f} />
        <rect x="7" y="3" width="2" height="10" fill={f} />
        <rect x="11.7" y="3" width="2" height="10" fill={f} />
      </>); break
    case 'dy':
      body = (<>
        <rect x="3" y="2.3" width="10" height="2" fill={f} />
        <rect x="3" y="7" width="10" height="2" fill={f} />
        <rect x="3" y="11.7" width="10" height="2" fill={f} />
      </>); break
  }
  return <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">{body}</svg>
}

/** ステージ上の編集マーカー（番号＋M/S・本番出力には出ない）。論理座標→表示座標。 */
function drawMarkers(ctx: CanvasRenderingContext2D, engine: ImageLightEngine, scale: number): void {
  const { ox, oy } = viewFromEngine(ctx)
  ctx.setTransform(scale, 0, 0, scale, ox, oy)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const beams = engine.beams
  for (let i = 0; i < beams.length; i++) {
    const b = beams[i]
    const isSel = engine.isSelected(i)
    ctx.lineWidth = (isSel ? 2 : 1.2) / scale
    if (b.motif === 'flame') {
      // FLAMER は炎(雫)の形マークで照明(四角)と区別する
      ctx.strokeStyle = isSel ? 'rgba(120,255,160,0.95)' : 'rgba(255,150,60,0.9)'
      ctx.beginPath()
      ctx.moveTo(b.x, b.y - 14)
      ctx.bezierCurveTo(b.x + 12, b.y - 1, b.x + 8, b.y + 12, b.x, b.y + 12)
      ctx.bezierCurveTo(b.x - 8, b.y + 12, b.x - 12, b.y - 1, b.x, b.y - 14)
      ctx.closePath()
      ctx.stroke()
    } else if (b.motif === 'sparkler') {
      // SPARKLER は星(火花)マークで区別する
      ctx.strokeStyle = isSel ? 'rgba(120,255,160,0.95)' : 'rgba(230,228,180,0.95)'
      const R = 13
      ctx.beginPath()
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 4
        ctx.moveTo(b.x - Math.cos(a) * R, b.y - Math.sin(a) * R)
        ctx.lineTo(b.x + Math.cos(a) * R, b.y + Math.sin(a) * R)
      }
      ctx.stroke()
    } else {
      ctx.strokeStyle = isSel ? 'rgba(120,255,160,0.95)' : 'rgba(255,255,255,0.35)'
      ctx.strokeRect(b.x - 18, b.y - 10, 36, 20)
    }
    // 向き（噴き出す方向）を示す細い線（選択中の炎/火花だけ・TILTで決まる）。
    if (isSel && (b.motif === 'flame' || b.motif === 'sparkler')) {
      const dir = -Math.PI / 2 + ((b.tilt ?? 0) * Math.PI) / 180
      const L = 40
      ctx.strokeStyle = 'rgba(120,255,160,0.85)'
      ctx.lineWidth = 1.5 / scale
      ctx.beginPath()
      ctx.moveTo(b.x, b.y)
      ctx.lineTo(b.x + Math.cos(dir) * L, b.y + Math.sin(dir) * L)
      ctx.stroke()
    }
    ctx.font = '700 ' + 14 / scale + 'px sans-serif'
    const lit = engine.isLit(b)
    ctx.fillStyle = isSel
      ? 'rgba(120,255,160,1)'
      : lit
        ? 'rgba(255,255,255,0.85)'
        : 'rgba(255,110,110,0.55)'
    ctx.fillText(String(i + 1), b.x, b.y + 1)
    ctx.font = '700 ' + 11 / scale + 'px sans-serif'
    ctx.fillStyle = b.mute ? 'rgba(224,90,90,1)' : 'rgba(255,255,255,0.42)'
    ctx.fillText('M', b.x - 11, b.y + 17)
    ctx.fillStyle = b.solo ? 'rgba(34,211,238,1)' : 'rgba(255,255,255,0.42)'
    ctx.fillText('S', b.x + 11, b.y + 17)
  }
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}

/** ピースの枠 + 選択ピースの 4 隅ハンドルを描く（BUILD のみ、LW×LH 座標系）。
 *  非選択ピースは破線、選択中は実線＋琥珀ハンドル。 */
function drawPieceOverlays(
  ctx: CanvasRenderingContext2D,
  engine: ImageLightEngine,
  scale: number
): void {
  const scene = engine.activeScene >= 0 ? engine.scenes[engine.activeScene] : null
  if (!scene || !scene.pieces) return
  for (const piece of scene.pieces) {
    const isSel = piece.id === engine.selectedPieceId
    ctx.beginPath()
    ctx.moveTo(piece.corners[0].x, piece.corners[0].y)
    ctx.lineTo(piece.corners[1].x, piece.corners[1].y)
    ctx.lineTo(piece.corners[2].x, piece.corners[2].y)
    ctx.lineTo(piece.corners[3].x, piece.corners[3].y)
    ctx.closePath()
    ctx.strokeStyle = isSel ? 'rgba(251,191,36,0.95)' : 'rgba(232,226,218,0.5)'
    ctx.lineWidth = (isSel ? 2 : 1) / scale
    ctx.setLineDash(isSel ? [] : [4 / scale, 3 / scale])
    ctx.stroke()
    ctx.setLineDash([])
    if (isSel) {
      const HS = 12 / scale
      for (let i = 0; i < 4; i++) {
        const c = piece.corners[i]
        ctx.fillStyle = 'rgba(251,191,36,1)'
        ctx.strokeStyle = '#000'
        ctx.lineWidth = 1.5 / scale
        ctx.fillRect(c.x - HS / 2, c.y - HS / 2, HS, HS)
        ctx.strokeRect(c.x - HS / 2, c.y - HS / 2, HS, HS)
      }
    }
  }
}

/** ピース作成中のドラッグ矩形（点線の琥珀枠＋薄塗り）。 */
function drawPieceCreating(
  ctx: CanvasRenderingContext2D,
  rect: { start: { x: number; y: number }; end: { x: number; y: number } } | null,
  scale: number
): void {
  if (!rect) return
  const x = Math.min(rect.start.x, rect.end.x)
  const y = Math.min(rect.start.y, rect.end.y)
  const w = Math.abs(rect.end.x - rect.start.x)
  const h = Math.abs(rect.end.y - rect.start.y)
  if (w < 1 || h < 1) return
  ctx.strokeStyle = 'rgba(251,191,36,1)'
  ctx.lineWidth = 1.5 / scale
  ctx.setLineDash([6 / scale, 4 / scale])
  ctx.strokeRect(x, y, w, h)
  ctx.setLineDash([])
  ctx.fillStyle = 'rgba(251,191,36,0.12)'
  ctx.fillRect(x, y, w, h)
}

/** 写真の 4 辺スケールワープ用ハンドル + 写真枠を描く（BUILD のみ）。
 *  4 辺の中央に小さい四角ハンドル + 枠全体をうっすら細線で示す。
 *  draggingEdge が来ているハンドルは琥珀でハイライト。 */
function drawWarpHandles(
  ctx: CanvasRenderingContext2D,
  engine: ImageLightEngine,
  scale: number,
  draggingEdge: 'top' | 'bottom' | 'left' | 'right' | null
): void {
  const b = engine.box
  if (!b) return
  // 写真枠（うっすら白の細い線）
  ctx.strokeStyle = 'rgba(232,226,218,0.35)'
  ctx.lineWidth = 1 / scale
  ctx.setLineDash([])
  ctx.strokeRect(b.x, b.y, b.w, b.h)
  // ハンドル位置（LW×LH 座標系）
  const handles: { edge: 'top' | 'bottom' | 'left' | 'right'; x: number; y: number }[] = [
    { edge: 'top', x: b.x + b.w / 2, y: b.y },
    { edge: 'bottom', x: b.x + b.w / 2, y: b.y + b.h },
    { edge: 'left', x: b.x, y: b.y + b.h / 2 },
    { edge: 'right', x: b.x + b.w, y: b.y + b.h / 2 }
  ]
  const HS = 12 / scale // ハンドル正方形の一辺（画面ピクセル正規化）
  for (const h of handles) {
    const active = h.edge === draggingEdge
    ctx.fillStyle = active ? 'rgba(251,191,36,1)' : 'rgba(232,226,218,0.95)'
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 1.5 / scale
    ctx.fillRect(h.x - HS / 2, h.y - HS / 2, HS, HS)
    ctx.strokeRect(h.x - HS / 2, h.y - HS / 2, HS, HS)
  }
}

/** ドラッグ中の吸着ガイド（整列の赤い破線／等間隔の赤いマーカー）を描く。 */
function drawSnapGuides(
  ctx: CanvasRenderingContext2D,
  engine: ImageLightEngine,
  scale: number
): void {
  const g = engine.snapGuides
  if (!g) return
  ctx.strokeStyle = 'rgba(255,70,110,0.95)'
  ctx.lineWidth = 1.2 / scale
  ctx.setLineDash([7 / scale, 4 / scale])
  for (const x of g.vx) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, LH)
    ctx.stroke()
  }
  for (const y of g.hy) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(LW, y)
    ctx.stroke()
  }
  ctx.setLineDash([])
  // 等間隔マーカー: 区間の両端tick＋水平線（灯体の少し下に）
  for (const m of g.equal) {
    const yy = m.y + 30
    ctx.beginPath()
    ctx.moveTo(m.x0, yy)
    ctx.lineTo(m.x1, yy)
    ctx.moveTo(m.x0, yy - 5)
    ctx.lineTo(m.x0, yy + 5)
    ctx.moveTo(m.x1, yy - 5)
    ctx.lineTo(m.x1, yy + 5)
    ctx.stroke()
  }
}
// drawMarkers は scale/ox/oy を呼び出し側の transform から逆算するのではなく、
// tick が直前に設定した viewRef を使う。ここでは ox/oy を transform から取り出す。
function viewFromEngine(ctx: CanvasRenderingContext2D): { ox: number; oy: number } {
  const t = ctx.getTransform()
  return { ox: t.e, oy: t.f }
}

const IL_CSS = `
.il-root{--il-bg:#0a0a0a;--il-panel:#0c0b0a;--il-line:#2c2a27;--il-inset:#131211;--il-txt:#e8e2da;--il-dim:#9a917f;--il-faint:#6b6457;--il-amber:#fbbf24;--il-green:#a8e878;--il-cyan:#22d3ee;--il-red:#e0726a;
  height:100%;display:flex;flex-direction:column;background:var(--il-bg);color:var(--il-txt);font-family:'Noto Sans JP',sans-serif;overflow:hidden;}
.il-root *{box-sizing:border-box;}
.il-header{display:flex;align-items:baseline;gap:14px;padding:10px 16px 8px;}
.il-header h1{font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:0.14em;font-weight:400;}
.il-header small{font-size:12px;color:var(--il-dim);}
.il-main{flex:1;min-height:0;display:flex;}
.il-stage{flex:1;min-width:0;position:relative;background:#000;border-top:0.5px solid var(--il-line);}
.il-cv{width:100%;height:100%;display:block;}
.il-empty{position:absolute;top:0;left:0;right:0;bottom:56px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;cursor:pointer;pointer-events:auto;}
.il-empty-big{font-family:'Bebas Neue',sans-serif;font-size:15px;color:var(--il-dim);font-weight:400;letter-spacing:0.16em;border:0.5px dashed var(--il-line);border-radius:10px;padding:22px 34px;}
.il-empty-sub{font-size:12px;color:var(--il-faint);letter-spacing:0.02em;}
.il-hint{position:absolute;top:10px;left:14px;font-size:11.5px;color:var(--il-faint);pointer-events:none;line-height:1.6;}
.il-hint b{color:var(--il-amber);font-weight:500;}
.il-scenes{position:absolute;left:0;right:0;bottom:0;display:flex;gap:8px;align-items:flex-end;padding:8px 12px;background:rgba(10,9,8,0.74);border-top:0.5px solid var(--il-line);overflow-x:auto;}
.il-sc-wrap{flex:0 0 auto;display:flex;flex-direction:column;align-items:stretch;gap:4px;}
.il-sc{flex:0 0 auto;width:96px;cursor:pointer;border:0.5px solid var(--il-line);border-radius:6px;background:#000;padding:0;position:relative;}
.il-sc.on{border-color:var(--il-amber);}
.il-sc canvas{display:block;width:92px;height:52px;border-radius:4px;}
.il-sc-name{font-family:inherit;font-size:11px;font-weight:500;color:var(--il-txt);text-align:center;line-height:1.2;padding:3px 4px;border-radius:3px;cursor:text;max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.il-sc-name:hover{background:rgba(255,255,255,0.07);}
.il-sc-wrap.on .il-sc-name{color:var(--il-amber);font-weight:500;}
.il-sc-name-input{font-family:inherit;font-size:11px;font-weight:500;color:var(--il-txt);background:rgba(0,0,0,0.9);border:0.5px solid var(--il-amber);border-radius:3px;padding:3px 4px;width:96px;text-align:center;outline:none;box-sizing:border-box;}
.il-sc .il-sc-del{position:absolute;top:3px;right:3px;left:auto;bottom:auto;width:20px;height:20px;line-height:18px;text-align:center;border-radius:50%;background:rgba(20,16,14,0.9);border:1px solid var(--il-line);color:var(--il-txt);font-size:14px;font-family:inherit;cursor:pointer;opacity:1;text-shadow:none;z-index:2;}
.il-sc .il-sc-del:hover{background:var(--il-red);border-color:var(--il-red);color:#fff;}
.il-sc .il-sc-vid{position:absolute;top:2px;left:2px;bottom:auto;font-size:8px;line-height:14px;color:var(--il-cyan);background:rgba(34,211,238,0.12);border:0.5px solid var(--il-cyan);border-radius:3px;padding:0 4px;text-shadow:none;}
.il-sc .il-sc-learn{position:absolute;bottom:3px;right:3px;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;line-height:1;padding:3px 5px;border-radius:3px;background:rgba(20,16,14,0.85);color:var(--il-amber);border:1px solid var(--il-amber);cursor:pointer;text-shadow:none;letter-spacing:0.04em;user-select:none;}
.il-sc .il-sc-learn:hover{background:var(--il-amber);color:#111;}
.il-sc .il-sc-learn.assigned{color:var(--il-cyan);border-color:var(--il-cyan);}
.il-sc .il-sc-learn.assigned:hover{background:var(--il-cyan);color:#111;}
.il-sc .il-sc-learn.on{background:var(--il-amber);color:#111;border-color:var(--il-amber);animation:il-learn-blink 0.7s infinite;}
@keyframes il-learn-blink{0%,100%{opacity:1;}50%{opacity:0.55;}}
.il-sc-add{flex:0 0 auto;width:96px;height:80px;border:0.5px dashed var(--il-line);border-radius:6px;background:transparent;color:var(--il-faint);cursor:pointer;font-size:11px;font-family:inherit;align-self:flex-end;}
.il-learn-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.78);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);}
.il-learn-card{background:#1a1611;border:2px solid var(--il-amber);border-radius:10px;padding:36px 56px;text-align:center;min-width:420px;box-shadow:0 24px 60px rgba(0,0,0,0.6);}
.il-learn-eyebrow{font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--il-amber);letter-spacing:0.22em;margin-bottom:10px;}
.il-learn-big{font-size:26px;font-weight:700;color:var(--il-txt);margin-bottom:14px;line-height:1.25;}
.il-learn-scene{font-size:15px;color:var(--il-dim);margin-bottom:22px;}
.il-learn-scene b{color:var(--il-txt);font-weight:700;}
.il-learn-hint{font-size:11px;color:var(--il-dim);margin-bottom:16px;letter-spacing:0.04em;}
.il-learn-cancel{background:transparent;border:1px solid var(--il-dim);color:var(--il-dim);padding:7px 22px;border-radius:5px;cursor:pointer;font-family:inherit;font-size:13px;}
.il-learn-cancel:hover{border-color:var(--il-amber);color:var(--il-amber);}
.il-panel{width:330px;flex-shrink:0;background:var(--il-panel);border-top:0.5px solid var(--il-line);border-left:0.5px solid var(--il-line);padding:9px 12px 10px;display:flex;flex-direction:column;gap:7px;overflow-y:auto;}
.il-deskhead{display:flex;align-items:baseline;gap:8px;flex-wrap:nowrap;}
.il-deskhead b{font-size:16px;font-weight:700;letter-spacing:1px;white-space:nowrap;flex-shrink:0;}
.il-deskhead span{font-size:10px;color:var(--il-dim);flex-shrink:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.il-deskhead button{flex-shrink:0;white-space:nowrap;}
.il-lbl{font-family:'Bebas Neue',sans-serif;font-size:12px;letter-spacing:0.16em;color:var(--il-dim);border-bottom:0.5px solid var(--il-line);padding-bottom:3px;margin-top:1px;}
.il-lbl em{font-style:normal;color:var(--il-faint);letter-spacing:0;margin-left:6px;font-family:'Noto Sans JP',sans-serif;font-size:9.5px;}
/* CONSOLE: 機能をまとめる細枠ベイ */
.il-strip{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;}
.il-strip button{background:var(--il-inset);border:0.5px solid var(--il-line);border-radius:6px;color:var(--il-txt);padding:4px 2px 3px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px;min-height:42px;justify-content:center;}
.il-strip button.on{border-color:var(--il-amber);box-shadow:0 0 0 1px rgba(251,191,36,0.30) inset;}
.il-strip button.addfx{border-style:dashed;color:var(--il-dim);}
.il-strip .nm{font-family:'Bebas Neue',sans-serif;font-size:15px;line-height:1;}
.il-strip .fxall .nm,.il-fxall .nm{font-size:11px;}
.il-strip .dot{width:13px;height:3px;border-radius:2px;}
.il-strip button.muted .nm{opacity:0.35;text-decoration:line-through;}
.il-strip button.soloed{border-color:var(--il-cyan);}
.il-strip .ms{display:flex;gap:3px;}
.il-strip .ms b{font-size:9px;font-weight:700;width:20px;height:17px;line-height:17px;text-align:center;border-radius:3px;color:var(--il-dim);background:rgba(255,255,255,0.07);cursor:pointer;font-family:'JetBrains Mono',monospace;}
.il-strip .ms b.m.on{background:var(--il-red);color:#fff;}
.il-strip .ms b.s.on{background:var(--il-cyan);color:#111;}
.il-frow{display:flex;align-items:center;gap:8px;}
.il-root input[type=range]{flex:1;-webkit-appearance:none;appearance:none;height:22px;background:transparent;cursor:pointer;}
.il-root input[type=range]::-webkit-slider-runnable-track{height:3px;border-radius:2px;background:#403a33;}
.il-root input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;border-radius:50%;background:var(--il-amber);border:none;margin-top:-5px;}
.il-val{font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--il-amber);width:48px;text-align:right;font-feature-settings:'tnum';}
.il-val.small{font-size:11px;color:var(--il-txt);width:48px;}
.il-val.big{font-size:14px;width:48px;}
.il-swatches{display:flex;gap:6px;flex-wrap:wrap;}
.il-swatches button{width:27px;height:27px;border-radius:50%;border:1.5px solid transparent;cursor:pointer;padding:0;}
.il-swatches button.on{border-color:var(--il-amber);}
.il-sw-cell{position:relative;display:inline-block;line-height:0;}
.il-colorpick{width:42px;height:26px;padding:0;border:0.5px solid var(--il-line);border-radius:6px;background:none;cursor:pointer;}
.il-hex{font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--il-dim);flex:1;}
.il-fxgrid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;}
.il-fxcell{position:relative;}
.il-fxcell .il-fxbtn{width:100%;background:rgba(255,255,255,0.02);border:0.5px solid var(--il-line);color:var(--il-dim);padding:11px 0 10px;border-radius:6px;cursor:pointer;font-family:'Bebas Neue',sans-serif;font-size:12px;letter-spacing:1px;}
.il-fxcell.on .il-fxbtn{border-color:var(--il-amber);color:var(--il-amber);box-shadow:0 0 0 1px rgba(251,191,36,0.3) inset;}
.il-fx-led{position:absolute;top:4px;left:5px;width:5px;height:5px;border-radius:50%;background:var(--il-line);pointer-events:none;}
.il-fxcell.on .il-fx-led{background:var(--il-green);}
.il-fx-learn{position:absolute;top:2px;right:3px;width:22px;height:22px;line-height:20px;text-align:center;font-size:11px;border-radius:50%;background:rgba(20,16,14,0.7);color:var(--il-faint);border:0.5px solid var(--il-line);cursor:pointer;padding:0;user-select:none;}
.il-fx-learn:hover{color:var(--il-txt);border-color:var(--il-dim);}
.il-fx-learn.assigned{color:var(--il-cyan);border-color:var(--il-cyan);}
.il-fx-learn.on{color:#111;background:var(--il-amber);border-color:var(--il-amber);animation:il-learn-blink 0.7s infinite;}
.il-strobebox{position:relative;}
.il-strobebtn{width:100%;background:var(--il-inset);border:0.5px solid var(--il-line);color:var(--il-txt);padding:9px 11px;border-radius:6px;cursor:pointer;font-family:'Bebas Neue',sans-serif;font-size:14px;letter-spacing:0.1em;}
.il-strobebtn:hover{border-color:var(--il-dim);}
.il-strobebtn.on{background:var(--il-amber);color:#111;border-color:var(--il-amber);animation:il-strobe-on 0.8s ease-in-out infinite;}
@keyframes il-strobe-on{50%{opacity:0.55;}}
.il-toggles{display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-bottom:6px;}
.il-toggle{background:var(--il-inset);border:0.5px solid var(--il-line);color:var(--il-dim);padding:8px 12px;border-radius:5px;cursor:pointer;font-size:11px;font-family:inherit;letter-spacing:0.02em;}
.il-toggle.on{border-color:var(--il-green);color:var(--il-green);}
.il-falloff-lbl{font-family:'Bebas Neue',sans-serif;font-size:11px;letter-spacing:0.12em;color:var(--il-dim);align-self:center;margin-right:2px;}
.il-fxparams{display:flex;flex-direction:column;gap:5px;}
.il-fxh{font-size:8.5px;color:var(--il-green);font-family:'JetBrains Mono',monospace;letter-spacing:1.2px;margin-top:1px;}
.il-chasepal{display:flex;flex-direction:column;gap:4px;margin-top:2px;}
.il-chasepal-h{display:flex;align-items:center;gap:8px;font-size:8.5px;color:var(--il-green);font-family:'JetBrains Mono',monospace;letter-spacing:1px;}
.il-chasepal-clear{margin-left:auto;background:none;border:0.5px solid var(--il-line);color:var(--il-dim);border-radius:4px;font-size:9px;padding:1px 6px;cursor:pointer;font-family:inherit;}
.il-chasepal-drop{display:flex;flex-wrap:wrap;gap:5px;align-items:center;min-height:30px;padding:6px;border:1.5px dashed var(--il-line);border-radius:6px;background:var(--il-inset);}
.il-chasepal-drop.over{border-color:var(--il-green);background:rgba(168,232,120,0.08);}
.il-chasepal-empty{font-size:10px;color:var(--il-faint);}
.il-chasepal-chip{width:20px;height:20px;border-radius:5px;cursor:pointer;border:0.5px solid var(--il-line);}
.il-chasepal-chip:hover{outline:2px solid var(--il-red);outline-offset:1px;}
.il-playpats{display:flex;flex-direction:column;gap:6px;}
.il-patbig{display:flex;align-items:center;gap:8px;background:var(--il-inset);border:0.5px solid var(--il-line);border-radius:7px;padding:11px 10px;cursor:pointer;color:var(--il-txt);text-align:left;}
.il-patbig.on{border-color:var(--il-amber);box-shadow:0 0 0 1px rgba(251,191,36,.25) inset;}
.il-patbig.empty{opacity:0.3;cursor:default;}
.il-patbig .pn{font-family:'Bebas Neue',sans-serif;font-size:15px;color:var(--il-dim);width:14px;}
.il-patbig .pname{flex:1;font-size:13px;font-weight:600;color:var(--il-txt);}
.il-patbig .pkey{font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--il-faint);}
.il-buildpats{display:flex;flex-direction:column;gap:6px;}
.il-patrow{display:flex;align-items:center;gap:6px;background:var(--il-inset);border:0.5px solid var(--il-line);border-radius:6px;padding:8px 9px;cursor:pointer;}
.il-patrow.armed{border-color:var(--il-amber);box-shadow:0 0 0 1px rgba(251,191,36,.3) inset;}
.il-patrow .pn{font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--il-dim);width:12px;}
.il-patrow .pname{flex:1;font-size:11.5px;}
.il-patrow .pname input{width:100%;background:#15130f;border:0.5px solid var(--il-line);color:var(--il-txt);font-size:11.5px;border-radius:4px;padding:2px 4px;font-family:inherit;}
.il-patrow .pkey{font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--il-faint);min-width:26px;text-align:right;}
.il-ic{background:none;border:0.5px solid var(--il-line);color:var(--il-dim);border-radius:4px;font-size:10px;padding:5px 9px;cursor:pointer;font-family:inherit;}
.il-ic.learnon{border-color:var(--il-cyan);color:var(--il-cyan);}
.il-ic.assigned{border-color:var(--il-cyan);color:var(--il-cyan);}
.il-ic.del:hover{border-color:var(--il-red);color:#fff;background:var(--il-red);}
.il-cc{flex-shrink:0;background:var(--il-inset);border:0.5px solid var(--il-line);color:var(--il-dim);border-radius:4px;font-size:9px;padding:1px 5px;cursor:pointer;font-family:'JetBrains Mono',monospace;line-height:1.5;}
.il-cc.set{border-color:var(--il-amber);color:var(--il-amber);}
.il-cc.learnon{border-color:var(--il-cyan);color:var(--il-cyan);}
.il-mini{background:var(--il-inset);border:0.5px solid var(--il-line);color:var(--il-dim);padding:6px 11px;border-radius:5px;cursor:pointer;font-size:10.5px;font-family:inherit;}
.il-mini:hover{border-color:var(--il-dim);color:var(--il-txt);}
.il-mini:disabled{opacity:0.4;cursor:default;}
.il-mini.learnon{border-color:var(--il-cyan);color:var(--il-cyan);}
/* 整列の絵アイコンボタン（揃った形を描画・正方形に近い当たり判定） */
.il-mini.il-icn{min-width:32px;padding:5px 7px;line-height:0;color:var(--il-dim);display:inline-flex;align-items:center;justify-content:center;}
.il-mini.il-icn:hover{color:var(--il-txt);}
.il-root hr{border:none;border-top:0.5px solid var(--il-line);margin:0;}
.il-card{border:0.5px solid var(--il-line);border-radius:8px;padding:8px 11px;display:flex;flex-direction:column;gap:6px;}
.il-cardhd{display:flex;align-items:center;gap:7px;font-size:13px;color:var(--il-txt);}
.il-stepn{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:transparent;border:0.5px solid var(--il-amber);color:var(--il-amber);font-family:'Bebas Neue',sans-serif;font-size:13px;line-height:1;flex-shrink:0;}
.il-card .il-lbl{border-bottom:none;padding-bottom:0;}
.il2-console{display:flex;flex-direction:column;border:0.5px solid var(--il-line);border-radius:9px;background:rgba(0,0,0,0.18);padding:0 11px;}
.il2-sec{padding:11px 0 9px;border-top:none;}
.il2-sec:first-child{border-top:none;}
.il2-eb{display:flex;align-items:center;gap:10px;margin-bottom:9px;}
.il2-kind{display:none;}
.il2-eb b{font-family:'Bebas Neue',sans-serif;font-weight:400;font-size:11px;letter-spacing:0.24em;color:var(--il-faint);text-transform:uppercase;}
.il2-eb::after{content:"";flex:1;height:0.5px;background:var(--il-line);}
.il2-fader{display:flex;align-items:center;gap:8px;margin-bottom:6px;}
.il2-fader:last-child{margin-bottom:0;}
.il2-fader .il2-nm{font-family:'Bebas Neue',sans-serif;font-size:12px;letter-spacing:0.1em;color:var(--il-dim);min-width:54px;}
.il2-fader.hero .il2-nm{font-size:14px;}
.il2-vv{font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--il-txt);min-width:40px;text-align:right;font-feature-settings:'tnum';}
.il2-vv.big{font-size:20px;color:var(--il-amber);min-width:62px;}
.il2-vv.big i{font-size:13px;font-style:normal;}
.il2-switch{display:flex;align-items:center;gap:11px;width:100%;background:none;border:none;padding:0;cursor:pointer;}
.il2-sw-track{position:relative;width:50px;height:26px;border-radius:14px;border:0.5px solid var(--il-line);background:var(--il-inset);flex:0 0 auto;}
.il2-sw-knob{position:absolute;top:50%;left:4px;transform:translateY(-50%);width:18px;height:18px;border-radius:50%;background:var(--il-faint);transition:left .15s,background .15s;}
.il2-switch.on .il2-sw-track{border-color:var(--il-amber);background:rgba(251,191,36,0.14);}
.il2-switch.on .il2-sw-knob{left:28px;background:var(--il-amber);}
.il2-sw-nm{font-size:13px;color:var(--il-dim);}
.il2-sw-nm i{display:none;}
.il2-sw-st{margin-left:auto;font-family:'Bebas Neue',sans-serif;font-size:12px;letter-spacing:0.12em;color:var(--il-faint);}
.il2-switch.on .il2-sw-st{color:var(--il-amber);}
.il2-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(86px,1fr));gap:6px;}
.il2-fxgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(86px,1fr));gap:6px;margin-top:8px;}
.il2-tile{padding:8px 5px;border:0.5px solid var(--il-line);border-radius:7px;background:rgba(255,255,255,0.02);color:var(--il-dim);cursor:pointer;font-size:11px;letter-spacing:0.02em;font-family:inherit;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.il2-tile.on{border-color:var(--il-amber);color:var(--il-amber);background:transparent;box-shadow:none;}
.il2-minirow{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;}
.il2-fxpick{display:flex;align-items:center;gap:8px;width:100%;padding:9px 11px;border:0.5px solid var(--il-line);border-radius:9px;background:rgba(255,255,255,0.012);cursor:pointer;font-family:inherit;text-align:left;margin-top:8px;}
.il2-fxpick .ab{font-family:'Bebas Neue',sans-serif;letter-spacing:0.05em;color:var(--il-amber);min-width:56px;font-size:14px;}
.il2-fxpick .nm{font-size:13px;color:var(--il-txt);}
.il2-fxpick .cv{margin-left:auto;color:var(--il-faint);font-size:11px;}
.il2-fxlist{display:flex;flex-direction:column;gap:2px;border:0.5px solid var(--il-line);border-radius:9px;background:var(--il-inset);padding:4px;margin-top:6px;}
.il2-fxli{display:flex;align-items:center;gap:8px;padding:8px 9px;border:0.5px solid transparent;border-radius:6px;background:none;color:var(--il-txt);cursor:pointer;font-family:inherit;text-align:left;}
.il2-fxli:hover{border-color:var(--il-line);}
.il2-fxli.on{border-color:var(--il-amber);color:var(--il-amber);}
.il2-fxli .ab{font-family:'Bebas Neue',sans-serif;letter-spacing:0.04em;min-width:56px;font-size:13px;}
.il2-fxli .nm{font-size:12px;}
.il2-fxli .ds{margin-left:auto;font-size:10px;color:var(--il-dim);}
.il2-seg{display:flex;border:0.5px solid var(--il-line);border-radius:9px;overflow:hidden;margin-top:8px;}
.il2-seg button{flex:1;background:rgba(255,255,255,0.012);border:none;border-right:0.5px solid var(--il-line);color:var(--il-dim);padding:8px 0;font-size:11px;letter-spacing:0.02em;font-family:inherit;cursor:pointer;}
.il2-seg button:last-child{border-right:none;}
.il2-seg button.on{background:transparent;color:var(--il-amber);box-shadow:0 -1px 0 var(--il-amber) inset;}
.il2-seg.dis{opacity:0.35;pointer-events:none;}
.il2-preset{display:flex;align-items:center;gap:16px;width:100%;padding:10px 12px;border:0.5px solid var(--il-line);border-radius:9px;background:rgba(255,255,255,0.012);cursor:pointer;font-family:inherit;text-align:left;}
.il2-pi{display:flex;align-items:baseline;gap:6px;}
.il2-pk{font-size:11px;color:var(--il-faint);}
.il2-pv{font-size:13px;color:var(--il-txt);}
.il2-chev{margin-left:auto;color:var(--il-faint);font-size:12px;}
.il2-presetbody{display:flex;flex-direction:column;gap:7px;margin-top:8px;}
.il2-segrow{display:flex;align-items:center;gap:8px;}
.il2-seglbl{font-family:'Bebas Neue',sans-serif;font-size:11px;letter-spacing:0.1em;color:var(--il-dim);min-width:50px;}
.il2-seg{display:flex;gap:5px;flex:1;}
.il2-segbtn{flex:1;background:rgba(255,255,255,0.02);border:0.5px solid var(--il-line);color:var(--il-dim);padding:8px 4px;border-radius:6px;cursor:pointer;font-size:11px;font-family:inherit;}
.il2-segbtn.on{border-color:var(--il-amber);color:var(--il-amber);background:transparent;}
.il2-act{display:flex;justify-content:flex-end;margin-top:8px;}
.il-fxall{background:var(--il-inset);border:0.5px solid var(--il-line);border-radius:6px;color:var(--il-txt);cursor:pointer;display:flex;align-items:center;justify-content:center;min-height:42px;}
.il-fxall.on{border-color:var(--il-amber);box-shadow:0 0 0 1px rgba(251,191,36,0.30) inset;}
/* MIDIラーン待ち受けの点滅（MASTER等・他のラーンと同じ作法） */
.il-blink{animation:il-learn-blink 0.7s infinite;}
/* ヘッダの生存ランプ（MIDI入力・出力） */
.il-lamp{display:inline-flex;align-items:center;gap:4px;font-size:10px;color:var(--il-dim);margin-right:8px;font-family:'JetBrains Mono',monospace;letter-spacing:0.04em;user-select:none;}
.il-lamp i{width:8px;height:8px;border-radius:50%;background:var(--il-line);border:0.5px solid rgba(255,255,255,0.15);}
.il-lamp i.on{background:var(--il-green);border-color:var(--il-green);}
/* PLAY上部の本番ボタン（当たり判定は大きめ・色は据え置き） */
.il-livebtns{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:5px;}
.il-livebtn{background:rgba(255,255,255,0.02);border:0.5px solid var(--il-line);color:var(--il-txt);border-radius:7px;padding:13px 4px;cursor:pointer;font-family:'Bebas Neue',sans-serif;font-size:14px;letter-spacing:0.06em;min-height:46px;}
.il-livebtn:hover{border-color:var(--il-dim);}
.il-livebtn.blackout:hover{border-color:var(--il-amber);color:var(--il-amber);}
.il-livebtn.panic:hover{border-color:var(--il-red);color:var(--il-red);}
.il-livebtn.full:hover{border-color:var(--il-dim);color:var(--il-dim);}
.il-livebtn.undo:hover{border-color:var(--il-dim);color:var(--il-dim);}
/* ソロ/ミュート中の注意＋押すと全解除 */
.il-msnotice{width:100%;background:rgba(96,165,250,0.08);border:0.5px solid var(--il-cyan);color:var(--il-cyan);border-radius:6px;padding:8px 10px;cursor:pointer;font-size:11.5px;font-family:inherit;text-align:center;letter-spacing:0.02em;}
.il-msnotice:hover{background:var(--il-cyan);color:#111;}
/* 操作キー一覧オーバーレイ */
.il-keys-card{background:#1a1611;border:2px solid var(--il-amber);border-radius:10px;padding:28px 36px;min-width:440px;box-shadow:0 24px 60px rgba(0,0,0,0.6);}
.il-keys-tbl{border-collapse:collapse;margin:8px 0 18px;width:100%;}
.il-keys-tbl th{text-align:left;font-weight:500;color:var(--il-dim);font-size:12.5px;padding:5px 18px 5px 0;white-space:nowrap;font-family:'Noto Sans JP',sans-serif;}
.il-keys-tbl td{color:var(--il-txt);font-size:12.5px;padding:5px 0;font-family:'JetBrains Mono',monospace;}
.il-keys-tbl tr+tr th,.il-keys-tbl tr+tr td{border-top:0.5px solid rgba(255,255,255,0.06);}
/* === HUD レイアウト（編集モード右パネル）=== */
.il-panel--hud{padding:0;gap:0;overflow:hidden;}
.il2hud-head{flex-shrink:0;padding:9px 11px 0;border-bottom:0.5px solid var(--il-line);}
.il2hud-hero{padding-bottom:8px;}
.il2hud-cue{display:flex;align-items:baseline;gap:8px;margin-bottom:7px;min-width:0;}
.il2hud-cuelbl{font-family:'Bebas Neue',sans-serif;font-size:10px;letter-spacing:0.2em;color:var(--il-faint);flex-shrink:0;}
.il2hud-cuename{font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:0.04em;color:var(--il-amber);line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0;}
.il2hud-cueidx{font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--il-faint);flex-shrink:0;}
.il2hud-master{display:flex;align-items:center;gap:8px;}
.il2hud-mlbl{font-family:'Bebas Neue',sans-serif;font-size:11px;letter-spacing:0.12em;color:var(--il-dim);flex-shrink:0;}
.il2hud-master input[type=range]{flex:1;}
.il2hud-mval{font-family:'JetBrains Mono',monospace;font-size:19px;color:var(--il-amber);min-width:46px;text-align:right;line-height:1;font-feature-settings:'tnum';}
.il2hud-mval i{font-style:normal;font-size:11px;color:var(--il-faint);}
.il2hud-tabs{display:flex;}
.il2hud-tab{flex:1;background:none;border:none;border-bottom:2px solid transparent;color:var(--il-faint);font-family:'Bebas Neue',sans-serif;font-size:13px;letter-spacing:0.1em;padding:8px 0 6px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px;}
.il2hud-tab i{display:none;}
.il2hud-tab.on{color:var(--il-amber);border-bottom-color:var(--il-amber);}
.il2hud-tab.on i{color:var(--il-dim);}
.il2-subtabs{display:flex;gap:6px;margin:6px 0 2px;}
.il2-subtab{flex:1;background:var(--il-inset);border:0.5px solid var(--il-line);border-bottom:2px solid transparent;color:var(--il-dim);font-family:'Bebas Neue',sans-serif;font-size:12.5px;letter-spacing:0.08em;padding:7px 0 6px;border-radius:5px 5px 0 0;cursor:pointer;}
.il2-subtab:hover{color:var(--il-txt);border-color:var(--il-dim);}
.il2-subtab.on{color:var(--il-amber);border-color:var(--il-amber);border-bottom-color:var(--il-amber);background:rgba(255,180,80,0.07);}
/* 特効の使い方ガイド（常時・読みやすく） */
.il-sfxguide{margin:7px 0 2px;padding:7px 9px;border:0.5px solid var(--il-line);border-radius:6px;background:rgba(255,180,80,0.06);color:var(--il-txt);font-size:11px;line-height:1.65;}
/* ON など大きめ操作ボタン（当たり判定だけ大きく・文字/線は規約どおり据え置き） */
.il-livebtn.big{padding:10px 16px;font-size:12px;border-radius:6px;}
/* ステップシーケンサー（ドラムマシン格子）。本番でタップしやすいようマスを大きく。 */
.il-seq{margin-top:10px;border-top:0.5px solid var(--il-line);padding-top:8px;}
.il-seqgrid{display:flex;flex-direction:column;gap:4px;margin-top:6px;overflow-x:auto;}
.il-seqrow{display:flex;align-items:center;gap:4px;}
.il-seqlbl{flex:0 0 34px;font-size:11px;color:var(--il-dim);display:flex;align-items:center;gap:3px;}
.il-cell{flex:0 0 27px;height:27px;border:0.5px solid var(--il-line);border-radius:4px;background:var(--il-inset);cursor:pointer;padding:0;}
.il-cell.on{background:var(--il-amber);border-color:var(--il-amber);}
.il-cell.flame.on{background:#ff9636;border-color:#ff9636;}
.il-cell.spark.on{background:#e6e4b4;border-color:#e6e4b4;}
.il-cell.head{box-shadow:inset 0 0 0 2px rgba(120,255,160,0.95);}
.il-seqhead{display:flex;gap:4px;margin-left:38px;}
.il-seqnum{flex:0 0 27px;text-align:center;font-size:10px;color:var(--il-faint);}
.il-seqnum.head{color:rgba(120,255,160,0.95);}
.il2hud-scroll{flex:1;overflow-y:auto;padding:7px 10px 9px;display:flex;flex-direction:column;gap:6px;}
.il2hud-foot{flex-shrink:0;border-top:0.5px solid var(--il-line);padding:8px 10px 9px;display:flex;flex-direction:column;gap:5px;background:#0a0908;}
`
