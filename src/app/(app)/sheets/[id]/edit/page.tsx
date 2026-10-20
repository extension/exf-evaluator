import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { SheetBuilderClient } from './sheet-builder-client'
import type { FormSettings, SheetSchema } from '@/types/forms'

export default async function SheetEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: form } = await supabase.from('forms').select('*').eq('id', id).single()
  if (!form) notFound()

  const settings = (form.settings ?? {}) as FormSettings
  if (settings.formType !== 'spreadsheet') notFound()

  return (
    <SheetBuilderClient
      sheetId={form.id}
      initialName={form.name}
      initialStatus={form.status}
      initialSettings={settings}
      initialSchema={(form.schema ?? { columns: [] }) as unknown as SheetSchema}
      formSlug={form.slug}
    />
  )
}
