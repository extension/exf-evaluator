'use client'

import { useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ArrowLeft, Eye, EyeOff, Save, Send, BookmarkPlus } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { FieldPalette } from './components/field-palette'
import { InviteDialog } from './components/invite-dialog'
import { InvitesPanel } from './components/invites-panel'
import { FormCanvas } from './components/form-canvas'
import { FieldEditor } from './components/field-editor'
import { FormSettingsPanel } from './components/form-settings-panel'
import { FormPreview } from './components/form-preview'
import type { Database } from '@/types/database'
import type { FormSchema, FormField, FormSettings } from '@/types/forms'

type Form = Database['public']['Tables']['forms']['Row']

interface Props {
  initialForm: Form
}

type RightPanel = 'field' | 'settings' | 'invites'

const statusConfig = {
  active:  { label: 'Active',  className: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  draft:   { label: 'Draft',   className: 'bg-zinc-100 text-zinc-500 border-zinc-200' },
  closed:  { label: 'Closed',  className: 'bg-rose-50 text-rose-600 border-rose-100' },
}

export function FormBuilderClient({ initialForm }: Props) {
  const router = useRouter()
  const [schema, setSchema] = useState<FormSchema>(initialForm.schema as unknown as FormSchema)
  const [settings, setSettings] = useState<FormSettings>((initialForm.settings as unknown as FormSettings) ?? {})
  const [formName, setFormName] = useState(initialForm.name)
  const [status, setStatus] = useState(initialForm.status)
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null)
  const [currentPageIndex, setCurrentPageIndex] = useState(0)
  const [rightPanel, setRightPanel] = useState<RightPanel>('field')
  const [previewMode, setPreviewMode] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Always points to the latest save function — fixes the stale-closure
  // bug that occurs when markDirty is memoised with an empty dep array.
  const saveRef = useRef<() => void>(() => {})

  const currentPage = schema.pages[currentPageIndex] ?? schema.pages[0]

  const selectedField = currentPage?.fields.find(f => f.id === selectedFieldId) ?? null

  async function save(showToast = true) {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    setSaving(true)
    const res = await fetch(`/api/forms/${initialForm.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: formName, schema, settings }),
    })
    setSaving(false)
    if (res.ok) {
      setDirty(false)
      setSavedAt(new Date())
      if (showToast) toast.success('Saved')
    } else {
      toast.error('Failed to save')
    }
  }

  // Update ref on every render so the debounced callback always calls
  // the current version of save() with up-to-date state.
  saveRef.current = () => save(false)

  const markDirty = useCallback(() => {
    setDirty(true)
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => saveRef.current(), 2000)
  }, []) // saveRef is a ref — safe to omit from deps

  function openTemplateDialog() {
    setTemplateName(formName)
    setTemplateDialogOpen(true)
  }

  async function handleSaveAsTemplate(e: React.FormEvent) {
    e.preventDefault()
    if (!templateName.trim()) return
    setSavingTemplate(true)
    const res = await fetch('/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: templateName.trim(),
        program_id: initialForm.program_id,
        schema: schema as unknown as Record<string, unknown>,
      }),
    })
    setSavingTemplate(false)
    if (res.ok) {
      setTemplateDialogOpen(false)
      toast.success('Saved as template')
    } else {
      const err = await res.json().catch(() => ({}))
      toast.error(typeof err.error === 'string' ? err.error : 'Failed to save template')
    }
  }

  async function handlePublish() {
    if (!settings.periodType) {
      toast.error('A reporting period is required before publishing. Set it in the Settings tab.')
      return
    }
    await save(false)
    const res = await fetch(`/api/forms/${initialForm.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    })
    if (res.ok) {
      setStatus('active')
      toast.success('Form published')
    } else {
      toast.error('Failed to publish')
    }
  }

  function updateSchema(updater: (prev: FormSchema) => FormSchema) {
    setSchema(prev => {
      const next = updater(prev)
      markDirty()
      return next
    })
  }

  function updateField(fieldId: string, updates: Partial<FormField>) {
    updateSchema(prev => ({
      ...prev,
      pages: prev.pages.map((page, i) =>
        i !== currentPageIndex ? page : {
          ...page,
          fields: page.fields.map(f => f.id === fieldId ? { ...f, ...updates } : f),
        }
      ),
    }))
  }

  function deleteField(fieldId: string) {
    if (selectedFieldId === fieldId) setSelectedFieldId(null)
    updateSchema(prev => ({
      ...prev,
      pages: prev.pages.map((page, i) =>
        i !== currentPageIndex ? page : {
          ...page,
          fields: page.fields.filter(f => f.id !== fieldId),
        }
      ),
    }))
  }

  function addPage() {
    const newPage = { id: `page-${Date.now()}`, title: `Page ${schema.pages.length + 1}`, fields: [] }
    updateSchema(prev => ({ ...prev, pages: [...prev.pages, newPage] }))
    setCurrentPageIndex(schema.pages.length)
  }

  function deletePage(index: number) {
    if (schema.pages.length <= 1) return
    updateSchema(prev => ({
      ...prev,
      pages: prev.pages.filter((_, i) => i !== index),
    }))
    setCurrentPageIndex(Math.min(index, schema.pages.length - 2))
  }

  function updatePageTitle(index: number, title: string) {
    updateSchema(prev => ({
      ...prev,
      pages: prev.pages.map((p, i) => i === index ? { ...p, title } : p),
    }))
  }

  function moveFieldToPage(fieldId: string, targetPageIndex: number) {
    updateSchema(prev => {
      const field = prev.pages[currentPageIndex]?.fields.find(f => f.id === fieldId)
      if (!field) return prev
      return {
        ...prev,
        pages: prev.pages.map((page, i) => {
          if (i === currentPageIndex) return { ...page, fields: page.fields.filter(f => f.id !== fieldId) }
          if (i === targetPageIndex) return { ...page, fields: [...page.fields, field] }
          return page
        }),
      }
    })
    if (selectedFieldId === fieldId) setSelectedFieldId(null)
  }

  const cfg = statusConfig[status]

  if (previewMode) {
    return (
      <div className="flex h-screen flex-col">
        <div className="flex items-center justify-between border-b bg-white px-5 py-3">
          <span className="text-[14px] font-medium text-gray-700">Preview — {formName}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPreviewMode(false)}
            className="gap-1.5 text-[13px]"
            aria-label="Exit preview mode"
          >
            <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
            Exit preview
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto bg-gray-50">
          <FormPreview schema={schema} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Top bar */}
      <header className="flex h-12 flex-shrink-0 items-center justify-between border-b bg-white px-4 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={() => router.push('/forms')}
            aria-label="Back to forms"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <input
            value={formName}
            onChange={e => { setFormName(e.target.value); markDirty() }}
            className="text-[14px] font-semibold text-gray-800 bg-transparent border-none outline-none focus:ring-0 truncate min-w-0 w-full max-w-xs"
            aria-label="Form name"
          />
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium flex-shrink-0 ${cfg.className}`}>
            {cfg.label}
          </span>
          {saving && <span className="text-[12px] text-gray-400 flex-shrink-0" aria-live="polite">Saving…</span>}
          {!saving && dirty && <span className="text-[12px] text-amber-500 flex-shrink-0" aria-live="polite">Unsaved changes</span>}
          {!saving && !dirty && savedAt && (
            <span className="text-[12px] text-gray-400 flex-shrink-0" aria-live="polite">
              Saved {savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-[13px] h-8"
            onClick={() => setPreviewMode(true)}
            aria-label="Preview form"
          >
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            Preview
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-[13px] h-8"
            onClick={openTemplateDialog}
            aria-label="Save as template"
          >
            <BookmarkPlus className="h-3.5 w-3.5" aria-hidden="true" />
            Template
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-[13px] h-8"
            onClick={() => save()}
            disabled={saving}
            aria-label="Save form"
          >
            <Save className="h-3.5 w-3.5" aria-hidden="true" />
            Save
          </Button>
          {status === 'active' && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-[13px] h-8"
              onClick={() => setInviteOpen(true)}
              aria-label="Invite respondents"
            >
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
              Invite
            </Button>
          )}
          {status !== 'active' && (
            <Button
              size="sm"
              className="bg-orange-600 hover:bg-orange-700 text-[13px] h-8"
              onClick={handlePublish}
            >
              Publish
            </Button>
          )}
        </div>
      </header>

      <InviteDialog
        formId={initialForm.id}
        formName={formName}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
      />

      <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
        <DialogContent className="sm:max-w-sm" aria-describedby="template-desc">
          <DialogHeader>
            <DialogTitle>Save as template</DialogTitle>
            <p id="template-desc" className="text-[13px] text-muted-foreground mt-1">
              This form&apos;s fields will be saved as a reusable template for your program.
            </p>
          </DialogHeader>
          <form onSubmit={handleSaveAsTemplate} id="save-template-form" className="py-2">
            <label htmlFor="template-name" className="text-[13px] font-medium text-gray-700 block mb-1.5">
              Template name <span aria-hidden="true" className="text-red-500">*</span>
            </label>
            <Input
              id="template-name"
              value={templateName}
              onChange={e => setTemplateName(e.target.value)}
              placeholder="e.g. Post-Event Survey"
              required
              autoFocus
              className="h-9 text-[13px]"
            />
          </form>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTemplateDialogOpen(false)} disabled={savingTemplate}>Cancel</Button>
            <Button
              type="submit"
              form="save-template-form"
              className="bg-orange-600 hover:bg-orange-700"
              disabled={savingTemplate || !templateName.trim()}
              aria-busy={savingTemplate}
            >
              {savingTemplate ? 'Saving…' : 'Save template'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Three-panel builder */}
      <div className="flex flex-1 overflow-hidden" role="main" aria-label="Form builder">
        {/* Left: Field palette */}
        <aside
          className="w-[220px] flex-shrink-0 overflow-y-auto border-r bg-white"
          aria-label="Field type palette"
        >
          <FieldPalette
            onAddField={(field) => {
              updateSchema(prev => ({
                ...prev,
                pages: prev.pages.map((page, i) =>
                  i !== currentPageIndex ? page : {
                    ...page,
                    fields: [...page.fields, field],
                  }
                ),
              }))
              setSelectedFieldId(field.id)
              setRightPanel('field')
            }}
          />
        </aside>

        {/* Center: Canvas */}
        <div className="flex flex-1 flex-col overflow-hidden bg-[#f7f7f8]">
          {/* Page navigator */}
          <nav
            className="flex items-center gap-1.5 border-b bg-white px-4 py-2 overflow-x-auto"
            aria-label="Form pages"
          >
            {schema.pages.map((page, i) => (
              <button
                key={page.id}
                onClick={() => { setCurrentPageIndex(i); setSelectedFieldId(null) }}
                className={`flex-shrink-0 rounded-md px-3 py-1 text-[12px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${
                  i === currentPageIndex
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-500 hover:bg-gray-100'
                }`}
                aria-current={i === currentPageIndex ? 'page' : undefined}
              >
                {page.title}
              </button>
            ))}
            <button
              onClick={addPage}
              className="flex-shrink-0 rounded-md px-3 py-1 text-[12px] text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
              aria-label="Add new page"
            >
              + Add page
            </button>
          </nav>

          <div className="flex-1 overflow-y-auto">
            <FormCanvas
              page={currentPage}
              selectedFieldId={selectedFieldId}
              onSelectField={(id) => {
                setSelectedFieldId(id)
                setRightPanel('field')
              }}
              onReorderFields={(fields) => {
                updateSchema(prev => ({
                  ...prev,
                  pages: prev.pages.map((p, i) => i === currentPageIndex ? { ...p, fields } : p),
                }))
              }}
              onDeleteField={deleteField}
              onAddPage={addPage}
              onUpdatePageTitle={(title) => updatePageTitle(currentPageIndex, title)}
              isOnlyPage={schema.pages.length === 1}
              onDeletePage={() => deletePage(currentPageIndex)}
              onAddField={(field) => {
                updateSchema(prev => ({
                  ...prev,
                  pages: prev.pages.map((page, i) =>
                    i !== currentPageIndex ? page : {
                      ...page,
                      fields: [...page.fields, field],
                    }
                  ),
                }))
                setSelectedFieldId(field.id)
                setRightPanel('field')
              }}
              allPages={schema.pages}
              currentPageIndex={currentPageIndex}
              onMoveFieldToPage={moveFieldToPage}
            />
          </div>
        </div>

        {/* Right: Field editor / Settings */}
        <aside
          className="w-[280px] flex-shrink-0 border-l bg-white overflow-y-auto"
          aria-label={rightPanel === 'settings' ? 'Form settings' : 'Field editor'}
        >
          <div className="border-b px-3 py-2">
            <div className="flex rounded-lg bg-gray-100 p-0.5" role="tablist">
              {(['field', 'settings', 'invites'] as const).map(panel => (
                <button
                  key={panel}
                  role="tab"
                  aria-selected={rightPanel === panel}
                  aria-controls={`panel-${panel}`}
                  onClick={() => setRightPanel(panel)}
                  className={`flex-1 rounded-md py-1 text-[12px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 capitalize ${
                    rightPanel === panel ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {panel === 'invites' ? 'Invites' : panel.charAt(0).toUpperCase() + panel.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div id="panel-field" role="tabpanel" hidden={rightPanel !== 'field'}>
            <FieldEditor
              field={selectedField}
              allFields={currentPage?.fields ?? []}
              allPages={schema.pages}
              onUpdate={(updates) => selectedField && updateField(selectedField.id, updates)}
              onDelete={() => selectedField && deleteField(selectedField.id)}
            />
          </div>
          <div id="panel-settings" role="tabpanel" hidden={rightPanel !== 'settings'}>
            <FormSettingsPanel
              settings={settings}
              onUpdate={(updates) => {
                setSettings(prev => ({ ...prev, ...updates }))
                markDirty()
              }}
            />
          </div>
          <div id="panel-invites" role="tabpanel" className="flex flex-col h-full" hidden={rightPanel !== 'invites'}>
            <InvitesPanel formId={initialForm.id} formSlug={initialForm.slug} />
          </div>
        </aside>
      </div>
    </div>
  )
}
