'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { CheckCircle2, UserPlus, Users, CheckSquare, Square, Flag, RotateCcw, Clock, BookmarkCheck, Loader2 } from 'lucide-react'
import type { FormSchema, FormField, FormPage, LogicRule, LogicCondition } from '@/types/forms'

interface Props {
  formId: string
  formName: string
  schema: FormSchema
  token: string
  tokenId: string
  tokenMetadata: Record<string, unknown>
  respondentEmail?: string | null
  programName: string
  brandColor: string
  confirmationMessage?: string
  redirectUrl?: string
  /** Pre-existing draft submission ID for this token, if any */
  draftId?: string
  /** Pre-filled data from the saved draft */
  draftData?: Record<string, unknown>
  /** When true, renders the form read-only with a preview banner — no submissions accepted */
  isPreview?: boolean
}

type RendererMode = 'filling' | 'delegated' | 'returned' | 'collaboration' | 'submitted' | 'collaborator-done'

// ─── Logic evaluation ────────────────────────────────────────────────────────

function evalCondition(cond: LogicCondition, data: Record<string, unknown>): boolean {
  const val = String(data[cond.fieldId] ?? '')
  const cmp = String(cond.value ?? '')
  switch (cond.operator) {
    case 'equals':       return val === cmp
    case 'not_equals':   return val !== cmp
    case 'contains':     return val.includes(cmp)
    case 'greater_than': return Number(val) > Number(cmp)
    case 'less_than':    return Number(val) < Number(cmp)
    case 'is_empty':     return val === '' || val === 'undefined'
    case 'is_not_empty': return val !== '' && val !== 'undefined'
    default:             return true
  }
}

function evalRule(rule: LogicRule, data: Record<string, unknown>): boolean {
  const results = rule.conditions.map(c => evalCondition(c, data))
  return rule.combinator === 'and' ? results.every(Boolean) : results.some(Boolean)
}

function isVisible(field: FormField, data: Record<string, unknown>): boolean {
  const rules = field.logic ?? []
  if (rules.length === 0) return true
  const showRules = rules.filter(r => r.action === 'show')
  const hideRules = rules.filter(r => r.action === 'hide')
  if (hideRules.some(r => evalRule(r, data))) return false
  if (showRules.length > 0) return showRules.some(r => evalRule(r, data))
  return true
}

function getSkipTarget(page: FormPage, data: Record<string, unknown>): string | null {
  for (const field of page.fields) {
    for (const rule of field.logic ?? []) {
      if (rule.action === 'skip_to_page' && rule.targetPageId && evalRule(rule, data)) {
        return rule.targetPageId
      }
    }
  }
  return null
}

// ─── Field renderer ──────────────────────────────────────────────────────────

const LAYOUT_TYPES = ['section_header', 'instructional_text', 'spacer', 'hidden_field', 'page_break', 'calculated_field', 'signature'] as const
const LAYOUT_TYPES_SET = new Set<string>(LAYOUT_TYPES)

