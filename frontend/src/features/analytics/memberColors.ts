export type ColorMember = { user_id: string }

const palette = ['#287D68', '#547FC1', '#DB873B', '#9567B0', '#CE5D65', '#4E9B99', '#7D8B3F', '#C8799A', '#58738A', '#B79A32']
const hash = (value: string) => {
  let result = 2166136261
  for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16777619) >>> 0
  return result >>> 0
}

function hueOf(color: string): number | undefined {
  const hsl = color.match(/^hsl\(([\d.]+)/i)
  if (hsl) return Number(hsl[1])
  const hex = color.match(/^#([\da-f]{6})$/i)?.[1]
  if (!hex) return undefined
  const [red, green, blue] = [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
  const max = Math.max(red, green, blue), min = Math.min(red, green, blue), delta = max - min
  if (!delta) return 0
  const hue = max === red ? ((green - blue) / delta) % 6 : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4
  return (hue * 60 + 360) % 360
}

/** Assign each group member one durable color; retain assignments when a date filter hides that member. */
export function assignMemberColors(groupId: string, members: ColorMember[]): Record<string, string> {
  const key = `splitmate.analytics.member-colors.v1:${groupId}`
  let assignments: Record<string, string> = {}
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) || '{}')
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
      assignments = Object.fromEntries(Object.entries(stored).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    }
  } catch { /* The current chart still receives deterministic colors without storage. */ }

  const used = new Set(Object.values(assignments))
  for (const { user_id } of [...members].sort((a, b) => a.user_id.localeCompare(b.user_id))) {
    if (assignments[user_id]) continue
    const start = hash(user_id) % palette.length
    let color = ''
    for (let probe = 0; probe < palette.length; probe++) {
      const candidate = palette[(start + probe * 7) % palette.length]
      if (!used.has(candidate)) { color = candidate; break }
    }
    if (!color) {
      const seed = hash(user_id) % 360
      const usedHues = [...used].map(hueOf).filter((hue): hue is number => hue !== undefined)
      const minimumHueDistance = Math.max(0, 18 - Math.floor(used.size / 2))
      for (let probe = 0; !color; probe++) {
        const hue = (seed + probe * 137.508) % 360
        const shade = probe % 4
        const candidate = `hsl(${hue.toFixed(3)} 68% ${[40, 47, 54, 61][shade]}%)`
        const distinct = usedHues.every(existing => {
          const difference = Math.abs(existing - hue)
          return Math.min(difference, 360 - difference) >= minimumHueDistance
        })
        if (!used.has(candidate) && distinct) color = candidate
      }
    }
    assignments[user_id] = color
    used.add(color)
  }
  try { localStorage.setItem(key, JSON.stringify(assignments)) } catch { /* In-memory rendering remains available. */ }
  return Object.fromEntries(members.map(({ user_id }) => [user_id, assignments[user_id]]))
}
