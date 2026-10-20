import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { sendNewSubmissionEmail } from '@/lib/email'
import type { FormSettings } from '@/types/forms'

const submitSchema = z.object({
  token: z.string().min(1),
  form_id: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
  status: z.enum(['draft', 'submitted']).optional(),
})

// Public: submit a form response via token
export async function POST(request: Request) {
  const service = createServiceClient()

  const body = await request.json()
  const parsed = submitSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 })

  const { token, form_id, data, status = 'submitted' } = parsed.data

  // Validate token
  const { data: tokenRow, error: tokenErr } = await service
    .from('submission_tokens')
    .select('*')
    .eq('token', token)
    .eq('form_id', form_id)
    .single()

  if (tokenErr || !tokenRow) return NextResponse.json({ error: 'Invalid token' }, { status: 403 })
  if (tokenRow.used_at) return NextResponse.json({ error: 'Token already used' }, { status: 409 })
  if (new Date(tokenRow.expires_at) < new Date()) return NextResponse.json({ error: 'Token expired' }, { status: 410 })

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? undefined

  // For draft saves: upsert — update existing draft for this token rather than
  // creating a new row on every "Save progress" click.
  if (status === 'draft') {
    const { data: existingDraft } = await service
      .from('submissions')
      .select('id')
      .eq('token_id', tokenRow.id)
      .eq('form_id', form_id)
      .eq('status', 'draft')
      .maybeSingle()

    if (existingDraft) {
      const { data: updated, error: updateErr } = await service
        .from('submissions')
        .update({ data: data as never })
        .eq('id', existingDraft.id)
        .select()
        .single()
      if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })
      return NextResponse.json(updated, { status: 200 })
    }
  }

  const { data: submission, error } = await service
    .from('submissions')
    .insert({
      form_id,
      token_id: tokenRow.id,
      respondent_email: tokenRow.email,
      data: data as never,
      status,
      submitted_at: status === 'submitted' ? new Date().toISOString() : null,
      ip_address: ip ?? null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Mark token as used only on final submit
  if (status === 'submitted') {
    await service.from('submission_tokens').update({ used_at: new Date().toISOString() }).eq('id', tokenRow.id)

    // Send notification emails if the form has any configured
    const { data: formRow } = await service
      .from('forms')
      .select('name, settings, programs(name)')
      .eq('id', form_id)
      .single()

    const notificationEmails = ((formRow?.settings ?? {}) as FormSettings).notificationEmails ?? []
    if (notificationEmails.length > 0 && formRow) {
      const programName = (formRow.programs as { name: string } | null)?.name ?? 'the program'
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
      const submissionUrl = `${appUrl}/submissions/${submission.id}`
      await Promise.allSettled(
        notificationEmails.map(email =>
          sendNewSubmissionEmail({
            to: email,
            formName: formRow.name,
            programName,
            respondentEmail: tokenRow.email ?? null,
            submissionUrl,
          })
        )
      )
    }
  }

  return NextResponse.json(submission, { status: 201 })
}

// Staff: list submissions for a form or program
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const formId = searchParams.get('form_id')
  const programId = searchParams.get('program_id')
  const status = searchParams.get('status')

  // Resolve which form_ids are in scope.
  // NOTE: filtering via .eq('forms.program_id', ...) on a PostgREST left-join does
  // NOT filter rows — it only nullifies the joined object. We must resolve form IDs
  // explicitly and filter with .in('form_id', ...) to enforce program isolation.
  let scopedFormIds: string[] | null = null
  if (programId && !formId) {
    const { data: programForms } = await supabase
      .from('forms')
      .select('id')
      .eq('program_id', programId)
    scopedFormIds = (programForms ?? []).map(f => f.id)
    // If the program has no forms, return early — no submissions possible
    if (scopedFormIds.length === 0) return NextResponse.json([])
  }

  let query = supabase
    .from('submissions')
    .select('*, forms(name, program_id, settings)')
    .order('submitted_at', { ascending: false })

  if (formId) query = query.eq('form_id', formId)
  if (scopedFormIds) query = query.in('form_id', scopedFormIds)
  // 'flagged' is stored in metadata.flagged, not the status enum
  if (status === 'flagged') {
    query = query.filter('metadata->>flagged', 'eq', 'true')
  } else if (status) {
    // Also exclude flagged items from other status views
    query = query.eq('status', status as 'draft' | 'submitted' | 'reviewed')
      .or('metadata->>flagged.is.null,metadata->>flagged.eq.false')
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Attach effectiveStatus to each row so clients don't need to re-derive it
  const rows = (data ?? []).map(s => {
    const meta = ((s.metadata ?? {}) as Record<string, unknown>)
    return { ...s, effectiveStatus: meta.flagged ? 'flagged' : s.status }
  })
  return NextResponse.json(rows)
}
