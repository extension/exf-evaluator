'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useProgram } from '@/contexts/program-context'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Search, Inbox, ChevronRight, Download,
  List, Table2, UserSearch, ChevronDown, Calendar,
  FileText, CheckCircle2, Clock, UserPlus, X, Folder, FolderOpen,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { Database } from '@/types/database'
import type { FormSettings, FormSchema } from '@/types/forms'
import { MyTasks } from './my-tasks'
import { createClient } from '@/lib/supabase/client'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Submission = Database['public']['Tables']['submissions']['Row'] & {
  forms: { name: string; program_id: string; settings: FormSettings | null } | null
  effectiveStatus?: string
}

interface FormRow {
  id: string
  name: string
  schema: FormSchema | null
  settings: FormSettings | null
  status: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPeriod(settings: FormSettings | null | undefined): string | null {
  if (!settings) return null
  const { periodType, periodValue, periodStart, periodEnd } = settings
  if (periodType === 'month' && periodValue) {
    const [year, month] = periodValue.split('-')
    return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  }
  if (periodType === 'quarter' && periodValue) return periodValue
  if (periodStart && periodEnd) {
    const fmt = (iso: string) => { const [y,m,d] = iso.split('-'); return new Date(Number(y),Number(m)-1,Number(d)).toLocaleDateString('en-US',{month:'short',day:'numeric'}) }
    return `${fmt(periodStart)} – ${fmt(periodEnd)}`
  }
  if (periodValue) return periodValue
  return null
}

function isImported(sub: Submission): boolean {
  return !sub.respondent_email && !!((sub.metadata ?? {}) as Record<string, unknown>).importedRow
}

function displayName(sub: Submission): string {
  if (!sub.respondent_email) return isImported(sub) ? 'Imported' : 'Anonymous'
  return sub.respondent_email
}

function escCsv(v: unknown): string {
  const s = Array.isArray(v) ? v.join('; ') : String(v ?? '')
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
}

type StatusFilter = 'all' | 'submitted' | 'reviewed' | 'flagged' | 'draft' | 'unassigned' | 'imported'
type FolderFilter = null | { type: 'folder'; name: string } | { type: 'form'; id: string }
type ActiveTab = 'list' | 'table' | 'respondents'

const statusConfig: Record<string, { label: string; className: string }> = {
  submitted: { label: 'Submitted', className: 'bg-blue-50 text-blue-700 border-blue-100' },
  reviewed:  { label: 'Reviewed',  className: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  flagged:   { label: 'Flagged',   className: 'bg-amber-50 text-amber-700 border-amber-100' },
  draft:     { label: 'Draft',     className: 'bg-zinc-50 text-zinc-500 border-zinc-200' },
}

const filterButtons: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'reviewed', label: 'Reviewed' },
  { key: 'flagged', label: 'Flagged' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'imported', label: 'Imported' },
]

// ---------------------------------------------------------------------------
// Submission detail dialog (used in Table View)
// ---------------------------------------------------------------------------

