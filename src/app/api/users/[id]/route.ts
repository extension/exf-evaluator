import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { logAudit } from '@/lib/audit'
import { sendInviteEmail, sendPasswordResetEmail } from '@/lib/email'

const updateSchema = z.union([
  z.object({ role: z.enum(['super_admin', 'program_admin', 'staff', 'viewer']) }),
  z.object({ action: z.enum(['resend_invite', 'send_reset']) }),
])

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const service = createServiceClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 })

  const { data: existing } = await supabase
    .from('program_memberships')
    .select('program_id, user_id')
    .eq('id', id)
    .single()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Verify the caller has admin rights in this program
  const { data: callerMembership } = await supabase
    .from('program_memberships')
    .select('role')
    .eq('program_id', existing.program_id)
    .eq('user_id', user.id)
    .single()
  const callerRole = callerMembership?.role
  if (callerRole !== 'super_admin' && callerRole !== 'program_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Only super_admins can assign the super_admin role
  if ('role' in parsed.data && parsed.data.role === 'super_admin' && callerRole !== 'super_admin') {
    return NextResponse.json({ error: 'Only super admins can assign the super_admin role' }, { status: 403 })
  }

  // --- Email actions ---
  if ('action' in parsed.data) {
    const { action } = parsed.data

    // Look up the member's email
    const { data: { users } } = await service.auth.admin.listUsers()
    const memberUser = users?.find(u => u.id === existing.user_id)
    if (!memberUser?.email) return NextResponse.json({ error: 'User email not found' }, { status: 404 })

    const { data: program } = await supabase.from('programs').select('name').eq('id', existing.program_id).single()
    const programName = program?.name ?? 'Extension Pulse'

    if (action === 'resend_invite') {
      const { data: linkData, error: linkErr } = await service.auth.admin.generateLink({
        type: 'invite',
        email: memberUser.email,
        options: { redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback` },
      })
      if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 500 })
      await sendInviteEmail({ to: memberUser.email, inviteUrl: linkData.properties.action_link, programName })
    }

    if (action === 'send_reset') {
      const { data: linkData, error: linkErr } = await service.auth.admin.generateLink({
        type: 'recovery',
        email: memberUser.email,
        options: { redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback` },
      })
      if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 500 })
      await sendPasswordResetEmail({ to: memberUser.email, resetUrl: linkData.properties.action_link, programName })
    }

    await logAudit(service, {
      userId: user.id,
      programId: existing.program_id,
      action: action === 'send_reset' ? 'user.password_reset_sent' : 'user.invite_resent',
      entityType: 'program_membership',
      entityId: id,
      ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
    })

    return NextResponse.json({ success: true })
  }

  // --- Role update ---
  const { data, error } = await service
    .from('program_memberships')
    .update({ role: parsed.data.role })
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAudit(service, {
    userId: user.id,
    programId: existing.program_id,
    action: 'user.role_change',
    entityType: 'program_membership',
    entityId: id,
    diff: { role: parsed.data.role } as Record<string, unknown>,
    ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json(data)
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const service = createServiceClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: existing } = await supabase.from('program_memberships').select('program_id').eq('id', id).single()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: callerMembership } = await supabase
    .from('program_memberships')
    .select('role')
    .eq('program_id', existing.program_id)
    .eq('user_id', user.id)
    .single()
  const callerRole = callerMembership?.role
  if (callerRole !== 'super_admin' && callerRole !== 'program_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error } = await service.from('program_memberships').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAudit(service, {
    userId: user.id,
    programId: existing.program_id,
    action: 'user.remove',
    entityType: 'program_membership',
    entityId: id,
    ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
  })

  return new NextResponse(null, { status: 204 })
}
