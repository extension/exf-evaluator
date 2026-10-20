import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { SheetsListClient } from './sheets-list-client'

export default async function SheetsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')
  return <SheetsListClient />
}
