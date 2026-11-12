import { useEffect } from 'react'
import type { Annotation } from '../types'
import { rangeForAnchor } from '../utils/reading_anchors'

export function useAnnotationHighlights(annotations: Annotation[]) {
  useEffect(() => {
    const css = (window as Window & { CSS?: { highlights?: { set: (name: string, value: unknown) => void; delete: (name: string) => void } }).CSS
    const HighlightCtor = (window as Window & { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
    if (!css?.highlights || !HighlightCtor) return
    const names = ['reader-yellow', 'reader-green', 'reader-blue']
    const colors: Record<string, string> = { yellow: names[0], green: names[1], blue: names[2] }
    for (const name of names) css.highlights.delete(name)
    for (const color of ['yellow', 'green', 'blue'] as const) {
      const ranges = annotations.filter((annotation) =>
        annotation.anchor_status === 'resolved' && annotation.current_anchor && annotation.color === color,
      ).map((annotation) => rangeForAnchor(annotation.current_anchor!)).filter((value): value is Range => value !== null)
      if (ranges.length) css.highlights.set(colors[color], new HighlightCtor(...ranges))
    }
    return () => { for (const name of names) css.highlights?.delete(name) }
  }, [annotations])
}
