import { useEffect } from 'react'
import { useStore } from './store'
import { computeMask } from '../ui/mask'

/** Recomputes the drawable-area mask whenever the underlay image, mask settings, or
 *  canvas size change, and stores the result (runtime only) for the editor. */
export function useMask(): void {
  const dataUrl = useStore((s) => s.chart.underlay?.dataUrl)
  const enabled = useStore((s) => s.chart.underlay?.mask?.enabled ?? false)
  const invert = useStore((s) => s.chart.underlay?.mask?.invert ?? false)
  const w = useStore((s) => s.chart.canvas.w)
  const h = useStore((s) => s.chart.canvas.h)
  const setMaskData = useStore((s) => s.setMaskData)

  useEffect(() => {
    let cancelled = false
    if (dataUrl && enabled) {
      computeMask(dataUrl, w, h, invert)
        .then((m) => {
          if (!cancelled) setMaskData(m)
        })
        .catch(() => {
          if (!cancelled) setMaskData(null)
        })
    } else {
      setMaskData(null)
    }
    return () => {
      cancelled = true
    }
  }, [dataUrl, enabled, invert, w, h, setMaskData])
}
