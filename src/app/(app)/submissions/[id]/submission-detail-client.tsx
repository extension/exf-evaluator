'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, Flag, CheckCircle, RotateCcw, UserRoundCog, Pencil, Save, X, Send, MessageSquare, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { formatDistanceToNow, format } from 'date-fns'
import type { FormSchema, FormField } from '@/types/forms'

type Status = 'draft' | 'submitted' | 'reviewed' | 'flagged'

interface Submission {
  id: string
  status: Status
  effectiveStatus?: Status
  respondent_email: string | null
  submitted_at: string | null
  created_at: string
  data: Record<string, unknown>
  forms: { name: string; slug: string } | null
  submission_tokens: { email: string; metadata: Record<string, unknown> | null } | null
}

interface Props {
  submission: Submission
  schema: FormSchema | null
  currentRole: string | null
}

const statusConfig: Record<Status, { label: string; className: string }> = {
  submitted: { label: 'Submitted',  className: 'bg-blue-50 text-blue-700 border-blue-100' },
  reviewed:  { label: 'Reviewed',   className: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  flagged:   { label: 'Flagged',    className: 'bg-amber-50 text-amber-700 border-amber-100' },
  draft:     { label: 'Draft',      className: 'bg-zinc-50 text-zinc-500 border-zinc-200' },
}

const LAYOUT_TYPES = ['section_header', 'instructional_text', 'spacer', 'page_break']

/** Format a stored answer value into a human-readable string, resolving option labels. */
function formatAnswer(field: FormField, value: unknown): string {
  if (value === undefined || value === null || value === '') return '—'

  // Multiple choice — array of option values
  if (field.type === 'multiple_choice' || field.type === 'image_choice') {
    const arr = Array.isArray(value) ? value as string[] : [String(value)]
    if (arr.length === 0) return '—'
    const options = field.options ?? []
    return arr.map(v => options.find(o => o.value === v)?.label ?? v).join(', ')
  }

  // Single choice / dropdown — look up the label
  if (field.type === 'single_choice' || field.type === 'dropdown') {
    const options = field.options ?? []
    const label = options.find(o => o.value === String(value))?.label
    return label ?? String(value)
  }

  // Matrix — { rowId: colId } object
  if (field.type === 'matrix') {
    if (typeof value !== 'object' || Array.isArray(value)) return String(value)
    const obj = value as Record<string, string>
    const rows = field.matrixRows ?? []
    const cols = field.matrixColumns ?? []
    const parts = Object.entries(obj).map(([rowId, colId]) => {
      const rowLabel = rows.find(r => r.id === rowId)?.label ?? rowId
      const colLabel = cols.find(c => c.id === colId)?.label ?? colId
      return `${rowLabel}: ${colLabel}`
    })
    return parts.length > 0 ? parts.join(' · ') : '—'
  }

  // Arrays (fallback)
  if (Array.isArray(value)) return value.join(', ')

  // Objects (fallback — avoid [object Object])
  if (typeof value === 'object') {
    try { return JSON.stringify(value) } catch { return '—' }
  }

  return String(value)
}

/** Render an editable control appropriate to the field type */
function EditControl({
  field,
  value,
  onChange,
}: {
  field: FormField
  value: unknown
  onChange: (v: unknown) => void
}) {
  const str = value === null || value === undefined ? '' : String(value)

  switch (field.type) {
    case 'long_text':
      return (
        <textarea
          value={str}
          onChange={e => onChange(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-[13px] text-gray-800 focus:outline-none focus:ring-1 focus:ring-orange-400 resize-y"
          aria-label={field.label}
        />
      )
    case 'number':
    case 'slider':
      return (
        <Input
          type="number"
          value={str}
          onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          className="h-8 text-[13px] max-w-[160px]"
          aria-label={field.label}
        />
      )
    case 'rating':
    case 'nps':
    case 'likert_scale': {
      const max = field.scale ?? field.max ?? (field.type === 'nps' ? 10 : 5)
      const nums = Array.from({ length: max }, (_, i) => i + 1)
      return (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={field.label}>
          {nums.map(n => (
            <button
              key={n}
              type="button"
              onClick={() => onChange(String(n))}
              className={`w-9 h-9 rounded-lg border text-[13px] font-medium transition-colors ${str === String(n) ? 'bg-orange-600 border-orange-600 text-white' : 'border-gray-200 text-gray-600 hover:border-orange-400'}`}
              aria-pressed={str === String(n)}
            >
              {n}
            </button>
          ))}
        </div>
      )
    }
    case 'date':
      return (
        <Input
          type="date"
          value={str}
          onChange={e => onChange(e.target.value)}
          className="h-8 text-[13px] max-w-[180px]"
          aria-label={field.label}
        />
      )
    case 'single_choice':
    case 'image_choice':
    case 'dropdown': {
      const options = field.options ?? []
      return (
        <select
          value={str}
          onChange={e => onChange(e.target.value)}
          className="h-8 rounded-md border border-gray-200 px-2 text-[13px] bg-white focus:outline-none focus:ring-1 focus:ring-orange-400"
          aria-label={field.label}
        >
          <option value="">—</option>
          {options.map(o => <option key={o.id} value={o.value}>{o.label}</option>)}
        </select>
      )
    }
    case 'multiple_choice': {
      const options = field.options ?? []
      const selected = Array.isArray(value) ? (value as string[]) : []
      return (
        <div className="space-y-1.5" role="group" aria-label={field.label}>
          {options.map(opt => (
            <label key={opt.id} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                value={opt.value}
                checked={selected.includes(opt.value)}
                onChange={e => {
                  const next = e.target.checked
                    ? [...selected, opt.value]
                    : selected.filter(v => v !== opt.value)
                  onChange(next)
                }}
                className="h-3.5 w-3.5 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
              />
              <span className="text-[13px] text-gray-700">{opt.label}</span>
            </label>
          ))}
        </div>
      )
    }
    case 'matrix': {
      const rows = field.matrixRows ?? []
      const cols = field.matrixColumns ?? []
      const matrixVal = (typeof value === 'object' && !Array.isArray(value) && value !== null)
        ? (value as Record<string, string>)
        : {}
      return (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]" role="grid" aria-label={field.label}>
            <thead>
              <tr>
                <th className="text-left pb-1.5 text-gray-400 font-normal w-1/3" />
                {cols.map(col => (
                  <th key={col.id} className="pb-1.5 text-gray-600 font-medium text-center px-2">{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id} className="border-t border-gray-50">
                  <td className="py-2 pr-3 text-gray-700">{row.label}</td>
                  {cols.map(col => (
                    <td key={col.id} className="py-2 text-center px-2">
                      <input
                        type={field.matrixType === 'checkbox' ? 'checkbox' : 'radio'}
                        name={`edit-matrix-${field.id}-${row.id}`}
                        value={col.id}
                        checked={matrixVal[row.id] === col.id}
                        onChange={() => onChange({ ...matrixVal, [row.id]: col.id })}
                        className="h-3.5 w-3.5 text-orange-600 border-gray-300 focus:ring-orange-500"
                        aria-label={`${row.label} — ${col.label}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
    case 'file_upload':
    case 'signature':
      // These can't be meaningfully edited inline — show read-only notice
      return <p className="text-[12px] text-gray-400 italic">Cannot edit {field.type === 'file_upload' ? 'file uploads' : 'signatures'} here.</p>
    default:
      return (
        <Input
          value={str}
          onChange={e => onChange(e.target.value)}
          className="h-8 text-[13px]"
          aria-label={field.label}
        />
      )
  }
}

export function SubmissionDetailClient({ submission: initial, schema, currentRole }: Props) {
  const canEdit = currentRole === 'super_admin' || currentRole === 'program_admin'
  const router = useRouter()
  const [submission, setSubmission] = useState(initial)
  const [updating, setUpdating] = useState(false)
  const [reassigning, setReassigning] = useState(false)
  const [reassignEmail, setReassignEmail] = useState('')
  const [reassignBusy, setReassignBusy] = useState(false)

  // Edit mode
  const [editing, setEditing] = useState(false)
  const [editData, setEditData] = useState<Record<string, unknown>>({})
  const [savingEdit, setSavingEdit] = useState(false)

  const meta = ((submission as unknown as Record<string, unknown>).metadata ?? {}) as Record<string, unknown>

  // Reviewer comment
  const [reviewerComment, setReviewerComment] = useState<string>((meta.reviewerComment as string) ?? '')
  const [savingComment, setSavingComment] = useState(false)
  const [sendingBack, setSendingBack] = useState(false)
  const [withdrawConfirm, setWithdrawConfirm] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  const feedbackSentAt = meta.feedbackSentAt as string | undefined
  const feedbackSentBy = meta.feedbackSentBy as string | undefined
  const displayEmail = submission.respondent_email ?? (meta.importedRow ? 'Imported' : 'Anonymous')

  const allFields: FormField[] = schema?.pages.flatMap(p => p.fields) ?? []
  const displayFields = allFields.filter(f => !LAYOUT_TYPES.includes(f.type) || f.type === 'section_header')
  const data = (submission.data ?? {}) as Record<string, unknown>
  const displayStatus = submission.effectiveStatus ?? submission.status
  const cfg = statusConfig[displayStatus] ?? statusConfig.draft

  function startEditing() {
    setEditData({ ...data })
    setEditing(true)
  }

  function cancelEditing() {
    setEditing(false)
    setEditData({})
  }

  async function saveEdits() {
    setSavingEdit(true)
    const res = await fetch(`/api/submissions/${submission.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: editData }),
    })
    setSavingEdit(false)
    if (res.ok) {
      const updated = await res.json()
      setSubmission(s => ({ ...s, data: updated.data ?? editData }))
      setEditing(false)
      setEditData({})
      toast.success('Responses saved')
    } else {
      toast.error('Failed to save changes')
    }
  }

  async function saveComment() {
    setSavingComment(true)
    const res = await fetch(`/api/submissions/${submission.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewer_comment: reviewerComment }),
    })
    setSavingComment(false)
    if (res.ok) toast.success('Comment saved')
    else toast.error('Failed to save comment')
  }

  async function sendBack() {
    if (!reviewerComment.trim()) { toast.error('Add a comment before sending feedback'); return }
    setSendingBack(true)
    const res = await fetch(`/api/submissions/${submission.id}/send-back`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: reviewerComment }),
    })
    setSendingBack(false)
    if (res.ok) {
      const result = await res.json()
      toast.success(`Returned to ${result.to} for editing`)
      setSubmission(s => ({
        ...s,
        status: 'draft',
        effectiveStatus: 'draft',
        metadata: { ...meta, reviewerComment, feedbackSentAt: new Date().toISOString(), feedbackSentBy: '' },
      } as typeof s))
    } else {
      const err = await res.json().catch(() => ({}))
      toast.error(typeof err.error === 'string' ? err.error : 'Failed to send feedback')
    }
  }

  async function setStatus(status: Status) {
    setUpdating(true)
    const res = await fetch(`/api/submissions/${submission.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    setUpdating(false)
    if (res.ok) {
      const updated = await res.json()
      setSubmission(s => ({ ...s, status: updated.status, effectiveStatus: updated.effectiveStatus ?? updated.status }))
      toast.success(`Marked as ${status}`)
    } else {
      toast.error('Failed to update status')
    }
  }

  async function handleReassign() {
    const email = reassignEmail.trim()
    if (!email) return
    setReassignBusy(true)
    const res = await fetch(`/api/submissions/${submission.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ respondent_email: email }),
    })
    setReassignBusy(false)
    if (res.ok) {
      setSubmission(s => ({ ...s, respondent_email: email }))
      setReassigning(false)
      setReassignEmail('')
      toast.success(`Reassigned to ${email}`)
    } else {
      toast.error('Failed to reassign submission')
    }
  }

  async function handleWithdraw() {
    setWithdrawing(true)
    const res = await fetch(`/api/submissions/${submission.id}`, { method: 'DELETE' })
    setWithdrawing(false)
    if (res.ok) {
      toast.success('Submission withdrawn and permanently deleted')
      router.push('/submissions')
    } else {
      const err = await res.json().catch(() => ({}))
      toast.error(typeof err.error === 'string' ? err.error : 'Failed to withdraw submission')
      setWithdrawConfirm(false)
    }
  }

  return (
    <div className="max-w-3xl px-8 py-8">
      {/* Back */}
      <button
        onClick={() => router.push('/submissions')}
        className="flex items-center gap-1.5 text-[13px] text-gray-400 hover:text-gray-700 transition-colors mb-6 focus:outline-none focus-visible:underline"
        aria-label="Back to submissions"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Submissions
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-[20px] font-semibold text-gray-900 mb-1">
            {displayEmail}
          </h1>
          <p className="text-[13px] text-gray-400">
            {submission.forms?.name} ·{' '}
            {submission.submitted_at
              ? `Submitted ${format(new Date(submission.submitted_at), 'MMM d, yyyy h:mm a')}`
              : `Started ${formatDistanceToNow(new Date(submission.created_at), { addSuffix: true })}`}
          </p>
        </div>
        <span className={cn('rounded-full border px-2.5 py-1 text-[12px] font-medium flex-shrink-0', cfg.className)}
          aria-label={`Status: ${cfg.label}`}>
          {cfg.label}
        </span>
      </div>

      {/* Actions */}
      {!editing && (
        <>
          {canEdit && displayStatus !== 'reviewed' && displayStatus !== 'flagged' && (
            <div className="flex items-center gap-2 mb-4">
              <Button
                variant="outline" size="sm"
                className="gap-1.5 text-[13px] h-8 text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                onClick={() => setStatus('reviewed')} disabled={updating}
              >
                <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" /> Mark reviewed
              </Button>
              <Button
                variant="outline" size="sm"
                className="gap-1.5 text-[13px] h-8 text-amber-700 border-amber-200 hover:bg-amber-50"
                onClick={() => setStatus('flagged')} disabled={updating}
              >
                <Flag className="h-3.5 w-3.5" aria-hidden="true" /> Flag
              </Button>
            </div>
          )}
          {canEdit && (displayStatus === 'reviewed' || displayStatus === 'flagged') && (
            <div className="mb-4">
              <Button
                variant="ghost" size="sm"
                className="gap-1.5 text-[13px] h-8 text-gray-500"
                onClick={() => setStatus('submitted')} disabled={updating}
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Reset to submitted
              </Button>
            </div>
          )}

          {/* Reassign — admin only */}
          {canEdit && <div className="mb-4">
            {!reassigning ? (
              <Button
                variant="ghost" size="sm"
                className="gap-1.5 text-[13px] h-8 text-gray-400 hover:text-gray-700"
                onClick={() => { setReassigning(true); setReassignEmail(submission.respondent_email ?? '') }}
              >
                <UserRoundCog className="h-3.5 w-3.5" aria-hidden="true" /> Reassign to someone else
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  type="email"
                  value={reassignEmail}
                  onChange={e => setReassignEmail(e.target.value)}
                  placeholder="new@email.com"
                  className="h-8 text-[13px] max-w-xs"
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') handleReassign(); if (e.key === 'Escape') setReassigning(false) }}
                  aria-label="New respondent email"
                />
                <Button size="sm" className="h-8 text-[13px] bg-orange-600 hover:bg-orange-700"
                  onClick={handleReassign}
                  disabled={reassignBusy || !reassignEmail.trim() || reassignEmail.trim() === submission.respondent_email}
                  aria-busy={reassignBusy}
                >
                  {reassignBusy ? 'Saving…' : 'Reassign'}
                </Button>
                <Button variant="ghost" size="sm" className="h-8 text-[13px]" onClick={() => setReassigning(false)}>Cancel</Button>
              </div>
            )}
          </div>}

          {/* Withdraw */}
          {canEdit && (
            <div className="mb-6">
              {!withdrawConfirm ? (
                <Button
                  variant="ghost" size="sm"
                  className="gap-1.5 text-[13px] h-8 text-red-400 hover:text-red-600 hover:bg-red-50"
                  onClick={() => setWithdrawConfirm(true)}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Withdraw submission
                </Button>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                  <p className="text-[12px] text-red-700 flex-1">This will permanently delete all response data. Cannot be undone.</p>
                  <Button
                    size="sm"
                    className="h-7 text-[12px] bg-red-600 hover:bg-red-700 flex-shrink-0"
                    onClick={handleWithdraw}
                    disabled={withdrawing}
                    aria-busy={withdrawing}
                  >
                    {withdrawing ? 'Withdrawing…' : 'Confirm withdraw'}
                  </Button>
                  <Button
                    variant="ghost" size="sm"
                    className="h-7 text-[12px] flex-shrink-0"
                    onClick={() => setWithdrawConfirm(false)}
                    disabled={withdrawing}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Reviewer comment — shown for flagged submissions (or any submission with an existing comment) */}
      {(displayStatus === 'flagged' || reviewerComment || feedbackSentAt) && !editing && (
        <div className="mb-6 rounded-xl border border-amber-100 bg-amber-50 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-amber-100 flex items-center gap-2">
            <MessageSquare className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />
            <h2 className="text-[13px] font-semibold text-amber-800">Reviewer notes</h2>
            {feedbackSentAt && (
              <span className="ml-auto text-[11px] text-amber-600">
                Sent to submitter {format(new Date(feedbackSentAt), 'MMM d, yyyy')}
                {feedbackSentBy ? ` by ${feedbackSentBy}` : ''}
              </span>
            )}
          </div>
          <div className="px-5 py-4 space-y-3">
            <textarea
              value={reviewerComment}
              onChange={e => setReviewerComment(e.target.value)}
              placeholder="Add notes about why this submission was flagged, what needs to be corrected, etc."
              rows={4}
              className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2.5 text-[13px] text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-amber-400 resize-y"
              aria-label="Reviewer comment"
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-[13px] border-amber-200 text-amber-700 hover:bg-amber-100 gap-1.5"
                onClick={saveComment}
                disabled={savingComment || sendingBack}
                aria-busy={savingComment}
              >
                {savingComment ? 'Saving…' : 'Save note'}
              </Button>
              {submission.respondent_email && (
                <Button
                  size="sm"
                  className="h-8 text-[13px] bg-amber-600 hover:bg-amber-700 gap-1.5"
                  onClick={sendBack}
                  disabled={sendingBack || savingComment || !reviewerComment.trim()}
                  aria-busy={sendingBack}
                >
                  <Send className="h-3 w-3" aria-hidden="true" />
                  {sendingBack ? 'Sending…' : 'Send feedback to submitter'}
                </Button>
              )}
              {!submission.respondent_email && (
                <p className="text-[12px] text-amber-600 italic">No email on file — cannot send directly</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Responses */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-50 flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-gray-600 uppercase tracking-wider">Responses</h2>
          {editing ? (
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost" size="sm"
                className="gap-1 text-[12px] h-7 text-gray-400"
                onClick={cancelEditing} disabled={savingEdit}
              >
                <X className="h-3 w-3" aria-hidden="true" /> Cancel
              </Button>
              <Button
                size="sm"
                className="gap-1 text-[12px] h-7 bg-orange-600 hover:bg-orange-700"
                onClick={saveEdits} disabled={savingEdit} aria-busy={savingEdit}
              >
                <Save className="h-3 w-3" aria-hidden="true" />
                {savingEdit ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          ) : canEdit ? (
            <Button
              variant="ghost" size="sm"
              className="gap-1.5 text-[12px] h-7 text-gray-400 hover:text-gray-700"
              onClick={startEditing}
            >
              <Pencil className="h-3 w-3" aria-hidden="true" /> Edit responses
            </Button>
          ) : null}
        </div>
        <dl className="divide-y divide-gray-50">
          {displayFields.length === 0 && (
            <div className="px-5 py-8 text-center text-[13px] text-gray-400">No field definitions found for this form.</div>
          )}
          {displayFields.map(field => {
            if (field.type === 'section_header') {
              return (
                <div key={field.id} className="px-5 py-2.5 bg-gray-50 border-t border-gray-100 first:border-t-0">
                  <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{field.label || field.content}</h3>
                </div>
              )
            }
            return (
              <div key={field.id} className={cn('px-5 py-3 grid grid-cols-5 gap-4', editing && 'items-start')}>
                <dt className="col-span-2 text-[13px] font-medium text-gray-500 leading-snug pt-0.5">{field.label || field.type}</dt>
                <dd className="col-span-3">
                  {editing ? (
                    <EditControl
                      field={field}
                      value={editData[field.id]}
                      onChange={v => setEditData(d => ({ ...d, [field.id]: v }))}
                    />
                  ) : (
                    <span className="text-[13px] text-gray-800">{formatAnswer(field, data[field.id])}</span>
                  )}
                </dd>
              </div>
            )
          })}
        </dl>
      </div>

      {/* Details */}
      <div className="mt-4 bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-50">
          <h2 className="text-[13px] font-semibold text-gray-600 uppercase tracking-wider">Details</h2>
        </div>
        <dl className="divide-y divide-gray-50">
          {[
            { label: 'Email', value: submission.respondent_email ?? '—' },
            { label: 'Form', value: submission.forms?.name ?? '—' },
            { label: 'Submission ID', value: submission.id },
            { label: 'IP address', value: (submission as unknown as Record<string, unknown>).ip_address as string ?? '—' },
          ].map(row => (
            <div key={row.label} className="px-5 py-3 grid grid-cols-5 gap-4">
              <dt className="col-span-2 text-[12px] font-medium text-gray-400">{row.label}</dt>
              <dd className="col-span-3 text-[12px] text-gray-600 font-mono break-all">{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
