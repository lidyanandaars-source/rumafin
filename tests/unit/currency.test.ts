import { describe, expect, it } from 'vitest'
import { parseHumanAmount } from '@/utils/currency'

describe('parseHumanAmount', () => {
  it.each([
    ['85 ribu', 85_000],
    ['85rb', 85_000],
    ['1,5 juta', 1_500_000],
    ['2 jt', 2_000_000],
    ['125000', 125_000],
    ['Rp 35.000', 35_000],
  ])('parses %s', (input, expected) => expect(parseHumanAmount(input)).toBe(expected))

  it('returns null for unclear text', () => expect(parseHumanAmount('sekitar banyak')).toBeNull())
})
