import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ImageLightEngine, LW, LH, IW, IH, MAX_BEAMS, type FxKey } from './engine'
import { COLORS, hexToRgb, rgbToHex, sameRgb, type RGB3 } from './colors'
import { FX_BUTTONS, FX_LABEL, FX_PARAMS } from './fxdefs'
import { fileToDataUrl } from '../io/image-pick'
import { useStore } from '../state/store'

interface DecorApi {
  publishFrame?: (width: number, height: number, buffer: Uint8ClampedArray) => void
  saveImageLightShow?: (
    json: string,
    media: { file: string; dataUrl: string }[],
    name: string
  ) => Promise<string | null>
  openImageLightShow?: () => Promise<
    { json: string; media: Record<string, string> } | { error: string } | null
  >
}
const getApi = (): DecorApi | undefined => (window as unknown as { api?: DecorApi }).api

const FPS = 30

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

/** 画像照明モード本体。自前のエンジン（モック移植）を駆動し、frame を Syphon へ流しつつ
 *  画面に表示する。PLAY=本番（叩くだけ）／BUILD=明かり作り。 */
export function ImageLightingMode({ onExit }: { onExit: () => void }): React.JSX.Element {
  // エンジンはマウント中で1個だけ（useStateの遅延初期化で生成）
  const [engine] = useState(() => new ImageLightEngine())
  // エンジン状態の変化で再描画
  useSyncExternalStore(engine.subscribe, engine.getVersion, engine.getVersion)

  // シーン名のインライン編集（null=非編集中）
  const [editingNameIdx, setEditingNameIdx] = useState<number | null>(null)
  const [editingNameValue, setEditingNameValue] = useState<string>('')
  const [uiMode, setUiMode] = useState<'play' | 'build'>('play')
  const uiModeRef = useRef(uiMode)
  useEffect(() => {
    uiModeRef.current = uiMode
    forceRenderRef.current = true // モード切替でマーカー表示が変わる→1回描き直す
  }, [uiMode])

  const displayRef = useRef<HTMLCanvasElement>(null)
  const viewRef = useRef({ scale: 1, dpr: 1, ox: 0, oy: 0 })
  const draggingRef = useRef(false)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null) // ドラッグ開始時のポインタ（吸着の基準）
  const rubberRef = useRef<{ x0: number; y0: number; x1: number; y1: number; add: boolean } | null>(
    null
  )
  const fileInputRef = useRef<HTMLInputElement>(null)
  const maskInputRef = useRef<HTMLInputElement>(null)
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

  // ---- 30fps: 描画 → Syphon publish → 画面へ転写（＋BUILDだけマーカー）
  useEffect(() => {
    const cv = displayRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')!
    const api = getApi()
    const tick = (): void => {
      // 静止画は描き直さない＝カクつき防止。FX/動画/フェード中、ラバーバンド中、状態変化、
      // または強制フラグ（初回・リサイズ・モード切替）の時だけ描く。
      const v = engine.getVersion()
      const animating =
        engine.isAnimating() ||
        rubberRef.current != null ||
        pieceCreateRef.current != null
      if (!animating && v === lastVRef.current && !forceRenderRef.current) return
      forceRenderRef.current = false
      lastVRef.current = v
      const now = performance.now()
      engine.renderFrame(now)
      // Syphon出力は「写真の部分だけ・写真の解像度・余白なし」（outCv）。画面表示は余白ありのframe。
      if (api?.publishFrame) api.publishFrame(engine.outW, engine.outH, engine.readOutputRGBA())
      // 画面へ
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
    }
    const iv = setInterval(tick, 1000 / FPS)
    tick()
    return () => clearInterval(iv)
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
    engine.setParamApply(map)
  }, [engine])

  // ---- キーボード（本番キー＋シーンのショートカット）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
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
      const pi = code ? engine.patterns.findIndex((p) => p && p.key === code) : -1
      if (pi >= 0) {
        engine.applyPattern(pi)
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
    // さらに、いま選択中の灯体を最優先＝コピー直後の群を確実につかめる。
    let hit = -1
    for (let i = beams.length - 1; i >= 0; i--) {
      if (
        engine.isSelected(i) &&
        Math.abs(p.x - beams[i].x) < 30 &&
        Math.abs(p.y - beams[i].y) < 24
      ) {
        hit = i
        break
      }
    }
    if (hit < 0)
      for (let i = beams.length - 1; i >= 0; i--) {
        if (Math.abs(p.x - beams[i].x) < 30 && Math.abs(p.y - beams[i].y) < 24) {
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
      engine.addFixtureAt(p.x, p.y) // ⌘+クリックでだけ追加（誤爆防止）
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
      flash(path ? '✓ 保存しました' : 'キャンセル')
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
      flash(ok ? '✓ 開きました' : '読込に失敗')
    } catch {
      flash('読込に失敗')
    }
  }

  const ref = engine.ref()
  const colorLocked = engine.colorOwnedByFx()
  const activeFx = FX_BUTTONS.filter((b) => engine.fxState(b.key))
  const masterPct = Math.round(engine.st.master * 100)

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
      <header className="il-header">
        <h1>
          IMAGE LIGHTING <span style={{ color: 'var(--il-amber)' }}>画像照明モード</span>
        </h1>
        <small>写真はクリック・明かりはシーン・困ったらESC</small>
        <div style={{ flex: 1 }} />
        {showMsg && (
          <span style={{ fontSize: 11, color: 'var(--il-amber)', marginRight: 8 }}>{showMsg}</span>
        )}
        <button className="il-mini" onClick={saveShow} title="公演まるごとフォルダに保存（写真/動画も一緒）">
          保存
        </button>
        <button className="il-mini" onClick={openShow} title="保存した公演フォルダを開く（写真も明かりも復元）">
          開く
        </button>
        <button className="il-mini" onClick={onExit}>
          ← フル機能照明へ
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
            <div className="il-empty" onClick={() => fileInputRef.current?.click()}>
              <div className="il-empty-big">＋ 写真／動画をドロップ</div>
              <div className="il-empty-sub">
                セット写真やループ動画を読み込むと、ここで灯体が照らします（クリックでも選べます）
              </div>
            </div>
          )}
          {uiMode === 'build' && (
            <div className="il-hint">
              <b>⌘+クリック＝追加</b> ／ クリック＝選択 ／ <b>Shift+クリック＝複数選択</b> ／{' '}
              <b>空きを四角ドラッグ＝囲んで選択</b> ／ ドラッグ＝移動（選択ぜんぶ）
              <br />
              <b>Delete＝削除</b> ／ <b>⌘C→⌘V＝コピペ</b>（複数まとめて）／ 番号の下の <b>M</b>
              ＝消す・<b>S</b>＝これだけ
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
                    engine.removeScene(i)
                  }}
                  title={s.name + '（右クリックで削除）'}
                >
                  <ThumbCanvas thumb={s.thumb} />
                  {s.kind === 'video' && <span className="il-sc-vid">▶</span>}
                  <span
                    className="il-sc-del"
                    title="この素材を棚から削除"
                    onClick={(e) => {
                      e.stopPropagation()
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
                    {engine.learnScene === i
                      ? '待機…'
                      : s.midiNote != null
                      ? `♪${s.midiNote}`
                      : 'LEARN'}
                  </span>
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
              MASTER<em>— 親フェーダー（LEARNでMIDI割当・↑↓キーでも）</em>
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
                className={'il-mini' + (engine.masterLearn ? ' learnon' : '')}
                onClick={() => engine.setMasterLearn(!engine.masterLearn)}
              >
                {engine.masterLearn
                  ? 'CC待ち…'
                  : engine.masterMidi != null
                    ? 'CC' + engine.masterMidi
                    : 'LEARN'}
              </button>
            </div>
            <div className="il-note">
              <b>ESC</b>＝全部ふわっと消す（1.5秒）／<b>0</b>＝即暗転／<b>F</b>＝全灯フル／<b>↑↓</b>
              ＝マスター／<b>← →</b>＝写真送り。
              <br />
              写真は下の棚をクリック。明かりはシーンを押すだけ。
            </div>
          </aside>
        ) : (
          // ===================== 明かり作り BUILD =====================
          <aside className="il-panel">
            <div className="il-deskhead">
              <b>明かり作り BUILD</b>
              <span>作って番号に詰める</span>
              <div style={{ flex: 1 }} />
              <button className="il-mini" onClick={() => setUiMode('play')}>
                ← 本番へ
              </button>
            </div>

            <button
              className={'il-mini' + (engine.lightOnly ? ' learnon' : '')}
              style={{ alignSelf: 'flex-start', marginBottom: 2 }}
              onClick={() => engine.setLightOnly(!engine.lightOnly)}
              title="ON=写真を使わず光だけをSyphon出力（Arena側で 映像×光 を Multiply）。OFF=従来の写真照らし"
            >
              {engine.lightOnly
                ? '💡 光だけ出力：ON（Arena乗算用）'
                : '光だけ出力：OFF（写真照らし）'}
            </button>
            <div
              style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 0, flexWrap: 'wrap' }}
              title="アルファ付き画像を入れると、BUILD のときだけステージ上に境界線をシアンで表示します"
            >
              <button
                className={'il-mini' + (engine.maskImage ? ' learnon' : '')}
                onClick={() => maskInputRef.current?.click()}
              >
                {engine.maskImage ? '🎭 マスク：差し替え' : '🎭 マスク取り込み（境界線）'}
              </button>
              {engine.maskImage && (
                <button
                  className="il-mini"
                  onClick={() => {
                    engine.setMaskFromDataUrl(null)
                  }}
                  title="マスクを外す"
                >
                  ×解除
                </button>
              )}
            </div>
            <div
              style={{
                fontSize: 10,
                color: 'var(--il-dim)',
                marginBottom: 4,
                lineHeight: 1.3,
                maxWidth: 280
              }}
            >
              ※マスクは「公演ファイル（保存／開く）」にだけ残ります。再起動するとリセット。
            </div>
            <div
              style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 2, flexWrap: 'wrap' }}
              title="BUILD で写真の枠（4 辺中央のハンドル）を引っ張ると、マスクの線に合わせて伸ばせる"
            >
              <span style={{ fontSize: 10, color: 'var(--il-dim)' }}>
                📐 写真の枠：4 辺ハンドルでマスクに合わせる
              </span>
              {engine.isActiveSceneWarped() && (
                <button
                  className="il-mini"
                  onClick={() => engine.setActiveSceneWarpBox(null)}
                  title="この写真のワープをリセット（contain fit へ）"
                >
                  ↺ リセット
                </button>
              )}
            </div>
            <div
              style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 2, flexWrap: 'wrap' }}
              title="写真の上で四角ドラッグして「ピース」を切り出し → 4 隅をマスクに合わせて引っ張る"
            >
              <button
                className={'il-mini' + (engine.pieceCreating ? ' learnon' : '')}
                onClick={() => engine.setPieceCreating(!engine.pieceCreating)}
              >
                {engine.pieceCreating ? '✂️ ピース：写真の上をドラッグ…（Esc 中止）' : '✂️ ピース作成'}
              </button>
              {engine.selectedPieceId && (
                <button
                  className="il-mini"
                  onClick={() => engine.removeSelectedPiece()}
                  title="選択中のピースを削除（Delete キーでも）"
                >
                  × 削除
                </button>
              )}
            </div>
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
                } catch {
                  /* 読込失敗は無視 */
                }
              }}
            />

            <div className="il-lbl">MASTER</div>
            <div className="il-frow">
              <input
                type="range"
                min={0}
                max={100}
                value={masterPct}
                onChange={(e) => engine.setMaster(+e.target.value / 100)}
              />
              <div className="il-val">{masterPct}%</div>
            </div>
            <div className="il-frow">
              <span className="il-lbl" style={{ width: 46 }}>
                SMOKE
              </span>
              <input
                type="range"
                min={0}
                max={30}
                value={engine.st.smoke}
                onChange={(e) => engine.setSmoke(+e.target.value)}
              />
              <div className="il-val small">{engine.st.smoke}</div>
            </div>

            <hr />
            <details className="il-note">
              <summary>▸ 仕込み（灯体の素性）</summary>
              <RigRow
                label="出口幅"
                min={8}
                max={180}
                value={ref?.w0 ?? 40}
                onChange={(v) => engine.setRig('w0', v)}
              />
              <RigRow
                label="広がり"
                min={20}
                max={700}
                value={ref?.w1 ?? 260}
                onChange={(v) => engine.setRig('w1', v)}
              />
              <RigRow
                label="伸び"
                min={80}
                max={1000}
                value={ref?.len ?? 600}
                onChange={(v) => engine.setRig('len', v)}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 3 }}>
                <button
                  className="il-mini"
                  onClick={() => engine.removeSelected()}
                  title="Delete / Backspace キーでも消せます"
                >
                  選択灯体を削除（Del）
                </button>
              </div>
            </details>

            <hr />
            <details className="il-note">
              <summary>▸ FIXTURES（灯体の選択）</summary>
              <div className="il-lbl" style={{ marginTop: 4, marginBottom: 5 }}>
                <em>番号=灯体／Shift+クリックで複数選択／M=消す・S=これだけ</em>
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
            </details>

            <div className="il-lbl">
              MOTIF — モチーフを置く
              <em>— 街灯・シャンデリア・マーキーを追加（⌘＋ドラッグで移動）</em>
            </div>
            <div className="il-frow" style={{ gap: 4, flexWrap: 'wrap' }}>
              {(['streetlamp', 'chandelier', 'marquee'] as const).map((type) => (
                <button
                  key={type}
                  className="il-mini"
                  disabled={engine.beams.length >= MAX_BEAMS}
                  onClick={() => engine.addMotifAt(800, 540, type)}
                >
                  {type === 'streetlamp' ? '街灯' : type === 'chandelier' ? 'シャンデリア' : 'マーキー'}
                </button>
              ))}
            </div>
            {ref?.motif && (
              <>
                <div className="il-lbl">
                  MOTIF SIZE<em>— モチーフの大きさ</em>
                </div>
                <div className="il-frow">
                  <input
                    type="range"
                    min={40}
                    max={600}
                    value={ref.motifDiam ?? 200}
                    onChange={(e) => engine.setMotifDiam(+e.target.value)}
                  />
                  <div className="il-val big">{ref.motifDiam ?? 200}px</div>
                </div>
                {ref.motif === 'marquee' && (
                  <>
                    <div className="il-lbl">
                      TEXT<em>— マーキーの文字</em>
                    </div>
                    <div className="il-frow">
                      <input
                        type="text"
                        value={ref.motifText ?? 'LIVE'}
                        maxLength={16}
                        style={{ flex: 1, background: '#111', color: '#eee', border: '0.5px solid #555', padding: '2px 6px', fontSize: 13 }}
                        onChange={(e) => engine.setMotifText(e.target.value)}
                      />
                    </div>
                    <div className="il-lbl">
                      CHASE SPEED<em>— 流れる速さ（球/秒）</em>
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
                  </>
                )}
              </>
            )}

            <div className="il-lbl">
              GAUGE<em>— 明るさ</em>
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

            <div className="il-lbl">
              COLOR
              <em>
                {colorLocked
                  ? '— 虹/カラーチェイス中（色はドラッグで「流す色」へ）'
                  : '— 固定色／ピッカー／★で保存（ドラッグで流す色へ）'}
              </em>
            </div>
            <div className="il-swatches" style={{ opacity: colorLocked ? 0.6 : 1 }}>
              {COLORS.map((cc) => (
                <button
                  key={cc.hex}
                  className={ref && sameRgb(ref.color, cc.rgb) ? 'on' : ''}
                  style={{ background: cc.hex }}
                  draggable
                  onDragStart={(e) =>
                    e.dataTransfer.setData('application/x-il-color', JSON.stringify(cc.rgb))
                  }
                  onClick={() => {
                    if (!colorLocked) engine.setColor(cc.rgb.slice() as RGB3)
                  }}
                  title="クリックで適用／ドラッグでカラフルチェイスの「流す色」へ"
                />
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
              PAN / TILT / ZOOM<em>— ZOOM＝広さ（扇の開き）。長さは変えない</em>
            </div>
            <PoseRow
              label="PAN"
              min={-90}
              max={90}
              value={ref?.pan ?? 0}
              fmt={(v) => v + '°'}
              onChange={(v) => engine.setPan(v)}
            />
            <PoseRow
              label="TILT"
              min={-180}
              max={180}
              value={ref?.tilt ?? 0}
              fmt={(v) => v + '°'}
              onChange={(v) => engine.setTilt(v)}
            />
            <PoseRow
              label="ZOOM"
              min={15}
              max={400}
              value={Math.round((ref?.zoom ?? 1) * 100)}
              fmt={(v) => '×' + (v / 100).toFixed(2)}
              onChange={(v) => engine.setZoom(v / 100)}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="il-mini" onClick={() => engine.home()}>
                HOME（置いた姿）
              </button>
            </div>

            <div className="il-lbl">
              FX — エフェクト<em>— クリックで点/消／各ツマミの ◎ でMIDIつまみ割当</em>
            </div>
            <div className="il-fxgrid">
              {FX_BUTTONS.map((b) => (
                <button
                  key={b.key}
                  className={engine.fxState(b.key) ? 'on' : ''}
                  onClick={() => engine.fxToggle(b.key)}
                >
                  {b.label}
                </button>
              ))}
            </div>
            <div className="il-fxparams">
              {activeFx.map((b) => (
                <FxParamBlock key={b.key} engine={engine} fxKey={b.key} />
              ))}
              {engine.fxState('colorchase') && <ChasePaletteEditor engine={engine} />}
            </div>

            <hr />
            <div className="il-lbl">
              SCENES — シーン
              <em>— ＋で好きなだけ追加（10個目以降はクリック/MIDI/LEARNで呼ぶ）</em>
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
                  onClick={() => engine.patternSlotClick(i)}
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
                    className={'il-ic' + (engine.learnPattern === i ? ' learnon' : '')}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (!p) return
                      engine.setLearnPattern(engine.learnPattern === i ? null : i)
                    }}
                  >
                    {engine.learnPattern === i ? 'キー待ち…' : 'LEARN'}
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
function PoseRow({
  label,
  min,
  max,
  value,
  fmt,
  onChange
}: {
  label: string
  min: number
  max: number
  value: number
  fmt: (v: number) => string
  onChange: (v: number) => void
}): React.JSX.Element {
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
    </div>
  )
}

