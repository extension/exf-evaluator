import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { createClient } from '@/lib/supabase/server'
import { logAudit } from '@/lib/audit'
import type { Json } from '@/types/database'

const createFormSchema = z.object({
  program_id: z.string().min(1),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullish().transform(v => v ?? undefined),
  template_id: z.string().min(1).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  schema: z.union([
    z.object({
      pages: z.array(z.object({
        id: z.string(),
        title: z.string(),
        fields: z.array(z.record(z.string(), z.unknown())),
      })),
    }),
    z.object({ columns: z.array(z.record(z.string(), z.unknown())) }),
  ]).optional(),
})

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const programId = searchParams.get('program_id')
  const status = searchParams.get('status')

  let query = supabase.from('forms').select('*').order('updated_at', { ascending: false })
  if (programId) query = query.eq('program_id', programId)
  if (status) query = query.eq('status', status as 'draft' | 'active' | 'closed')

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const service = createServiceClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const parsed = createFormSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 })

  const { name, description, program_id, template_id, schema, settings: initialSettings } = parsed.data

  // Generate a unique slug
  const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  const slug = `${baseSlug}-${Date.now().toString(36)}`

  let formSchema = schema ?? { pages: [{ id: 'page-1', title: 'Page 1', fields: [] }] }

  // If creating from template, copy template schema
  if (template_id) {
    const { data: tpl } = await supabase.from('form_templates').select('schema').eq('id', template_id).single()
    if (tpl?.schema) formSchema = tpl.schema as typeof formSchema
  }

  // Fetch author email for display (no auth.users join needed on reads)
  const { data: userRecord } = await service.auth.admin.getUserById(user.id)
  const authorEmail = userRecord?.user?.email ?? null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (service.from('forms') as any).insert({
    name,
    description,
    program_id,
    template_id,
    slug,
    schema: formSchema as unknown as Json,
    settings: (initialSettings ?? {}) as unknown as Json,
    status: 'draft',
    created_by: user.id,
    author_email: authorEmail,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAudit(service, {
    userId: user.id,
    programId: program_id,
    action: 'form.create',
    entityType: 'form',
    entityId: data.id,
    ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
  })

  return NextResponse.json(data, { status: 201 })
}
