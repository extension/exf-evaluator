'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus, Trash2, Save, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SheetColumn, SheetSchema } from '@/types/forms'

interface SheetRow {
  id: string
  [colId: string]: string
}

interface Props {
  formId: string
  formName: string
  schema: SheetSchema
  token: string
  tokenId: string
  respondentEmail: string | null
  programName: string
  brandColor: string
  confirmationMessage?: string
  draftId?: string
  draftData?: { rows?: SheetRow[] }
}

function newRow(columns: SheetColumn[]): SheetRow {
  const row: SheetRow = { id: `row-${Date.now()}-${Math.random().toString(36).slice(2)}` }
  columns.forEach(col => { row[col.id] = '' })
  return row
}

export function SheetRendererClient({
  formId,
  formName,
  schema,
  token,
  tokenId,
  respondentEmail,
  programName,
  brandColor,
  confirmationMessage,
  draftId,
  draftData,
}: Props) {
  const [rows, setRows] = useState<SheetRow[]>(() => {
    if (draftData?.rows?.length) return draftData.rows
    return [newRow(schema.columns)]
  })
  const [saving, setSaving] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [currentDraftId, setCurrentDraftId] = useState<string | undefined>(draftId)

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const saveDraft = useCallback(async (currentRows: SheetRow[]) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    setSaving(true)
    try {
      const res = await fetch('/api/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          form_id: formId,
          token,
          token_id: tokenId,
          data: { rows: currentRows },
          status: 'draft',
          draft_id: currentDraftId,
        }),
      })
      if (res.ok) {
        const result = await res.json()
        setCurrentDraftId(result.id)
      }
    } finally {
      setSaving(false)
    }
  }, [formId, token, tokenId, currentDraftId])

  function markDirty(updatedRows: SheetRow[]) {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => saveDraft(updatedRows), 2000)
  }

  function updateCell(rowIdx: number, colId: string, value: string) {
    setRows(prev => {
      const next = prev.map((r, i) => i === rowIdx ? { ...r, [colId]: value } : r)
      markDirty(next)
      return next
    })
  }

  function addRow() {
    setRows(prev => {
      const next = [...prev, newRow(schema.columns)]
      markDirty(next)
      return next
    })
  }

  function deleteRow(idx: number) {
    if (rows.length === 1) return
    setRows(prev => {
      const next = prev.filter((_, i) => i !== idx)
      markDirty(next)
      return next
    })
  }

  async function handleSubmit() {
    // Check required columns
    for (const col of schema.columns) {
      if (!col.required) continue
      for (let i = 0; i < rows.length; i++) {
        if (!rows[i][col.id]?.trim()) {
          toast.error(`Row ${i + 1}: "${col.label}" is required`)
          return
        }
      }
    }

    setSubmitting(true)
    const res = await fetch('/api/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        form_id: formId,
        token,
        token_id: tokenId,
        data: { rows },
        status: 'submitted',
        draft_id: currentDraftId,
      }),
    })
    setSubmitting(false)
    if (res.ok) {
      setSubmitted(true)
    } else {
      const err = await res.json().catch(() => ({}))
      toast.error(err.error ?? 'Failed to submit')
    }
  }

  // Auto-save on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    }
  }, [])

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="max-w-md w-full text-center">
          <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: `${brandColor}20` }}>
            <CheckCircle2 className="w-6 h-6" style={{ color: brandColor }} />
          </div>
          <h1 className="text-[20px] font-semibold text-gray-800 mb-2">Submitted!</h1>
          <p className="text-[14px] text-gray-500">
            {confirmationMessage ?? 'Thank you — your responses have been recorded.'}
          </p>
        </div>
      </div>
    )
  }

  const col = schema.columns

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white px-6 py-5">
        <div
          className="mb-1 h-1 w-10 rounded-full"
          style={{ backgroundColor: brandColor }}
        />
        <p className="text-[12px] text-gray-400 mb-1">{programName}</p>
        <h1 className="text-[20px] font-semibold text-gray-900">{formName}</h1>
        {respondentEmail && (
          <p className="text-[12px] text-gray-400 mt-0.5">{respondentEmail}</p>
        )}
      </div>

      <div className="px-6 py-6 max-w-full overflow-x-auto">
        {/* Sheet table */}
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden min-w-max">
          {/* Header row */}
          <div className="flex bg-gray-50 border-b border-gray-200">
            <div className="w-10 flex-shrink-0 px-3 py-2.5 text-[11px] font-medium text-gray-400 border-r border-gray-100" />
            {col.map(c => (
              <div
                key={c.id}
                className="w-44 flex-shrink-0 px-3 py-2.5 text-[12px] font-semibold text-gray-600 border-r border-gray-100 last:border-0"
              >
                {c.label}
                {c.required && <span className="ml-0.5 text-rose-400">*</span>}
              </div>
            ))}
            <div className="w-10 flex-shrink-0" />
          </div>

          {/* Data rows */}
          {rows.map((row, rowIdx) => (
            <div
              key={row.id}
              className="flex border-b border-gray-100 last:border-0 hover:bg-orange-50/30 group transition-colors"
            >
              <div className="w-10 flex-shrink-0 flex items-center justify-center px-3 text-[11px] text-gray-300 border-r border-gray-100">
                {rowIdx + 1}
              </div>
              {col.map(c => (
                <div key={c.id} className="w-44 flex-shrink-0 border-r border-gray-100 last:border-0">
                  {c.type === 'dropdown' ? (
                    <select
                      value={row[c.id] ?? ''}
                      onChange={e => updateCell(rowIdx, c.id, e.target.value)}
                      className="h-full w-full bg-transparent px-3 py-2 text-[13px] text-gray-800 outline-none focus:bg-orange-50"
                    >
                      <option value="">—</option>
                      {(c.options ?? []).map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : 'text'}
                      value={row[c.id] ?? ''}
                      onChange={e => updateCell(rowIdx, c.id, e.target.value)}
                      className="h-full w-full bg-transparent px-3 py-2 text-[13px] text-gray-800 outline-none focus:bg-orange-50"
                    />
                  )}
                </div>
              ))}
              <div className="w-10 flex-shrink-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => deleteRow(rowIdx)}
                  disabled={rows.length === 1}
                  className="text-gray-300 hover:text-rose-400 disabled:opacity-20"
                  title="Delete row"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}

          {/* Add row */}
          <div className="flex border-t border-gray-100">
            <button
              onClick={addRow}
              className="flex items-center gap-2 px-4 py-2.5 text-[12px] text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors w-full"
            >
              <Plus className="h-3.5 w-3.5" />
              Add row
            </button>
          </div>
        </div>

        {/* Footer actions */}
        <div className="mt-5 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[12px] text-gray-400">
            {saving && (
              <>
                <Save className="h-3.5 w-3.5 animate-pulse" />
                Saving draft…
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              className="h-9 text-[13px]"
              onClick={() => saveDraft(rows)}
              disabled={saving}
            >
              <Save className="h-3.5 w-3.5 mr-1.5" />
              Save progress
            </Button>
            <Button
              size="sm"
              className="h-9 text-[13px]"
              style={{ backgroundColor: brandColor }}
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? 'Submitting…' : 'Submit'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
