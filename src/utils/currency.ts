export function formatCurrency(value: number | string | null | undefined, currency = 'IDR') {
  const amount = typeof value === 'string' ? Number(value) : (value ?? 0)
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'IDR' ? 0 : 2,
  }).format(Number.isFinite(amount) ? amount : 0)
}

export function parseHumanAmount(input: string): number | null {
  const raw = input.trim().toLowerCase().replace(/rp\s?/g, '').replace(/\s+/g, ' ')
  if (!raw) return null

  const normalizedDecimal = raw.replace(/(?<=\d),(?=\d)/g, '.')
  const unitMatch = normalizedDecimal.match(/^([\d.]+)\s*(ribu|rb|k|juta|jt|m)?$/)
  if (unitMatch) {
    const base = Number(unitMatch[1])
    if (!Number.isFinite(base)) return null
    const unit = unitMatch[2]
    if (['ribu', 'rb', 'k'].includes(unit ?? '')) return Math.round(base * 1_000)
    if (['juta', 'jt'].includes(unit ?? '')) return Math.round(base * 1_000_000)
    if (unit === 'm') return Math.round(base * 1_000_000_000)
    return Math.round(base)
  }

  const digitsOnly = raw.replace(/[.,\s]/g, '')
  if (/^\d+$/.test(digitsOnly)) return Number(digitsOnly)
  return null
}

export function compactCurrency(value: number, currency = 'IDR') {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}
