import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { sendResendFormEmail } from '@/lib/email'

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const service = createServiceClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // RLS check: confirm user can see this submission
  const { data: submissionCheck } = await supabase
    .from('submissions')
    .select('id, forms(program_id)')
    .eq('id', id)
    .single()
  if (!submissionCheck) return NextResponse.json({ error: 'Submission not found' }, { status: 404 })

  // Require admin or staff membership
  const programId = (submissionCheck.forms as { program_id: string } | null)?.program_id
  if (programId) {
    const { count } = await supabase
      .from('program_memberships')
      .select('*', { count: 'exact', head: true })
      .eq('program_id', programId)
      .eq('user_id', user.id)
      .in('role', ['super_admin', 'program_admin', 'staff'])
    if ((count ?? 0) === 0) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: submission, error: fetchErr } = await service
    .from('submissions')
    .select('id, respondent_email, token_id, forms(name, slug, programs(name))')
    .eq('id', id)
    .single()
  if (fetchErr || !submission) return NextResponse.json({ error: 'Submission not found' }, { status: 404 })

  const recipientEmail = submission.respondent_email
  if (!recipientEmail) {
    return NextResponse.json({ error: 'No email address on this submission — cannot resend' }, { status: 422 })
  }

  const form = submission.forms as { name: string; slug: string; programs: { name: string } | null } | null
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

  // Set submission back to draft
  await service.from('submissions').update({ status: 'draft' }).eq('id', id)

  try {
    await sendResendFormEmail({ to: recipientEmail, formName, programName, formLink })
  } catch (e) {
    console.error('[resend] email error:', e)
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
  }

  return NextResponse.json({ sent: true, to: recipientEmail })
}
