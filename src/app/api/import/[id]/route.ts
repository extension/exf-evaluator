import { parsePeriod, periodEndDate, isPeriodLabel } from '@/lib/periods'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { logAudit } from '@/lib/audit'
import type { Json } from '@/types/database'

const updateSchema = z.object({
  column_mappings: z.record(z.string(), z.string()).optional(),
  status: z.enum(['pending', 'processing', 'review', 'complete', 'failed']).optional(),
})

/**
 * Normalise a raw string value from a CSV into a proper number.
 * Handles suffixes: 300K → 300000, 1.5M → 1500000, 2B → 2000000000
 * Strips: $, commas, %, leading/trailing whitespace
 * Returns the original string unchanged if it can't be confidently parsed.
 */
function normalizeNumeric(raw: string): number | string {
  const s = raw.trim().replace(/[$,\s]/g, '')
  if (s === '') return raw

  // Suffix multipliers (case-insensitive)
  const suffixes: [RegExp, number][] = [
    [/^(-?\d+\.?\d*)[Bb]$/, 1_000_000_000],
    [/^(-?\d+\.?\d*)[Mm]$/, 1_000_000],
    [/^(-?\d+\.?\d*)[Kk]$/, 1_000],
  ]
  for (const [re, mult] of suffixes) {
    const m = s.match(re)
    if (m) {
      const n = parseFloat(m[1]) * mult
      return isNaN(n) ? raw : n
    }
  }

  // Strip trailing % — store as the numeric value (e.g. 75% → 75)
  const noPercent = s.replace(/%$/, '')
  const n = parseFloat(noPercent)
  if (!isNaN(n) && noPercent !== '') return n

  return raw
}

/**
 * Data-only import: insert submissions into an EXISTING form.
 * column_mappings contains { csvColumn: formFieldId } plus _* internal keys.
 */
/**
 * Per-row submission date. If the row has a Month/Quarter answer (column named
 * "Month", "Quarter" or "Period") the date is the end of that period, so a row never
 * carries the wrong month because of the import-level period setting.
 */
function rowSubmittedAt(row: Record<string, string>, fallbackIso: string): string {
  for (const [col, val] of Object.entries(row)) {
    if (!isPeriodLabel(col)) continue
    const p = parsePeriod(val)
    const end = p ? periodEndDate(p) : null
    if (end) return new Date(`${end}T12:00:00Z`).toISOString()
  }
  return fallbackIso
}

async function importDataToExistingForm(
  service: ReturnType<typeof createServiceClient>,
  job: { id: string; program_id: string; row_count: number | null; preview_data: Json | null },
  columnMappings: Record<string, string>,
  userId: string,
) {
  const targetFormId = columnMappings._target_form_id
  if (!targetFormId) return

  const periodEnd = columnMappings._period_end
  const periodStart = columnMappings._period_start
  const submittedAt = periodEnd
    ? new Date(periodEnd).toISOString()
    : periodStart
      ? new Date(periodStart).toISOString()
      : new Date().toISOString()

  // Only real column→fieldId mappings (skip _* internal keys and "skip" values)
  const colToFieldId: Record<string, string> = {}
  for (const [k, v] of Object.entries(columnMappings)) {
    if (!k.startsWith('_') && v && v !== 'skip') colToFieldId[k] = v
  }

  const allRows = (job.preview_data ?? []) as Record<string, string>[]
  if (allRows.length === 0) return

  const submissions = allRows.map(row => {
    const data: Record<string, unknown> = {}
    for (const [col, fieldId] of Object.entries(colToFieldId)) {
      data[fieldId] = row[col] ?? ''
    }
    // Try to pull respondent email from any column mapped to a field named 'email'
    // (best-effort — no harm if not found)
    const emailCol = Object.entries(colToFieldId).find(([, fid]) => fid.includes('email'))?.[0]
    const respondentEmail = emailCol ? (row[emailCol] ?? null) : null
    return {
      form_id: targetFormId,
      data: data as unknown as Json,
      status: 'submitted' as const,
      submitted_at: rowSubmittedAt(row, submittedAt),
      submitted_by: userId,
      respondent_email: respondentEmail || null,
      metadata: { importJobId: job.id, importedRow: true } as unknown as Json,
    }
  })

  for (let i = 0; i < submissions.length; i += 100) {
    await service.from('submissions').insert(submissions.slice(i, i + 100))
  }
}

