export type SplitMode = 'equal' | 'exact' | 'percentage'
export type ShareInput = { user_id: string; value?: string }
export type AllocatedShare = { user_id: string; amount: string }

export function parseInrToPaise(value: string): bigint | null {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value.trim())
  if (!match) return null
  const whole = BigInt(match[1])
  const fraction = BigInt((match[2] || '').padEnd(2, '0') || '0')
  return whole * 100n + fraction
}

export function formatPaise(value: bigint): string {
  const rupees = value / 100n
  const paise = (value % 100n).toString().padStart(2, '0')
  return `${rupees}.${paise}`
}

function percentageToBasisPoints(value: string | undefined): bigint | null {
  if (!value) return null
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value.trim())
  if (!match) return null
  return BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0') || '0')
}

export function allocateShares(total: string, participants: ShareInput[], mode: SplitMode): AllocatedShare[] {
  const totalPaise = parseInrToPaise(total)
  if (totalPaise === null || totalPaise <= 0n) throw new Error('Enter a positive amount with up to two decimal places.')
  if (participants.length === 0) throw new Error('Select at least one participant.')
  const ordered = [...participants].sort((a, b) => a.user_id.localeCompare(b.user_id))

  if (mode === 'equal') {
    const count = BigInt(ordered.length)
    const base = totalPaise / count
    const remainder = totalPaise % count
    return ordered.map((person, index) => ({ user_id: person.user_id, amount: formatPaise(base + (BigInt(index) < remainder ? 1n : 0n)) }))
  }

  if (mode === 'exact') {
    const shares = ordered.map(person => {
      const value = parseInrToPaise(person.value || '')
      if (value === null || value < 0n) throw new Error('Enter each exact share as a non-negative amount with up to two decimals.')
      return { user_id: person.user_id, paise: value }
    })
    if (shares.reduce((sum, share) => sum + share.paise, 0n) !== totalPaise) throw new Error('Exact shares must add up to the full expense amount.')
    return shares.map(share => ({ user_id: share.user_id, amount: formatPaise(share.paise) }))
  }

  const shares = ordered.map(person => {
    const basisPoints = percentageToBasisPoints(person.value)
    if (basisPoints === null || basisPoints < 0n) throw new Error('Enter each percentage with up to two decimal places.')
    return { user_id: person.user_id, basisPoints, paise: totalPaise * basisPoints / 10_000n }
  })
  if (shares.reduce((sum, share) => sum + share.basisPoints, 0n) !== 10_000n) throw new Error('Percentages must total 100.00%.')
  let remainder = totalPaise - shares.reduce((sum, share) => sum + share.paise, 0n)
  return shares.map(share => {
    const extraPaise = remainder > 0n ? 1n : 0n
    remainder -= extraPaise
    return { user_id: share.user_id, amount: formatPaise(share.paise + extraPaise) }
  })
}
