'use client'

import { useEffect, useState } from 'react'
import { useProgram } from '@/contexts/program-context'
import { createClient } from '@/lib/supabase/client'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { FileText, Inbox, TrendingUp, ArrowUpRight } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import Link from 'next/link'
import { cn } from '@/lib/utils'

interface Stats {
  activeForms: number
  totalSubmissions: number
  submissionsThisMonth: number
}

export function DashboardClient({ userId }: { userId?: string }) {
  const { currentProgram, loading: programLoading } = useProgram()
  const [stats, setStats] = useState<Stats | null>(null)
  const [recentForms, setRecentForms] = useState<{ id: string; name: string; status: string; updated_at: string }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!currentProgram) { setLoading(false); return }
    setStats(null)
    setRecentForms([])
    setLoading(true)

    async function fetchStats() {
      if (!currentProgram) return
      const supabase = createClient()
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()

      // Fetch forms for this program first — used for counts and recent list.
      // All submission counts must be scoped to this program's form IDs to avoid
      // cross-program data leakage (filtering via joined table columns is unreliable
      // in PostgREST without !inner, and even then can be unpredictable).
      const [{ count: activeForms }, { data: forms }] = await Promise.all([
        supabase.from('forms').select('*', { count: 'exact', head: true })
          .eq('program_id', currentProgram.id).eq('status', 'active'),
        supabase.from('forms').select('id, name, status, updated_at')
          .eq('program_id', currentProgram.id)
          .order('updated_at', { ascending: false })
          .limit(6),
      ])

      const formIds = (forms ?? []).map(f => f.id)

      let totalSubs = 0
      let monthSubs = 0
      if (formIds.length > 0) {
        const [{ count: t }, { count: m }] = await Promise.all([
          supabase.from('submissions').select('*', { count: 'exact', head: true })
            .in('form_id', formIds).eq('status', 'submitted'),
          supabase.from('submissions').select('*', { count: 'exact', head: true })
            .in('form_id', formIds).eq('status', 'submitted').gte('submitted_at', monthStart),
        ])
        totalSubs = t ?? 0
        monthSubs = m ?? 0
      }

      setStats({ activeForms: activeForms ?? 0, totalSubmissions: totalSubs, submissionsThisMonth: monthSubs })
      setRecentForms(forms ?? [])
      setLoading(false)
    }

    fetchStats()
  }, [currentProgram])

  if (programLoading || loading) {
    return (
      <div className="p-8 space-y-6 max-w-5xl">
        <div className="space-y-1">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="grid grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  if (!currentProgram) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-[15px] font-medium">No programs assigned</p>
          <p className="text-sm text-muted-foreground">Contact your administrator to get access.</p>
        </div>
      </div>
    )
  }

  const kpis = [
    {
      label: 'Active Forms',
      value: stats?.activeForms ?? 0,
      icon: FileText,
      href: '/forms',
      color: 'text-blue-500',
      bg: 'bg-blue-50',
    },
    {
      label: 'Total Submissions',
      value: stats?.totalSubmissions ?? 0,
      icon: Inbox,
      href: '/submissions',
      color: 'text-emerald-500',
      bg: 'bg-emerald-50',
    },
    {
      label: 'This Month',
      value: stats?.submissionsThisMonth ?? 0,
      icon: TrendingUp,
      href: '/submissions',
      color: 'text-orange-500',
      bg: 'bg-orange-50',
    },
  ]

  const statusColors: Record<string, string> = {
    active: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    draft: 'bg-zinc-50 text-zinc-500 border-zinc-100',
    closed: 'bg-rose-50 text-rose-600 border-rose-100',
  }

  return (
    <div className="max-w-5xl px-8 py-8 space-y-8">

      {/* Header */}
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight text-gray-900">
          {currentProgram.name}
        </h1>
        <p className="mt-0.5 text-[14px] text-gray-500">{currentProgram.description ?? 'Program dashboard'}</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {kpis.map(kpi => (
          <Link key={kpi.label} href={kpi.href}>
            <div className="group rounded-xl border border-gray-100 bg-white p-5 shadow-sm hover:shadow-md transition-all">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[12px] font-medium uppercase tracking-wide text-gray-400">{kpi.label}</p>
                  <p className="mt-2 text-[32px] font-semibold leading-none tracking-tight text-gray-900">
                    {kpi.value.toLocaleString()}
                  </p>
                </div>
                <div className={cn('rounded-lg p-2', kpi.bg)}>
                  <kpi.icon className={cn('h-4 w-4', kpi.color)} />
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Recent forms */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[15px] font-semibold text-gray-900">Recent Forms</h2>
          <Link
            href="/forms"
            className="flex items-center gap-1 text-[13px] font-medium text-orange-600 hover:text-orange-700 transition-colors"
          >
            View all <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {recentForms.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">
            <FileText className="mx-auto h-8 w-8 text-gray-200 mb-3" />
            <p className="text-[14px] font-medium text-gray-500">No forms yet</p>
            <p className="text-[13px] text-gray-400 mt-0.5">
              <Link href="/forms" className="text-orange-600 hover:underline">Create your first form</Link> to get started.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
            {recentForms.map((form, i) => (
              <Link key={form.id} href={`/forms/${form.id}/edit`}>
                <div className={cn(
                  'flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors',
                  i < recentForms.length - 1 && 'border-b border-gray-50'
                )}>
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-50">
                      <FileText className="h-3.5 w-3.5 text-gray-400" />
                    </div>
                    <span className="text-[14px] font-medium text-gray-800">{form.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[12px] text-gray-400">
                      {formatDistanceToNow(new Date(form.updated_at), { addSuffix: true })}
                    </span>
                    <span className={cn(
                      'rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize',
                      statusColors[form.status] ?? 'bg-gray-50 text-gray-500'
                    )}>
                      {form.status}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
