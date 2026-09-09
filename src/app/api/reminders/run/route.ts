import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendTokenEmail } from '@/lib/email'
import type { Json } from '@/types/database'

export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const service = createServiceClient()

  // Fetch all active forms
  const { data: forms, error: formsError } = await service
    .from('forms')
    .select('id, name, slug, settings, program_id, programs(name)')
    .eq('status', 'active')

  if (formsError) return NextResponse.json({ error: formsError.message }, { status: 500 })

  const now = new Date()
  let sent = 0

  for (const form of forms ?? []) {
    const settings = (form.settings ?? {}) as Record<string, unknown>
    const reminderIntervalDays = typeof settings.reminderIntervalDays === 'number' ? settings.reminderIntervalDays : 0
    const reminderMaxCount = typeof settings.reminderMaxCount === 'number' ? settings.reminderMaxCount : 0

    if (reminderIntervalDays <= 0 || reminderMaxCount <= 0) continue

    // Fetch pending tokens for this form
    const { data: tokens } = await service
      .from('submission_tokens')
      .select('id, email, token, expires_at, metadata')
      .eq('form_id', form.id)
      .is('used_at', null)
      .gt('expires_at', now.toISOString())

    for (const tok of tokens ?? []) {
      const meta = (tok.metadata ?? {}) as Record<string, unknown>
      const reminderCount = typeof meta.reminderCount === 'number' ? meta.reminderCount : 0
      const lastReminderAt = typeof meta.lastReminderAt === 'string' ? meta.lastReminderAt : null

      if (reminderCount >= reminderMaxCount) continue

      if (lastReminderAt !== null) {
        const lastDate = new Date(lastReminderAt)
        const msPerDay = 86400000
        const daysSinceLast = (now.getTime() - lastDate.getTime()) / msPerDay
        if (daysSinceLast < reminderIntervalDays) continue
      }

      const programsData = form.programs as { name: string } | null
      const programName = programsData?.name ?? 'Extension Pulse'

      try {
        await sendTokenEmail({
          to: tok.email,
          formName: form.name,
          programName,
          token: tok.token,
          formSlug: form.slug,
          expiresAt: tok.expires_at,
        })

        const updatedMeta: Json = {
          ...(meta as Record<string, Json>),
          reminderCount: reminderCount + 1,
          lastReminderAt: now.toISOString(),
        }

        await service
          .from('submission_tokens')
          .update({ metadata: updatedMeta })
          .eq('id', tok.id)

        sent++
      } catch (e) {
        console.error(`Failed to send reminder to ${tok.email}:`, e)
      }
    }
  }

  return NextResponse.json({ sent })
}
