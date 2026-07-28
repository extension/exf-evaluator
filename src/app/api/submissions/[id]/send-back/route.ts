import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { sendReturnToEditEmail } from '@/lib/email'
import type { Json } from '@/types/database'

const schema = z.object({
  comment: z.string().min(1).max(2000),
})

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const service = createServiceClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const { comment } = parsed.data

  // Fetch via user-scoped client first to confirm the submission exists AND
  // the user's RLS policies allow them to see it (program membership check).
  const { data: submissionCheck } = await supabase
    .from('submissions')
    .select('id, forms(program_id)')
    .eq('id', id)
    .single()

  if (!submissionCheck) return NextResponse.json({ error: 'Submission not found' }, { status: 404 })

  // Require admin/staff membership — viewers cannot send feedback.
  const programId = (submissionCheck.forms as { program_id: string } | null)?.program_id
  if (programId) {
    const { count: memberCount } = await supabase
      .from('program_memberships')
      .select('*', { count: 'exact', head: true })
      .eq('program_id', programId)
      .eq('user_id', user.id)
      .in('role', ['super_admin', 'program_admin', 'staff'])

    if ((memberCount ?? 0) === 0) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  // Now fetch full details via service client.
  const { data: submission, error: fetchErr } = await service
    .from('submissions')
    .select('id, respondent_email, metadata, token_id, forms(name, slug, program_id, programs(name))')
    .eq('id', id)
    .single()

  if (fetchErr || !submission) return NextResponse.json({ error: 'Submission not found' }, { status: 404 })

  const recipientEmail = submission.respondent_email
  if (!recipientEmail) {
    return NextResponse.json({ error: 'No email address on this submission — cannot send feedback' }, { status: 422 })
  }

  const form = submission.forms as { name: string; slug: string; program_id: string; programs: { name: string } | null } | null
  const formName = form?.name ?? 'your form'
  const programName = form?.programs?.name ?? 'the program'

  // Reopen the token so the respondent can edit again
  let formLink: string | undefined
  if (submission.token_id) {
    const { data: tokenRow } = await service
      .from('submission_tokens')
      .select('token')
      .eq('id', submission.token_id)
      .single()

    if (tokenRow) {
      await service
        .from('submission_tokens')
        .update({ used_at: null })
        .eq('id', submission.token_id)

      formLink = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3002'}/f/${form?.slug}?token=${tokenRow.token}`
    }
  }

  // Reset submission to draft so it's editable again
  await service.from('submissions').update({ status: 'draft' }).eq('id', id)

  // Send the email with the form link + comment
  try {
    await sendReturnToEditEmail({
      to: recipientEmail,
      reviewerName: user.email ?? 'A reviewer',
      formName,
      programName,
      comment,
      formLink,
    })
  } catch (e) {
    console.error('Failed to send return-to-edit email:', e)
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
  }

  // Persist: save comment + returnedAt in metadata
  const existingMeta = ((submission.metadata ?? {}) as Record<string, unknown>)
  await service.from('submissions').update({
    metadata: {
      ...existingMeta,
      reviewerComment: comment,
      feedbackSentAt: new Date().toISOString(),
      feedbackSentBy: user.email ?? user.id,
    } as Json,
  }).eq('id', id)

  return NextResponse.json({ sent: true, to: recipientEmail })
}