async function createFormFromImport(
  service: ReturnType<typeof createServiceClient>,
  job: { id: string; file_name: string; program_id: string; detected_schema: Json | null; row_count: number | null; preview_data: Json | null },
  columnMappings: Record<string, string>,
  userId: string,
  userEmail: string | null,
) {
  const periodType = columnMappings._period_type
  const periodValue = columnMappings._period_value
  const periodStart = columnMappings._period_start
  const periodEnd = columnMappings._period_end

  // Filter out internal _period_ keys to get the actual data column mappings
  const dataFieldEntries = Object.entries(columnMappings).filter(([k]) => !k.startsWith('_period_'))

  // Build field definitions — field id = sanitized column name for stable mapping
  const fields = dataFieldEntries.map(([col, mappedType], idx) => ({
    id: `field-${idx + 1}`,
    label: col,
    type: mappedType === 'skip' ? 'text' : mappedType,
    required: false,
    ...(mappedType === 'skip' ? { hidden: true } : {}),
  }))

  // Map column name → field id for submission creation
  const colToFieldId: Record<string, string> = {}
  dataFieldEntries.forEach(([col], idx) => { colToFieldId[col] = `field-${idx + 1}` })

  const baseName = job.file_name.replace(/\.[^.]+$/, '')
  const periodLabel = periodValue ? ` (${periodValue})` : ''
  const formName = `${baseName}${periodLabel}`
  const slug = `import-${baseName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`

  const formSchema = { pages: [{ id: 'page-1', title: 'Imported Data', fields }] }
  const formSettings = {
    isImported: true,
    importJobId: job.id,
    importedRowCount: job.row_count,
    ...(periodType ? { periodType, periodValue, ...(periodStart ? { periodStart } : {}), ...(periodEnd ? { periodEnd } : {}) } : {}),
  }

  const { data: createdForm, error: formError } = await service.from('forms').insert({
    name: formName,
    program_id: job.program_id,
    slug,
    schema: formSchema as unknown as Json,
    settings: formSettings as unknown as Json,
    status: 'active',
    created_by: userId,
    author_email: userEmail,
  }).select('id').single()

  if (formError || !createdForm) {
    console.error('Failed to create form from import:', formError)
    return
  }

  // Create a submission for every data row in preview_data
  const allRows = (job.preview_data ?? []) as Record<string, string>[]
  if (allRows.length > 0) {
    // Use the period end date as submitted_at so these submissions fall within
    // the correct date range when the report AI filters by submitted_at.
    // Fall back to period start, then today if no period is set.
    const periodSubmittedAt = periodEnd
      ? new Date(periodEnd).toISOString()
      : periodStart
        ? new Date(periodStart).toISOString()
        : new Date().toISOString()
    const submittedAt = periodSubmittedAt
    const submissions = allRows.map(row => {
      // Build data object: { fieldId: value } mapping
      const data: Record<string, unknown> = {}
      for (const [col, fieldId] of Object.entries(colToFieldId)) {
        const mappedType = columnMappings[col]
        if (mappedType === 'skip') continue
        const raw = row[col] ?? ''
        // Normalise numeric-typed fields: "300K" → 300000, "$1,500" → 1500, etc.
        const numericTypes = ['number', 'scale', 'rating', 'nps', 'slider']
        data[fieldId] = numericTypes.includes(mappedType) ? normalizeNumeric(raw) : raw
      }
      // Try to extract respondent email from any email-typed field
      const emailFieldEntry = dataFieldEntries.find(([, t]) => t === 'email')
      const respondentEmail = emailFieldEntry ? (row[emailFieldEntry[0]] ?? null) : null
      return {
        form_id: createdForm.id,
        data: data as unknown as Json,
        status: 'submitted' as const,
        submitted_at: rowSubmittedAt(row, submittedAt),
        submitted_by: userId,
        respondent_email: respondentEmail || null,
        metadata: { importJobId: job.id, importedRow: true } as unknown as Json,
      }
    })

    // Insert in batches of 100 to avoid payload limits
    for (let i = 0; i < submissions.length; i += 100) {
      await service.from('submissions').insert(submissions.slice(i, i + 100))
    }
  }

  // Log separately for the auto-created form
  await logAudit(service, {
    userId,
    programId: job.program_id,
    action: 'form.create',
    entityType: 'form',
    entityId: job.id,
  })
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const service = createServiceClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: job } = await service.from('import_jobs').select('program_id, status').eq('id', id).single()
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // For complete imports, retract what was created
  if (job.status === 'complete') {
    const mappings = ((await service.from('import_jobs').select('column_mappings').eq('id', id).single()).data?.column_mappings ?? {}) as Record<string, string>
    const isDataOnly = mappings._import_mode === 'data_only'

    if (isDataOnly) {
      // Data-only: delete only the submissions that were imported (identified by metadata.importJobId)
      await service.from('submissions').delete().filter('metadata->>importJobId', 'eq', id)
    } else {
      // Full import: find and delete the created form + its submissions
      const { data: forms } = await service
        .from('forms')
        .select('id')
        .filter('settings->>importJobId', 'eq', id)

      for (const form of forms ?? []) {
        await service.from('submissions').delete().eq('form_id', form.id)
        await service.from('forms').delete().eq('id', form.id)
      }
    }
  }

  // Delete the import job record
  const { error } = await service.from('import_jobs').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAudit(service, {
    userId: user.id,
    programId: job.program_id,
    action: 'import.delete',
    entityType: 'import_job',
    entityId: id,
  })

  return NextResponse.json({ success: true })
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase.from('import_jobs').select('*').eq('id', id).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json(data)
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const service = createServiceClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 })

  const { data: job } = await supabase
    .from('import_jobs')
    .select('program_id, file_name, detected_schema, column_mappings, row_count, preview_data')
    .eq('id', id)
    .single()
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  type ImportUpdate = { column_mappings?: Json; status?: 'pending' | 'processing' | 'review' | 'complete' | 'failed' }
  const update: ImportUpdate = {}
  if (parsed.data.column_mappings) update.column_mappings = parsed.data.column_mappings as unknown as Json
  if (parsed.data.status) update.status = parsed.data.status

  const { data, error } = await service.from('import_jobs').update(update).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // When import is confirmed, create form + submissions (full) or just submissions (data-only)
  if (parsed.data.status === 'complete') {
    const finalMappings = (parsed.data.column_mappings ?? (job.column_mappings ?? {})) as Record<string, string>
    const isDataOnly = finalMappings._import_mode === 'data_only'
    if (isDataOnly) {
      await importDataToExistingForm(service, { id, ...job }, finalMappings, user.id).catch(() => {})
    } else {
      await createFormFromImport(service, { id, ...job }, finalMappings, user.id, user.email ?? null).catch(() => {})
    }
  }

  await logAudit(service, {
    userId: user.id,
    programId: job.program_id,
    action: 'import.update',
    entityType: 'import_job',
    entityId: id,
    ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json(data)
}
