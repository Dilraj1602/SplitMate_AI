import { describe, expect, it } from 'vitest'
import { getRadialOffsets } from './radialLayout'

describe('radial quick action positioning', () => {
  it.each([[1280, 95], [800, 85], [390, 76]])('keeps four actions on a shared %ipx radius at %ipx width', (width, expectedRadius) => {
    const points = getRadialOffsets('right', width)
    expect(points).toHaveLength(4)
    for (const point of points) expect(Math.hypot(point.x, point.y)).toBeCloseTo(expectedRadius as number, 4)
    for (let index = 1; index < points.length; index++) {
      expect(Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y)).toBeGreaterThanOrEqual(43.99)
    }
  })

  it('mirrors the arc for bottom-left positioning', () => {
    const right = getRadialOffsets('right', 1280)
    const left = getRadialOffsets('left', 1280)
    right.forEach((point, index) => {
      expect(left[index].x).toBeCloseTo(-point.x, 8)
      expect(left[index].y).toBeCloseTo(point.y, 8)
    })
  })
})