function FieldInput({ field, value, onChange }: {
  field: FormField
  value: unknown
  onChange: (val: unknown) => void
}) {
  const id = `field-${field.id}`
  const strVal = String(value ?? '')
  const base = 'w-full rounded-lg border border-gray-200 px-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent'

  if (LAYOUT_TYPES_SET.has(field.type)) {
    if (field.type === 'section_header') return <h3 className="text-[16px] font-semibold text-gray-800 pt-2">{field.label || field.content}</h3>
    if (field.type === 'instructional_text') return <p className="text-[14px] text-gray-600">{field.content || field.label}</p>
    if (field.type === 'spacer') return <div className="h-4" />
    return null
  }

  const helpId = field.helpText ? `${id}-help` : undefined
  const label = (
    <label htmlFor={id} className="block text-[14px] font-medium text-gray-800 mb-1.5">
      {field.label}
      {field.required && <span className="text-red-500 ml-1" aria-hidden="true">*</span>}
      {field.required && <span className="sr-only"> (required)</span>}
    </label>
  )
  const help = field.helpText
    ? <p id={helpId} className="text-[13px] text-gray-500 mt-1">{field.helpText}</p>
    : null

  switch (field.type) {
    case 'short_text':
    case 'email':
    case 'url':
    case 'number': {
      const typeMap: Record<string, string> = { email: 'email', url: 'url', number: 'number' }
      return (
        <div>
          {label}
          <input id={id} type={typeMap[field.type] ?? 'text'} value={strVal} onChange={e => onChange(e.target.value)} placeholder={field.placeholder} required={field.required} aria-required={field.required} aria-describedby={helpId} className={`${base} h-10`} />
          {help}
        </div>
      )
    }
    case 'long_text':
      return (
        <div>
          {label}
          <textarea id={id} value={strVal} onChange={e => onChange(e.target.value)} placeholder={field.placeholder} required={field.required} aria-required={field.required} aria-describedby={helpId} rows={4} className={`${base} py-2 resize-none`} />
          {help}
        </div>
      )
    case 'date':
      return (
        <div>
          {label}
          <input id={id} type="date" value={strVal} onChange={e => onChange(e.target.value)} required={field.required} aria-required={field.required} aria-describedby={helpId} className={`${base} h-10`} />
          {help}
        </div>
      )
    case 'single_choice': {
      const opts = field.options ?? []
      return (
        <div>
          <fieldset>
            <legend className="block text-[14px] font-medium text-gray-800 mb-1.5">
              {field.label}{field.required && <span className="text-red-500 ml-1" aria-hidden="true">*</span>}
            </legend>
            {help}
            <div className="space-y-2 mt-2">
              {opts.map(opt => (
                <label key={opt.id} className="flex items-center gap-2.5 cursor-pointer">
                  <input type="radio" name={id} value={opt.value} checked={strVal === opt.value} onChange={() => onChange(opt.value)} required={field.required} className="h-4 w-4 text-orange-600 border-gray-300 focus:ring-orange-500" />
                  <span className="text-[14px] text-gray-700">{opt.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      )
    }
    case 'multiple_choice': {
      const selected = Array.isArray(value) ? (value as string[]) : []
      return (
        <div>
          <fieldset>
            <legend className="block text-[14px] font-medium text-gray-800 mb-1.5">
              {field.label}{field.required && <span className="text-red-500 ml-1" aria-hidden="true">*</span>}
            </legend>
            {help}
            <div className="space-y-2 mt-2">
              {(field.options ?? []).map(opt => (
                <label key={opt.id} className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" value={opt.value} checked={selected.includes(opt.value)} onChange={e => {
                    const next = e.target.checked ? [...selected, opt.value] : selected.filter(v => v !== opt.value)
                    onChange(next)
                  }} className="h-4 w-4 text-orange-600 border-gray-300 rounded focus:ring-orange-500" />
                  <span className="text-[14px] text-gray-700">{opt.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      )
    }
    case 'dropdown':
      return (
        <div>
          {label}
          <select id={id} value={strVal} onChange={e => onChange(e.target.value)} required={field.required} aria-required={field.required} className={`${base} h-10 bg-white`}>
            <option value="">Select…</option>
            {(field.options ?? []).map(opt => <option key={opt.id} value={opt.value}>{opt.label}</option>)}
          </select>
          {help}
        </div>
      )
    case 'rating':
    case 'likert_scale':
    case 'nps': {
      const max = field.scale ?? field.max ?? (field.type === 'nps' ? 10 : 5)
      const labels = field.scaleLabels ?? {}
      return (
        <div>
          <fieldset>
            <legend className="block text-[14px] font-medium text-gray-800 mb-1.5">
              {field.label}{field.required && <span className="text-red-500 ml-1" aria-hidden="true">*</span>}
            </legend>
            {help}
            <div className="flex gap-2 mt-2 flex-wrap">
              {Array.from({ length: max }, (_, i) => i + 1).map(n => (
                <label key={n} className="flex flex-col items-center gap-1 cursor-pointer">
                  <input type="radio" name={id} value={String(n)} checked={strVal === String(n)} onChange={() => onChange(String(n))} required={field.required} className="sr-only" />
                  <span className={`w-10 h-10 flex items-center justify-center rounded-lg border text-[14px] font-medium transition-colors cursor-pointer ${strVal === String(n) ? 'bg-orange-600 border-orange-600 text-white' : 'border-gray-200 text-gray-600 hover:border-orange-400'}`}>{n}</span>
                  {n === 1 && labels.start && <span className="text-[10px] text-gray-400 max-w-[40px] text-center leading-tight">{labels.start}</span>}
                  {n === max && labels.end && <span className="text-[10px] text-gray-400 max-w-[40px] text-center leading-tight">{labels.end}</span>}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      )
    }
    case 'slider':
      return (
        <div>
          {label}
          <div className="flex items-center gap-3 mt-2">
            <span className="text-[12px] text-gray-400">{field.min ?? 0}</span>
            <input type="range" id={id} min={field.min ?? 0} max={field.max ?? 100} step={field.step ?? 1} value={strVal || String(field.min ?? 0)} onChange={e => onChange(e.target.value)} className="flex-1 accent-orange-600" />
            <span className="text-[12px] text-gray-400">{field.max ?? 100}</span>
            <span className="text-[13px] font-semibold text-gray-700 w-10 text-right">{strVal || (field.min ?? 0)}</span>
          </div>
          {help}
        </div>
      )
    case 'matrix': {
      const rows = field.matrixRows ?? []
      const cols = field.matrixColumns ?? []
      const matrixVal = (value as Record<string, string> | undefined) ?? {}
      return (
        <div>
          <p className="text-[14px] font-medium text-gray-800 mb-2">{field.label}{field.required && <span className="text-red-500 ml-1" aria-hidden="true">*</span>}</p>
          {help}
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-[13px]" role="grid" aria-label={field.label}>
              <thead>
                <tr>
                  <th className="text-left pb-2 text-gray-400 font-normal w-1/3" />
                  {cols.map(col => <th key={col.id} className="pb-2 text-gray-600 font-medium text-center px-2">{col.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id} className="border-t border-gray-50">
                    <td className="py-2.5 pr-4 text-gray-700">{row.label}</td>
                    {cols.map(col => (
                      <td key={col.id} className="py-2.5 text-center px-2">
                        <input type={field.matrixType === 'checkbox' ? 'checkbox' : 'radio'} name={`${id}-${row.id}`} value={col.id} checked={matrixVal[row.id] === col.id} onChange={() => onChange({ ...matrixVal, [row.id]: col.id })} className="h-4 w-4 text-orange-600 border-gray-300 focus:ring-orange-500" aria-label={`${row.label} — ${col.label}`} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )
    }
    case 'file_upload':
      return (
        <div>
          {label}
          <input id={id} type="file" onChange={e => onChange(e.target.files?.[0]?.name ?? '')} required={field.required} aria-required={field.required} className="block w-full text-[13px] text-gray-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-[13px] file:font-medium file:bg-orange-50 file:text-orange-700 hover:file:bg-orange-100" />
          {help}
        </div>
      )
    default:
      return (
        <div>
          {label}
          <input id={id} type="text" value={strVal} onChange={e => onChange(e.target.value)} placeholder={field.placeholder} required={field.required} aria-required={field.required} className={`${base} h-10`} />
          {help}
        </div>
      )
  }
}

// ─── Main renderer ───────────────────────────────────────────────────────────

function deriveMode(meta: Record<string, unknown>): RendererMode {
  if (meta.isCollaboration) return 'collaboration'
  const ds = meta.delegationStatus as string | undefined
  if (ds === 'delegated') return 'delegated'
  if (ds === 'returned') return 'returned'
  return 'filling'
}

export function FormRenderer({
  formId, formName, schema, token, tokenId, tokenMetadata,
  respondentEmail, programName, brandColor, confirmationMessage, redirectUrl,
  draftId: initialDraftId, draftData, isPreview,
}: Props) {
  const initialMode = deriveMode(tokenMetadata)

  // Pre-fill data: draft → collaboration prefill → returned merged data → empty
  const [data, setData] = useState<Record<string, unknown>>(() => {
    if (initialMode === 'returned') return (tokenMetadata.mergedData as Record<string, unknown>) ?? {}
    if (initialMode === 'collaboration') return (tokenMetadata.prefillData as Record<string, unknown>) ?? {}
    if (draftData && Object.keys(draftData).length > 0) return draftData
    return {}
  })

  const [mode, setMode] = useState<RendererMode>(initialMode)
  const [pageIndex, setPageIndex] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Draft saving
  const [draftId, setDraftId] = useState<string | undefined>(initialDraftId)
  const [savingDraft, setSavingDraft] = useState(false)
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(initialDraftId ? new Date() : null)
  const restoredFromDraft = !!(initialDraftId && draftData && Object.keys(draftData).length > 0)

  // Delegation dialog state
  const [delegateOpen, setDelegateOpen] = useState(false)
  const [delegateEmail, setDelegateEmail] = useState('')
  const [delegateComment, setDelegateComment] = useState('')
  const [flaggedIds, setFlaggedIds] = useState<Set<string>>(new Set())
  const [delegating, setDelegating] = useState(false)

  const currentPage = schema.pages[pageIndex]
  const totalPages = schema.pages.length
  const isLastPage = pageIndex === totalPages - 1

  // Flagged field IDs for collaboration/returned rendering
  const effectiveFlaggedIds = new Set<string>(
    (tokenMetadata.flaggedFieldIds as string[] | undefined) ?? []
  )

  const setValue = useCallback((fieldId: string, val: unknown) => {
    setData(prev => ({ ...prev, [fieldId]: val }))
  }, [])

  const visibleFields = currentPage?.fields.filter(f => isVisible(f, data)) ?? []

  // All non-layout fields (for delegation flag checklist)
  const flaggableFields = schema.pages.flatMap(p => p.fields).filter(f => !LAYOUT_TYPES_SET.has(f.type))

  async function saveDraft() {
    setSavingDraft(true)
    const res = await fetch('/api/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, form_id: formId, data, status: 'draft' }),
    })
    setSavingDraft(false)
    if (res.ok) {
      const saved = await res.json()
      setDraftId(saved.id)
      setDraftSavedAt(new Date())
    }
    // Fail silently — draft saving is best-effort
  }

  function validatePage(): boolean {
    for (const field of visibleFields) {
      if (!field.required || LAYOUT_TYPES_SET.has(field.type)) continue
      const val = data[field.id]
      if (val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0)) return false
    }
    return true
  }

  function handleNext() {
    if (!validatePage()) { setError('Please fill in all required fields before continuing.'); return }
    setError(null)
    const skipTarget = getSkipTarget(currentPage, data)
    if (skipTarget) {
      const idx = schema.pages.findIndex(p => p.id === skipTarget)
      if (idx !== -1) { setPageIndex(idx); return }
    }
    setPageIndex(i => Math.min(i + 1, totalPages - 1))
  }

  // Normal final submission
  async function handleSubmit() {
    if (!validatePage()) { setError('Please fill in all required fields.'); return }
    setError(null)
    setSubmitting(true)
    const res = await fetch('/api/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, form_id: formId, data, status: 'submitted' }),
    })
    setSubmitting(false)
    if (res.ok) {
      setMode('submitted')
      if (redirectUrl) setTimeout(() => { window.location.href = redirectUrl }, 2000)
    } else {
      const body = await res.json().catch(() => ({}))
      setError(typeof body.error === 'string' ? body.error : 'Something went wrong. Please try again.')
    }
  }

  // Collaborator returning the form to owner
  async function handleCollaboratorReturn() {
    if (!validatePage()) { setError('Please fill in all required fields.'); return }
    setError(null)
    setSubmitting(true)
    const res = await fetch(`/api/tokens/${tokenId}/return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, data }),
    })
    setSubmitting(false)
    if (res.ok) {
      setMode('collaborator-done')
    } else {
      const body = await res.json().catch(() => ({}))
      setError(typeof body.error === 'string' ? body.error : 'Something went wrong. Please try again.')
    }
  }

  // Owner delegates to collaborator
  async function handleDelegate(e: React.FormEvent) {
    e.preventDefault()
    if (!delegateEmail.trim()) return
    setDelegating(true)
    const res = await fetch(`/api/tokens/${tokenId}/delegate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        collaboratorEmail: delegateEmail.trim(),
        comment: delegateComment.trim() || undefined,
        flaggedFieldIds: [...flaggedIds],
        currentData: data,
      }),
    })
    setDelegating(false)
    if (res.ok) {
      setDelegateOpen(false)
      setMode('delegated')
    } else {
      const body = await res.json().catch(() => ({}))
      setError(typeof body.error === 'string' ? body.error : 'Failed to delegate form')
    }
  }

  function toggleFlag(fieldId: string) {
    setFlaggedIds(prev => {
      const next = new Set(prev)
      if (next.has(fieldId)) next.delete(fieldId); else next.add(fieldId)
      return next
    })
  }

  const progress = ((pageIndex + 1) / totalPages) * 100
  const ownerEmail = tokenMetadata.ownerEmail as string | undefined
  const collaboratorEmail = tokenMetadata.collaboratorEmail as string | undefined
  const delegationComment = tokenMetadata.delegationComment as string | undefined

  // ── Special screens ──────────────────────────────────────────────────────

  if (mode === 'submitted') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="max-w-md w-full">
          <div className="text-center mb-6">
            <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-7 h-7 text-emerald-600" aria-hidden="true" />
            </div>
            <h1 className="text-[20px] font-semibold text-gray-800 mb-2">Response submitted</h1>
            <p className="text-[14px] text-gray-500">
              {confirmationMessage ?? 'Thank you for completing this form. Your response has been recorded.'}
            </p>
            {redirectUrl && <p className="text-[12px] text-gray-400 mt-4">Redirecting you shortly…</p>}
          </div>
          {respondentEmail && !redirectUrl && (
            <div className="mt-2 rounded-xl border border-orange-100 bg-orange-50 px-5 py-4">
              <div className="flex items-start gap-3">
                <UserPlus className="h-5 w-5 text-orange-500 flex-shrink-0 mt-0.5" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-gray-800 mb-0.5">Track your submissions over time</p>
                  <p className="text-[12px] text-gray-500 mb-3">Create a free account to view all forms you&apos;ve completed in one place.</p>
                  <a href={`/auth/login?email=${encodeURIComponent(respondentEmail)}&next=/my`} className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-orange-700 transition-colors">
                    <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                    Create account with {respondentEmail}
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (mode === 'collaborator-done') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="max-w-md w-full text-center">
          <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-4">
            <RotateCcw className="w-7 h-7 text-blue-600" aria-hidden="true" />
          </div>
          <h1 className="text-[20px] font-semibold text-gray-800 mb-2">Responses returned</h1>
          <p className="text-[14px] text-gray-500">
            Your responses have been sent back to {ownerEmail ?? 'the form owner'} for review and final submission. Thank you!
          </p>
        </div>
      </div>
    )
  }

  if (mode === 'delegated') {
    const collab = (tokenMetadata.collaboratorEmail as string | undefined) ?? delegateEmail
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="max-w-md w-full text-center">
          <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
            <Clock className="w-7 h-7 text-amber-600" aria-hidden="true" />
          </div>
          <h1 className="text-[20px] font-semibold text-gray-800 mb-2">Waiting for response</h1>
          <p className="text-[14px] text-gray-500">
            You&apos;ve delegated this form to <strong>{collab}</strong>. You&apos;ll receive an email when they&apos;ve returned it to you for final review and submission.
          </p>
        </div>
      </div>
    )
  }

  // ── Form filling (filling, collaboration, returned) ───────────────────────

  const isCollaboration = mode === 'collaboration'
  const isReturned = mode === 'returned'

  const submitLabel = isCollaboration
    ? `Return to ${ownerEmail ?? 'owner'}`
    : isReturned
      ? 'Final Submit'
      : 'Submit'

  const onSubmit = isCollaboration ? handleCollaboratorReturn : handleSubmit


  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b" style={{ borderTopWidth: 3, borderTopColor: brandColor }}>
        <div className="max-w-2xl mx-auto px-6 py-4">
          <p className="text-[12px] text-gray-400 mb-0.5">{programName}</p>
          <h1 className="text-[18px] font-semibold text-gray-800">{formName}</h1>
        </div>
        {totalPages > 1 && (
          <div className="h-1 bg-gray-100">
            <div className="h-1 transition-all duration-300" style={{ width: `${progress}%`, backgroundColor: brandColor }} aria-hidden="true" />
          </div>
        )}
      </header>

      {/* Preview mode banner */}
      {isPreview && (
        <div className="bg-amber-50 border-b border-amber-200">
          <div className="max-w-2xl mx-auto px-6 py-2.5 flex items-center gap-2">
            <svg className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
            <p className="text-[13px] text-amber-700 font-medium">Preview mode — responses will not be recorded</p>
          </div>
        </div>
      )}

      {/* Draft restored banner */}
      {restoredFromDraft && (
        <div className="bg-sky-50 border-b border-sky-100">
          <div className="max-w-2xl mx-auto px-6 py-2.5 flex items-center gap-2">
            <BookmarkCheck className="h-3.5 w-3.5 text-sky-500 flex-shrink-0" aria-hidden="true" />
            <p className="text-[13px] text-sky-700">Your progress has been restored. Continue where you left off.</p>
          </div>
        </div>
      )}

      {/* Collaboration banner */}
      {isCollaboration && (
        <div className="bg-amber-50 border-b border-amber-200">
          <div className="max-w-2xl mx-auto px-6 py-3 flex items-start gap-2.5">
            <Flag className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="text-[13px] font-semibold text-amber-800">
                {ownerEmail} asked for your help
              </p>
              {delegationComment && <p className="text-[12px] text-amber-700 mt-0.5">&ldquo;{delegationComment}&rdquo;</p>}
              {effectiveFlaggedIds.size > 0 && (
                <p className="text-[12px] text-amber-600 mt-0.5">
                  {effectiveFlaggedIds.size} question{effectiveFlaggedIds.size !== 1 ? 's are' : ' is'} flagged for your response below.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Review banner */}
      {isReturned && (
        <div className="bg-teal-50 border-b border-teal-200">
          <div className="max-w-2xl mx-auto px-6 py-3 flex items-start gap-2.5">
            <CheckCircle2 className="h-4 w-4 text-teal-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="text-[13px] font-semibold text-teal-800">
                {collaboratorEmail} has returned this form for your review
              </p>
              <p className="text-[12px] text-teal-700 mt-0.5">
                Their responses are highlighted below. Make any final edits and submit when ready.
              </p>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-2xl mx-auto px-6 py-8">
        {totalPages > 1 && (
          <p className="text-[12px] text-gray-400 mb-5">Page {pageIndex + 1} of {totalPages} — {currentPage.title}</p>
        )}
        <form onSubmit={e => e.preventDefault()} noValidate>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-6">
            {visibleFields.map(field => {
              const isFlagged = effectiveFlaggedIds.has(field.id)
              const input = (
                <FieldInput
                  key={field.id}
                  field={field}
                  value={data[field.id]}
                  onChange={val => setValue(field.id, val)}
                />
              )
              if (!isFlagged || LAYOUT_TYPES_SET.has(field.type)) return input
              return (
                <div
                  key={field.id}
                  className={`rounded-lg border-2 px-4 pt-3 pb-4 -mx-2 ${
                    isCollaboration
                      ? 'border-amber-200 bg-amber-50'
                      : 'border-teal-200 bg-teal-50'
                  }`}
                >
                  <p className={`text-[11px] font-semibold mb-2.5 flex items-center gap-1 ${
                    isCollaboration ? 'text-amber-700' : 'text-teal-700'
                  }`}>
                    <Flag className="h-3 w-3" aria-hidden="true" />
                    {isCollaboration
                      ? 'Please respond to this question'
                      : `Answered by ${collaboratorEmail}`}
                  </p>
                  {input}
                </div>
              )
            })}
            {visibleFields.length === 0 && (
              <p className="text-[14px] text-gray-400 text-center py-4">No fields on this page.</p>
            )}
          </div>

          {error && <p className="mt-3 text-[13px] text-red-600" role="alert">{error}</p>}

          <div className="mt-6 flex items-center justify-between gap-3">
            {pageIndex > 0 ? (
              <button type="button" onClick={() => { setPageIndex(i => i - 1); setError(null) }} className="text-[13px] text-gray-500 hover:text-gray-800 transition-colors focus:outline-none focus-visible:underline">
                ← Back
              </button>
            ) : <span />}
            <div className="flex items-center gap-4">
              {/* Save + Delegate — only in normal filling mode */}
              {mode === 'filling' && (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={saveDraft}
                    disabled={savingDraft}
                    className="flex items-center gap-1.5 text-[12px] text-gray-400 hover:text-gray-600 transition-colors focus:outline-none focus-visible:underline disabled:opacity-50"
                    aria-busy={savingDraft}
                  >
                    {savingDraft
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      : <BookmarkCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    }
                    {savingDraft ? 'Saving…' : draftSavedAt ? `Saved ${draftSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Save progress'}
                  </button>
                  <span className="text-gray-200">|</span>
                  <button
                    type="button"
                    onClick={() => setDelegateOpen(true)}
                    className="flex items-center gap-1.5 text-[12px] text-gray-400 hover:text-gray-600 transition-colors focus:outline-none focus-visible:underline"
                  >
                    <Users className="h-3.5 w-3.5" aria-hidden="true" />
                    Delegate to someone
                  </button>
                </div>
              )}
              {isLastPage ? (
                <Button
                  type="button"
                  onClick={isPreview ? undefined : onSubmit}
                  disabled={submitting || isPreview}
                  aria-busy={submitting}
                  className="px-8"
                  style={{ backgroundColor: brandColor, opacity: isPreview ? 0.5 : 1 }}
                  title={isPreview ? 'Submissions are disabled in preview mode' : undefined}
                >
                  {submitting ? 'Submitting…' : isPreview ? 'Submit (preview only)' : submitLabel}
                </Button>
              ) : (
                <Button type="button" onClick={handleNext} style={{ backgroundColor: brandColor }}>Next →</Button>
              )}
            </div>
          </div>
        </form>
      </main>

      {/* Delegation dialog */}
      <Dialog open={delegateOpen} onOpenChange={setDelegateOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto" aria-describedby="delegate-desc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-4 w-4 text-orange-500" aria-hidden="true" />
              Delegate to someone
            </DialogTitle>
            <p id="delegate-desc" className="text-[13px] text-muted-foreground mt-1">
              They&apos;ll receive a link, see your current answers, and can fill in their portion. You&apos;ll review before final submission.
            </p>
          </DialogHeader>
          <form onSubmit={handleDelegate} id="delegate-form" className="space-y-4 py-2">
            <div>
              <label htmlFor="delegate-email" className="text-[13px] font-medium text-gray-700 block mb-1.5">
                Their email <span className="text-red-500" aria-hidden="true">*</span>
              </label>
              <Input
                id="delegate-email"
                type="email"
                value={delegateEmail}
                onChange={e => setDelegateEmail(e.target.value)}
                placeholder="colleague@example.com"
                required
                autoFocus
                className="h-9 text-[13px]"
              />
            </div>
            <div>
              <label htmlFor="delegate-comment" className="text-[13px] font-medium text-gray-700 block mb-1.5">
                Message <span className="text-[12px] text-gray-400 font-normal">(optional)</span>
              </label>
              <Textarea
                id="delegate-comment"
                value={delegateComment}
                onChange={e => setDelegateComment(e.target.value)}
                placeholder="e.g. Please fill in the financial impact questions in section 3."
                className="text-[13px] min-h-[70px]"
              />
            </div>
            {flaggableFields.length > 0 && (
              <div>
                <p className="text-[13px] font-medium text-gray-700 mb-1.5">
                  Flag specific questions <span className="text-[12px] text-gray-400 font-normal">(optional)</span>
                </p>
                <p className="text-[11px] text-gray-400 mb-2">Flagged questions are highlighted for the person you&apos;re delegating to.</p>
                <div className="max-h-[220px] overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-50">
                  {flaggableFields.map(f => {
                    const checked = flaggedIds.has(f.id)
                    return (
                      <label key={f.id} className="flex items-start gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-gray-50">
                        <span className="flex-shrink-0 mt-0.5">
                          {checked
                            ? <CheckSquare className="h-4 w-4 text-orange-600" aria-hidden="true" />
                            : <Square className="h-4 w-4 text-gray-300" aria-hidden="true" />}
                        </span>
                        <input type="checkbox" checked={checked} onChange={() => toggleFlag(f.id)} className="sr-only" aria-label={f.label} />
                        <span className="text-[13px] text-gray-700 leading-snug">{f.label}</span>
                      </label>
                    )
                  })}
                </div>
                {flaggedIds.size > 0 && (
                  <p className="text-[11px] text-orange-600 font-medium mt-1.5">{flaggedIds.size} question{flaggedIds.size !== 1 ? 's' : ''} flagged</p>
                )}
              </div>
            )}
          </form>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDelegateOpen(false)} disabled={delegating}>Cancel</Button>
            <Button
              type="submit"
              form="delegate-form"
              className="bg-orange-600 hover:bg-orange-700 gap-1.5"
              disabled={delegating || !delegateEmail.trim()}
              aria-busy={delegating}
            >
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              {delegating ? 'Sending…' : 'Send delegation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
