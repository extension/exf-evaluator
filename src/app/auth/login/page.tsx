'use client'

import { Suspense, useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function LoginForm() {
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [usePassword, setUsePassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nextUrl = searchParams.get('next') ?? '/dashboard'

  useEffect(() => {
    const pre = searchParams.get('email')
    if (pre) setEmail(pre)
  }, [searchParams])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()

    if (usePassword) {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setError(error.message)
        setLoading(false)
      } else {
        window.location.href = nextUrl
      }
      return
    }

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent(nextUrl)}`,
      },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      setSent(true)
      setLoading(false)
    }
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
      {sent ? (
        <div className="text-center space-y-3 py-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
            <svg className="h-5 w-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <p className="text-[15px] font-semibold text-gray-900">Check your email</p>
            <p className="mt-1 text-[13px] text-gray-500">
              We sent a sign-in link to <span className="font-medium text-gray-700">{email}</span>
            </p>
          </div>
          <button
            onClick={() => setSent(false)}
            className="text-[13px] text-orange-600 hover:text-orange-700 transition-colors"
          >
            Use a different email
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-[13px] font-medium text-gray-700">
              Work email
            </label>
            <Input
              id="email"
              type="email"
              placeholder="you@extension.org"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              className="h-10 text-[14px]"
            />
          </div>
          {usePassword && (
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-[13px] font-medium text-gray-700">
                Password
              </label>
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="h-10 text-[14px]"
              />
            </div>
          )}
          {error && (
            <p className="text-[13px] text-red-500">{error}</p>
          )}
          <Button
            type="submit"
            className="w-full h-10 bg-orange-600 hover:bg-orange-700 text-[14px] font-medium shadow-sm"
            disabled={loading}
          >
            {loading ? 'Signing in…' : usePassword ? 'Sign in' : 'Continue with email'}
          </Button>
          <p className="text-center text-[12px] text-gray-400">
            {usePassword ? (
              <>
                Have a magic link?{' '}
                <button
                  type="button"
                  onClick={() => { setUsePassword(false); setError(null) }}
                  className="text-orange-600 hover:text-orange-700 transition-colors"
                >
                  Use email link instead
                </button>
              </>
            ) : (
              <>
                Have a password?{' '}
                <button
                  type="button"
                  onClick={() => { setUsePassword(true); setError(null) }}
                  className="text-orange-600 hover:text-orange-700 transition-colors"
                >
                  Sign in with password
                </button>
              </>
            )}
          </p>
        </form>
      )}
    </div>
  )
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-[360px]">
        <div className="mb-8 flex flex-col items-center">
          <Image
            src="/logo.png"
            alt="Extension Pulse"
            width={280}
            height={79}
            priority
            className="mb-4"
          />
          <p className="text-[13px] text-gray-400">Sign in to your account</p>
        </div>
        <Suspense fallback={
          <div className="rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
            <div className="h-10 bg-gray-100 rounded animate-pulse" />
          </div>
        }>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  )
}
