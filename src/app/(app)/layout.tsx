import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { ProgramProvider } from '@/contexts/program-context'
import { Sidebar } from '@/components/layout/sidebar'
import { Toaster } from '@/components/ui/sonner'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  // Respondents (no program memberships) belong in /my, not the admin area
  const service = createServiceClient()
  const { count } = await service
    .from('program_memberships')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)

  if ((count ?? 0) === 0) redirect('/my')

  return (
    <ProgramProvider>
      {/* Skip to main content — WCAG 2.4.1 */}
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <div className="flex h-screen overflow-hidden bg-[#f7f7f8]">
        <Sidebar userEmail={user.email} />
        <main id="main-content" className="flex-1 overflow-y-auto flex flex-col" tabIndex={-1}>
          <div className="flex-1">
            {children}
          </div>
          <footer className="px-6 py-3 text-center border-t border-gray-100">
            <p className="text-[11px] text-gray-400">
              Extension Pulse is an open source product for Extension Foundation members.
            </p>
          </footer>
        </main>
      </div>
      <Toaster richColors position="bottom-right" />
    </ProgramProvider>
  )
}
