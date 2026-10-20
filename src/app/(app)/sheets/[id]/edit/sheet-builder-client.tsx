'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  ArrowLeft, Plus, Trash2, Save, GripVertical, ChevronDown, ChevronUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { InvitesPanel } from '@/app/(app)/forms/[id]/edit/components/invites-panel'
import { InviteDialog } from '@/app/(app)/forms/[id]/edit/components/invite-dialog'
import type { FormSettings, SheetColumn, SheetColumnType, SheetSchema } from '@/types/forms'

const COLUMN_TYPE_LABELS: Record<SheetColumnType, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  dropdown: 'Dropdown',
}

const statusConfig = {
  active: { label: 'Active', className: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  draft:  { label: 'Draft',  className: 'bg-zinc-100 text-zinc-500 border-zinc-200' },
  closed: { label: 'Closed', className: 'bg-rose-50 text-rose-600 border-rose-100' },
}

interface Props {
  sheetId: string
  initialName: string
  initialStatus: string
  initialSettings: FormSettings
  initialSchema: SheetSchema
  formSlug: string
}

type TabValue = 'columns' | 'settings' | 'invites'

function ColumnRow({
  col,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: {
  col: SheetColumn
  onUpdate: (updated: SheetColumn) => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  isFirst: boolean
  isLast: boolean
}) {
  const [optionInput, setOptionInput] = useState('')

  function addOption() {
    const trimmed = optionInput.trim()
    if (!trimmed) return
    onUpdate({ ...col, options: [...(col.options ?? []), trimmed] })
    setOptionInput('')
  }

  function removeOption(idx: number) {
    onUpdate({ ...col, options: (col.options ?? []).filter((_, i) => i !== idx) })
  }

  return (
    <div className="rounded-lg border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="mt-2 flex flex-col gap-0.5">
          <button
            className="text-gray-300 hover:text-gray-500 disabled:opacity-30"
            disabled={isFirst}
            onClick={onMoveUp}
            title="Move up"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <GripVertical className="h-3.5 w-3.5 text-gray-200" />
          <button
            className="text-gray-300 hover:text-gray-500 disabled:opacity-30"
            disabled={isLast}
            onClick={onMoveDown}
            title="Move down"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex-1 space-y-2.5">
          <div className="flex items-center gap-2">
            <Input
              value={col.label}
              onChange={e => onUpdate({ ...col, label: e.target.value })}
              placeholder="Column label"
              className="h-8 flex-1 text-[13px]"
            />
            <Select
              value={col.type}
              onValueChange={val => onUpdate({ ...col, type: val as SheetColumnType, options: val === 'dropdown' ? (col.options ?? []) : undefined })}
            >
              <SelectTrigger className="h-8 w-[130px] text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(COLUMN_TYPE_LABELS) as SheetColumnType[]).map(t => (
                  <SelectItem key={t} value={t} className="text-[13px]">
                    {COLUMN_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-1.5 text-[12px] text-gray-500 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={col.required ?? false}
                onChange={e => onUpdate({ ...col, required: e.target.checked })}
                className="rounded border-gray-300 text-orange-500"
              />
              Required
            </label>
          </div>

          {col.type === 'dropdown' && (
            <div className="pl-0.5">
              <p className="text-[11px] font-medium text-gray-500 mb-1.5">Dropdown options</p>
              <div className="flex flex-wrap gap-1 mb-2">
                {(col.options ?? []).map((opt, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-[11px] text-orange-700"
                  >
                    {opt}
                    <button
                      onClick={() => removeOption(idx)}
                      className="hover:text-orange-900"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  value={optionInput}
                  onChange={e => setOptionInput(e.target.value)}
                  placeholder="Add option…"
                  className="h-7 flex-1 text-[12px]"
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addOption() } }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[12px]"
                  onClick={addOption}
                  disabled={!optionInput.trim()}
                >
                  Add
                </Button>
              </div>
            </div>
          )}
        </div>

        <button
          onClick={onDelete}
          className="mt-1 text-gray-300 hover:text-rose-500 transition-colors"
          title="Delete column"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

export function SheetBuilderClient({
  sheetId,
  initialName,
  initialStatus,
  initialSettings,
  initialSchema,
  formSlug,
}: Props) {
  const router = useRouter()
  const [sheetName, setSheetName] = useState(initialName)
  const [status, setStatus] = useState(initialStatus)
  const [settings, setSettings] = useState<FormSettings>(initialSettings)
  const [schema, setSchema] = useState<SheetSchema>(initialSchema)
  const [tab, setTab] = useState<TabValue>('columns')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const save = useCallback(async (showToast = true) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    setSaving(true)
    const res = await fetch(`/api/forms/${sheetId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: sheetName, schema, settings: { ...settings, status } }),
    })
    setSaving(false)
    if (res.ok) {
      setDirty(false)
      if (showToast) toast.success('Saved')
    } else {
      toast.error('Failed to save')
    }
  }, [sheetId, sheetName, schema, settings, status])

  function markDirty() {
    setDirty(true)
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => save(false), 2000)
  }

  function addColumn() {
    const newCol: SheetColumn = {
      id: `col-${Date.now()}`,
      label: '',
      type: 'text',
    }
    setSchema(s => ({ columns: [...s.columns, newCol] }))
    markDirty()
  }

  function updateColumn(idx: number, updated: SheetColumn) {
    setSchema(s => {
      const cols = [...s.columns]
      cols[idx] = updated
      return { columns: cols }
    })
    markDirty()
  }

  function deleteColumn(idx: number) {
    setSchema(s => ({ columns: s.columns.filter((_, i) => i !== idx) }))
    markDirty()
  }

  function moveColumn(idx: number, dir: 'up' | 'down') {
    setSchema(s => {
      const cols = [...s.columns]
      const target = dir === 'up' ? idx - 1 : idx + 1
      if (target < 0 || target >= cols.length) return s;
      [cols[idx], cols[target]] = [cols[target], cols[idx]]
      return { columns: cols }
    })
    markDirty()
  }

  const statusCfg = statusConfig[status as keyof typeof statusConfig] ?? statusConfig.draft

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      {/* Top bar */}
      <div className="flex h-14 flex-shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-4">
        <button
          onClick={() => router.push('/sheets')}
          className="flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Sheets
        </button>
        <Separator orientation="vertical" className="h-5" />
        <input
          value={sheetName}
          onChange={e => { setSheetName(e.target.value); markDirty() }}
          className="flex-1 bg-transparent text-[15px] font-semibold text-gray-800 outline-none placeholder:text-gray-300"
          placeholder="Sheet name"
        />

        <div className="flex items-center gap-2 ml-auto">
          <Select
            value={status}
            onValueChange={val => { if (val) { setStatus(val); markDirty() } }}
          >
            <SelectTrigger className="h-7 w-[100px] text-[12px] border-0 bg-transparent p-0 focus:ring-0">
              <Badge
                variant="outline"
                className={cn('cursor-pointer text-[11px] font-medium', statusCfg.className)}
              >
                {statusCfg.label}
              </Badge>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(statusConfig).map(([val, cfg]) => (
                <SelectItem key={val} value={val} className="text-[13px]">
                  {cfg.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {dirty && (
            <span className="text-[11px] text-gray-400">Unsaved changes</span>
          )}

          <Button
            size="sm"
            className="h-8 gap-1.5 text-[13px] bg-orange-600 hover:bg-orange-700"
            onClick={() => save(true)}
            disabled={saving}
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Saving…' : 'Save'}
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="h-8 text-[13px]"
            onClick={() => setInviteOpen(true)}
          >
            Invite respondent
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left — tab content */}
        <div className="flex-1 overflow-y-auto p-6">
          <Tabs value={tab} onValueChange={v => setTab(v as TabValue)}>
            <TabsList className="mb-5">
              <TabsTrigger value="columns" className="text-[13px]">Columns</TabsTrigger>
              <TabsTrigger value="settings" className="text-[13px]">Settings</TabsTrigger>
              <TabsTrigger value="invites" className="text-[13px]">Invites</TabsTrigger>
            </TabsList>
          </Tabs>

          {tab === 'columns' && (
            <div className="max-w-2xl space-y-3">
              {schema.columns.length === 0 && (
                <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">
                  <p className="text-[14px] font-medium text-gray-400">No columns yet</p>
                  <p className="text-[13px] text-gray-300 mt-1">Add a column to define what data respondents will enter.</p>
                </div>
              )}
              {schema.columns.map((col, idx) => (
                <ColumnRow
                  key={col.id}
                  col={col}
                  isFirst={idx === 0}
                  isLast={idx === schema.columns.length - 1}
                  onUpdate={updated => updateColumn(idx, updated)}
                  onDelete={() => deleteColumn(idx)}
                  onMoveUp={() => moveColumn(idx, 'up')}
                  onMoveDown={() => moveColumn(idx, 'down')}
                />
              ))}
              <Button
                variant="outline"
                className="h-9 w-full gap-2 border-dashed text-[13px] text-gray-500 hover:text-gray-700"
                onClick={addColumn}
              >
                <Plus className="h-4 w-4" />
                Add column
              </Button>
            </div>
          )}

          {tab === 'settings' && (
            <div className="max-w-lg space-y-5">
              <div>
                <label className="block text-[13px] font-medium text-gray-700 mb-1.5">Sheet name</label>
                <Input
                  value={sheetName}
                  onChange={e => { setSheetName(e.target.value); markDirty() }}
                  className="h-9 text-[13px]"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-gray-700 mb-1.5">Folder</label>
                <Input
                  value={settings.folder ?? ''}
                  onChange={e => { setSettings(s => ({ ...s, folder: e.target.value || undefined })); markDirty() }}
                  placeholder="e.g. Health Agents"
                  className="h-9 text-[13px]"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-gray-700 mb-1.5">Status</label>
                <Select value={status} onValueChange={val => { if (val) { setStatus(val); markDirty() } }}>
                  <SelectTrigger className="h-9 text-[13px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(statusConfig).map(([val, cfg]) => (
                      <SelectItem key={val} value={val} className="text-[13px]">
                        {cfg.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {tab === 'invites' && (
            <div className="max-w-3xl">
              <InvitesPanel formId={sheetId} formSlug={formSlug} />
            </div>
          )}
        </div>

        {/* Right — column preview */}
        {tab === 'columns' && schema.columns.length > 0 && (
          <div className="w-72 flex-shrink-0 border-l border-gray-100 bg-white p-5 overflow-y-auto">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-4">
              Preview
            </p>
            <div className="rounded-lg border border-gray-100 overflow-hidden text-[12px]">
              <div className="flex bg-gray-50 border-b border-gray-100">
                <div className="w-8 flex-shrink-0 px-2 py-2 text-gray-400 font-medium border-r border-gray-100">#</div>
                {schema.columns.map(col => (
                  <div key={col.id} className="flex-1 min-w-0 px-2 py-2 font-medium text-gray-600 border-r border-gray-100 last:border-0 truncate">
                    {col.label || <span className="text-gray-300 italic">Untitled</span>}
                  </div>
                ))}
              </div>
              {[1, 2].map(row => (
                <div key={row} className="flex border-b border-gray-50 last:border-0">
                  <div className="w-8 flex-shrink-0 px-2 py-2 text-gray-300 border-r border-gray-50">{row}</div>
                  {schema.columns.map(col => (
                    <div key={col.id} className="flex-1 min-w-0 px-2 py-2 text-gray-300 border-r border-gray-50 last:border-0">
                      {col.type === 'dropdown' && col.options?.[0]
                        ? <span className="text-gray-200">{col.options[0]}</span>
                        : col.type === 'date' ? '—'
                        : col.type === 'number' ? '0'
                        : '…'
                      }
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        formId={sheetId}
        formName={sheetName}
      />
    </div>
  )
}
