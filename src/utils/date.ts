import { format, subDays } from 'date-fns'
import { id } from 'date-fns/locale'

export const APP_TIMEZONE = 'Asia/Jakarta'

function zonedParts(value: Date, timeZone = APP_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') }
}

export function todayLocal(timeZone = APP_TIMEZONE) {
  const p = zonedParts(new Date(), timeZone)
  return `${p.year}-${p.month}-${p.day}`
}

export function currentTimeLocal(timeZone = APP_TIMEZONE) {
  const p = zonedParts(new Date(), timeZone)
  return `${p.hour}:${p.minute}`
}

export function dateTimeInputParts(value: string | Date, timeZone = APP_TIMEZONE) {
  const p = zonedParts(typeof value === 'string' ? new Date(value) : value, timeZone)
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }
}

export function currentMonthRange(timeZone = APP_TIMEZONE) {
  const today = todayLocal(timeZone)
  const [year, month] = today.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year!, month!, 0)).getUTCDate()
  return { from: `${year}-${String(month).padStart(2, '0')}-01`, to: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}` }
}

export function formatDateId(value: string | Date) {
  const date = typeof value === 'string' ? new Date(value) : value
  return format(date, 'd MMM yyyy', { locale: id })
}

export function relativeDate(reference?: string | null) {
  const now = new Date()
  if (reference === 'YESTERDAY') return format(subDays(now, 1), 'yyyy-MM-dd')
  return todayLocal()
}
