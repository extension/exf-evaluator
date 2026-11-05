/**
 * Builds the data context handed to the Evaluation Sidekick.
 *
 * Design notes (why this is not a naive dump of every field):
 *  - Time is taken from the form's own reporting-period answer (e.g. "Month" /
 *    "Quarter") rather than `submitted_at`, which is unreliable for imported data.
 *  - Zeros are real values and are kept. Only blank/missing answers are ignored.
 *  - Numbers stored in text fields are detected and summed.
 *  - Small record-style forms (e.g. one row per survey question) are listed row by
 *    row so different questions are never blended together.
 *  - For the EXCITE Health Agent (monthly) + Other Extension Professional
 *    (quarterly) forms, combined events/reach/curriculum totals are computed here
 *    in code, so the model reports finished numbers instead of adding by hand.
 */
import type { FormField } from '@/types/forms'

export interface SubmissionRow {
  id: string
  submitted_at: string | null
  data: Record<string, unknown>
  form_id: string
}

export interface FormMeta {
  id: string
  name: string
  fields: FormField[]
  settings: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const NUMERIC_TYPES = ['number', 'scale', 'rating', 'nps', 'slider', 'likert_scale', 'calculated_field']
const SCALE_TYPES = ['scale', 'rating', 'nps', 'slider', 'likert_scale']
const CHOICE_TYPES = ['single_choice', 'multiple_choice', 'dropdown', 'image_choice', 'boolean']
const TEXT_TYPES = ['short_text', 'long_text', 'text']
const NON_DATA_TYPES = ['section_header', 'page_break', 'spacer', 'instructional_text', 'file_upload', 'signature']

const ROW_LISTING_MAX_ROWS = 40
const ROW_LISTING_MAX_ROWS_NO_NUMBERS = 200
const MAX_CONTEXT_CHARS = 600_000

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const t = v.replace(/,/g, '').trim()
    if (t === '') return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function isBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true
  if (typeof v === 'string') return v.trim() === ''
  if (Array.isArray(v)) return v.length === 0
  return false
}

const round2 = (n: number) => Math.round(n * 100) / 100
const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString('en-US') : round2(n).toLocaleString('en-US'))

function fieldLabel(f: FormField): string {
  return (f.label || f.id).replace(/\s+/g, ' ').trim()
}

// ---------------------------------------------------------------------------
// Reporting periods
// ---------------------------------------------------------------------------

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

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

export function parsePeriod(raw: unknown): Period | null {
  if (typeof raw !== 'string') return null
  const label = raw.trim()
  if (!label) return null

  // "Sept. 2025", "April 2026", "Jul 2025"
  let m = label.match(/^([A-Za-z]{3,9})\.?\s+(\d{4})$/)
  if (m) {
    const mi = monthIndex(m[1])
    if (mi >= 0) {
      const idx = Number(m[2]) * 12 + mi
      return { key: `m${idx}`, sort: idx, display: `${MONTH_ABBR[mi]} ${m[2]}`, kind: 'month', startMonth: idx, endMonth: idx }
    }
  }

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

  // "Q4 2026"
  m = label.match(/^Q(\d)\s+(\d{4})$/)
  if (m) {
    const sort = Number(m[2]) * 12 + Number(m[1]) * 3
    return { key: `q${sort}`, sort, display: label, kind: 'quarter' }
  }

  return null
}

/** Find the field that holds the reporting period (Month / Quarter / Period) */
function findPeriodField(form: FormMeta, rows: SubmissionRow[]): FormField | null {
  const candidates = form.fields.filter(f =>
    /^(reporting\s+)?(month|quarter|period)$/i.test(fieldLabel(f)) &&
    ([...CHOICE_TYPES, ...TEXT_TYPES] as string[]).includes(f.type),
  )
  for (const f of candidates) {
    if (rows.some(r => parsePeriod(r.data[f.id]))) return f
  }
  return null
}

