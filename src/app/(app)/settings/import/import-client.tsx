'use client'

import { useCallback, useEffect, useState } from 'react'
import { useProgram } from '@/contexts/program-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import {
  Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2, RotateCcw,
  Trash2, Undo2, Link2, ExternalLink, FileInput, Database,
} from 'lucide-react'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import type { Database as DB } from '@/types/database'
import type { FormSchema } from '@/types/forms'

type ImportJob = DB['public']['Tables']['import_jobs']['Row']

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<string, { label: string; icon: React.ElementType; className: string }> = {
  pending:    { label: 'Pending',    icon: Loader2,     className: 'text-gray-400' },
  processing: { label: 'Processing', icon: Loader2,     className: 'text-blue-500' },
  review:     { label: 'Review',     icon: AlertCircle, className: 'text-amber-500' },
  complete:   { label: 'Complete',   icon: CheckCircle2,className: 'text-emerald-500' },
  failed:     { label: 'Failed',     icon: AlertCircle, className: 'text-red-500' },
}

// ---------------------------------------------------------------------------
// CSV parser
// ---------------------------------------------------------------------------

function parseCsvRows(text: string, maxRows?: number): Record<string, string>[] {
  const src = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const rows: string[][] = []
  let field = '', inQuotes = false, fieldStart = true
  let currentRow: string[] = []

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else { field += ch }
    } else {
      if (ch === '"' && fieldStart) { inQuotes = true; fieldStart = false }
      else if (ch === ',') { currentRow.push(field.trim()); field = ''; fieldStart = true }
      else if (ch === '\n') {
        currentRow.push(field.trim())
        if (currentRow.some(c => c !== '')) rows.push(currentRow)
        currentRow = []; field = ''; fieldStart = true
      } else { field += ch; fieldStart = false }
    }
  }
  currentRow.push(field.trim())
  if (currentRow.some(c => c !== '')) rows.push(currentRow)
  if (rows.length < 2) return []

  const headers = rows[0].map(h => h.trim())
  const dataRows = maxRows !== undefined ? rows.slice(1, maxRows + 1) : rows.slice(1)
  return dataRows
    .filter(row => row.some(c => c.trim() !== ''))
    .map(row => {
      const record: Record<string, string> = {}
      headers.forEach((h, i) => { record[h] = row[i] ?? '' })
      return record
    })
}

function parseCsvPreview(text: string) { return parseCsvRows(text, 10) }
function parseCsvAll(text: string) { return parseCsvRows(text) }

// ---------------------------------------------------------------------------
// Period helpers
// ---------------------------------------------------------------------------

function periodOptions(type: 'month' | 'quarter'): { value: string; label: string }[] {
  const now = new Date()
  const options: { value: string; label: string }[] = []
  if (type === 'month') {
    for (let offset = -35; offset <= 11; offset++) {
      const d = new Date(now.getFullYear(), now.getMonth() + offset, 1)
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      options.push({ value, label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) })
    }
  } else {
    const currentQ = Math.floor(now.getMonth() / 3) + 1
    for (let yOffset = -3; yOffset <= 1; yOffset++) {
      const year = now.getFullYear() + yOffset
      const maxQ = yOffset === 1 ? currentQ + 1 : 4
      for (let q = 1; q <= maxQ && q <= 4; q++) options.push({ value: `${year}-Q${q}`, label: `Q${q} ${year}` })
    }
  }
  return options.reverse()
}

// ---------------------------------------------------------------------------
// Shared Period Picker
// ---------------------------------------------------------------------------

interface PeriodState {
  periodType: 'month' | 'quarter' | 'year' | 'custom' | ''
  periodValue: string
  periodStart: string
  periodEnd: string
}

function yearOptions(): { value: string; label: string }[] {
  const now = new Date()
  const options: { value: string; label: string }[] = []
  for (let y = now.getFullYear() + 1; y >= now.getFullYear() - 10; y--) {
    options.push({ value: String(y), label: String(y) })
  }
  return options
}

