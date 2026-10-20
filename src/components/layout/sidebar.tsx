'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  LayoutDashboard,
  FileText,
  Inbox,
  BarChart3,
  FileBarChart2,
  Settings,
  Users,
  Upload,
  Plug,
  ChevronDown,
  LogOut,
  FolderOpen,
  BookOpen,
  ChevronsUpDown,
  Check,
  ScrollText,
  Sparkles,
  BookMarked,
  Radio,
  PieChart,
  Paperclip,
  TableProperties,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useProgram } from '@/contexts/program-context'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// Sidebar dark background: #18181b (zinc-900)
const SIDEBAR_BG = '#18181b'

interface NavItem {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  children?: { label: string; href: string; icon: React.ComponentType<{ className?: string }> }[]
  roles?: string[]
}

const ADMIN_ROLES = ['super_admin', 'program_admin']
const STAFF_PLUS  = ['super_admin', 'program_admin', 'staff']

const navItems: NavItem[] = [
  { label: 'Dashboard',           href: '/dashboard',   icon: LayoutDashboard, roles: ADMIN_ROLES },
  {
    label: 'Forms',
    href: '/forms',
    icon: FileText,
    roles: ADMIN_ROLES,
    children: [
      { label: 'All Forms',  href: '/forms',           icon: FolderOpen },
      { label: 'Templates',  href: '/forms/templates', icon: BookOpen },
    ],
  },
  { label: 'Sheets',              href: '/sheets',      icon: TableProperties, roles: ADMIN_ROLES },
  { label: 'Submissions',         href: '/submissions', icon: Inbox,        roles: STAFF_PLUS },
  { label: 'Reports',             href: '/reports',     icon: FileBarChart2, roles: ADMIN_ROLES },
  { label: 'Impact Dashboard',    href: '/impact',      icon: BarChart3,     roles: ADMIN_ROLES },
  { label: 'Evaluation Sidekick', href: '/sidekick',    icon: Sparkles,      roles: ADMIN_ROLES },
  { label: 'Data Visualizer',     href: '/visualizer',  icon: PieChart,      roles: STAFF_PLUS },
  { label: 'Pulse',               href: '/pulse',        icon: Radio,         roles: STAFF_PLUS },
  { label: 'Files',               href: '/files',        icon: Paperclip,     roles: ADMIN_ROLES },
]

const settingsItems: NavItem[] = [
  { label: 'Program Settings', href: '/settings/program', icon: Settings, roles: ['super_admin', 'program_admin'] },
  { label: 'Users & Roles', href: '/settings/users', icon: Users, roles: ['super_admin', 'program_admin'] },
  { label: 'Respondent Groups', href: '/settings/groups', icon: Users, roles: ['super_admin', 'program_admin'] },
  { label: 'Import Data', href: '/settings/import', icon: Upload, roles: ['super_admin', 'program_admin'] },
  { label: 'Email Templates', href: '/settings/integrations', icon: Plug, roles: ['super_admin', 'program_admin'] },
  { label: 'Award Context', href: '/settings/narratives', icon: BookOpen, roles: ['super_admin', 'program_admin'] },
  { label: 'Audit Log', href: '/settings/audit', icon: ScrollText, roles: ['super_admin', 'program_admin'] },
  { label: 'User Guide', href: '/guide', icon: BookMarked, roles: ['super_admin', 'program_admin'] },
]

function NavLink({ href, icon: Icon, label, exact = false }: {
  href: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  exact?: boolean
}) {
  const pathname = usePathname()
  const active = exact ? pathname === href : (pathname === href || pathname.startsWith(href + '/'))

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400',
        active
          ? 'bg-zinc-700 text-white'
          : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
      )}
    >
      <Icon aria-hidden="true" className={cn('h-[15px] w-[15px] flex-shrink-0 transition-colors', active ? 'text-white' : 'text-zinc-500 group-hover:text-zinc-300')} />
      {label}
    </Link>
  )
}

