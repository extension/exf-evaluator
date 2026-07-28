import { createServiceClient } from '@/lib/supabase/server'
import { FormRenderer } from './form-renderer-client'
import type { FormSchema } from '@/types/forms'

interface Props {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ token?: string; preview?: string }>
}

export default async function PublicFormPage({ params, searchParams }: Props) {
  const { slug } = await params
  const { token, preview } = await searchParams
  const isPreview = preview === 'true'
  const service = createServiceClient()

  // Load form by slug
  const { data: form } = await service
    .from('forms')
    .select('*, programs(name, brand_color)')
    .eq('slug', slug)
    .single()

  if (!form) {
    return <ErrorPage message="This form could not be found." />
  }

  const program = form.programs as { name: string; brand_color: string | null } | null
  const schema = form.schema as unknown as FormSchema
  const settings = (form.settings as Record<string, unknown> | null) ?? {}

  // Preview mode: show the form read-only, no token required, no submissions
  if (isPreview) {
    return (
      <FormRenderer
        formId={form.id}
        formName={form.name}
        schema={schema}
        token=""
        tokenId=""
        tokenMetadata={{}}
        respondentEmail={null}
        programName={program?.name ?? 'Extension Pulse'}
        brandColor={program?.brand_color ?? '#ea580c'}
        confirmationMessage={settings.confirmation_message as string | undefined}
        redirectUrl={undefined}
        isPreview
      />
    )
  }

  // Normal token-gated mode
  if (!token) {
    return <ErrorPage message="No access token provided. Please use the link from your invitation email." />
  }

  if (form.status !== 'active') {
    return <ErrorPage message="This form is not currently available." />
  }

  // Validate token
  const { data: tokenRow } = await service
    .from('submission_tokens')
    .select('*')
    .eq('token', token)
    .eq('form_id', form.id)
    .single()

  if (!tokenRow) return <ErrorPage message="Invalid or expired link. Please contact the sender." />
  if (tokenRow.used_at) return <ErrorPage message="This link has already been used. Each link can only be used once." />
  if (new Date(tokenRow.expires_at) < new Date()) return <ErrorPage message="This link has expired. Please contact the sender for a new one." />

  // Check for an existing draft so we can pre-fill on return
  const { data: existingDraft } = await service
    .from('submissions')
    .select('id, data')
    .eq('token_id', tokenRow.id)
    .eq('form_id', form.id)
    .eq('status', 'draft')
    .maybeSingle()

  return (
    <FormRenderer
      formId={form.id}
      formName={form.name}
      schema={schema}
      token={token}
      tokenId={tokenRow.id}
      tokenMetadata={(tokenRow.metadata ?? {}) as Record<string, unknown>}
      respondentEmail={tokenRow.email}
      programName={program?.name ?? 'Extension Pulse'}
      brandColor={program?.brand_color ?? '#ea580c'}
      confirmationMessage={settings.confirmation_message as string | undefined}
      redirectUrl={settings.redirect_url as string | undefined}
      closesAt={(settings.closesAt ?? settings.closes_at) as string | undefined}
      tokenExpiresAt={tokenRow.expires_at}
      periodType={settings.periodType as string | undefined}
      periodValue={settings.periodValue as string | undefined}
      periodStart={settings.periodStart as string | undefined}
      periodEnd={settings.periodEnd as string | undefined}
      draftId={existingDraft?.id ?? undefined}
      draftData={(existingDraft?.data ?? undefined) as Record<string, unknown> | undefined}
    />
  )
}

function ErrorPage({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="max-w-md w-full text-center">
        <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <h1 className="text-[18px] font-semibold text-gray-800 mb-2">Form unavailable</h1>
        <p className="text-[14px] text-gray-500">{message}</p>
      </div>
    </div>
  )
}
