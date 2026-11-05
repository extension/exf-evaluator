/**
 * Reporting-period parsing shared by the Sidekick context builder and the importer.
 * Understands: "Sept. 2025", "April 2026", "2025-09", "09/2025", "Q1 (July-Sept. 2025)",
 * "Q4 2026", "2026 Q3", "Q3 FY2026", "Fall 2025", "FY 2025-2026", "Y3Q2" / "PAT Y3Q2".
 */
export const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function monthIndex(name: string): number {
  return MONTH_ABBR.findIndex(m => m.toLowerCase() === name.slice(0, 3).toLowerCase())
}

export interface Period {
  key: string
  sort: number
  display: string
  kind: 'month' | 'quarter' | 'date'
  /** months since year 0 (year*12 + monthIndex) of the first / last month covered, when known */
  startMonth?: number
  endMonth?: number
}

const monthPeriod = (year: number, mi: number): Period => {
  const idx = year * 12 + mi
  return { key: `m${idx}`, sort: idx, display: `${MONTH_ABBR[mi]} ${year}`, kind: 'month', startMonth: idx, endMonth: idx }
}

export function parsePeriod(raw: unknown): Period | null {
  if (typeof raw !== 'string') return null
  const label = raw.trim()
  if (!label) return null
  let m: RegExpMatchArray | null

  // "Sept. 2025", "April 2026", "Jul 2025"
  m = label.match(/^([A-Za-z]{3,9})\.?,?\s+(\d{4})$/)
  if (m) {
    const mi = monthIndex(m[1])
    if (mi >= 0) return monthPeriod(Number(m[2]), mi)
  }

  // "2025-09", "2025/09"
  m = label.match(/^(\d{4})[-/](0?[1-9]|1[0-2])$/)
  if (m) return monthPeriod(Number(m[1]), Number(m[2]) - 1)

  // "09/2025"
  m = label.match(/^(0?[1-9]|1[0-2])[-/](\d{4})$/)
  if (m) return monthPeriod(Number(m[2]), Number(m[1]) - 1)

  // "Q1 (July-Sept. 2025)", "Q2 (Oct. - Dec. 2025)", "Q4 (Apr-June 2026)"
  m = label.match(/^Q(\d+)\s*\(\s*([A-Za-z]+)\.?\s*-\s*([A-Za-z]+)\.?\s*(\d{4})\s*\)/)
  if (m) {
    const sm = monthIndex(m[2])
    const em = monthIndex(m[3])
    if (sm >= 0 && em >= 0) {
      const year = Number(m[4])
      const endMonth = year * 12 + em
      const startMonth = (sm <= em ? year : year - 1) * 12 + sm
      return { key: `q${endMonth}`, sort: endMonth, display: label, kind: 'quarter', startMonth, endMonth }
    }
  }

  // "Q4 2026", "2026 Q3", "Q3 FY2026", "Q3 FY 2026"
  m = label.match(/^Q(\d+)\s+(?:FY\s*)?(\d{4})$/i) ?? label.match(/^(\d{4})\s+Q(\d+)$/i)
  if (m) {
    const [q, y] = /^\d{4}$/.test(m[1]) ? [Number(m[2]), Number(m[1])] : [Number(m[1]), Number(m[2])]
    const sort = y * 12 + q * 3
    return { key: `q${sort}`, sort, display: label, kind: 'quarter' }
  }

  // "Fall 2025", "Spring 2026" (semester labels)
  m = label.match(/^(Winter|Spring|Summer|Fall|Autumn)\s+(\d{4})$/i)
  if (m) {
    const season = { winter: 0, spring: 3, summer: 6, fall: 9, autumn: 9 }[m[1].toLowerCase() as 'winter']
    const sort = Number(m[2]) * 12 + season
    return { key: `s${sort}`, sort, display: label, kind: 'quarter' }
  }

  // "Y3Q2", "PAT Y3Q2" (program-year quarters): ordered, but no calendar alignment
  m = label.match(/Y(\d+)\s*Q([1-4])/i)
  if (m) {
    const sort = 1e6 + Number(m[1]) * 10 + Number(m[2])
    return { key: `y${sort}`, sort, display: label, kind: 'quarter' }
  }

  return null
}

/** Last calendar day (YYYY-MM-DD) of a period, when its end month is known */
export function periodEndDate(p: Period): string | null {
  if (p.endMonth === undefined) return null
  const y = Math.floor(p.endMonth / 12)
  const mo = p.endMonth % 12
  const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate()
  return `${y}-${String(mo + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`
}

/** True when a column/field name looks like a reporting-period question */
export function isPeriodLabel(label: string): boolean {
  return /^(reporting\s+)?(month|quarter|period)$/i.test(label.replace(/\s+/g, ' ').trim())
}