export function Sidebar({ userEmail }: { userEmail?: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const { programs, currentProgram, currentRole, setCurrentProgram } = useProgram()
  const [formsOpen, setFormsOpen] = useState(pathname.startsWith('/forms'))

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  const filteredSettings = settingsItems.filter(item =>
    !item.roles || (currentRole && item.roles.includes(currentRole))
  )

  const brandColor = currentProgram?.brand_color ?? '#ea580c'
  const emailPrefix = userEmail?.split('@')[0] ?? ''

  return (
    <aside
      className="flex h-screen w-[220px] flex-shrink-0 flex-col"
      style={{ backgroundColor: SIDEBAR_BG }}
      aria-label="Sidebar"
    >
      {/* Logo */}
      <div className="px-4 pt-5 pb-3">
        <Image
          src="/logo.png"
          alt="Extension Pulse"
          width={160}
          height={45}
          priority
        />
      </div>

      {/* Program switcher */}
      <div className="px-3 pt-1 pb-2">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-zinc-800">
            <div
              className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-white text-[10px] font-bold leading-none"
              style={{ backgroundColor: brandColor }}
            >
              {currentProgram?.name?.slice(0, 2).toUpperCase() ?? 'EX'}
            </div>
            <span className="flex-1 truncate text-left text-[13px] font-semibold text-zinc-100 leading-none">
              {currentProgram?.name ?? 'Select program'}
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 text-zinc-500 flex-shrink-0" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56 ml-1" side="bottom" align="start">
            {programs.map(p => (
              <DropdownMenuItem key={p.id} onClick={() => setCurrentProgram(p)}>
                <div
                  className="mr-2 h-4 w-4 rounded-sm flex items-center justify-center text-white text-[9px] font-bold"
                  style={{ backgroundColor: p.brand_color ?? '#ea580c' }}
                >
                  {p.name.slice(0, 1)}
                </div>
                <span className="flex-1 truncate">{p.name}</span>
                {p.id === currentProgram?.id && <Check className="h-3.5 w-3.5 text-orange-500 ml-1" />}
              </DropdownMenuItem>
            ))}
            {currentRole === 'super_admin' && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push('/settings/programs')}>
                  Manage programs…
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Divider */}
      <div className="mx-3 my-1 border-t border-zinc-800" />

      {/* Main nav */}
      <nav className="no-scrollbar flex-1 overflow-y-auto px-3 py-2 space-y-0.5" aria-label="Main navigation">
        {navItems.filter(item => !item.roles || (currentRole && item.roles.includes(currentRole))).map(item => {
          if (item.children) {
            const isParentActive = pathname.startsWith(item.href)
            return (
              <div key={item.href}>
                <button
                  onClick={() => setFormsOpen(v => !v)}
                  className={cn(
                    'group flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors',
                    isParentActive
                      ? 'text-zinc-200'
                      : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
                  )}
                >
                  <item.icon className={cn('h-[15px] w-[15px] flex-shrink-0', isParentActive ? 'text-zinc-300' : 'text-zinc-500 group-hover:text-zinc-300')} />
                  <span className="flex-1 text-left">{item.label}</span>
                  <ChevronDown className={cn('h-3 w-3 text-zinc-600 transition-transform', formsOpen && 'rotate-180')} />
                </button>
                {formsOpen && (
                  <div className="ml-[26px] mt-0.5 space-y-0.5 border-l border-zinc-700 pl-2.5">
                    {item.children.map(child => (
                      <NavLink key={child.href} href={child.href} icon={child.icon} label={child.label} exact />
                    ))}
                  </div>
                )}
              </div>
            )
          }

          return (
            <NavLink key={item.href} href={item.href} icon={item.icon} label={item.label} />
          )
        })}

        {filteredSettings.length > 0 && (
          <>
            <div className="!my-3 border-t border-zinc-800" />
            <p className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-widest text-zinc-600">
              Settings
            </p>
            {filteredSettings.map(item => (
              <NavLink key={item.href} href={item.href} icon={item.icon} label={item.label} />
            ))}
          </>
        )}
      </nav>

      {/* User footer */}
      <div className="mx-3 mb-4 mt-2">
        <div className="border-t border-zinc-800 mb-3" />
        <DropdownMenu>
          <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-zinc-800">
            <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-zinc-700 text-[11px] font-semibold text-zinc-200">
              {emailPrefix.slice(0, 2).toUpperCase()}
            </div>
            <span className="flex-1 truncate text-left text-[12px] text-zinc-500">{userEmail}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-48">
            <DropdownMenuItem onClick={handleSignOut} className="text-red-500 focus:text-red-500">
              <LogOut className="mr-2 h-3.5 w-3.5" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  )
}
