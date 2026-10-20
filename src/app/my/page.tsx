import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { RespondentPortal } from './respondent-portal'

export default async function MySubmissionsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login?next=/my')

  // If this user has program memberships they belong in the admin area, not here
  const { count } = await supabase
    .from('program_memberships')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
  if ((count ?? 0) > 0) redirect('/dashboard')

  return <RespondentPortal userEmail={user.email ?? ''} />
}
