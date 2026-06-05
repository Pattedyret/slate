import { getStroke } from 'perfect-freehand'

export function strokeOutline(points: number[], size: number): number[] {
  const pairs: number[][] = []
  for (let i = 0; i < points.length; i += 2) pairs.push([points[i], points[i + 1]])
  const outline = getStroke(pairs, { size, thinning: 0.6, smoothing: 0.5, streamline: 0.5 })
  return outline.flat()
}