function RigRow({
  label,
  min,
  max,
  value,
  onChange
}: {
  label: string
  min: number
  max: number
  value: number
  onChange: (v: number) => void
}): React.JSX.Element {
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
    ctx.strokeStyle = isSel ? 'rgba(120,255,160,0.95)' : 'rgba(255,255,255,0.35)'
    ctx.lineWidth = (isSel ? 2 : 1.2) / scale
    ctx.strokeRect(b.x - 18, b.y - 10, 36, 20)
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
.il-root{--il-bg:#191715;--il-panel:#221f1c;--il-line:#3a3530;--il-inset:#15130f;--il-txt:#e8e2da;--il-dim:#9a917f;--il-faint:#6b6457;--il-amber:#fbbf24;--il-green:#a8e878;--il-cyan:#22d3ee;--il-red:#e0726a;
  height:100%;display:flex;flex-direction:column;background:var(--il-bg);color:var(--il-txt);font-family:'Noto Sans JP',sans-serif;overflow:hidden;}
.il-root *{box-sizing:border-box;}
.il-header{display:flex;align-items:baseline;gap:14px;padding:10px 16px 8px;}
.il-header h1{font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:2px;font-weight:400;}
.il-header small{font-size:12px;color:var(--il-dim);}
.il-main{flex:1;min-height:0;display:flex;}
.il-stage{flex:1;min-width:0;position:relative;background:#000;border-top:1px solid var(--il-line);}
.il-cv{width:100%;height:100%;display:block;}
.il-empty{position:absolute;top:0;left:0;right:0;bottom:56px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;cursor:pointer;pointer-events:auto;}
.il-empty-big{font-size:20px;color:var(--il-dim);font-weight:700;letter-spacing:1px;border:1.5px dashed var(--il-line);border-radius:10px;padding:26px 40px;}
.il-empty-sub{font-size:12px;color:var(--il-faint);}
.il-hint{position:absolute;top:10px;left:14px;font-size:11.5px;color:rgba(255,255,255,0.4);pointer-events:none;line-height:1.8;}
.il-hint b{color:rgba(255,255,255,0.66);font-weight:500;}
.il-scenes{position:absolute;left:0;right:0;bottom:0;display:flex;gap:8px;align-items:flex-end;padding:8px 12px;background:rgba(10,9,8,0.74);border-top:1px solid var(--il-line);overflow-x:auto;}
.il-sc-wrap{flex:0 0 auto;display:flex;flex-direction:column;align-items:stretch;gap:4px;}
.il-sc{flex:0 0 auto;width:96px;cursor:pointer;border:2px solid var(--il-line);border-radius:6px;background:#000;padding:0;position:relative;}
.il-sc.on{border-color:var(--il-amber);}
.il-sc canvas{display:block;width:92px;height:52px;border-radius:4px;}
.il-sc-name{font-family:inherit;font-size:13px;font-weight:600;color:var(--il-txt);text-align:center;line-height:1.2;padding:3px 4px;border-radius:3px;cursor:text;max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.il-sc-name:hover{background:rgba(255,255,255,0.07);}
.il-sc-wrap.on .il-sc-name{color:var(--il-amber);font-weight:700;}
.il-sc-name-input{font-family:inherit;font-size:13px;font-weight:600;color:var(--il-txt);background:rgba(0,0,0,0.9);border:1px solid var(--il-amber);border-radius:3px;padding:3px 4px;width:96px;text-align:center;outline:none;box-sizing:border-box;}
.il-sc .il-sc-del{position:absolute;top:2px;right:2px;left:auto;bottom:auto;width:17px;height:17px;line-height:15px;text-align:center;border-radius:50%;background:rgba(20,16,14,0.78);color:var(--il-txt);font-size:13px;font-family:inherit;cursor:pointer;opacity:0;transition:opacity 90ms;text-shadow:none;}
.il-sc:hover .il-sc-del{opacity:1;}
.il-sc .il-sc-del:hover{background:var(--il-red);color:#fff;}
.il-sc .il-sc-vid{position:absolute;top:2px;left:2px;bottom:auto;font-size:8px;line-height:14px;color:#111;background:var(--il-cyan);border-radius:3px;padding:0 4px;text-shadow:none;}
.il-sc .il-sc-learn{position:absolute;bottom:3px;right:3px;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;line-height:1;padding:3px 5px;border-radius:3px;background:rgba(20,16,14,0.85);color:var(--il-amber);border:1px solid var(--il-amber);cursor:pointer;text-shadow:none;letter-spacing:0.04em;user-select:none;}
.il-sc .il-sc-learn:hover{background:var(--il-amber);color:#111;}
.il-sc .il-sc-learn.assigned{color:var(--il-cyan);border-color:var(--il-cyan);}
.il-sc .il-sc-learn.assigned:hover{background:var(--il-cyan);color:#111;}
.il-sc .il-sc-learn.on{background:var(--il-amber);color:#111;border-color:var(--il-amber);animation:il-learn-blink 0.7s infinite;}
@keyframes il-learn-blink{0%,100%{opacity:1;}50%{opacity:0.55;}}
.il-sc-add{flex:0 0 auto;width:96px;height:80px;border:1.5px dashed var(--il-dim);border-radius:6px;background:transparent;color:var(--il-dim);cursor:pointer;font-size:11px;font-family:inherit;align-self:flex-end;}
.il-learn-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.78);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);}
.il-learn-card{background:#1a1611;border:2px solid var(--il-amber);border-radius:10px;padding:36px 56px;text-align:center;min-width:420px;box-shadow:0 24px 60px rgba(0,0,0,0.6);}
.il-learn-eyebrow{font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--il-amber);letter-spacing:0.22em;margin-bottom:10px;}
.il-learn-big{font-size:26px;font-weight:700;color:var(--il-txt);margin-bottom:14px;line-height:1.25;}
.il-learn-scene{font-size:15px;color:var(--il-dim);margin-bottom:22px;}
.il-learn-scene b{color:var(--il-txt);font-weight:700;}
.il-learn-hint{font-size:11px;color:var(--il-dim);margin-bottom:16px;letter-spacing:0.04em;}
.il-learn-cancel{background:transparent;border:1px solid var(--il-dim);color:var(--il-dim);padding:7px 22px;border-radius:5px;cursor:pointer;font-family:inherit;font-size:13px;}
.il-learn-cancel:hover{border-color:var(--il-amber);color:var(--il-amber);}
.il-panel{width:330px;flex-shrink:0;background:var(--il-panel);border-top:1px solid var(--il-line);border-left:1px solid var(--il-line);padding:9px 12px 10px;display:flex;flex-direction:column;gap:7px;overflow-y:auto;}
.il-deskhead{display:flex;align-items:baseline;gap:8px;}
.il-deskhead b{font-size:16px;font-weight:700;letter-spacing:1px;}
.il-deskhead span{font-size:10px;color:var(--il-dim);}
.il-lbl{font-size:9.5px;letter-spacing:1.4px;color:var(--il-dim);font-family:'JetBrains Mono',monospace;}
.il-lbl em{font-style:normal;color:var(--il-faint);letter-spacing:0;margin-left:6px;}
.il-strip{display:grid;grid-template-columns:repeat(6,1fr);gap:4px;}
.il-strip button{background:var(--il-inset);border:1px solid var(--il-line);border-radius:6px;color:var(--il-txt);padding:4px 2px 3px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px;min-height:42px;justify-content:center;}
.il-strip button.on{border-color:var(--il-green);box-shadow:0 0 0 1px rgba(168,232,120,0.35) inset;}
.il-strip button.addfx{border-style:dashed;color:var(--il-dim);}
.il-strip .nm{font-family:'Bebas Neue',sans-serif;font-size:15px;line-height:1;}
.il-strip .fxall .nm,.il-fxall .nm{font-size:11px;}
.il-strip .dot{width:13px;height:3px;border-radius:2px;}
.il-strip button.muted .nm{opacity:0.35;text-decoration:line-through;}
.il-strip button.soloed{border-color:var(--il-cyan);}
.il-strip .ms{display:flex;gap:3px;}
.il-strip .ms b{font-size:9px;font-weight:700;width:14px;height:12px;line-height:12px;text-align:center;border-radius:2px;color:var(--il-dim);background:rgba(255,255,255,0.07);cursor:pointer;font-family:'JetBrains Mono',monospace;}
.il-strip .ms b.m.on{background:var(--il-red);color:#fff;}
.il-strip .ms b.s.on{background:var(--il-cyan);color:#111;}
.il-frow{display:flex;align-items:center;gap:8px;}
.il-root input[type=range]{flex:1;-webkit-appearance:none;appearance:none;height:16px;background:transparent;}
.il-root input[type=range]::-webkit-slider-runnable-track{height:3px;border-radius:2px;background:#403a33;}
.il-root input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;border-radius:50%;background:var(--il-amber);border:none;margin-top:-5px;}
.il-val{font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--il-amber);width:50px;text-align:right;}
.il-val.small{font-size:11px;color:var(--il-txt);width:46px;}
.il-val.big{font-size:16px;width:56px;}
.il-swatches{display:flex;gap:6px;flex-wrap:wrap;}
.il-swatches button{width:22px;height:22px;border-radius:50%;border:2px solid transparent;cursor:pointer;padding:0;}
.il-swatches button.on{border-color:#fff;}
.il-colorpick{width:42px;height:26px;padding:0;border:1px solid var(--il-line);border-radius:6px;background:none;cursor:pointer;}
.il-hex{font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--il-dim);flex:1;}
.il-fxgrid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px;}
.il-fxgrid button{background:var(--il-inset);border:1px solid var(--il-line);color:var(--il-txt);padding:7px 0 6px;border-radius:6px;cursor:pointer;font-family:'Bebas Neue',sans-serif;font-size:12px;letter-spacing:1px;}
.il-fxgrid button.on{border-color:var(--il-green);color:var(--il-green);box-shadow:0 0 0 1px rgba(168,232,120,0.3) inset;}
.il-fxparams{display:flex;flex-direction:column;gap:5px;}
.il-fxh{font-size:8.5px;color:var(--il-green);font-family:'JetBrains Mono',monospace;letter-spacing:1.2px;margin-top:1px;}
.il-chasepal{display:flex;flex-direction:column;gap:4px;margin-top:2px;}
.il-chasepal-h{display:flex;align-items:center;gap:8px;font-size:8.5px;color:var(--il-green);font-family:'JetBrains Mono',monospace;letter-spacing:1px;}
.il-chasepal-clear{margin-left:auto;background:none;border:1px solid var(--il-line);color:var(--il-dim);border-radius:4px;font-size:9px;padding:1px 6px;cursor:pointer;font-family:inherit;}
.il-chasepal-drop{display:flex;flex-wrap:wrap;gap:5px;align-items:center;min-height:30px;padding:6px;border:1.5px dashed var(--il-line);border-radius:6px;background:var(--il-inset);}
.il-chasepal-drop.over{border-color:var(--il-green);background:rgba(168,232,120,0.08);}
.il-chasepal-empty{font-size:10px;color:var(--il-faint);}
.il-chasepal-chip{width:20px;height:20px;border-radius:5px;cursor:pointer;border:1px solid rgba(0,0,0,0.3);box-shadow:0 1px 2px rgba(0,0,0,0.4);}
.il-chasepal-chip:hover{outline:2px solid var(--il-red);outline-offset:1px;}
.il-playpats{display:flex;flex-direction:column;gap:6px;}
.il-patbig{display:flex;align-items:center;gap:8px;background:var(--il-inset);border:1px solid var(--il-line);border-radius:7px;padding:11px 10px;cursor:pointer;color:var(--il-txt);text-align:left;}
.il-patbig.on{border-color:var(--il-amber);box-shadow:0 0 0 1px rgba(251,191,36,.25) inset;}
.il-patbig.empty{opacity:0.3;cursor:default;}
.il-patbig .pn{font-family:'Bebas Neue',sans-serif;font-size:15px;color:var(--il-dim);width:14px;}
.il-patbig .pname{flex:1;font-size:13.5px;font-weight:700;}
.il-patbig .pkey{font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--il-cyan);}
.il-buildpats{display:flex;flex-direction:column;gap:4px;}
.il-patrow{display:flex;align-items:center;gap:6px;background:var(--il-inset);border:1px solid var(--il-line);border-radius:6px;padding:4px 8px;cursor:pointer;}
.il-patrow.armed{border-color:var(--il-amber);box-shadow:0 0 0 1px rgba(251,191,36,.3) inset;}
.il-patrow .pn{font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--il-dim);width:12px;}
.il-patrow .pname{flex:1;font-size:11.5px;}
.il-patrow .pname input{width:100%;background:#15130f;border:1px solid var(--il-line);color:var(--il-txt);font-size:11.5px;border-radius:4px;padding:2px 4px;font-family:inherit;}
.il-patrow .pkey{font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--il-cyan);min-width:26px;text-align:right;}
.il-ic{background:none;border:1px solid var(--il-line);color:var(--il-dim);border-radius:4px;font-size:10px;padding:2px 6px;cursor:pointer;font-family:inherit;}
.il-ic.learnon{border-color:var(--il-cyan);color:var(--il-cyan);}
.il-cc{flex-shrink:0;background:var(--il-inset);border:1px solid var(--il-line);color:var(--il-dim);border-radius:4px;font-size:9px;padding:1px 5px;cursor:pointer;font-family:'JetBrains Mono',monospace;line-height:1.5;}
.il-cc.set{border-color:var(--il-amber);color:var(--il-amber);}
.il-cc.learnon{border-color:var(--il-cyan);color:var(--il-cyan);}
.il-mini{background:var(--il-inset);border:1px solid var(--il-line);color:var(--il-dim);padding:3px 8px;border-radius:5px;cursor:pointer;font-size:10.5px;font-family:inherit;}
.il-mini.learnon{border-color:var(--il-cyan);color:var(--il-cyan);}
.il-root hr{border:none;border-top:1px solid var(--il-line);margin:0;}
.il-note{font-size:10.5px;color:var(--il-faint);line-height:1.7;}
.il-note b{color:var(--il-dim);font-weight:500;}
.il-note summary{cursor:pointer;color:var(--il-dim);font-size:10.5px;}
.il-fxall{background:var(--il-inset);border:1px solid var(--il-line);border-radius:6px;color:var(--il-txt);cursor:pointer;display:flex;align-items:center;justify-content:center;min-height:42px;}
.il-fxall.on{border-color:var(--il-green);box-shadow:0 0 0 1px rgba(168,232,120,0.35) inset;}
`
