'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useProgram } from '@/contexts/program-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import {
  BookOpen, Plus, Trash2, Upload, FileText, Loader2, ChevronDown, ChevronUp,
  Calendar, Pencil, X, Check, Layers,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { cn } from '@/lib/utils'

// Supported document types
const DOC_TYPES = [
  { value: 'narrative',        label: 'Grant Narrative' },
  { value: 'logic_model',      label: 'Logic Model' },
  { value: 'continuation',     label: 'Continuation Document' },
  { value: 'evaluation',       label: 'Evaluation Plan' },
  { value: 'budget',           label: 'Budget Narrative' },
  { value: 'progress_report',  label: 'Progress Report' },
  { value: 'other',            label: 'Other' },
] as const

type DocTypeValue = typeof DOC_TYPES[number]['value']

function docTypeLabel(value: string): string {
  return DOC_TYPES.find(d => d.value === value)?.label ?? 'Document'
}

const DOC_TYPE_COLORS: Record<string, string> = {
  narrative:       'bg-orange-50 text-orange-700 border-orange-100',
  logic_model:     'bg-violet-50 text-violet-700 border-violet-100',
  continuation:    'bg-blue-50 text-blue-700 border-blue-100',
  evaluation:      'bg-teal-50 text-teal-700 border-teal-100',
  budget:          'bg-green-50 text-green-700 border-green-100',
  progress_report: 'bg-sky-50 text-sky-700 border-sky-100',
  other:           'bg-gray-50 text-gray-600 border-gray-100',
}

interface Document {
  id: string
  title: string
  description: string | null
  document_type: string
  file_name: string | null
  starts_at: string
  ends_at: string
  created_at: string
  content?: string  // only loaded in detail view
}

type InputMode = 'pdf' | 'text'

export function NarrativesClient() {
  const { currentProgram } = useProgram()
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [expandedContent, setExpandedContent] = useState<Record<string, string>>({})

  // Form state
  const [inputMode, setInputMode] = useState<InputMode>('pdf')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [docType, setDocType] = useState<DocTypeValue>('narrative')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [textContent, setTextContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Inline edit
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDocType, setEditDocType] = useState<DocTypeValue>('narrative')
  const [editStarts, setEditStarts] = useState('')
  const [editEnds, setEditEnds] = useState('')
  const [editBusy, setEditBusy] = useState(false)

  // Delete confirm
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const fetchDocuments = useCallback(async () => {
    if (!currentProgram) return
    setLoading(true)
    const res = await fetch(`/api/narratives?program_id=${currentProgram.id}`)
    if (res.ok) setDocuments(await res.json())
    setLoading(false)
  }, [currentProgram])

  useEffect(() => { fetchDocuments() }, [fetchDocuments])

  async function loadContent(id: string) {
    if (expandedContent[id]) return
    const res = await fetch(`/api/narratives/${id}`)
    if (res.ok) {
      const data = await res.json()
      setExpandedContent(prev => ({ ...prev, [id]: data.content }))
    }
  }

  function toggleExpand(id: string) {
    if (expanded === id) {
      setExpanded(null)
    } else {
      setExpanded(id)
      loadContent(id)
    }
  }

  function resetForm() {
    setTitle(''); setDescription(''); setStartsAt(''); setEndsAt('')
    setFile(null); setTextContent(''); setInputMode('pdf'); setDocType('narrative')
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!currentProgram) return
    if (inputMode === 'pdf' && !file) { toast.error('Please select a file'); return }
    if (inputMode === 'text' && !textContent.trim()) { toast.error('Please paste the document text'); return }

    setSubmitting(true)
    try {
      let file_base64: string | undefined
      let file_name: string | undefined
      if (inputMode === 'pdf' && file) {
        file_name = file.name
        file_base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => {
            const result = reader.result as string
            resolve(result.split(',')[1])
          }
          reader.onerror = reject
          reader.readAsDataURL(file)
        })
      }

      const res = await fetch('/api/narratives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          program_id: currentProgram.id,
          title: title.trim(),
          description: description.trim() || undefined,
          document_type: docType,
          starts_at: startsAt,
          ends_at: endsAt,
          file_name,
          file_base64,
          text_content: inputMode === 'text' ? textContent.trim() : undefined,
        }),
      })

      if (res.ok) {
        toast.success('Document saved — it will be used to ground future AI reports')
        resetForm()
        setCreating(false)
        fetchDocuments()
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error(typeof err.error === 'string' ? err.error : 'Failed to save document')
      }
    } catch {
      toast.error('Failed to process file')
    }
    setSubmitting(false)
  }

  async function handleSaveEdit(id: string) {
    setEditBusy(true)
    const res = await fetch(`/api/narratives/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: editTitle.trim(), document_type: editDocType, starts_at: editStarts, ends_at: editEnds }),
    })
    setEditBusy(false)
    if (res.ok) {
      toast.success('Updated')
      setEditingId(null)
      fetchDocuments()
    } else {
      toast.error('Failed to update')
    }
  }

  async function handleDelete(id: string) {
    setDeleteBusy(true)
    const res = await fetch(`/api/narratives/${id}`, { method: 'DELETE' })
    setDeleteBusy(false)
    if (res.ok) {
      toast.success('Document deleted')
      setDeletingId(null)
      setDocuments(d => d.filter(x => x.id !== id))
    } else {
      toast.error('Failed to delete')
    }
  }

  function dateRange(doc: Document) {
    return `${format(parseISO(doc.starts_at), 'MMM d, yyyy')} – ${format(parseISO(doc.ends_at), 'MMM d, yyyy')}`
  }

  return (
    <div className="max-w-3xl px-8 py-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-gray-900">Award Context</h1>
          <p className="mt-1 text-[14px] text-gray-500 max-w-xl">
            Upload the documents that define your award — narratives, logic models, continuation documents,
            and more. The AI pulls all matching documents into context when generating reports.
          </p>
        </div>
        {!creating && (
          <Button
            onClick={() => setCreating(true)}
            className="bg-orange-600 hover:bg-orange-700 h-9 gap-1.5 text-[13px] flex-shrink-0"
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> Add document
          </Button>
        )}
      </div>

      {/* How it works callout */}
      <div className="mb-6 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-[13px] text-blue-800 space-y-1">
        <p><strong>How it works:</strong> Add any number of documents per award period — grant narratives, logic models, continuation documents, evaluation plans, and more.</p>
        <p>When you generate a report, the AI automatically finds <strong>all documents</strong> whose date range overlaps your reporting period and reads them together as context, so generated summaries are grounded in your actual program goals and language.</p>
      </div>

      {/* Add document form */}
      {creating && (
        <form onSubmit={handleSubmit} className="mb-6 rounded-xl border border-orange-100 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between">
            <p className="text-[14px] font-semibold text-gray-800">New document</p>
            <button type="button" onClick={() => { setCreating(false); resetForm() }} className="text-gray-400 hover:text-gray-600">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="px-5 py-4 space-y-4">

            {/* Document type */}
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-gray-700">
                Document type <span className="text-red-500" aria-hidden="true">*</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {DOC_TYPES.map(dt => (
                  <button
                    key={dt.value}
                    type="button"
                    onClick={() => setDocType(dt.value)}
                    className={cn(
                      'px-3 py-1.5 rounded-lg border text-[12px] font-medium transition-colors',
                      docType === dt.value
                        ? DOC_TYPE_COLORS[dt.value]
                        : 'border-gray-200 text-gray-500 hover:border-gray-300 bg-white'
                    )}
                  >
                    {dt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Title */}
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-gray-700">
                Title <span className="text-red-500" aria-hidden="true">*</span>
              </label>
              <Input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder={
                  docType === 'logic_model' ? 'e.g. Program Logic Model 2024'
                  : docType === 'continuation' ? 'e.g. Year 2 Continuation Application'
                  : docType === 'evaluation' ? 'e.g. External Evaluation Plan 2024–2028'
                  : docType === 'budget' ? 'e.g. Budget Justification Year 1'
                  : 'e.g. USDA NIFA Award Narrative 2024–2028'
                }
                required
                className="h-9 text-[13px]"
                autoFocus
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-gray-700">Short description <span className="text-gray-400 font-normal">(optional)</span></label>
              <Input
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="e.g. Describes goals and outcomes for the 4-year integrated award"
                className="h-9 text-[13px]"
              />
            </div>

            {/* Date range */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[13px] font-medium text-gray-700">Award start date <span className="text-red-500" aria-hidden="true">*</span></label>
                <Input type="date" value={startsAt} onChange={e => setStartsAt(e.target.value)} required className="h-9 text-[13px]" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[13px] font-medium text-gray-700">Award end date <span className="text-red-500" aria-hidden="true">*</span></label>
                <Input type="date" value={endsAt} onChange={e => setEndsAt(e.target.value)} required className="h-9 text-[13px]" min={startsAt} />
              </div>
            </div>

            {/* Input mode toggle */}
            <div className="space-y-2">
              <label className="text-[13px] font-medium text-gray-700">Content <span className="text-red-500" aria-hidden="true">*</span></label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setInputMode('pdf')}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] font-medium transition-colors',
                    inputMode === 'pdf' ? 'bg-orange-50 border-orange-200 text-orange-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  )}
                >
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" /> Upload file
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode('text')}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] font-medium transition-colors',
                    inputMode === 'text' ? 'bg-orange-50 border-orange-200 text-orange-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  )}
                >
                  <FileText className="h-3.5 w-3.5" aria-hidden="true" /> Paste text
                </button>
              </div>

              {inputMode === 'pdf' && (
                <div>
                  <label
                    htmlFor="pdf-upload"
                    className={cn(
                      'flex items-center gap-3 px-4 py-3 rounded-lg border-2 border-dashed cursor-pointer transition-colors',
                      file ? 'border-orange-300 bg-orange-50' : 'border-gray-200 hover:border-gray-300'
                    )}
                  >
                    {file ? (
                      <>
                        <FileText className="h-5 w-5 text-orange-500 flex-shrink-0" aria-hidden="true" />
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium text-gray-800 truncate">{file.name}</p>
                          <p className="text-[11px] text-gray-400">{(file.size / 1024 / 1024).toFixed(1)} MB · Text will be extracted automatically</p>
                        </div>
                        <button type="button" onClick={e => { e.preventDefault(); setFile(null); if (fileRef.current) fileRef.current.value = '' }}
                          className="ml-auto text-gray-400 hover:text-gray-600">
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </>
                    ) : (
                      <>
                        <Upload className="h-5 w-5 text-gray-300 flex-shrink-0" aria-hidden="true" />
                        <div>
                          <p className="text-[13px] text-gray-600">Click to select a file</p>
                          <p className="text-[11px] text-gray-400">PDF, DOC, or DOCX</p>
                        </div>
                      </>
                    )}
                    <input
                      id="pdf-upload"
                      ref={fileRef}
                      type="file"
                      accept=".pdf,.doc,.docx"
                      className="sr-only"
                      onChange={e => setFile(e.target.files?.[0] ?? null)}
                      aria-label="Upload document"
                    />
                  </label>
                </div>
              )}

              {inputMode === 'text' && (
                <textarea
                  value={textContent}
                  onChange={e => setTextContent(e.target.value)}
                  placeholder="Paste the full document text here — goals, objectives, expected outcomes, theory of change…"
                  rows={10}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-[13px] text-gray-800 focus:outline-none focus:ring-1 focus:ring-orange-400 resize-y"
                  aria-label="Document text content"
                />
              )}
            </div>
          </div>

          <div className="px-5 py-3.5 border-t border-gray-50 flex items-center justify-between">
            {submitting && inputMode === 'pdf' && (
              <p className="text-[12px] text-gray-400 flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                Extracting text with Claude — this may take 15–30 seconds for long documents…
              </p>
            )}
            {!submitting && <div />}
            <div className="flex gap-2 ml-auto">
              <Button type="button" variant="ghost" onClick={() => { setCreating(false); resetForm() }} disabled={submitting} className="h-8 text-[13px]">
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-orange-600 hover:bg-orange-700 h-8 text-[13px] gap-1.5"
                disabled={submitting || !title.trim() || !startsAt || !endsAt}
                aria-busy={submitting}
              >
                {submitting
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> {inputMode === 'pdf' ? 'Extracting…' : 'Saving…'}</>
                  : 'Save document'
                }
              </Button>
            </div>
          </div>
        </form>
      )}

      {/* Document list */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-20 rounded-xl border border-gray-100 bg-white animate-pulse" />
          ))}
        </div>
      ) : documents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-20 text-center">
          <Layers className="mx-auto h-8 w-8 text-gray-200 mb-3" aria-hidden="true" />
          <p className="text-[14px] font-medium text-gray-500">No documents yet</p>
          <p className="text-[13px] text-gray-400 mt-1">Upload your first award document to give the AI program context.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {documents.map(doc => (
            <div key={doc.id} className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
              {/* Row header */}
              <div className="px-5 py-4 flex items-start gap-4">
                <BookOpen className="h-5 w-5 text-orange-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  {editingId === doc.id ? (
                    <div className="space-y-2">
                      {/* Type picker in edit mode */}
                      <div className="flex flex-wrap gap-1.5">
                        {DOC_TYPES.map(dt => (
                          <button
                            key={dt.value}
                            type="button"
                            onClick={() => setEditDocType(dt.value)}
                            className={cn(
                              'px-2 py-1 rounded-md border text-[11px] font-medium transition-colors',
                              editDocType === dt.value
                                ? DOC_TYPE_COLORS[dt.value]
                                : 'border-gray-200 text-gray-400 hover:border-gray-300 bg-white'
                            )}
                          >
                            {dt.label}
                          </button>
                        ))}
                      </div>
                      <Input
                        value={editTitle}
                        onChange={e => setEditTitle(e.target.value)}
                        className="h-8 text-[13px]"
                        autoFocus
                        aria-label="Edit title"
                      />
                      <div className="flex gap-2">
                        <Input type="date" value={editStarts} onChange={e => setEditStarts(e.target.value)} className="h-7 text-[12px]" aria-label="Start date" />
                        <span className="text-gray-400 self-center text-[12px]">–</span>
                        <Input type="date" value={editEnds} onChange={e => setEditEnds(e.target.value)} className="h-7 text-[12px]" min={editStarts} aria-label="End date" />
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="text-[14px] font-semibold text-gray-800 truncate">{doc.title}</p>
                        <span className={cn(
                          'flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium border',
                          DOC_TYPE_COLORS[doc.document_type] ?? DOC_TYPE_COLORS.other
                        )}>
                          {docTypeLabel(doc.document_type)}
                        </span>
                      </div>
                      {doc.description && <p className="text-[12px] text-gray-400 truncate">{doc.description}</p>}
                      <div className="flex items-center gap-1.5 mt-1 text-[11px] text-gray-400">
                        <Calendar className="h-3 w-3" aria-hidden="true" />
                        <span>{dateRange(doc)}</span>
                        {doc.file_name && (
                          <>
                            <span>·</span>
                            <span className="truncate max-w-[200px]">{doc.file_name}</span>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {editingId === doc.id ? (
                    <>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-gray-400 hover:text-gray-600"
                        onClick={() => setEditingId(null)} disabled={editBusy} aria-label="Cancel edit">
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                      <Button size="sm" className="h-7 px-2 text-[11px] bg-orange-600 hover:bg-orange-700 gap-1"
                        onClick={() => handleSaveEdit(doc.id)} disabled={editBusy || !editTitle.trim()} aria-busy={editBusy}>
                        {editBusy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <Check className="h-3 w-3" aria-hidden="true" />}
                        Save
                      </Button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => toggleExpand(doc.id)}
                        className="p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-50"
                        aria-label={expanded === doc.id ? 'Collapse content' : 'View extracted content'}
                      >
                        {expanded === doc.id
                          ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                          : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                        }
                      </button>
                      <button
                        onClick={() => {
                          setEditingId(doc.id)
                          setEditTitle(doc.title)
                          setEditDocType((doc.document_type as DocTypeValue) ?? 'narrative')
                          setEditStarts(doc.starts_at)
                          setEditEnds(doc.ends_at)
                        }}
                        className="p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-50"
                        aria-label={`Edit ${doc.title}`}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      {deletingId === doc.id ? (
                        <div className="flex items-center gap-1">
                          <span className="text-[11px] text-red-600">Delete?</span>
                          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px] text-gray-400" onClick={() => setDeletingId(null)} disabled={deleteBusy}>No</Button>
                          <Button size="sm" className="h-6 px-1.5 text-[11px] bg-red-600 hover:bg-red-700" onClick={() => handleDelete(doc.id)} disabled={deleteBusy} aria-busy={deleteBusy}>
                            {deleteBusy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : 'Yes'}
                          </Button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeletingId(doc.id)}
                          className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50"
                          aria-label={`Delete ${doc.title}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Expanded content */}
              {expanded === doc.id && (
                <div className="border-t border-gray-50 px-5 py-4">
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Extracted content</p>
                  {expandedContent[doc.id] ? (
                    <pre className="text-[12px] text-gray-600 whitespace-pre-wrap font-sans leading-relaxed max-h-80 overflow-y-auto">
                      {expandedContent[doc.id]}
                    </pre>
                  ) : (
                    <div className="flex items-center gap-2 text-[12px] text-gray-400">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading…
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