function PeriodPicker({ state, onChange }: {
  state: PeriodState
  onChange: (s: PeriodState) => void
}) {
  const { periodType, periodValue, periodStart, periodEnd } = state
  const periodComplete = !!(periodStart && periodEnd)

  return (
    <div className={cn(
      'px-5 py-3 border-b flex items-center gap-3 flex-wrap',
      periodComplete ? 'bg-gray-50' : 'bg-amber-50 border-amber-100'
    )}>
      <span className={cn('text-[12px] font-medium', periodComplete ? 'text-gray-600' : 'text-amber-700')}>
        Reporting period <span className="text-amber-500" aria-label="required">*</span>
      </span>
      <select
        value={periodType}
        onChange={e => onChange({ periodType: e.target.value as PeriodState['periodType'], periodValue: '', periodStart: '', periodEnd: '' })}
        className="h-7 rounded-md border border-gray-200 px-2 text-[11px] bg-white focus:outline-none focus:ring-1 focus:ring-orange-400"
        aria-label="Period type"
      >
        <option value="">None</option>
        <option value="month">Month</option>
        <option value="quarter">Quarter</option>
        <option value="year">Year</option>
        <option value="custom">Custom</option>
      </select>
      {periodType === 'month' && (
        <select
          value={periodValue}
          onChange={e => {
            const v = e.target.value
            if (v) {
              const [y, m] = v.split('-').map(Number)
              const lastDay = new Date(y, m, 0).getDate()
              onChange({ periodType, periodValue: v, periodStart: `${v}-01`, periodEnd: `${v}-${String(lastDay).padStart(2, '0')}` })
            } else {
              onChange({ periodType, periodValue: '', periodStart: '', periodEnd: '' })
            }
          }}
          className="h-7 rounded-md border border-gray-200 px-2 text-[11px] bg-white focus:outline-none focus:ring-1 focus:ring-orange-400"
          aria-label="Month"
        >
          <option value="">Select month…</option>
          {periodOptions('month').map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
      {periodType === 'year' && (
        <select
          value={periodValue}
          onChange={e => {
            const y = e.target.value
            if (y) {
              onChange({ periodType, periodValue: y, periodStart: `${y}-01-01`, periodEnd: `${y}-12-31` })
            } else {
              onChange({ periodType, periodValue: '', periodStart: '', periodEnd: '' })
            }
          }}
          className="h-7 rounded-md border border-gray-200 px-2 text-[11px] bg-white focus:outline-none focus:ring-1 focus:ring-orange-400"
          aria-label="Year"
        >
          <option value="">Select year…</option>
          {yearOptions().map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
      {(periodType === 'quarter' || periodType === 'custom') && (
        <input
          type="text"
          value={periodValue}
          onChange={e => onChange({ ...state, periodValue: e.target.value })}
          placeholder={periodType === 'quarter' ? 'e.g. Q3 2025' : 'e.g. FY 2024–25'}
          className="h-7 rounded-md border border-gray-200 px-2 text-[11px] bg-white focus:outline-none focus:ring-1 focus:ring-orange-400 w-36"
          aria-label="Period label"
        />
      )}
      {periodType && periodType !== 'month' && (
        <>
          <input type="date" value={periodStart}
            onChange={e => onChange({ ...state, periodStart: e.target.value })}
            className="h-7 rounded-md border border-gray-200 px-2 text-[11px] bg-white focus:outline-none focus:ring-1 focus:ring-orange-400"
            aria-label="Period start date" />
          <span className="text-[11px] text-gray-400">→</span>
          <input type="date" value={periodEnd}
            onChange={e => onChange({ ...state, periodEnd: e.target.value })}
            className="h-7 rounded-md border border-gray-200 px-2 text-[11px] bg-white focus:outline-none focus:ring-1 focus:ring-orange-400"
            aria-label="Period end date" />
        </>
      )}
      {!periodType && <span className="text-[11px] text-amber-600 italic">Choose a period type to continue</span>}
      {periodType && !periodComplete && (
        <span className="text-[11px] text-amber-600 italic">
          {periodType === 'month' ? 'Select a month above'
            : periodType === 'year' ? 'Select a year above'
            : 'Enter a label and start/end dates'}
        </span>
      )}
      {periodComplete && periodValue && (
        <span className="text-[11px] text-orange-600 font-medium">Period: <strong>{periodValue}</strong></span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Full-mode mapping editor (create form + data — existing behaviour)
// ---------------------------------------------------------------------------

const FULL_FIELD_TYPES = [
  { value: 'skip',            label: "Don't import" },
  { value: 'text',            label: 'Text' },
  { value: 'number',          label: 'Number' },
  { value: 'date',            label: 'Date' },
  { value: 'email',           label: 'Email' },
  { value: 'name',            label: 'Name' },
  { value: 'identifier',      label: 'Identifier' },
  { value: 'single_choice',   label: 'Single choice' },
  { value: 'multiple_choice', label: 'Multiple choice' },
  { value: 'scale',           label: 'Scale / Rating' },
  { value: 'boolean',         label: 'Yes / No' },
]

interface FullMappingEditorProps {
  job: ImportJob
  onSave: (mappings: Record<string, string>) => Promise<void>
  saving: boolean
}

function FullMappingEditor({ job, onSave, saving }: FullMappingEditorProps) {
  const schema = (job.detected_schema ?? {}) as Record<string, string>
  const rawMappings = (job.column_mappings ?? {}) as Record<string, string>
  const [mappings, setMappings] = useState<Record<string, string>>({ ...schema, ...Object.fromEntries(Object.entries(rawMappings).filter(([, v]) => FULL_FIELD_TYPES.some(t => t.value === v))) })
  const [period, setPeriod] = useState<PeriodState>({
    periodType: (rawMappings._period_type ?? '') as PeriodState['periodType'],
    periodValue: rawMappings._period_value ?? '',
    periodStart: rawMappings._period_start ?? '',
    periodEnd: rawMappings._period_end ?? '',
  })
  const preview = (job.preview_data ?? []) as Record<string, string>[]
  const periodComplete = !!(period.periodStart && period.periodEnd)

  function handleSave() {
    const full: Record<string, string> = { ...mappings, _import_mode: 'full' }
    if (period.periodType) {
      full._period_type = period.periodType
      full._period_value = period.periodValue
      if (period.periodStart) full._period_start = period.periodStart
      if (period.periodEnd) full._period_end = period.periodEnd
    }
    onSave(full)
  }

  return (
    <div className="mt-4 rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b flex items-center justify-between gap-4">
        <div>
          <p className="text-[13px] font-semibold text-gray-800">{job.file_name}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">{job.row_count?.toLocaleString()} rows · {Object.keys(schema).length} columns detected</p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {!periodComplete && <p className="text-[12px] text-amber-600 font-medium">Set a reporting period first</p>}
          <Button
            onClick={handleSave}
            disabled={saving || !periodComplete}
            className="h-8 text-[12px] bg-orange-600 hover:bg-orange-700 gap-1.5 disabled:opacity-50"
            aria-busy={saving}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {saving ? 'Creating…' : 'Confirm & create form'}
          </Button>
        </div>
      </div>
      <PeriodPicker state={period} onChange={setPeriod} />
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="text-left px-4 py-2.5 font-medium text-gray-500 w-1/3">Column</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-500 w-1/4">AI detected</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-500 w-1/4">Field type</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-500">Sample</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(schema).map(col => {
              const currentType = mappings[col] ?? schema[col] ?? 'text'
              const isSkipped = currentType === 'skip'
              return (
                <tr key={col} className={cn('border-b last:border-0', isSkipped ? 'bg-gray-50 opacity-50' : 'hover:bg-gray-50/50')}>
                  <td className={cn('px-4 py-2.5 font-medium truncate max-w-[200px]', isSkipped ? 'text-gray-400 line-through' : 'text-gray-700')}>{col}</td>
                  <td className="px-4 py-2.5 text-gray-400">{schema[col]}</td>
                  <td className="px-4 py-2.5">
                    <select
                      value={currentType}
                      onChange={e => setMappings(m => ({ ...m, [col]: e.target.value }))}
                      className="h-7 rounded-md border border-gray-200 px-2 text-[11px] bg-white focus:outline-none focus:ring-1 focus:ring-orange-400"
                      aria-label={`Field type for ${col}`}
                    >
                      {FULL_FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-2.5 text-gray-400 truncate max-w-[160px]">
                    {isSkipped ? '—' : String(preview[0]?.[col] ?? '')}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Data-only mapping editor (add rows to existing form)
// ---------------------------------------------------------------------------

interface FormOption {
  id: string
  name: string
  schema: FormSchema | null
}

interface DataOnlyMappingEditorProps {
  job: ImportJob
  targetForm: FormOption
  onSave: (mappings: Record<string, string>) => Promise<void>
  saving: boolean
}

function DataOnlyMappingEditor({ job, targetForm, onSave, saving }: DataOnlyMappingEditorProps) {
  const csvColumns = Object.keys((job.detected_schema ?? {}) as Record<string, string>)
  const formFields = targetForm.schema?.pages.flatMap(p => p.fields).filter(f =>
    !['section_header', 'instructional_text', 'spacer', 'page_break', 'hidden_field', 'calculated_field'].includes(f.type)
  ) ?? []

  // Auto-map: if CSV column name loosely matches a field label, pre-select it
  const autoMap = (col: string) => {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
    return formFields.find(f => norm(f.label) === norm(col))?.id ?? 'skip'
  }

  const [mappings, setMappings] = useState<Record<string, string>>(() =>
    Object.fromEntries(csvColumns.map(col => [col, autoMap(col)]))
  )
  const [period, setPeriod] = useState<PeriodState>({ periodType: '', periodValue: '', periodStart: '', periodEnd: '' })
  const preview = (job.preview_data ?? []) as Record<string, string>[]
  const periodComplete = !!(period.periodStart && period.periodEnd)
  const mappedCount = Object.values(mappings).filter(v => v !== 'skip').length

  function handleSave() {
    const full: Record<string, string> = {
      ...mappings,
      _import_mode: 'data_only',
      _target_form_id: targetForm.id,
    }
    if (period.periodType) {
      full._period_type = period.periodType
      full._period_value = period.periodValue
      if (period.periodStart) full._period_start = period.periodStart
      if (period.periodEnd) full._period_end = period.periodEnd
    }
    onSave(full)
  }

  return (
    <div className="mt-4 rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b flex items-center justify-between gap-4">
        <div>
          <p className="text-[13px] font-semibold text-gray-800">{job.file_name} → <span className="text-orange-600">{targetForm.name}</span></p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {job.row_count?.toLocaleString()} rows · {mappedCount} of {csvColumns.length} columns mapped
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {!periodComplete && <p className="text-[12px] text-amber-600 font-medium">Set a reporting period first</p>}
          <Button
            onClick={handleSave}
            disabled={saving || !periodComplete || mappedCount === 0}
            className="h-8 text-[12px] bg-orange-600 hover:bg-orange-700 gap-1.5 disabled:opacity-50"
            aria-busy={saving}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Database className="h-3.5 w-3.5" />}
            {saving ? 'Importing…' : `Import ${job.row_count?.toLocaleString() ?? ''} rows`}
          </Button>
        </div>
      </div>
      <PeriodPicker state={period} onChange={setPeriod} />
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="text-left px-4 py-2.5 font-medium text-gray-500 w-1/3">CSV column</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-500 w-2/5">Map to form field</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-500">Sample value</th>
            </tr>
          </thead>
          <tbody>
            {csvColumns.map(col => {
              const val = mappings[col] ?? 'skip'
              const isSkipped = val === 'skip'
              return (
                <tr key={col} className={cn('border-b last:border-0', isSkipped ? 'bg-gray-50 opacity-50' : 'hover:bg-gray-50/50')}>
                  <td className={cn('px-4 py-2.5 font-medium truncate max-w-[180px]', isSkipped ? 'text-gray-400 line-through' : 'text-gray-700')}>{col}</td>
                  <td className="px-4 py-2.5">
                    <select
                      value={val}
                      onChange={e => setMappings(m => ({ ...m, [col]: e.target.value }))}
                      className="h-7 rounded-md border border-gray-200 px-2 text-[11px] bg-white focus:outline-none focus:ring-1 focus:ring-orange-400 max-w-[220px]"
                      aria-label={`Map ${col}`}
                    >
                      <option value="skip">— Don't import —</option>
                      {formFields.map(f => (
                        <option key={f.id} value={f.id}>{f.label || f.type}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2.5 text-gray-400 truncate max-w-[160px]">
                    {isSkipped ? '—' : String(preview[0]?.[col] ?? '')}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {formFields.length === 0 && (
        <p className="px-5 py-4 text-[13px] text-amber-600">This form has no editable fields. Choose a different form.</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// URL Import tab
// ---------------------------------------------------------------------------

interface UrlImportProps {
  programId: string
  onDone: () => void
}

function UrlImportTab({ programId, onDone }: UrlImportProps) {
  const [url, setUrl] = useState('')
  const [formName, setFormName] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ form_id: string; form_slug: string; title: string; field_count: number } | null>(null)

  async function handleExtract() {
    if (!url.trim()) return
    setLoading(true)
    setResult(null)
    try {
      const res = await fetch('/api/import/from-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ program_id: programId, url: url.trim(), form_name: formName.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(typeof data.error === 'string' ? data.error : 'Failed to import form')
      } else {
        setResult(data)
        toast.success(`Form created with ${data.field_count} fields`)
        onDone()
      }
    } catch {
      toast.error('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-5 space-y-4">
        <div>
          <p className="text-[13px] font-semibold text-gray-800 mb-0.5">Form URL</p>
          <p className="text-[12px] text-gray-400 mb-3">
            Paste a publicly accessible Google Form, JotForm, or other form link.
            The form must be set to "anyone with the link can view."
          </p>
          <Input
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://forms.google.com/… or https://form.jotform.com/…"
            className="text-[13px] h-9"
            aria-label="Form URL"
            onKeyDown={e => { if (e.key === 'Enter' && url.trim()) handleExtract() }}
          />
        </div>
        <div>
          <p className="text-[13px] font-medium text-gray-700 mb-1.5">Form name <span className="text-gray-400 font-normal">(optional — uses the form's own title if blank)</span></p>
          <Input
            value={formName}
            onChange={e => setFormName(e.target.value)}
            placeholder="e.g. Q2 Agent Survey"
            className="text-[13px] h-9 max-w-sm"
            aria-label="Form name override"
          />
        </div>
        <Button
          onClick={handleExtract}
          disabled={!url.trim() || loading}
          className="h-9 text-[13px] bg-orange-600 hover:bg-orange-700 gap-2"
          aria-busy={loading}
        >
          {loading
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Extracting form…</>
            : <><Link2 className="h-3.5 w-3.5" /> Extract &amp; create form</>
          }
        </Button>
      </div>

      {loading && (
        <div className="rounded-xl border border-blue-100 bg-blue-50 px-5 py-4 flex items-center gap-3">
          <Loader2 className="h-4 w-4 text-blue-500 animate-spin flex-shrink-0" />
          <div>
            <p className="text-[13px] font-medium text-blue-800">Fetching and analyzing the form…</p>
            <p className="text-[12px] text-blue-600 mt-0.5">This usually takes 5–15 seconds depending on the form size.</p>
          </div>
        </div>
      )}

      {result && (
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-5 py-4 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-[13px] font-semibold text-emerald-800">{result.title}</p>
              <p className="text-[12px] text-emerald-600 mt-0.5">{result.field_count} fields extracted and created</p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-[12px] border-emerald-200 text-emerald-700 hover:bg-emerald-100 gap-1.5 flex-shrink-0"
            onClick={() => window.open(`/forms/${result.form_id}/edit`, '_blank')}
          >
            <ExternalLink className="h-3 w-3" /> Open in builder
          </Button>
        </div>
      )}

      <div className="rounded-xl border border-gray-100 bg-gray-50 px-5 py-4 space-y-1.5">
        <p className="text-[12px] font-semibold text-gray-600">What gets imported</p>
        <ul className="text-[12px] text-gray-500 space-y-1 list-disc ml-4">
          <li>All question text, field types, and answer options</li>
          <li>Required vs. optional status</li>
          <li>Section headers and instructions</li>
          <li>Matrix / grid questions with rows and columns</li>
        </ul>
        <p className="text-[12px] font-semibold text-gray-600 mt-3 pt-1 border-t border-gray-200">What doesn't carry over</p>
        <ul className="text-[12px] text-gray-500 space-y-1 list-disc ml-4">
          <li>Existing response data (this only imports the form structure)</li>
          <li>Conditional logic / skip rules</li>
          <li>File upload or payment fields</li>
        </ul>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type PageTab = 'file' | 'url'
type ImportMode = 'full' | 'data_only'

export function ImportClient() {
  const { currentProgram } = useProgram()

  // Tab + mode
  const [pageTab, setPageTab] = useState<PageTab>('file')
  const [importMode, setImportMode] = useState<ImportMode>('full')

  // Existing forms (for data-only mode)
  const [forms, setForms] = useState<FormOption[]>([])
  const [formsLoaded, setFormsLoaded] = useState(false)
  const [targetFormId, setTargetFormId] = useState('')

  // File upload state
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)

  // Import jobs
  const [jobs, setJobs] = useState<ImportJob[]>([])
  const [activeJob, setActiveJob] = useState<ImportJob | null>(null)
  const [savingMappings, setSavingMappings] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // Confirm delete dialog
  const [confirmingDelete, setConfirmingDelete] = useState<ImportJob | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loadJobs = useCallback(async () => {
    if (!currentProgram) return
    const res = await fetch(`/api/import?program_id=${currentProgram.id}`)
    if (res.ok) setJobs(await res.json())
    setLoaded(true)
  }, [currentProgram])

  // Load forms for data-only mode
  useEffect(() => {
    if (importMode !== 'data_only' || formsLoaded || !currentProgram) return
    fetch(`/api/forms?program_id=${currentProgram.id}`)
      .then(r => r.ok ? r.json() : [])
      .then((data: Array<{ id: string; name: string; schema: unknown }>) => {
        setForms(data.map(f => ({ id: f.id, name: f.name, schema: f.schema as FormSchema | null })))
        setFormsLoaded(true)
      })
      .catch(() => setFormsLoaded(true))
  }, [importMode, formsLoaded, currentProgram])

  if (currentProgram && !loaded) loadJobs()

  const targetForm = forms.find(f => f.id === targetFormId) ?? null

  async function handleDelete(job: ImportJob) {
    setDeleting(true)
    const res = await fetch(`/api/import/${job.id}`, { method: 'DELETE' })
    setDeleting(false)
    if (res.ok) {
      setJobs(j => j.filter(x => x.id !== job.id))
      if (activeJob?.id === job.id) setActiveJob(null)
      setConfirmingDelete(null)
      const mappings = (job.column_mappings ?? {}) as Record<string, string>
      const isDataOnly = mappings._import_mode === 'data_only'
      toast.success(
        job.status === 'complete'
          ? isDataOnly
            ? 'Import undone — submitted rows removed from form'
            : 'Import undone — form and submissions removed'
          : 'Import deleted'
      )
    } else {
      toast.error('Failed to delete import')
    }
  }

  async function handleFile(file: File) {
    if (!currentProgram) return
    const allowed = ['text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
    if (!allowed.includes(file.type) && !file.name.match(/\.(csv|xlsx?)$/i)) {
      toast.error('Only CSV and Excel files are supported')
      return
    }
    if (importMode === 'data_only' && !targetFormId) {
      toast.error('Select a target form before uploading')
      return
    }

    setUploading(true)
    try {
      const text = await file.text()
      const preview = parseCsvPreview(text)
      if (preview.length === 0) {
        toast.error('Could not parse file — check that it has headers and data rows')
        return
      }
      const allRows = parseCsvAll(text)

      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          program_id: currentProgram.id,
          file_name: file.name,
          file_url: '',
          preview_data: allRows,
          row_count: allRows.length,
        }),
      })

      if (res.ok) {
        const job = await res.json()
        setJobs(j => [job, ...j])
        setActiveJob(job)
        toast.success('File analyzed — review the column mappings below')
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error(typeof err.error === 'string' ? err.error : 'Failed to process file')
      }
    } catch {
      toast.error('Failed to read file')
    } finally {
      setUploading(false)
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  async function saveMappings(mappings: Record<string, string>) {
    if (!activeJob) return
    setSavingMappings(true)
    const res = await fetch(`/api/import/${activeJob.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ column_mappings: mappings, status: 'complete' }),
    })
    if (res.ok) {
      const updated = await res.json()
      setJobs(j => j.map(x => x.id === updated.id ? updated : x))
      setActiveJob(null)
      const isDataOnly = mappings._import_mode === 'data_only'
      toast.success(isDataOnly ? 'Data imported into existing form' : 'Import complete — form created')
    } else {
      toast.error('Failed to save')
    }
    setSavingMappings(false)
  }

  return (
    <div className="max-w-4xl px-8 py-8">
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold tracking-tight text-gray-900">Import</h1>
        <p className="mt-0.5 text-[14px] text-gray-500">Bring in data from a spreadsheet or recreate a form from an external link.</p>
      </div>

      {/* Page tab */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-xl mb-6 w-fit">
        {([
          { key: 'file', label: 'From file', icon: FileSpreadsheet },
          { key: 'url',  label: 'From URL',  icon: Link2 },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setPageTab(key)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[13px] font-medium transition-colors',
              pageTab === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* ── From URL tab ── */}
      {pageTab === 'url' && currentProgram && (
        <UrlImportTab programId={currentProgram.id} onDone={loadJobs} />
      )}

      {/* ── From file tab ── */}
      {pageTab === 'file' && (
        <>
          {/* Import mode toggle */}
          <div className="mb-4 rounded-xl border border-gray-100 bg-white shadow-sm px-5 py-4">
            <p className="text-[13px] font-semibold text-gray-800 mb-3">What would you like to do?</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={() => setImportMode('full')}
                className={cn(
                  'flex items-start gap-3 flex-1 rounded-lg border px-4 py-3 text-left transition-colors',
                  importMode === 'full'
                    ? 'border-orange-300 bg-orange-50 ring-1 ring-orange-300'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                )}
              >
                <FileInput className={cn('h-4 w-4 mt-0.5 flex-shrink-0', importMode === 'full' ? 'text-orange-600' : 'text-gray-400')} />
                <div>
                  <p className={cn('text-[13px] font-medium', importMode === 'full' ? 'text-orange-700' : 'text-gray-700')}>
                    Create a new form with this data
                  </p>
                  <p className="text-[12px] text-gray-400 mt-0.5">Builds a form from the spreadsheet columns, then imports all rows as submissions.</p>
                </div>
              </button>
              <button
                onClick={() => setImportMode('data_only')}
                className={cn(
                  'flex items-start gap-3 flex-1 rounded-lg border px-4 py-3 text-left transition-colors',
                  importMode === 'data_only'
                    ? 'border-orange-300 bg-orange-50 ring-1 ring-orange-300'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                )}
              >
                <Database className={cn('h-4 w-4 mt-0.5 flex-shrink-0', importMode === 'data_only' ? 'text-orange-600' : 'text-gray-400')} />
                <div>
                  <p className={cn('text-[13px] font-medium', importMode === 'data_only' ? 'text-orange-700' : 'text-gray-700')}>
                    Add data to an existing form
                  </p>
                  <p className="text-[12px] text-gray-400 mt-0.5">Map spreadsheet columns to fields in a form you've already created, then import as submissions.</p>
                </div>
              </button>
            </div>

            {/* Form selector for data-only mode */}
            {importMode === 'data_only' && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <label className="block text-[13px] font-medium text-gray-700 mb-1.5">
                  Which form should receive this data?
                </label>
                {!formsLoaded ? (
                  <p className="text-[12px] text-gray-400">Loading forms…</p>
                ) : forms.length === 0 ? (
                  <p className="text-[12px] text-amber-600">No forms found in this program. Create a form first.</p>
                ) : (
                  <select
                    value={targetFormId}
                    onChange={e => setTargetFormId(e.target.value)}
                    className="h-9 rounded-md border border-gray-200 px-3 text-[13px] bg-white focus:outline-none focus:ring-1 focus:ring-orange-400 max-w-sm"
                    aria-label="Target form"
                  >
                    <option value="">Select a form…</option>
                    {forms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                )}
              </div>
            )}
          </div>

          {/* Drop zone */}
          <div
            className={cn(
              'rounded-xl border-2 border-dashed transition-colors cursor-pointer',
              dragging ? 'border-orange-400 bg-orange-50' : 'border-gray-200 bg-white hover:border-gray-300',
              importMode === 'data_only' && !targetFormId ? 'opacity-40 pointer-events-none' : ''
            )}
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            role="button"
            aria-label="Upload CSV or Excel file"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && document.getElementById('file-input')?.click()}
          >
            <label htmlFor="file-input" className="flex flex-col items-center py-12 cursor-pointer">
              {uploading ? (
                <>
                  <Loader2 className="h-8 w-8 text-orange-500 animate-spin mb-3" />
                  <p className="text-[14px] font-medium text-gray-600">Analyzing file with AI…</p>
                  <p className="text-[12px] text-gray-400 mt-1">Detecting column types</p>
                </>
              ) : (
                <>
                  <Upload className="h-8 w-8 text-gray-300 mb-3" />
                  <p className="text-[14px] font-medium text-gray-600">Drop a CSV or Excel file here</p>
                  <p className="text-[12px] text-gray-400 mt-1">or click to browse</p>
                  {importMode === 'data_only' && !targetFormId && (
                    <p className="text-[12px] text-amber-500 mt-2">Select a form above first</p>
                  )}
                </>
              )}
              <input
                id="file-input"
                type="file"
                accept=".csv,.xlsx,.xls"
                className="sr-only"
                onChange={onFileInput}
                disabled={uploading || (importMode === 'data_only' && !targetFormId)}
                aria-label="Select CSV or Excel file"
              />
            </label>
          </div>

          {/* Active mapping editor */}
          {activeJob && activeJob.status === 'review' && (
            importMode === 'data_only' && targetForm
              ? <DataOnlyMappingEditor job={activeJob} targetForm={targetForm} onSave={saveMappings} saving={savingMappings} />
              : <FullMappingEditor job={activeJob} onSave={saveMappings} saving={savingMappings} />
          )}
        </>
      )}

      {/* Import history — shown on both tabs */}
      {jobs.length > 0 && (
        <div className="mt-8">
          <h2 className="text-[13px] font-semibold text-gray-700 mb-3">Import history</h2>
          <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden" role="list">
            {jobs.map((job, i) => {
              const cfg = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.pending
              const Icon = cfg.icon
              const mappings = (job.column_mappings ?? {}) as Record<string, string>
              const isDataOnly = mappings._import_mode === 'data_only'
              return (
                <div
                  key={job.id}
                  role="listitem"
                  className={cn('flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50', i < jobs.length - 1 && 'border-b border-gray-50')}
                >
                  <FileSpreadsheet className="h-4 w-4 text-gray-300 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] font-medium text-gray-800 truncate">{job.file_name}</p>
                      {isDataOnly && (
                        <span className="text-[10px] font-medium text-blue-600 bg-blue-50 border border-blue-100 rounded px-1.5 py-0.5 flex-shrink-0">
                          data only
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      {job.row_count?.toLocaleString() ?? '—'} rows · {format(new Date(job.created_at), 'MMM d, yyyy h:mm a')}
                      {mappings._period_value ? ` · ${mappings._period_value}` : ''}
                    </p>
                  </div>
                  <div className={cn('flex items-center gap-1 text-[11px] font-medium', cfg.className)}>
                    <Icon className={cn('h-3.5 w-3.5', job.status === 'processing' && 'animate-spin')} />
                    {cfg.label}
                  </div>
                  {job.status === 'review' && (
                    <Button variant="ghost" size="sm" className="h-7 text-[11px] text-orange-600 hover:text-orange-700" onClick={() => setActiveJob(job)}>
                      Review
                    </Button>
                  )}
                  {job.status === 'failed' && (
                    <Button variant="ghost" size="sm" className="h-7 text-[11px] gap-1" onClick={loadJobs}>
                      <RotateCcw className="h-3 w-3" /> Retry
                    </Button>
                  )}
                  {job.status === 'complete' && (
                    <Button
                      variant="ghost" size="sm"
                      className="h-7 text-[11px] gap-1 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                      onClick={() => setConfirmingDelete(job)}
                      aria-label="Undo import"
                    >
                      <Undo2 className="h-3 w-3" /> Undo
                    </Button>
                  )}
                  {['review', 'failed', 'pending'].includes(job.status) && (
                    <Button
                      variant="ghost" size="sm"
                      className="h-7 w-7 p-0 text-gray-300 hover:text-red-500 hover:bg-red-50"
                      onClick={() => setConfirmingDelete(job)}
                      aria-label="Delete import"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Confirm delete / undo dialog */}
      {confirmingDelete && (() => {
        const isComplete = confirmingDelete.status === 'complete'
        const mappings = (confirmingDelete.column_mappings ?? {}) as Record<string, string>
        const isDataOnly = mappings._import_mode === 'data_only'
        const periodLabel = mappings._period_value ? ` (${mappings._period_value})` : ''
        const fileName = confirmingDelete.file_name.replace(/\.[^.]+$/, '') + periodLabel
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="dialog" aria-modal="true" aria-labelledby="confirm-delete-title">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
              <h2 id="confirm-delete-title" className="text-[16px] font-semibold text-gray-900 mb-2">
                {isComplete ? 'Undo import?' : 'Delete import?'}
              </h2>
              <p className="text-[13px] text-gray-500 mb-1">
                <strong className="text-gray-700">{fileName}</strong> · {confirmingDelete.row_count?.toLocaleString() ?? '—'} rows
              </p>
              {isComplete ? (
                <p className="text-[13px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-3">
                  {isDataOnly
                    ? `This will permanently delete the ${confirmingDelete.row_count?.toLocaleString()} submission records that were imported. The form itself will not be affected.`
                    : `This will permanently delete the imported form and all ${confirmingDelete.row_count?.toLocaleString()} submission records.`
                  } This cannot be undone.
                </p>
              ) : (
                <p className="text-[13px] text-gray-500 mt-2">
                  This removes the import job. No submissions were created yet, so nothing else is affected.
                </p>
              )}
              <div className="flex justify-end gap-2 mt-5">
                <Button variant="ghost" onClick={() => setConfirmingDelete(null)} disabled={deleting} className="h-8 text-[13px]">Cancel</Button>
                <Button
                  onClick={() => handleDelete(confirmingDelete)}
                  disabled={deleting}
                  aria-busy={deleting}
                  className={cn('h-8 text-[13px] gap-1.5', isComplete ? 'bg-amber-600 hover:bg-amber-700' : 'bg-red-600 hover:bg-red-700')}
                >
                  {deleting
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {isComplete ? 'Undoing…' : 'Deleting…'}</>
                    : isComplete
                      ? <><Undo2 className="h-3.5 w-3.5" /> Yes, undo import</>
                      : <><Trash2 className="h-3.5 w-3.5" /> Delete</>
                  }
                </Button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
