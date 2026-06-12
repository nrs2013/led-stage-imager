import { useEffect } from 'react'
import { useStore } from '../state/store'
import { serializeChart, parseChart } from './chart-file'
import type { Chart } from '../model/types'

interface AutosaveApi {
  autosaveWrite?: (json: string) => Promise<boolean>
  autosaveRead?: () => Promise<string | null>
}
const api = (): AutosaveApi | undefined => (window as unknown as { api?: AutosaveApi }).api

// ---- IndexedDB fallback (browser build: github.io / dev) ----
const DB_NAME = 'decor-studio'
const DB_STORE = 'kv'
const DB_KEY = 'autosave'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = (): void => {
      if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE)
    }
    req.onsuccess = (): void => resolve(req.result)
    req.onerror = (): void => reject(req.error)
  })
}

async function idbWrite(json: string): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite')
    tx.objectStore(DB_STORE).put(json, DB_KEY)
    tx.oncomplete = (): void => resolve()
    tx.onerror = (): void => reject(tx.error)
  })
  db.close()
}

async function idbRead(): Promise<string | null> {
  const db = await openDb()
  const json = await new Promise<string | null>((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly')
    const req = tx.objectStore(DB_STORE).get(DB_KEY)
    req.onsuccess = (): void => resolve((req.result as string) ?? null)
    req.onerror = (): void => reject(req.error)
  })
  db.close()
  return json
}

async function writeBackup(json: string): Promise<void> {
  const a = api()
  if (a?.autosaveWrite) await a.autosaveWrite(json)
  else await idbWrite(json)
}

/** The crash-net chart from the last session, or null. Never throws. */
export async function readBackup(): Promise<Chart | null> {
  try {
    const a = api()
    const json = a?.autosaveRead ? await a.autosaveRead() : await idbRead()
    if (!json) return null
    return parseChart(json)
  } catch {
    return null
  }
}

const DEBOUNCE_MS = 5000

/** Crash net: mirrors every chart edit to disk (Electron) or IndexedDB (browser),
 *  debounced so big charts with photo underlays don't grind the editor. The start
 *  screen offers the mirror back as「前回の続きから」. */
export function useAutosave(): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let lastChart: Chart | null = null
    const unsub = useStore.subscribe((s) => {
      if (!s.started) return
      if (s.chart === lastChart) return
      lastChart = s.chart
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const c = useStore.getState().chart
        void writeBackup(serializeChart(c)).catch(() => {})
      }, DEBOUNCE_MS)
    })
    return () => {
      if (timer) clearTimeout(timer)
      unsub()
    }
  }, [])
}
