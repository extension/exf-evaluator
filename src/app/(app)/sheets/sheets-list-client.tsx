'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useProgram } from '@/contexts/program-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { TableProperties, Plus, Users, Inbox, ChevronRight, Pencil } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/utils'
import type { FormSettings, SheetSchema } from '@/types/forms'

interface SheetRow {
  id: string
  name: string
  slug: string
  status: string
  settings: FormSettings | null
  schema: SheetSchema | null
  updated_at: string
  submission_count?: number
  invite_count?: number
}

const statusColors: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  draft:  'bg-zinc-50 text-zinc-500 border-zinc-100',
  closed: 'bg-rose-50 text-rose-600 border-rose-100',
}

export function SheetsListClient() {
  const router = useRouter()
  const { currentProgram } = useProgram()
  const [sheets, setSheets] = useState<SheetRow[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  useEffect(() => {
    if (!currentProgram) return
    setLoading(true)
    fetch(`/api/forms?program_id=${currentProgram.id}`)
      .then(r => r.json())
      .then(data => {
        const sheetForms = (data ?? []).filter(
          (f: { settings: FormSettings | null }) =>
            (f.settings as FormSettings | null)?.formType === 'spreadsheet'
        )
        setSheets(sheetForms)
        setLoading(false)
      })
  }, [currentProgram])

  async function createSheet() {
    if (!newName.trim() || !currentProgram) return
    setCreating(true)
    const res = await fetch('/api/forms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        program_id: currentProgram.id,
        name: newName.trim(),
        settings: { formType: 'spreadsheet' },
        schema: { columns: [] },
      }),
    })
    setCreating(false)
    if (res.ok) {
      const sheet = await res.json()
      toast.success('Sheet created')
      router.push(`/sheets/${sheet.id}/edit`)
    } else {
      toast.error('Failed to create sheet')
    }
  }

  return (
    <div className="max-w-4xl px-8 py-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-gray-900">Sheets</h1>
          <p className="mt-0.5 text-[14px] text-gray-500">
            Spreadsheet-style data collectors — assign to respondents, they fill rows over time
          </p>
        </div>
        <Button
          className="h-9 gap-1.5 text-[13px] bg-orange-600 hover:bg-orange-700"
          onClick={() => setShowCreate(v => !v)}
        >
          <Plus className="h-3.5 w-3.5" /> New sheet
        </Button>
      </div>

      {showCreate && (
        <div className="mb-6 rounded-xl border border-orange-200 bg-orange-50 p-4 flex items-end gap-3">
          <div className="flex-1">
            <label className="text-[13px] font-medium text-gray-700 block mb-1.5">Sheet name</label>
            <Input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="e.g. Health Agent Monthly Tracker"
              className="h-9 text-[13px]"
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') createSheet(); if (e.key === 'Escape') setShowCreate(false) }}
            />
          </div>
          <Button
            className="h-9 text-[13px] bg-orange-600 hover:bg-orange-700 flex-shrink-0"
            onClick={createSheet}
            disabled={creating || !newName.trim()}
          >
            {creating ? 'Creating…' : 'Create & edit'}
          </Button>
          <Button variant="ghost" className="h-9 text-[13px]" onClick={() => setShowCreate(false)}>Cancel</Button>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      ) : sheets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-20 text-center">
          <TableProperties className="mx-auto h-8 w-8 text-gray-200 mb-3" />
          <p className="text-[14px] font-medium text-gray-500">No sheets yet</p>
          <p className="text-[13px] text-gray-400 mt-1">
            Create a sheet to assign a spreadsheet-style collector to respondents.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          {sheets.map((sheet, i) => {
            const cols = sheet.schema?.columns?.length ?? 0
            return (
              <div
                key={sheet.id}
                className={cn(
                  'flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors group',
                  i < sheets.length - 1 && 'border-b border-gray-50'
                )}
              >
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-orange-50">
                  <TableProperties className="h-4 w-4 text-orange-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-medium text-gray-800">{sheet.name}</p>
                  <p className="text-[12px] text-gray-400">
                    {cols} column{cols !== 1 ? 's' : ''} · updated {formatDistanceToNow(new Date(sheet.updated_at), { addSuffix: true })}
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize', statusColors[sheet.status] ?? 'bg-gray-50 text-gray-500')}>
                    {sheet.status}
                  </span>
                  <div className="flex items-center gap-1 text-[12px] text-gray-400">
                    <Users className="h-3.5 w-3.5" />
                    <Inbox className="h-3.5 w-3.5 ml-1" />
                  </div>
                  <Button
                    variant="ghost" size="sm"
                    className="h-7 gap-1 text-[12px] opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => router.push(`/sheets/${sheet.id}/edit`)}
                  >
                    <Pencil className="h-3 w-3" /> Edit
                  </Button>
                  <ChevronRight className="h-3.5 w-3.5 text-gray-300 group-hover:text-gray-400" />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
