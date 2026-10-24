import { describe, expect, it } from 'vitest'
import { allocateShares, formatPaise, parseInrToPaise } from './splitMath'

describe('INR split preview arithmetic', () => {
  it('uses integer paise and deterministic equal-split residuals', () => {
    const shares = allocateShares('10.00', [{ user_id: 'c' }, { user_id: 'a' }, { user_id: 'b' }], 'equal')

    expect(shares).toEqual([
      { user_id: 'a', amount: '3.34' },
      { user_id: 'b', amount: '3.33' },
      { user_id: 'c', amount: '3.33' },
    ])
  })

  it('allocates exact and residual shares for the positive-flow examples', () => {
    expect(allocateShares('900.00', [
      { user_id: 'c' }, { user_id: 'a' }, { user_id: 'b' },
    ], 'equal')).toEqual([
      { user_id: 'a', amount: '300.00' },
      { user_id: 'b', amount: '300.00' },
      { user_id: 'c', amount: '300.00' },
    ])

    expect(allocateShares('100.00', [
      { user_id: 'c' }, { user_id: 'a' }, { user_id: 'b' },
    ], 'equal')).toEqual([
      { user_id: 'a', amount: '33.34' },
      { user_id: 'b', amount: '33.33' },
      { user_id: 'c', amount: '33.33' },
    ])
  })

  it('rejects exact shares that do not reconcile', () => {
    expect(() => allocateShares('10.00', [{ user_id: 'a', value: '3.00' }, { user_id: 'b', value: '6.99' }], 'exact'))
      .toThrow('Exact shares must add up')
  })

  it('preserves valid exact-amount allocations', () => {
    expect(allocateShares('1000.00', [
      { user_id: 'c', value: '500.00' },
      { user_id: 'a', value: '200.00' },
      { user_id: 'b', value: '300.00' },
    ], 'exact')).toEqual([
      { user_id: 'a', amount: '200.00' },
      { user_id: 'b', amount: '300.00' },
      { user_id: 'c', amount: '500.00' },
    ])
  })

  it('distributes percentage rounding residuals in participant order', () => {
    expect(allocateShares('1.00', [{ user_id: 'b', value: '50' }, { user_id: 'a', value: '50' }], 'percentage'))
      .toEqual([{ user_id: 'a', amount: '0.50' }, { user_id: 'b', amount: '0.50' }])
  })

  it('reconciles fractional percentage allocations to the exact total', () => {
    expect(allocateShares('1.00', [
      { user_id: 'c', value: '33.33' },
      { user_id: 'a', value: '33.34' },
      { user_id: 'b', value: '33.33' },
    ], 'percentage')).toEqual([
      { user_id: 'a', amount: '0.34' },
      { user_id: 'b', amount: '0.33' },
      { user_id: 'c', amount: '0.33' },
    ])
  })

  it('parses only INR precision and formats without floating-point numbers', () => {
    expect(parseInrToPaise('12.3')).toBe(1230n)
    expect(parseInrToPaise('12.345')).toBeNull()
    expect(formatPaise(9007199254740993123n)).toBe('90071992547409931.23')
  })
})
