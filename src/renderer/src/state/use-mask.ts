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
  const setMaskEmpty = useStore((s) => s.setMaskEmpty)

  useEffect(() => {
    let cancelled = false
    if (dataUrl && enabled) {
      computeMask(dataUrl, w, h, invert)
        .then((m) => {
          if (cancelled) return
          // A mask with zero drawable cells is never intended (wrong-polarity image):
          // lift the restriction and let the UI explain instead of blocking everything.
          const usable = !!m && m.bitmap.some((v) => v === 1)
          setMaskData(usable ? m : null)
          setMaskEmpty(!!m && !usable)
        })
        .catch(() => {
          if (!cancelled) {
            setMaskData(null)
            setMaskEmpty(false)
          }
        })
    } else {
      setMaskData(null)
      setMaskEmpty(false)
    }
    return () => {
      cancelled = true
    }
  }, [dataUrl, enabled, invert, w, h, setMaskData, setMaskEmpty])
}