function periodOf(row: SubmissionRow, periodField: FormField | null): Period {
  if (periodField) {
    const p = parsePeriod(row.data[periodField.id])
    if (p) return p
    const raw = row.data[periodField.id]
    if (typeof raw === 'string' && raw.trim()) {
      return { key: `x${raw}`, sort: 9e9, display: raw.trim(), kind: 'date' }
    }
  }
  const ym = (row.submitted_at ?? '').slice(0, 7)
  if (ym.length === 7) {
    const [y, mo] = ym.split('-').map(Number)
    const idx = y * 12 + (mo - 1)
    return { key: `m${idx}`, sort: idx, display: `${MONTH_ABBR[mo - 1]} ${y}`, kind: 'date', startMonth: idx, endMonth: idx }
  }
  return { key: 'unknown', sort: 9e9 + 1, display: 'unknown date', kind: 'date' }
}

interface PeriodGroup { period: Period; rows: SubmissionRow[] }

function groupByPeriod(rows: SubmissionRow[], periodField: FormField | null): PeriodGroup[] {
  const map = new Map<string, PeriodGroup>()
  for (const row of rows) {
    const p = periodOf(row, periodField)
    const g = map.get(p.key) ?? { period: p, rows: [] }
    g.rows.push(row)
    map.set(p.key, g)
  }
  return [...map.values()].sort((a, b) => a.period.sort - b.period.sort || a.period.display.localeCompare(b.period.display))
}

// ---------------------------------------------------------------------------
// Generic per-form section
// ---------------------------------------------------------------------------

function isNumericField(f: FormField, rows: SubmissionRow[]): boolean {
  if (NUMERIC_TYPES.includes(f.type)) return true
  // Numbers imported into text fields (e.g. "OEP_VL" = "3")
  if (TEXT_TYPES.includes(f.type)) {
    if (/phone|zip|postal|\bid\b|year|name|email/i.test(f.label)) return false
    const vals = rows.map(r => r.data[f.id]).filter(v => !isBlank(v))
    return vals.length > 0 && vals.every(v => toNum(v) !== null)
  }
  return false
}