function SubmissionDetailDialog({
  sub, fields, onClose, onAssigned,
}: {
  sub: Submission
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fields: any[]
  onClose: () => void
  onAssigned: (id: string, email: string) => void
}) {
  const data = (sub.data ?? {}) as Record<string, unknown>
  const cfg = statusConfig[sub.status] ?? statusConfig.draft
  const needsAssign = !sub.respondent_email
  const [assignEmail, setAssignEmail] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [showAssign, setShowAssign] = useState(false)

  async function handleAssign() {
    if (!assignEmail.trim()) return
    setAssigning(true)
    const res = await fetch(`/api/submissions/${sub.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ respondent_email: assignEmail.trim().toLowerCase() }),
    })
    setAssigning(false)
    if (res.ok) {
      toast.success(`Assigned to ${assignEmail.trim()}`)
      onAssigned(sub.id, assignEmail.trim().toLowerCase())
      onClose()
    } else {
      toast.error('Failed to assign — do you have admin access?')
    }
  }

  return (
    <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 pr-6">
          <span>{sub.respondent_email ?? (isImported(sub) ? 'Imported record' : 'Anonymous')}</span>
          <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', cfg.className)}>{cfg.label}</span>
        </DialogTitle>
        <div className="flex items-center gap-3 text-xs text-zinc-500 mt-1">
          <span>{sub.forms?.name}</span>
          {sub.submitted_at && <span>· {new Date(sub.submitted_at).toLocaleDateString()}</span>}
          {(() => { const p = formatPeriod(sub.forms?.settings); return p ? <span className="text-orange-500">· {p}</span> : null })()}
        </div>
      </DialogHeader>

      <div className="space-y-3 py-1">
        {fields.map((f) => {
          const val = data[f.id]
          if (val === undefined || val === null || val === '') return null
          const display = Array.isArray(val) ? val.join(', ') : String(val)
          return (
            <div key={f.id} className="rounded-lg bg-zinc-50 px-3 py-2.5">
              <p className="text-[11px] font-medium text-zinc-400 uppercase tracking-wide mb-1">{f.label || f.id}</p>
              <p className="text-sm text-zinc-800 whitespace-pre-wrap leading-relaxed">{display}</p>
            </div>
          )
        })}
      </div>

      <div className="border-t border-zinc-100 pt-3 space-y-2">
        {needsAssign && !showAssign && (
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setShowAssign(true)}>
            <UserPlus className="h-3.5 w-3.5" /> Assign to a contact
          </Button>
        )}
        {needsAssign && showAssign && (
          <div className="flex gap-2 items-center">
            <Input
              type="email"
              placeholder="contact@example.com"
              value={assignEmail}
              onChange={e => setAssignEmail(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAssign() }}
              className="h-8 text-xs flex-1"
              autoFocus
            />
            <Button size="sm" onClick={handleAssign} disabled={assigning || !assignEmail.trim()}
              className="h-8 bg-orange-600 hover:bg-orange-700 text-white text-xs">
              {assigning ? 'Saving…' : 'Assign'}
            </Button>
            <button onClick={() => setShowAssign(false)} className="text-zinc-400 hover:text-zinc-600">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
      </div>
    </DialogContent>
  )
}

// ---------------------------------------------------------------------------
// Table View
// ---------------------------------------------------------------------------

function TableView({ submissions, forms, onAssigned }: {
  submissions: Submission[]
  forms: FormRow[]
  onAssigned: (id: string, email: string) => void
}) {
  const [selectedFormId, setSelectedFormId] = useState<string>('')
  const [formOpen, setFormOpen] = useState(false)
  const [expandedSub, setExpandedSub] = useState<Submission | null>(null)

  const selectedForm = forms.find(f => f.id === selectedFormId)
  const formSubmissions = submissions.filter(s => s.form_id === selectedFormId && s.status !== 'draft')

  const fields = useMemo(() => {
    if (!selectedForm?.schema) return []
    return selectedForm.schema.pages.flatMap(p => p.fields).filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (f: any) => !f.hidden && f.type !== 'section' && f.type !== 'heading'
    )
  }, [selectedForm])

  function downloadCSV() {
    if (!formSubmissions.length || !fields.length) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const headers = ['Email', 'Submitted', 'Status', ...fields.map((f: any) => f.label || f.id)]
    const rows = formSubmissions.map(sub => {
      const data = (sub.data ?? {}) as Record<string, unknown>
      return [
        sub.respondent_email ?? '',
        sub.submitted_at ? new Date(sub.submitted_at).toLocaleDateString() : '',
        sub.status,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...fields.map((f: any) => data[f.id] ?? ''),
      ].map(escCsv).join(',')
    })
    const csv = [headers.map(escCsv).join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${selectedForm?.name ?? 'submissions'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      {/* Form picker + export */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <button
            onClick={() => setFormOpen(v => !v)}
            className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm hover:border-zinc-300 transition-colors min-w-[220px]"
          >
            <FileText className="h-3.5 w-3.5 text-zinc-400 flex-shrink-0" />
            <span className={cn('flex-1 text-left truncate', selectedForm ? 'text-zinc-900' : 'text-zinc-400')}>
              {selectedForm ? selectedForm.name : 'Select a form…'}
            </span>
            <ChevronDown className={cn('h-3.5 w-3.5 text-zinc-400 flex-shrink-0 transition-transform', formOpen && 'rotate-180')} />
          </button>
          {formOpen && (
            <div className="absolute z-50 mt-1 w-72 rounded-lg border border-zinc-200 bg-white shadow-lg overflow-hidden">
              {forms.filter(f => f.status !== 'draft').map(f => (
                <button key={f.id}
                  className="flex w-full items-center justify-between px-3 py-2 text-sm text-left hover:bg-zinc-50 transition-colors"
                  onClick={() => { setSelectedFormId(f.id); setFormOpen(false) }}>
                  <span className="font-medium text-zinc-900 truncate">{f.name}</span>
                  <span className="text-xs text-zinc-400 ml-2 flex-shrink-0">
                    {submissions.filter(s => s.form_id === f.id && s.status !== 'draft').length} rows
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedFormId && formSubmissions.length > 0 && (
          <>
            <Button variant="outline" size="sm" onClick={downloadCSV} className="gap-1.5">
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
            <span className="text-xs text-zinc-400">
              {formSubmissions.length} submission{formSubmissions.length !== 1 ? 's' : ''} · click any row to expand
            </span>
          </>
        )}
      </div>

      {!selectedFormId ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-200 bg-white py-20 text-center">
          <Table2 className="h-8 w-8 text-zinc-200 mb-3" />
          <p className="text-sm font-medium text-zinc-500">Select a form to view its data</p>
          <p className="text-xs text-zinc-400 mt-1">All fields will appear as columns</p>
        </div>
      ) : formSubmissions.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-200 bg-white py-16 text-center">
          <Inbox className="h-8 w-8 text-zinc-200 mb-3" />
          <p className="text-sm font-medium text-zinc-500">No submissions for this form yet</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-200">
                <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 whitespace-nowrap sticky left-0 bg-zinc-50 border-r border-zinc-100 min-w-[140px] max-w-[180px]">Email</th>
                <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 whitespace-nowrap min-w-[90px]">Date</th>
                <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 whitespace-nowrap min-w-[90px]">Status</th>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {fields.map((f: any) => (
                  <th key={f.id} className="px-3 py-2.5 text-left font-semibold text-zinc-500 min-w-[120px] max-w-[200px]">
                    <span className="block truncate">{f.label || f.id}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {formSubmissions.map(sub => {
                const data = (sub.data ?? {}) as Record<string, unknown>
                const cfg = statusConfig[sub.status] ?? statusConfig.draft
                return (
                  <tr
                    key={sub.id}
                    onClick={() => setExpandedSub(sub)}
                    className="hover:bg-orange-50 cursor-pointer transition-colors group"
                  >
                    <td className="px-3 py-2 font-medium whitespace-nowrap sticky left-0 bg-white group-hover:bg-orange-50 border-r border-zinc-100 min-w-[140px] max-w-[180px] transition-colors">
                      <span className="block truncate text-zinc-700">
                        {sub.respondent_email ?? (isImported(sub) ? 'Imported' : '—')}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-zinc-500 whitespace-nowrap">
                      {sub.submitted_at ? new Date(sub.submitted_at).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', cfg.className)}>
                        {cfg.label}
                      </span>
                    </td>
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {fields.map((f: any) => {
                      const val = data[f.id]
                      const display = Array.isArray(val) ? val.join(', ') : String(val ?? '')
                      return (
                        <td key={f.id} className="px-3 py-2 text-zinc-600 min-w-[120px] max-w-[200px]">
                          <span className="block truncate" title={display || undefined}>{display || '—'}</span>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Row detail dialog */}
      <Dialog open={!!expandedSub} onOpenChange={open => { if (!open) setExpandedSub(null) }}>
        {expandedSub && (
          <SubmissionDetailDialog
            sub={expandedSub}
            fields={fields}
            onClose={() => setExpandedSub(null)}
            onAssigned={onAssigned}
          />
        )}
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Respondent Lookup
// ---------------------------------------------------------------------------

const IMPORTED_KEY = '__imported__'

function RespondentLookup({ submissions, forms, onAssigned }: {
  submissions: Submission[]
  forms: FormRow[]
  onAssigned: (id: string, email: string) => void
}) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [profileView, setProfileView] = useState<'timeline' | 'table'>('timeline')
  const [assignOpen, setAssignOpen] = useState(false)
  const [assignSubId, setAssignSubId] = useState<string | null>(null)
  const [assignEmail, setAssignEmail] = useState('')
  const [assigning, setAssigning] = useState(false)

  // Group submissions — null email → IMPORTED_KEY
  const respondentMap = useMemo(() => {
    const map = new Map<string, Submission[]>()
    for (const sub of submissions) {
      const key = sub.respondent_email ?? IMPORTED_KEY
      const bucket = map.get(key) ?? []
      bucket.push(sub)
      map.set(key, bucket)
    }
    return map
  }, [submissions])

  const respondents = useMemo(() => {
    const all = Array.from(respondentMap.entries())
      .map(([key, subs]) => ({
        key,
        displayEmail: key === IMPORTED_KEY ? 'Imported records' : key,
        isImported: key === IMPORTED_KEY,
        count: subs.length,
        latest: subs.reduce((a, b) => (a.submitted_at ?? '') > (b.submitted_at ?? '') ? a : b),
        subs: subs.sort((a, b) => (b.submitted_at ?? '').localeCompare(a.submitted_at ?? '')),
      }))
      .sort((a, b) => (b.latest.submitted_at ?? '').localeCompare(a.latest.submitted_at ?? ''))

    if (!search.trim()) return all
    const q = search.toLowerCase()
    return all.filter(r =>
      r.displayEmail.toLowerCase().includes(q) ||
      r.subs.some(s => s.forms?.name?.toLowerCase().includes(q))
    )
  }, [respondentMap, search])

  const selectedRespondent = selectedKey ? respondents.find(r => r.key === selectedKey) : null

  // For table view: build field columns across all forms this respondent submitted to
  const respondentFields = useMemo(() => {
    if (!selectedRespondent) return []
    const formIds = new Set(selectedRespondent.subs.map(s => s.form_id))
    const seen = new Set<string>()
    const out: { id: string; label: string; formId: string }[] = []
    for (const form of forms) {
      if (!formIds.has(form.id)) continue
      for (const page of form.schema?.pages ?? []) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const f of page.fields as any[]) {
          if (f.hidden || f.type === 'section' || f.type === 'heading') continue
          if (!seen.has(f.id)) { seen.add(f.id); out.push({ id: f.id, label: f.label || f.id, formId: form.id }) }
        }
      }
    }
    return out
  }, [selectedRespondent, forms])

  async function handleAssign() {
    if (!assignEmail.trim() || !assignSubId) return
    setAssigning(true)
    const res = await fetch(`/api/submissions/${assignSubId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ respondent_email: assignEmail.trim().toLowerCase() }),
    })
    setAssigning(false)
    if (res.ok) {
      toast.success(`Assigned to ${assignEmail.trim()}`)
      onAssigned(assignSubId, assignEmail.trim().toLowerCase())
      setAssignOpen(false)
      setAssignEmail('')
      setAssignSubId(null)
    } else {
      toast.error('Failed to assign — admin access required')
    }
  }

  function openAssign(subId: string) {
    setAssignSubId(subId)
    setAssignEmail('')
    setAssignOpen(true)
  }

  return (
    <div className="flex gap-5 min-h-0">
      {/* Left list */}
      <div className="w-72 flex-shrink-0 space-y-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
          <Input placeholder="Search by email or form…" value={search}
            onChange={e => { setSearch(e.target.value); setSelectedKey(null) }}
            className="pl-8 h-9 text-sm" />
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
          {respondents.length === 0 ? (
            <div className="py-10 text-center">
              <UserSearch className="h-7 w-7 text-zinc-200 mx-auto mb-2" />
              <p className="text-xs text-zinc-400">No respondents found</p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-100 max-h-[60vh] overflow-y-auto">
              {respondents.map(r => (
                <button key={r.key} onClick={() => setSelectedKey(r.key)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-zinc-50 transition-colors',
                    selectedKey === r.key && 'bg-orange-50 border-l-2 border-orange-500'
                  )}>
                  <div className={cn(
                    'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
                    r.isImported ? 'bg-zinc-200 text-zinc-500' : 'bg-zinc-100 text-zinc-500'
                  )}>
                    {r.isImported ? '?' : (r.displayEmail[0]?.toUpperCase() ?? '?')}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-zinc-800 truncate">{r.displayEmail}</p>
                    <p className="text-[10px] text-zinc-400">{r.count} submission{r.count !== 1 ? 's' : ''}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right: profile */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {!selectedRespondent ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-200 bg-white h-64 text-center">
            <UserSearch className="h-8 w-8 text-zinc-200 mb-3" />
            <p className="text-sm font-medium text-zinc-500">Select a respondent to view their history</p>
            <p className="text-xs text-zinc-400 mt-1">See all submissions across all forms over time</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Profile header */}
            <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={cn(
                    'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                    selectedRespondent.isImported ? 'bg-zinc-100 text-zinc-400' : 'bg-orange-100 text-orange-600'
                  )}>
                    {selectedRespondent.isImported ? '?' : (selectedRespondent.displayEmail[0]?.toUpperCase() ?? '?')}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-zinc-900 truncate">{selectedRespondent.displayEmail}</p>
                    <p className="text-xs text-zinc-500">
                      {selectedRespondent.count} submission{selectedRespondent.count !== 1 ? 's' : ''} across{' '}
                      {new Set(selectedRespondent.subs.map(s => s.form_id)).size} form{new Set(selectedRespondent.subs.map(s => s.form_id)).size !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
                {/* View toggle */}
                <div className="flex rounded-lg border border-zinc-200 bg-zinc-50 p-0.5 gap-0.5 flex-shrink-0">
                  {(['timeline', 'table'] as const).map(mode => (
                    <button key={mode} onClick={() => setProfileView(mode)}
                      className={cn(
                        'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                        profileView === mode ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
                      )}>
                      {mode === 'timeline' ? <><List className="h-3 w-3" />Timeline</> : <><Table2 className="h-3 w-3" />Table</>}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Timeline view */}
            {profileView === 'timeline' && (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wider text-zinc-400 px-1">Submission history</p>
                {selectedRespondent.subs.map(sub => {
                  const cfg = statusConfig[sub.status] ?? statusConfig.draft
                  const period = formatPeriod(sub.forms?.settings)
                  return (
                    <div key={sub.id} className="rounded-xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
                      <button onClick={() => router.push(`/submissions/${sub.id}`)}
                        className="w-full p-3.5 text-left hover:bg-zinc-50 transition-colors group">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3 min-w-0">
                            <div className="flex-shrink-0 mt-0.5">
                              {sub.status === 'reviewed' ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                : sub.status === 'submitted' ? <Clock className="h-4 w-4 text-blue-400" />
                                : <FileText className="h-4 w-4 text-zinc-300" />}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-zinc-800">{sub.forms?.name ?? 'Unknown form'}</p>
                              {period && <p className="text-[11px] text-orange-600 flex items-center gap-1 mt-0.5"><Calendar className="h-2.5 w-2.5" />{period}</p>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', cfg.className)}>{cfg.label}</span>
                            <span className="text-[11px] text-zinc-400">{sub.submitted_at ? new Date(sub.submitted_at).toLocaleDateString() : 'Draft'}</span>
                            <ChevronRight className="h-3.5 w-3.5 text-zinc-300 group-hover:text-zinc-500" />
                          </div>
                        </div>
                      </button>
                      {selectedRespondent.isImported && (
                        <div className="border-t border-zinc-100 px-3.5 py-2 bg-zinc-50 flex items-center justify-between">
                          <span className="text-[11px] text-zinc-400">Imported — not linked to a contact</span>
                          <button onClick={() => openAssign(sub.id)}
                            className="flex items-center gap-1 text-[11px] text-orange-600 hover:text-orange-700 font-medium">
                            <UserPlus className="h-3 w-3" /> Assign to contact
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Table view */}
            {profileView === 'table' && (
              <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-zinc-50 border-b border-zinc-200">
                      <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 whitespace-nowrap sticky left-0 bg-zinc-50 border-r border-zinc-100">Form</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 whitespace-nowrap">Date</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 whitespace-nowrap">Status</th>
                      {respondentFields.map(f => (
                        <th key={f.id} className="px-3 py-2.5 text-left font-semibold text-zinc-500 min-w-[120px] max-w-[180px]">
                          <span className="block truncate">{f.label}</span>
                        </th>
                      ))}
                      {selectedRespondent.isImported && <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 whitespace-nowrap">Assign</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {selectedRespondent.subs.map(sub => {
                      const data = (sub.data ?? {}) as Record<string, unknown>
                      const cfg = statusConfig[sub.status] ?? statusConfig.draft
                      return (
                        <tr key={sub.id} className="hover:bg-zinc-50 transition-colors">
                          <td className="px-3 py-2 font-medium text-zinc-700 whitespace-nowrap sticky left-0 bg-white hover:bg-zinc-50 border-r border-zinc-100 max-w-[160px]">
                            <span className="block truncate">{sub.forms?.name ?? '—'}</span>
                          </td>
                          <td className="px-3 py-2 text-zinc-500 whitespace-nowrap">
                            {sub.submitted_at ? new Date(sub.submitted_at).toLocaleDateString() : '—'}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', cfg.className)}>{cfg.label}</span>
                          </td>
                          {respondentFields.map(f => {
                            const val = sub.form_id === f.formId ? data[f.id] : undefined
                            const display = val === undefined ? '' : Array.isArray(val) ? val.join(', ') : String(val ?? '')
                            return (
                              <td key={f.id} className="px-3 py-2 text-zinc-600 max-w-[180px]">
                                <span className="block truncate" title={display || undefined}>{display || '—'}</span>
                              </td>
                            )
                          })}
                          {selectedRespondent.isImported && (
                            <td className="px-3 py-2 whitespace-nowrap">
                              <button onClick={() => openAssign(sub.id)}
                                className="flex items-center gap-1 text-[11px] text-orange-600 hover:text-orange-700 font-medium">
                                <UserPlus className="h-3 w-3" /> Assign
                              </button>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Assign dialog */}
      <Dialog open={assignOpen} onOpenChange={open => { setAssignOpen(open); if (!open) setAssignEmail('') }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-orange-500" /> Assign to contact
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-zinc-500">Enter the email address this imported record belongs to.</p>
          <Input type="email" placeholder="contact@example.com" value={assignEmail}
            onChange={e => setAssignEmail(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAssign() }}
            autoFocus />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAssignOpen(false)}>Cancel</Button>
            <Button onClick={handleAssign} disabled={assigning || !assignEmail.trim()}
              className="bg-orange-600 hover:bg-orange-700 text-white">
              {assigning ? 'Saving…' : 'Assign'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SubmissionsClient() {
  const router = useRouter()
  const { currentProgram, currentRole } = useProgram()
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [forms, setForms] = useState<FormRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [folderFilter, setFolderFilter] = useState<FolderFilter>(null)
  const [activeTab, setActiveTab] = useState<ActiveTab>('list')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false)
  const [bulkAssignEmail, setBulkAssignEmail] = useState('')
  const [bulkAssignBusy, setBulkAssignBusy] = useState(false)

  // Staff and viewer can only see their own submissions
  const isRestricted = currentRole === 'staff' || currentRole === 'viewer'

  useEffect(() => {
    createClient().auth.getUser().then(({ data: { user } }) => setUserEmail(user?.email ?? null))
  }, [])

  const fetchData = useCallback(async () => {
    if (!currentProgram) return
    // Clear stale data immediately so switching programs never shows another
    // program's submissions while the new fetch is in flight.
    setSubmissions([])
    setForms([])
    setSelectedIds(new Set())
    setLoading(true)
    const [subsRes, formsRes] = await Promise.all([
      fetch(`/api/submissions?program_id=${currentProgram.id}`),
      fetch(`/api/forms?program_id=${currentProgram.id}`),
    ])
    if (subsRes.ok) setSubmissions(await subsRes.json())
    if (formsRes.ok) setForms(await formsRes.json())
    setLoading(false)
  }, [currentProgram])

  useEffect(() => { fetchData() }, [fetchData])

  // Update a single submission's email in local state after assignment
  function handleAssigned(id: string, email: string) {
    setSubmissions(prev => prev.map(s => s.id === id ? { ...s, respondent_email: email } : s))
  }

  async function handleBulkAssign() {
    const email = bulkAssignEmail.trim().toLowerCase()
    if (!email || selectedIds.size === 0) return
    setBulkAssignBusy(true)
    const ids = [...selectedIds]
    const results = await Promise.allSettled(
      ids.map(id =>
        fetch(`/api/submissions/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ respondent_email: email }),
        })
      )
    )
    setBulkAssignBusy(false)
    const succeeded = results.filter(r => r.status === 'fulfilled' && (r.value as Response).ok).length
    const failed = ids.length - succeeded
    if (succeeded > 0) {
      toast.success(`Assigned ${succeeded} submission${succeeded !== 1 ? 's' : ''} to ${email}`)
      setSubmissions(prev => prev.map(s => selectedIds.has(s.id) ? { ...s, respondent_email: email } : s))
      setSelectedIds(new Set())
      setBulkAssignOpen(false)
      setBulkAssignEmail('')
    }
    if (failed > 0) toast.error(`${failed} assignment${failed !== 1 ? 's' : ''} failed`)
  }

  function toggleSelect(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSelectAll(ids: string[]) {
    setSelectedIds(prev => prev.size === ids.length ? new Set() : new Set(ids))
  }

  // Restricted roles only see their own submissions
  const visibleSubmissions = isRestricted && userEmail
    ? submissions.filter(s => s.respondent_email?.toLowerCase() === userEmail.toLowerCase())
    : submissions

  const filtered = visibleSubmissions
    .filter(s => {
      const email = s.respondent_email?.toLowerCase() ?? ''
      const formName = s.forms?.name?.toLowerCase() ?? ''
      const q = search.toLowerCase()
      return email.includes(q) || formName.includes(q)
    })
    .filter(s => {
      if (statusFilter === 'unassigned') return !s.respondent_email
      if (statusFilter === 'imported') return isImported(s)
      return statusFilter === 'all' || s.status === statusFilter
    })
    .filter(s => {
      if (!folderFilter) return true
      if (folderFilter.type === 'form') return s.form_id === folderFilter.id
      const form = forms.find(f => f.id === s.form_id)
      return (form?.settings?.folder ?? '') === folderFilter.name
    })

  // Folder sidebar data: group non-draft forms by their folder setting
  const folderTree = useMemo(() => {
    const folderMap = new Map<string, FormRow[]>()
    const unfiled: FormRow[] = []
    for (const form of forms) {
      const folder = form.settings?.folder?.trim()
      if (folder) {
        const bucket = folderMap.get(folder) ?? []
        bucket.push(form)
        folderMap.set(folder, bucket)
      } else {
        unfiled.push(form)
      }
    }
    const sorted = [...folderMap.entries()].sort(([a], [b]) => a.localeCompare(b))
    return { folders: sorted, unfiled }
  }, [forms])

  const tabs: { key: ActiveTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { key: 'list', label: isRestricted ? 'My Submissions' : 'All Submissions', icon: List },
    ...(!isRestricted ? [
      { key: 'table' as ActiveTab,       label: 'Table View',        icon: Table2 },
      { key: 'respondents' as ActiveTab, label: 'Respondent Lookup', icon: UserSearch },
    ] : []),
  ]

  return (
    <div className="max-w-6xl px-8 py-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-gray-900">
            {isRestricted ? 'My Submissions' : 'Submissions'}
          </h1>
          <p className="mt-0.5 text-[14px] text-gray-500">
            {isRestricted
              ? `${visibleSubmissions.length} submission${visibleSubmissions.length !== 1 ? 's' : ''} assigned to you`
              : `${submissions.length} response${submissions.length !== 1 ? 's' : ''} in ${currentProgram?.name}`}
          </p>
        </div>
        {!isRestricted && (
          <div className="flex items-center gap-2">
            {currentProgram && submissions.length > 0 && (
              <a href={`/api/submissions/export?program_id=${currentProgram.id}`} download>
                <Button variant="outline" size="sm" className="gap-1.5 h-8 text-[13px]">
                  <Download className="h-3.5 w-3.5" /> Export all CSV
                </Button>
              </a>
            )}
          </div>
        )}
      </div>

      {/* To-do: pending form assignments for the logged-in user */}
      <MyTasks />

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-0.5 mb-5 w-fit">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setActiveTab(key)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              activeTab === key ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
            )}>
            <Icon className="h-3.5 w-3.5" />{label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
      ) : (
        <>
          {/* ── List tab ── */}
          {activeTab === 'list' && (
            <div className="flex gap-5 items-start">
              {/* Folder sidebar — only shown when folders exist */}
              {!isRestricted && (folderTree.folders.length > 0 || folderTree.unfiled.length > 0) && (
                <div className="w-52 flex-shrink-0 rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
                  <button
                    onClick={() => setFolderFilter(null)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2.5 text-[13px] font-medium transition-colors border-b border-gray-50',
                      !folderFilter ? 'bg-orange-50 text-orange-700' : 'text-gray-600 hover:bg-gray-50'
                    )}
                  >
                    <List className="h-3.5 w-3.5 flex-shrink-0" />
                    All submissions
                  </button>
                  {folderTree.folders.map(([folderName, folderForms]) => {
                    const isActive = folderFilter?.type === 'folder' && folderFilter.name === folderName
                    return (
                      <div key={folderName} className="border-b border-gray-50 last:border-b-0">
                        <button
                          onClick={() => setFolderFilter(isActive ? null : { type: 'folder', name: folderName })}
                          className={cn(
                            'w-full flex items-center gap-2 px-3 py-2 text-[12px] font-semibold transition-colors',
                            isActive ? 'bg-orange-50 text-orange-700' : 'text-gray-500 hover:bg-gray-50'
                          )}
                        >
                          {isActive ? <FolderOpen className="h-3.5 w-3.5 flex-shrink-0 text-orange-500" /> : <Folder className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />}
                          <span className="flex-1 text-left truncate">{folderName}</span>
                        </button>
                        {folderForms.map(form => {
                          const isFormActive = folderFilter?.type === 'form' && folderFilter.id === form.id
                          const count = submissions.filter(s => s.form_id === form.id).length
                          return (
                            <button
                              key={form.id}
                              onClick={() => setFolderFilter(isFormActive ? null : { type: 'form', id: form.id })}
                              className={cn(
                                'w-full flex items-center justify-between pl-8 pr-3 py-1.5 text-[12px] transition-colors',
                                isFormActive ? 'bg-orange-50 text-orange-700 font-medium' : 'text-gray-500 hover:bg-gray-50'
                              )}
                            >
                              <span className="truncate text-left">{form.name}</span>
                              <span className="ml-1 flex-shrink-0 text-[10px] text-gray-400">{count}</span>
                            </button>
                          )
                        })}
                      </div>
                    )
                  })}
                  {folderTree.unfiled.length > 0 && (
                    <div>
                      <button
                        onClick={() => setFolderFilter(folderFilter?.type === 'folder' && folderFilter.name === '' ? null : { type: 'folder', name: '' })}
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-2 text-[12px] font-semibold transition-colors border-t border-gray-50',
                          folderFilter?.type === 'folder' && folderFilter.name === '' ? 'bg-orange-50 text-orange-700' : 'text-gray-400 hover:bg-gray-50'
                        )}
                      >
                        <Folder className="h-3.5 w-3.5 flex-shrink-0" />
                        Unfiled
                      </button>
                      {folderTree.unfiled.map(form => {
                        const isFormActive = folderFilter?.type === 'form' && folderFilter.id === form.id
                        const count = submissions.filter(s => s.form_id === form.id).length
                        return (
                          <button
                            key={form.id}
                            onClick={() => setFolderFilter(isFormActive ? null : { type: 'form', id: form.id })}
                            className={cn(
                              'w-full flex items-center justify-between pl-8 pr-3 py-1.5 text-[12px] transition-colors',
                              isFormActive ? 'bg-orange-50 text-orange-700 font-medium' : 'text-gray-500 hover:bg-gray-50'
                            )}
                          >
                            <span className="truncate text-left">{form.name}</span>
                            <span className="ml-1 flex-shrink-0 text-[10px] text-gray-400">{count}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-4">
                <div className="relative flex-1 max-w-xs">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                  <Input placeholder="Search by email or form…" value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-9 text-[13px]" />
                </div>
                <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-1">
                  {filterButtons.map(btn => (
                    <button key={btn.key} onClick={() => setStatusFilter(btn.key)}
                      className={cn('rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors',
                        statusFilter === btn.key ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-900')}>
                      {btn.label}
                    </button>
                  ))}
                </div>
              </div>
              {/* Bulk selection action bar — admin/program_admin only */}
              {!isRestricted && selectedIds.size > 0 && (
                <div className="flex items-center gap-3 mb-3 rounded-lg bg-orange-50 border border-orange-200 px-4 py-2.5">
                  <span className="text-[13px] font-medium text-orange-800">
                    {selectedIds.size} selected
                  </span>
                  <Button
                    size="sm"
                    className="h-7 gap-1.5 text-[12px] bg-orange-600 hover:bg-orange-700"
                    onClick={() => setBulkAssignOpen(true)}
                  >
                    <UserPlus className="h-3.5 w-3.5" /> Assign to contact
                  </Button>
                  <button
                    className="ml-auto text-[12px] text-orange-600 hover:text-orange-800 flex items-center gap-1"
                    onClick={() => setSelectedIds(new Set())}
                  >
                    <X className="h-3 w-3" /> Clear
                  </button>
                </div>
              )}

              {filtered.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 bg-white py-20 text-center">
                  <Inbox className="mx-auto h-8 w-8 text-gray-200 mb-3" />
                  <p className="text-[14px] font-medium text-gray-500">
                    {search || statusFilter !== 'all' ? 'No submissions match your filters' : 'No submissions yet'}
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
                  {/* Select-all header row — admin only */}
                  {!isRestricted && (
                    <div className="flex items-center gap-3 px-5 py-2 border-b border-gray-100 bg-gray-50">
                      <input
                        type="checkbox"
                        aria-label="Select all submissions"
                        checked={selectedIds.size === filtered.length && filtered.length > 0}
                        ref={el => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < filtered.length }}
                        onChange={() => toggleSelectAll(filtered.map(s => s.id))}
                        className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                      />
                      <span className="text-[11px] text-gray-400 font-medium uppercase tracking-wide">
                        {filtered.length} submission{filtered.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  )}
                  {filtered.map((sub, i) => {
                    const cfg = statusConfig[sub.effectiveStatus ?? sub.status] ?? statusConfig.draft
                    const submittedAt = sub.submitted_at
                      ? formatDistanceToNow(new Date(sub.submitted_at), { addSuffix: true })
                      : formatDistanceToNow(new Date(sub.created_at), { addSuffix: true })
                    const isSelected = selectedIds.has(sub.id)
                    return (
                      <div
                        key={sub.id}
                        className={cn(
                          'flex items-center gap-3 px-5 py-3.5 transition-colors group',
                          i < filtered.length - 1 && 'border-b border-gray-50',
                          isSelected ? 'bg-orange-50' : 'hover:bg-gray-50'
                        )}
                      >
                        {!isRestricted && (
                          <input
                            type="checkbox"
                            aria-label={`Select submission from ${displayName(sub)}`}
                            checked={isSelected}
                            onChange={e => toggleSelect(sub.id, e as unknown as React.MouseEvent)}
                            onClick={e => e.stopPropagation()}
                            className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500 flex-shrink-0 cursor-pointer"
                          />
                        )}
                        <button
                          onClick={() => router.push(`/submissions/${sub.id}`)}
                          className="flex items-center gap-4 flex-1 min-w-0 text-left"
                        >
                          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-[11px] font-semibold text-gray-500">
                            {(displayName(sub)[0] ?? '?').toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[14px] font-medium text-gray-800 truncate">{displayName(sub)}</p>
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-[12px] text-gray-400 truncate">{sub.forms?.name ?? 'Unknown form'}</p>
                              {(() => { const p = formatPeriod(sub.forms?.settings); return p ? <span className="flex items-center gap-1 text-[10px] font-medium text-orange-600"><Calendar className="h-2.5 w-2.5" />{p}</span> : null })()}
                            </div>
                          </div>
                          <span className="text-[12px] text-gray-400 flex-shrink-0">{submittedAt}</span>
                          <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-medium flex-shrink-0', cfg.className)}>{cfg.label}</span>
                          <ChevronRight className="h-3.5 w-3.5 text-gray-300 group-hover:text-gray-400 flex-shrink-0" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
              </div>{/* flex-1 */}
            </div>
          )}

          {activeTab === 'table' && <TableView submissions={submissions} forms={forms} onAssigned={handleAssigned} />}
          {activeTab === 'respondents' && <RespondentLookup submissions={submissions} forms={forms} onAssigned={handleAssigned} />}
        </>
      )}

      {/* Bulk assign dialog */}
      <Dialog open={bulkAssignOpen} onOpenChange={o => { setBulkAssignOpen(o); if (!o) setBulkAssignEmail('') }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-orange-500" />
              Assign {selectedIds.size} submission{selectedIds.size !== 1 ? 's' : ''}
            </DialogTitle>
            <p className="text-[13px] text-muted-foreground mt-1">
              Enter the contact email to assign these submissions to.
            </p>
          </DialogHeader>
          <div className="py-2 space-y-1.5">
            <label htmlFor="bulk-assign-email" className="text-[13px] font-medium text-gray-700">Contact email</label>
            <Input
              id="bulk-assign-email"
              type="email"
              placeholder="contact@example.com"
              value={bulkAssignEmail}
              onChange={e => setBulkAssignEmail(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleBulkAssign() }}
              className="h-9 text-[13px]"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBulkAssignOpen(false)} disabled={bulkAssignBusy}>Cancel</Button>
            <Button
              onClick={handleBulkAssign}
              className="bg-orange-600 hover:bg-orange-700 gap-1.5"
              disabled={bulkAssignBusy || !bulkAssignEmail.trim()}
            >
              {bulkAssignBusy ? 'Assigning…' : `Assign ${selectedIds.size}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
