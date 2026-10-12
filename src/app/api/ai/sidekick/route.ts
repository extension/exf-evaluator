import { NextResponse } from 'next/server'
import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import type { FormSchema, FormField } from '@/types/forms'

const client = new Anthropic()

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
})

const schema = z.object({
  program_id: z.string().min(1),
  messages: z.array(messageSchema).min(1),
})

// ---------------------------------------------------------------------------
// Data aggregation helpers
// ---------------------------------------------------------------------------

interface SubmissionRow {
  id: string
  submitted_at: string | null
  data: Record<string, unknown>
  form_id: string
}

interface FormMeta {
  id: string
  name: string
  fields: FormField[]
  settings: Record<string, unknown>
}

/** Group submission rows by calendar month (YYYY-MM) */
function groupByMonth(rows: SubmissionRow[]): Map<string, SubmissionRow[]> {
  const map = new Map<string, SubmissionRow[]>()
  for (const row of rows) {
    const key = (row.submitted_at ?? '').slice(0, 7) || 'unknown'
    const bucket = map.get(key) ?? []
    bucket.push(row)
    map.set(key, bucket)
  }
  return map
}

/** Compute numeric stats for an array of values */
function numStats(vals: number[]) {
  if (!vals.length) return null
  const sum = vals.reduce((a, b) => a + b, 0)
  const avg = sum / vals.length
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  return { count: vals.length, sum: Math.round(sum * 100) / 100, avg: Math.round(avg * 100) / 100, min, max }
}

/** Build a concise, AI-ready context document from program data */
function buildContext(
  programName: string,
  forms: FormMeta[],
  submissions: SubmissionRow[],
): string {
  const lines: string[] = [
    `PROGRAM: ${programName}`,
    `TOTAL FORMS: ${forms.length}`,
    `TOTAL SUBMISSIONS: ${submissions.length}`,
    '',
  ]

  // Overall date range
  const dates = submissions.map(s => s.submitted_at).filter(Boolean).sort() as string[]
  if (dates.length) {
    lines.push(`DATA RANGE: ${dates[0].slice(0, 10)} → ${dates[dates.length - 1].slice(0, 10)}`)
    lines.push('')
  }

  // Per-form breakdown
  for (const form of forms) {
    const formRows = submissions.filter(s => s.form_id === form.id)
    if (!formRows.length) continue

    const periodLabel = (() => {
      const s = form.settings
      if (s.periodValue) return ` [Period: ${s.periodValue}]`
      if (s.periodStart && s.periodEnd) return ` [${s.periodStart} – ${s.periodEnd}]`
      return ''
    })()

    lines.push(`--- FORM: "${form.name}"${periodLabel} (${formRows.length} submissions) ---`)

    // Group by month for trend data
    const byMonth = groupByMonth(formRows)
    const sortedMonths = [...byMonth.keys()].sort()

    for (const field of form.fields) {
      if ((field as unknown as Record<string, unknown>).hidden) continue
      const label = field.label || field.id
      const isNumeric = ['number', 'scale', 'rating', 'nps', 'slider'].includes(field.type)

      if (isNumeric) {
        // Monthly trend for numeric fields
        lines.push(`  [${label}] (numeric)`)
        for (const month of sortedMonths) {
          const monthRows = byMonth.get(month) ?? []
          const vals = monthRows
            .map(r => Number(r.data[field.id]))
            .filter(v => !isNaN(v) && v !== 0)
          const stats = numStats(vals)
          if (stats) {
            lines.push(`    ${month}: n=${stats.count} sum=${stats.sum} avg=${stats.avg} min=${stats.min} max=${stats.max}`)
          }
        }
        // Overall stats
        const allVals = formRows
          .map(r => Number(r.data[field.id]))
          .filter(v => !isNaN(v) && v !== 0)
        const overall = numStats(allVals)
        if (overall) {
          lines.push(`    OVERALL: n=${overall.count} sum=${overall.sum} avg=${overall.avg}`)
        }
      } else if (field.type === 'single_choice' || field.type === 'multiple_choice') {
        // Value distribution
        const dist: Record<string, number> = {}
        for (const row of formRows) {
          const val = row.data[field.id]
          const choices = Array.isArray(val) ? val : [val]
          for (const c of choices) {
            if (c) dist[String(c)] = (dist[String(c)] ?? 0) + 1
          }
        }
        const sorted = Object.entries(dist).sort((a, b) => b[1] - a[1]).slice(0, 10)
        if (sorted.length) {
          lines.push(`  [${label}] (choice): ${sorted.map(([v, n]) => `"${v}"=${n}`).join(', ')}`)
        }
      } else if (field.type === 'short_text' || field.type === 'long_text') {
        // Sample responses (up to 5)
        const samples = formRows
          .map(r => r.data[field.id])
          .filter(v => v && String(v).trim().length > 2)
          .slice(0, 5)
          .map(v => `"${String(v).slice(0, 120)}"`)
        if (samples.length) {
          lines.push(`  [${label}] (text samples): ${samples.join(' | ')}`)
        }
      }
    }
    lines.push('')
  }

  return lines.join('\n')
}