function displayValue(v: unknown): string {
  if (Array.isArray(v)) return v.map(x => String(x)).join('; ')
  if (v && typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function tally(vals: unknown[]): Array<[string, number]> {
  const dist: Record<string, number> = {}
  for (const val of vals) {
    const choices = Array.isArray(val) ? val : [val]
    for (const c of choices) if (!isBlank(c)) dist[String(c)] = (dist[String(c)] ?? 0) + 1
  }
  return Object.entries(dist).sort((a, b) => b[1] - a[1])
}

function formSection(form: FormMeta, formRows: SubmissionRow[]): string[] {
  const lines: string[] = []
  const s = form.settings
  const settingsPeriod = s.periodValue ? ` [Period: ${s.periodValue}]` : s.periodStart && s.periodEnd ? ` [${s.periodStart} – ${s.periodEnd}]` : ''
  lines.push(`--- FORM: "${form.name}"${settingsPeriod} (${formRows.length} submissions) ---`)

  const fields = form.fields.filter(f => !f.hidden && !NON_DATA_TYPES.includes(f.type))
  const periodField = findPeriodField(form, formRows)
  const groups = groupByPeriod(formRows, periodField)
  const numericFields = fields.filter(f => f !== periodField && isNumericField(f, formRows))
  const hasNumbers = numericFields.some(f => formRows.some(r => toNum(r.data[f.id]) !== null))

  if (periodField) {
    lines.push(`  TIME PERIOD comes from the "${fieldLabel(periodField)}" answer (not the upload date).`)
  } else {
    lines.push('  TIME PERIOD: this form has no month/quarter question, so periods below use the submission date.')
  }
  lines.push(`  SUBMISSIONS BY PERIOD: ${groups.map(g => `${g.period.display}=${g.rows.length}`).join('; ')}`)

  // Record-style listing: small forms, or text/choice-only forms of modest size
  const listRows = formRows.length <= ROW_LISTING_MAX_ROWS || (!hasNumbers && formRows.length <= ROW_LISTING_MAX_ROWS_NO_NUMBERS)
  const recordLines = (): string[] => {
    const out: string[] = [
      '  RECORDS (each line is ONE submission — values from different records are different items; do not blend them):',
    ]
    const labelById = new Map(form.fields.map(f => [f.id, fieldLabel(f)]))
    let i = 0
    for (const g of groups) {
      for (const row of g.rows) {
        i++
        const parts: string[] = []
        const seen = new Set<string>(periodField ? [periodField.id] : [])
        for (const f of form.fields) {
          if (NON_DATA_TYPES.includes(f.type)) continue
          seen.add(f.id)
          const v = row.data[f.id]
          if (f === periodField || isBlank(v)) continue
          parts.push(`${fieldLabel(f)}=${displayValue(v).replace(/\s+/g, ' ').slice(0, 300)}`)
        }
        for (const [k, v] of Object.entries(row.data)) {
          if (seen.has(k) || isBlank(v)) continue
          parts.push(`${labelById.get(k) ?? k}=${displayValue(v).replace(/\s+/g, ' ').slice(0, 300)}`)
        }
        out.push(`    #${i} [${g.period.display}] ${parts.join(' | ')}`)
      }
    }
    out.push('')
    return out
  }
  // Forms with numbers (e.g. one row per survey question) are listed row by row only,
  // so different questions are never blended into one total.
  if (listRows && hasNumbers) {
    lines.push(...recordLines())
    return lines
  }

  // Numeric fields: cumulative totals plus per-period totals
  for (const field of numericFields) {
    const label = fieldLabel(field)
    const allVals = formRows.map(r => toNum(r.data[field.id])).filter((v): v is number => v !== null)
    if (!allVals.length) continue
    const sum = allVals.reduce((a, b) => a + b, 0)
    const isScale = SCALE_TYPES.includes(field.type)
    const perPeriod = groups
      .map(g => {
        const vals = g.rows.map(r => toNum(r.data[field.id])).filter((v): v is number => v !== null)
        if (!vals.length) return null
        const t = vals.reduce((a, b) => a + b, 0)
        return isScale ? `${g.period.display}: avg ${round2(t / vals.length)} (n=${vals.length})` : `${g.period.display}: ${fmt(t)}`
      })
      .filter(Boolean)
    lines.push(
      `  [${label}] (numeric) TOTAL=${fmt(sum)} | answered by ${allVals.length} of ${formRows.length} submissions | avg per answer=${round2(sum / allVals.length)} | by period: ${perPeriod.join('; ')}`,
    )
  }

  // Choice, matrix and text fields
  for (const field of fields) {
    if (field === periodField || numericFields.includes(field)) continue
    const label = fieldLabel(field)
    if (CHOICE_TYPES.includes(field.type)) {
      const sorted = tally(formRows.map(r => r.data[field.id])).slice(0, 60)
      if (sorted.length) lines.push(`  [${label}] (choice counts): ${sorted.map(([v, n]) => `"${v}"=${n}`).join(', ')}`)
    } else if (field.type === 'matrix') {
      const rowsById = new Map((field.matrixRows ?? []).map(r => [r.id, r.label]))
      const colsById = new Map((field.matrixColumns ?? []).map(c => [c.id, c.label]))
      const perRow = new Map<string, Record<string, number>>()
      for (const r of formRows) {
        const v = r.data[field.id]
        if (!v || typeof v !== 'object') continue
        for (const [rowId, ans] of Object.entries(v as Record<string, unknown>)) {
          const rl = rowsById.get(rowId) ?? rowId
          const bucket = perRow.get(rl) ?? {}
          for (const a of Array.isArray(ans) ? ans : [ans]) {
            if (isBlank(a)) continue
            const cl = colsById.get(String(a)) ?? String(a)
            bucket[cl] = (bucket[cl] ?? 0) + 1
          }
          perRow.set(rl, bucket)
        }
      }
      if (perRow.size) {
        lines.push(`  [${label}] (matrix, one entry per question row):`)
        for (const [rl, b] of perRow) lines.push(`    ${rl}: ${Object.entries(b).map(([c, n]) => `"${c}"=${n}`).join(', ')}`)
      }
    } else if (TEXT_TYPES.includes(field.type) && !listRows) {
      const samples = formRows
        .map(r => r.data[field.id])
        .filter(v => !isBlank(v) && String(v).trim().length > 2)
        .slice(0, 5)
        .map(v => `"${String(v).replace(/\s+/g, ' ').slice(0, 120)}"`)
      if (samples.length) lines.push(`  [${label}] (text samples): ${samples.join(' | ')}`)
    }
  }

  // Non-numeric forms (e.g. partnerships): counts by period and choice × choice
  const choiceFields = fields.filter(
    f => f !== periodField && CHOICE_TYPES.includes(f.type) && f.type !== 'multiple_choice',
  )
  if (!hasNumbers) {
    const small = choiceFields
      .map(f => ({ f, vals: tally(formRows.map(r => r.data[f.id])) }))
      .filter(x => x.vals.length >= 2 && x.vals.length <= 12)
    for (const { f, vals } of small) {
      const byPeriod = groups.map(g => {
        const t = new Map(tally(g.rows.map(r => r.data[f.id])))
        return `${g.period.display}: ${vals.map(([v]) => `${v}=${t.get(v) ?? 0}`).join(', ')}`
      })
      lines.push(`  [${fieldLabel(f)}] counts BY PERIOD: ${byPeriod.join(' || ')}`)
    }
    let pairs = 0
    for (let i = 0; i < small.length && pairs < 4; i++) {
      for (let j = i + 1; j < small.length && pairs < 4; j++) {
        pairs++
        const a = small[i], b = small[j]
        lines.push(`  CROSS-TAB [${fieldLabel(a.f)}] × [${fieldLabel(b.f)}]:`)
        for (const [av] of a.vals) {
          const rows = formRows.filter(r => tally([r.data[a.f.id]]).some(([x]) => x === av))
          const t = tally(rows.map(r => r.data[b.f.id]))
          lines.push(`    "${av}" (${rows.length}): ${t.map(([v, n]) => `${v}=${n}`).join(', ')}`)
        }
      }
    }
  }

  // Numeric fields broken down by each choice field (e.g. by institution); non-zero sums only
  const breakdownFields = choiceFields.filter(f => (f.type as string) !== 'boolean')
  if (hasNumbers) {
    for (const cf of breakdownFields) {
      const values = tally(formRows.map(r => r.data[cf.id])).map(([v]) => v)
      if (values.length === 0 || values.length > 50) continue
      lines.push(`  BREAKDOWN of numeric totals by [${fieldLabel(cf)}] (zero totals omitted):`)
      for (const cv of values.sort()) {
        const g = formRows.filter(r => tally([r.data[cf.id]]).some(([x]) => x === cv))
        const parts: string[] = []
        for (const nf of numericFields) {
          const vals = g.map(r => toNum(r.data[nf.id])).filter((v): v is number => v !== null)
          const t = vals.reduce((a, b) => a + b, 0)
          if (vals.length && t !== 0) parts.push(`${fieldLabel(nf)}=${fmt(t)}`)
        }
        if (parts.length) lines.push(`    "${cv}" (${g.length} submissions): ${parts.join(' | ')}`)
      }
    }
  }

  if (listRows) lines.push(...recordLines())
  else lines.push('')
  return lines
}

// ---------------------------------------------------------------------------
// EXCITE: Health Agent (monthly) + Other Extension Professionals (quarterly)
// ---------------------------------------------------------------------------

type Metric = { name: string; label: string; countsTowardTotal?: boolean }

const HA_EVENTS: Metric[] = [
  { name: 'Virtual live events', label: 'Virtual Live' },
  { name: 'In-person events', label: 'In-Person' },
  { name: 'Training sessions', label: 'Training Sessions' },
  { name: 'Vaccination events', label: 'Vax Events' },
  { name: 'Mass media placements', label: 'Mass Media' },
  { name: 'Social media posts', label: 'Social Media' },
  { name: 'Direct communications', label: 'Direct Comm' },
  { name: 'Print media pieces', label: 'Print Media' },
  { name: 'Other activities', label: 'Other' },
]
const OEP_EVENTS: Metric[] = [
  { name: 'Virtual live events', label: 'OEP_VL' },
  { name: 'In-person events', label: 'OEP InPerson' },
  { name: 'Training sessions', label: 'OEP Training Sessions' },
  { name: 'Vaccination events', label: 'OEP Vax Events' },
  { name: 'Mass media placements', label: 'OEP MM' },
  { name: 'Social media posts', label: 'OEP SM' },
  { name: 'Direct communications', label: 'OEP Direct Comm' },
  { name: 'Print media pieces', label: 'OEP Print Media' },
  { name: 'Other activities', label: 'OEP Other' },
]
const HA_REACH: Metric[] = [
  { name: 'Virtual live reach', label: 'VL Reach' },
  { name: 'In-person reach', label: 'In-Person Reach' },
  { name: 'Training session reach', label: 'TS Reach' },
  { name: 'Vaccination event reach', label: 'Vax Reach' },
  { name: 'Number vaccinated', label: 'Vax Vaxxed', countsTowardTotal: false },
  { name: 'Mass media reach', label: 'MM Reach' },
  { name: 'Social media views', label: 'SM Views' },
  { name: 'Social media interactions', label: 'SM Interactions', countsTowardTotal: false },
  { name: 'Direct communication reach', label: 'DC Reach' },
  { name: 'Print media reach', label: 'PM Reach' },
  { name: 'Other reach', label: 'Other Reach' },
]
const OEP_REACH: Metric[] = [
  { name: 'Virtual live reach', label: 'OEPVL Reach' },
  { name: 'In-person reach', label: 'OEP InPerson Reach' },
  { name: 'Training session reach', label: 'OEP Training Sessions Reach' },
  { name: 'Vaccination event reach', label: 'OEP Vax Reach' },
  { name: 'Number vaccinated', label: 'OEP Vax Vaxxed', countsTowardTotal: false },
  { name: 'Mass media reach', label: 'OEP MM Reach' },
  { name: 'Social media views', label: 'OEP SM Reach' },
  { name: 'Social media interactions', label: 'OEP SM Interactions', countsTowardTotal: false },
  { name: 'Direct communication reach', label: 'OEP Direct Comm Reach' },
  { name: 'Print media reach', label: 'OEP PM Reach' },
  { name: 'Other reach', label: 'OEP Other Reach' },
]
const OEP_PD: Metric[] = [
  { name: 'One-on-one technical assistance reach', label: 'TA Reach' },
  { name: 'Group training / professional development reach', label: 'Group Reach' },
  { name: 'Other professional development reach', label: 'Other Reach' },
]

const CURRICULUM_METRICS = ['Cohorts', 'Sessions', 'Attendees', 'Completed Programs', 'Individuals Completed'] as const

interface Source {
  form: FormMeta
  rows: SubmissionRow[]
  groups: PeriodGroup[]
}

function sumField(rows: SubmissionRow[], f: FormField | undefined): number {
  if (!f) return 0
  return rows.reduce((a, r) => a + (toNum(r.data[f.id]) ?? 0), 0)
}

function metricTotals(src: Source | null, metrics: Metric[], rows?: SubmissionRow[]): number[] {
  return metrics.map(m => {
    if (!src) return 0
    const f = src.form.fields.find(x => x.label === m.label)
    return sumField(rows ?? src.rows, f)
  })
}

function totalOf(metrics: Metric[], vals: number[]): number {
  return vals.reduce((a, v, i) => a + (metrics[i].countsTowardTotal === false ? 0 : v), 0)
}

function listNonZero(metrics: Metric[], vals: number[]): string {
  const p = metrics.map((m, i) => (vals[i] ? `${m.name}=${fmt(vals[i])}` : null)).filter(Boolean)
  return p.length ? p.join(', ') : 'none reported'
}

function curriculumOf(src: Source | null): Map<string, Record<string, FormField>> {
  const out = new Map<string, Record<string, FormField>>()
  if (!src) return out
  for (const f of src.form.fields) {
    const m = f.label.match(/^(.*?)\s+[—–-]\s+(Cohorts|Sessions|Attendees|Completed Programs|Individuals Completed)$/)
    if (!m) continue
    const rec = out.get(m[1]) ?? {}
    rec[m[2]] = f
    out.set(m[1], rec)
  }
  return out
}

function buildExciteRollups(forms: FormMeta[], submissions: SubmissionRow[]): string {
  const load = (probe: string): Source | null => {
    // Prefer the real activity form (it also carries the curriculum columns) over any raw re-import
    const matches = forms.filter(f => f.fields.some(x => x.label === probe))
    const form = matches.find(f => f.fields.some(x => / — Cohorts$/.test(x.label))) ?? matches[0]
    if (!form) return null
    const rows = submissions.filter(s => s.form_id === form.id)
    if (!rows.length) return null
    return { form, rows, groups: groupByPeriod(rows, findPeriodField(form, rows)) }
  }
  const ha = load('VL Reach')
  const oep = load('OEPVL Reach')
  if (!ha && !oep) return ''

  const L: string[] = []
  L.push('=== PRE-COMPUTED COMBINED REPORT: HEALTH AGENTS (HA, reported monthly) + OTHER EXTENSION PROFESSIONALS (OEP, reported quarterly) ===')
  L.push('These totals were calculated by the system from every submission (zeros included). Quote them directly; do NOT re-add or re-derive them.')
  L.push('This mirrors the program workbook\'s "HA & OEP Summary": events/activities AND reach together, HA | OEP | TOTAL. Always report every category, including "Other".')
  L.push('TOTAL REACH excludes "Number vaccinated" and "Social media interactions" (they are subsets / engagement counts, not additional people).')
  L.push('')

  // ---- Cumulative
  const haE = metricTotals(ha, HA_EVENTS)
  const oepE = metricTotals(oep, OEP_EVENTS)
  const haR = metricTotals(ha, HA_REACH)
  const oepR = metricTotals(oep, OEP_REACH)
  L.push('-- CUMULATIVE (all reporting periods) --')
  L.push('EVENTS / ACTIVITIES (counts)  [HA | OEP | TOTAL]:')
  HA_EVENTS.forEach((m, i) => L.push(`  ${m.name}: HA=${fmt(haE[i])} | OEP=${fmt(oepE[i])} | TOTAL=${fmt(haE[i] + oepE[i])}`))
  L.push(`  TOTAL EVENTS/ACTIVITIES: HA=${fmt(totalOf(HA_EVENTS, haE))} | OEP=${fmt(totalOf(OEP_EVENTS, oepE))} | TOTAL=${fmt(totalOf(HA_EVENTS, haE) + totalOf(OEP_EVENTS, oepE))}`)
  L.push('REACH (people)  [HA | OEP | TOTAL]:')
  HA_REACH.forEach((m, i) => L.push(`  ${m.name}: HA=${fmt(haR[i])} | OEP=${fmt(oepR[i])} | TOTAL=${fmt(haR[i] + oepR[i])}`))
  L.push(`  TOTAL REACH: HA=${fmt(totalOf(HA_REACH, haR))} | OEP=${fmt(totalOf(OEP_REACH, oepR))} | TOTAL=${fmt(totalOf(HA_REACH, haR) + totalOf(OEP_REACH, oepR))}`)
  if (oep) {
    const pd = metricTotals(oep, OEP_PD)
    L.push(`OEP PROFESSIONAL DEVELOPMENT REACH (OEP only): ${OEP_PD.map((m, i) => `${m.name}=${fmt(pd[i])}`).join(', ')}, TOTAL=${fmt(pd.reduce((a, b) => a + b, 0))}`)
  }
  L.push('')

  // ---- Monthly (HA)
  if (ha) {
    L.push('-- MONTHLY (HA only; OEP reports quarterly). Metrics not listed were 0 or not reported. --')
    for (const g of ha.groups) {
      const e = metricTotals(ha, HA_EVENTS, g.rows)
      const r = metricTotals(ha, HA_REACH, g.rows)
      L.push(`${g.period.display} (${g.rows.length} HA reports): EVENTS: ${listNonZero(HA_EVENTS, e)}; TOTAL EVENTS=${fmt(totalOf(HA_EVENTS, e))} || REACH: ${listNonZero(HA_REACH, r)}; TOTAL REACH=${fmt(totalOf(HA_REACH, r))}`)
    }
    L.push('')
  }

  // ---- Quarterly (OEP quarters; HA months rolled up into them)
  const quarters = (oep?.groups ?? []).map(g => g.period).filter(p => p.kind === 'quarter' && p.startMonth !== undefined)
  if (quarters.length) {
    L.push('-- QUARTERLY (OEP as reported; HA monthly reports rolled up into the same calendar quarters) --')
    for (const q of quarters) {
      const haRows = ha ? ha.rows.filter(r => {
        const p = periodOf(r, findPeriodField(ha.form, ha.rows))
        return p.endMonth !== undefined && p.endMonth >= q.startMonth! && p.endMonth <= q.endMonth!
      }) : []
      const oepRows = oep!.groups.find(g => g.period.key === q.key)?.rows ?? []
      const hE = metricTotals(ha, HA_EVENTS, haRows), hR = metricTotals(ha, HA_REACH, haRows)
      const oE = metricTotals(oep, OEP_EVENTS, oepRows), oR = metricTotals(oep, OEP_REACH, oepRows)
      const pd = metricTotals(oep, OEP_PD, oepRows)
      L.push(`${q.display}:`)
      L.push(`  HA events: ${listNonZero(HA_EVENTS, hE)}; TOTAL=${fmt(totalOf(HA_EVENTS, hE))} | HA reach: ${listNonZero(HA_REACH, hR)}; TOTAL=${fmt(totalOf(HA_REACH, hR))}`)
      L.push(`  OEP events: ${listNonZero(OEP_EVENTS, oE)}; TOTAL=${fmt(totalOf(OEP_EVENTS, oE))} | OEP reach: ${listNonZero(OEP_REACH, oR)}; TOTAL=${fmt(totalOf(OEP_REACH, oR))}`)
      L.push(`  OEP professional development reach: ${listNonZero(OEP_PD, pd)}`)
      L.push(`  COMBINED: events=${fmt(totalOf(HA_EVENTS, hE) + totalOf(OEP_EVENTS, oE))}, reach=${fmt(totalOf(HA_REACH, hR) + totalOf(OEP_REACH, oR))}`)
    }
    L.push('')
  }

  // ---- Curriculum delivery
  const haC = curriculumOf(ha)
  const oepC = curriculumOf(oep)
  const names = [...new Set([...haC.keys(), ...oepC.keys()])]
  if (names.length) {
    const cur = (src: Source | null, map: Map<string, Record<string, FormField>>, name: string, rows?: SubmissionRow[]) =>
      CURRICULUM_METRICS.map(k => (src ? sumField(rows ?? src.rows, map.get(name)?.[k]) : 0))
    const line = (v: number[]) => `cohorts=${fmt(v[0])}, sessions=${fmt(v[1])}, attendees=${fmt(v[2])}, completed programs=${fmt(v[3])}, individuals completed=${fmt(v[4])}`
    L.push('-- CURRICULUM DELIVERY (cumulative; every curriculum listed, including ones that reported only completions) --')
    const tot = { ha: [0, 0, 0, 0, 0], oep: [0, 0, 0, 0, 0] }
    for (const n of names) {
      const a = cur(ha, haC, n), b = cur(oep, oepC, n)
      a.forEach((v, i) => (tot.ha[i] += v))
      b.forEach((v, i) => (tot.oep[i] += v))
      L.push(`  ${n}:`)
      L.push(`    HA: ${line(a)}`)
      L.push(`    OEP: ${line(b)}`)
      L.push(`    COMBINED: ${line(a.map((v, i) => v + b[i]))}`)
    }
    L.push(`  ALL CURRICULA: HA: ${line(tot.ha)}`)
    L.push(`  ALL CURRICULA: OEP: ${line(tot.oep)}`)
    L.push(`  ALL CURRICULA: COMBINED: ${line(tot.ha.map((v, i) => v + tot.oep[i]))}`)
    L.push('  (Completion counts are meaningful even when cohorts/sessions are 0 — some programs only report completions.)')

    const perPeriod = (src: Source | null, map: Map<string, Record<string, FormField>>, label: string) => {
      if (!src) return
      L.push(`-- CURRICULUM DELIVERY BY PERIOD (${label}; only non-zero curricula shown) --`)
      for (const g of src.groups) {
        const parts = names
          .map(n => ({ n, v: cur(src, map, n, g.rows) }))
          .filter(x => x.v.some(Boolean))
          .map(x => `${x.n} (${line(x.v)})`)
        if (parts.length) L.push(`  ${g.period.display}: ${parts.join(' ; ')}`)
      }
    }
    perPeriod(ha, haC, 'HA monthly')
    perPeriod(oep, oepC, 'OEP quarterly')
    L.push('')
  }

  return L.join('\n')
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function buildContext(programName: string, forms: FormMeta[], submissions: SubmissionRow[]): string {
  const lines: string[] = [
    `PROGRAM: ${programName}`,
    `TOTAL FORMS: ${forms.length}`,
    `TOTAL SUBMISSIONS: ${submissions.length}`,
    '',
  ]

  const rollups = buildExciteRollups(forms, submissions)
  if (rollups) lines.push(rollups)

  for (const form of forms) {
    const formRows = submissions.filter(s => s.form_id === form.id)
    if (!formRows.length) continue
    lines.push(...formSection(form, formRows))
  }

  const text = lines.join('\n')
  return text.length > MAX_CONTEXT_CHARS
    ? text.slice(0, MAX_CONTEXT_CHARS) + '\n[CONTEXT TRUNCATED — tell the user some detail was cut off]'
    : text
}
