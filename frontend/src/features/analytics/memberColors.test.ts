import { beforeEach, describe, expect, it } from 'vitest'
import { assignMemberColors } from './memberColors'

beforeEach(() => localStorage.clear())

describe('group analytics member colors', () => {
  it('assigns ten distinct colors and keeps assignments stable across filters and order', () => {
    const members = Array.from({ length: 10 }, (_, index) => ({ user_id: `member-${index}` }))
    const all = assignMemberColors('color-test', members)
    expect(new Set(Object.values(all)).size).toBe(10)
    const filtered = assignMemberColors('color-test', members.slice(3, 8).reverse())
    for (const member of members.slice(3, 8)) expect(filtered[member.user_id]).toBe(all[member.user_id])
  })

  it('generates additional distinct colors beyond the base palette', () => {
    const members = Array.from({ length: 14 }, (_, index) => ({ user_id: `many-member-${index}` }))
    const colors = assignMemberColors('many-color-test', members)
    expect(new Set(Object.values(colors)).size).toBe(14)
  })
})
