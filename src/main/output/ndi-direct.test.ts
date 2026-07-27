import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// existsSync をこのテストの中だけ差し替える（本物のディスクは見ない）。
const existing = new Set<string>()
vi.mock('node:fs', () => ({ existsSync: (p: string) => existing.has(p) }))

const { resolveNdiLibPath } = await import('./ndi-direct')

// 実装と同じ join を使う（Mac 上でテストを走らせると区切りが / になるため、文字列直書きだと外れる）
const { join } = await import('node:path')
const DLL = 'Processing.NDI.Lib.x64.dll'
const BUNDLED = 'C:\\app\\resources\\ndi'
const BUNDLED_DLL = join(BUNDLED, DLL)
const INSTALLED_DLL = 'C:\\Program Files\\NDI\\NDI 6 Runtime\\v6\\Processing.NDI.Lib.x64.dll'

describe('resolveNdiLibPath (Windows)', () => {
  const realPlatform = process.platform
  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    existing.clear()
    delete process.env.NDI_RUNTIME_DIR_V6
    delete process.env.NDI_RUNTIME_DIR_V5
  })
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true })
  })

  // 🔴 これが本題。2026-07-15 に現場の実機で判明した順番で、一度 main で逆に戻ってしまった。
  // 同梱DLLを先に読むと NDI が設定(送信NIC固定)を無視し、NICが複数ある機材で
  // Resolume から見つからなくなる。
  it('正規インストールのNDIランタイムを、アプリ同梱DLLより優先する', () => {
    existing.add(INSTALLED_DLL)
    existing.add(BUNDLED_DLL)
    expect(resolveNdiLibPath(BUNDLED)).toBe(INSTALLED_DLL)
  })

  it('環境変数のランタイムがあれば、それを最優先する', () => {
    process.env.NDI_RUNTIME_DIR_V6 = 'C:\\NDI\\Redist'
    const envDll = join('C:\\NDI\\Redist', DLL)
    existing.add(envDll)
    existing.add(INSTALLED_DLL)
    existing.add(BUNDLED_DLL)
    expect(resolveNdiLibPath(BUNDLED)).toBe(envDll)
  })

  it('正規ランタイムが無いPCでは、同梱DLLに落ちる（保険は残す）', () => {
    existing.add(BUNDLED_DLL)
    expect(resolveNdiLibPath(BUNDLED)).toBe(BUNDLED_DLL)
  })

  it('どこにも無ければ null', () => {
    expect(resolveNdiLibPath(BUNDLED)).toBeNull()
  })
})
