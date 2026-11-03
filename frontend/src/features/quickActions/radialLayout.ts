export type FloatingPosition = 'right' | 'left'

/** Four evenly spaced points on one compact arc centered on the main FAB. */
export function getRadialOffsets(position: FloatingPosition, viewportWidth: number) {
  const radius = viewportWidth <= 639 ? 76 : viewportWidth <= 1023 ? 85 : 95
  const actionAngles = viewportWidth <= 639 ? [180, 215, 250, 285] : [180, 210, 240, 270]
  const mirror = position === 'right' ? 1 : -1
  return actionAngles.map(angle => {
    const radians = angle * Math.PI / 180
    return { x: Math.cos(radians) * radius * mirror, y: -Math.sin(radians) * radius }
  })
}
