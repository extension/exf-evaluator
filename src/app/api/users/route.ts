import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { logAudit } from '@/lib/audit'
import { sendInviteEmail, sendWelcomeWithPasswordEmail } from '@/lib/email'

const inviteSchema = z.object({
  program_id: z.string().min(1),
  email: z.string().email(),
  role: z.enum(['super_admin', 'program_admin', 'staff', 'viewer']),
  // 'invite' = magic link (default), 'password' = set a temp password
  mode: z.enum(['invite', 'password']).default('invite'),
  password: z.string().min(8).optional(),
})

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const programId = searchParams.get('program_id')
  if (!programId) return NextResponse.json({ error: 'program_id required' }, { status: 400 })

  const { data: memberships, error } = await supabase
    .from('program_memberships')
    .select('id, role, user_id, created_at')
    .eq('program_id', programId)
    .order('created_at')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Fetch user emails + confirmation status from auth.users via service client
  const service = createServiceClient()
  const userIds = memberships?.map(m => m.user_id) ?? []
  const userMeta: Record<string, { email: string; email_confirmed: boolean; last_sign_in: string | null }> = {}

  if (userIds.length > 0) {
    const { data: { users } } = await service.auth.admin.listUsers()
    users?.forEach(u => {
      userMeta[u.id] = {
        email: u.email ?? '',
        email_confirmed: !!u.email_confirmed_at,
        last_sign_in: u.last_sign_in_at ?? null,
      }
    })
  }

  const result = memberships?.map(m => ({
    ...m,
    email: userMeta[m.user_id]?.email ?? '',
    email_confirmed: userMeta[m.user_id]?.email_confirmed ?? false,
    last_sign_in: userMeta[m.user_id]?.last_sign_in ?? null,
  })) ?? []

  return NextResponse.json(result)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const service = createServiceClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const parsed = inviteSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 })

  const { program_id, email, role, mode, password } = parsed.data

  if (mode === 'password' && !password) {
    return NextResponse.json({ error: 'Password is required in password mode' }, { status: 400 })
  }

  // Verify the caller has admin rights in this program
  const { data: callerMembership } = await supabase
    .from('program_memberships')
    .select('role')
    .eq('program_id', program_id)
    .eq('user_id', user.id)
    .single()
  const callerRole = callerMembership?.role
  const callerIsAdmin = callerRole === 'super_admin' || callerRole === 'program_admin'
  if (!callerIsAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Only super_admins can assign the super_admin role
  if (role === 'super_admin' && callerRole !== 'super_admin') {
    return NextResponse.json({ error: 'Only super admins can assign the super_admin role' }, { status: 403 })
  }

  // Check if user already exists in auth
  const { data: { users: existing } } = await service.auth.admin.listUsers()
  let targetUserId = existing?.find(u => u.email === email)?.id

  // Fetch program name for email copy
  const { data: program } = await supabase.from('programs').select('name').eq('id', program_id).single()
  const programName = program?.name ?? 'Extension Pulse'
  const loginUrl = `${process.env.NEXT_PUBLIC_APP_URL}/auth/login`

  if (!targetUserId) {
    if (mode === 'password') {
      // Create confirmed user with a set password — Supabase sends no email
      const { data: created, error: createErr } = await service.auth.admin.createUser({
        email,
        password: password!,
        email_confirm: true,
      })
      if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 })
      targetUserId = created.user.id

      // Send welcome email with credentials via Mailgun
      await sendWelcomeWithPasswordEmail({ to: email, temporaryPassword: password!, loginUrl, programName }).catch(err => {
        console.error('Welcome email failed:', err)
      })
    } else {
      // Generate an invite link and send it ourselves via Mailgun
      // (avoids Supabase's rate-limited / spam-prone built-in email)
      const { data: linkData, error: linkErr } = await service.auth.admin.generateLink({
        type: 'invite',
        email,
        options: { redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback` },
      })
      if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 500 })
      targetUserId = linkData.user.id

      const inviteUrl = linkData.properties.action_link
      await sendInviteEmail({ to: email, inviteUrl, programName }).catch(err => {
        console.error('Invite email failed:', err)
      })
    }
  }

  // Upsert membership
  const { data, error } = await service.from('program_memberships').upsert({
    program_id,
    user_id: targetUserId,
    role,
  }, { onConflict: 'program_id,user_id' }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAudit(service, {
    userId: user.id,
    programId: program_id,
    action: 'user.invite',
    entityType: 'program_membership',
    entityId: data.id,
    diff: { email, role, mode } as Record<string, unknown>,
    ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json({ ...data, email }, { status: 201 })
}