const SYSTEM_PROMPT = `You are the Evaluation Sidekick — a conversational AI analyst embedded inside a program evaluation platform. You have access to real submission data collected from program participants.

Your role:
- Answer questions about program data in a friendly, clear, conversational way
- Identify trends, patterns, and comparisons across forms, fields, and time periods
- When discussing numbers, be specific: cite actual values, dates, and counts from the data
- When you see a trend, describe the direction and magnitude
- Compare metrics when asked ("how does X compare to Y?")
- Flag anything surprising or noteworthy in the data
- Be concise — lead with the key finding, then provide supporting detail
- Use bullet points and short paragraphs for readability
- If the data doesn't contain something the user asked about, say so clearly and suggest what IS available

Data format notes:
- Numeric fields show monthly stats: n=count, sum=total, avg=average
- Date ranges are YYYY-MM or YYYY-MM-DD
- "Period" labels (e.g. "Fall 2025") come from imported datasets

You are not a generic chatbot. Only discuss program evaluation topics — redirect politely if asked about unrelated things.`

// ---------------------------------------------------------------------------
// Route handler — streaming
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const service = createServiceClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 })

    const { program_id, messages } = parsed.data

    // Fetch program
    const { data: program, error: programError } = await supabase
      .from('programs').select('name').eq('id', program_id).single()
    if (programError || !program) return NextResponse.json({ error: 'Program not found' }, { status: 404 })

    // Fetch all active/closed forms for the program
    const { data: rawForms } = await supabase
      .from('forms')
      .select('id, name, schema, settings')
      .eq('program_id', program_id)
      .in('status', ['active', 'closed'])
      .order('created_at', { ascending: true })

    const forms: FormMeta[] = (rawForms ?? []).map(f => ({
      id: f.id,
      name: f.name,
      fields: ((f.schema as FormSchema | null)?.pages ?? []).flatMap(p => p.fields),
      settings: (f.settings ?? {}) as Record<string, unknown>,
    }))

    // Fetch submissions (cap at 2000)
    const formIds = forms.map(f => f.id)
    let submissions: SubmissionRow[] = []
    if (formIds.length > 0) {
      const { data: rawSubs } = await service
        .from('submissions')
        .select('id, form_id, submitted_at, data')
        .in('form_id', formIds)
        .eq('status', 'submitted')
        .order('submitted_at', { ascending: true })
        .limit(2000)
      submissions = (rawSubs ?? []).map(s => ({
        id: s.id,
        form_id: s.form_id,
        submitted_at: s.submitted_at,
        data: s.data as Record<string, unknown>,
      }))
    }

    const context = buildContext(program.name, forms, submissions)

    // Fetch Pulse notes
    const { data: rawPulse } = await supabase
      .from('pulse_notes')
      .select('title, content, source, note_date, author_email, attachments')
      .eq('program_id', program_id)
      .order('note_date', { ascending: false })
      .limit(100)

    const pulseSection = (rawPulse && rawPulse.length > 0)
      ? `\n\nPULSE FIELD NOTES (${rawPulse.length} entries):\n` +
        rawPulse.map(p => {
          const author = p.author_email ?? 'unknown'
          const src = p.source ?? 'typed'
          const heading = p.title
            ? `[${p.note_date}] "${p.title}" (${src}, by ${author})`
            : `[${p.note_date}] (${src}, by ${author})`
          const noteBody = String(p.content ?? '').slice(0, 1200)
          const attachments = (p.attachments as Array<{ name?: string; type?: string; extracted_text?: string | null }> | null) ?? []
          const attachText = attachments.map(a => {
            if (a.extracted_text) {
              return `  [ATTACHMENT — "${a.name ?? 'file'}"]\n${String(a.extracted_text).slice(0, 8000)}\n  [END ATTACHMENT]`
            }
            return `  [ATTACHMENT — "${a.name ?? 'file'}" (${a.type ?? 'file'}, no text content)]`
          }).join('\n')
          return attachText ? `${heading}\nNote: ${noteBody}\n${attachText}` : `${heading}: ${noteBody}`
        }).join('\n\n')
      : ''

    // Inject context as first user message preamble
    const contextMessage: Anthropic.MessageParam = {
      role: 'user',
      content: `[DATA CONTEXT — use this to answer questions]\n\n${context}${pulseSection}\n\n[END DATA CONTEXT]`,
    }
    const contextAck: Anthropic.MessageParam = {
      role: 'assistant',
      content: `Got it — I have the program data loaded and I'm ready to help you explore it. What would you like to know?`,
    }

    // Filter out any messages with empty content to avoid API errors
    const validMessages = messages.filter(m => m.content.trim().length > 0)

    const anthropicMessages: Anthropic.MessageParam[] = [
      contextMessage,
      contextAck,
      ...validMessages.map(m => ({ role: m.role, content: m.content })),
    ]

    // Stream back the response using event callbacks (more reliable on serverless)
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          await client.messages
            .stream({
              model: 'claude-sonnet-4-5',
              max_tokens: 2048,
              system: SYSTEM_PROMPT,
              messages: anthropicMessages,
            })
            .on('text', (text) => {
              controller.enqueue(encoder.encode(text))
            })
            .finalMessage()
          controller.close()
        } catch (err) {
          console.error('[sidekick] Anthropic stream error:', err)
          controller.error(err)
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (err) {
    console.error('[sidekick] Route error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
