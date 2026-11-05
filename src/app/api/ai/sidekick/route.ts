import { NextResponse } from 'next/server'
import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import type { FormSchema } from '@/types/forms'
import { buildContext, type FormMeta, type SubmissionRow } from '@/lib/sidekick-context'

const client = new Anthropic()

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
})

const schema = z.object({
  program_id: z.string().min(1),
  messages: z.array(messageSchema).min(1),
})

const SYSTEM_PROMPT = `You are the Evaluation Sidekick — a conversational AI analyst embedded inside a program evaluation platform. You have access to real submission data collected from program participants.

Your role:
- Answer questions about program data in a friendly, clear, conversational way
- Identify trends, patterns, and comparisons across forms, fields, and time periods
- When discussing numbers, be specific: cite actual values, dates, and counts from the data
- Be concise — lead with the key finding, then provide supporting detail
- If the data doesn't contain something the user asked about, say so clearly and suggest what IS available

How to use the data (important):
- A "PRE-COMPUTED COMBINED REPORT" section may be present. Its totals are calculated by the system: quote them directly and NEVER re-add or re-derive them. Do not recompute totals from per-form lines when a pre-computed figure exists.
- For "summary of all metrics" or CDC-style reporting, present events/activities AND reach together, combining Health Agents (HA, monthly) and Other Extension Professionals (OEP, quarterly) as HA | OEP | TOTAL — events, reach, curriculum delivery, and then results, partnerships and scholarly outputs. Cover every category, including "Other"; do not silently skip any.
- Curriculum delivery: list EVERY curriculum with data. Some curricula report only completed programs / individuals completed (zero cohorts or sessions) — still include them.
- If the user asks for monthly, quarterly, or both, give that view for ALL available periods, in chronological order, without skipping periods. HA data is monthly; OEP data is quarterly (roll HA up to quarters only via the pre-computed quarterly section).
- Time periods come from each form's own Month/Quarter answer, not the upload date. Never invent periods that are not in the data.
- Survey/results forms list one record per question. Never merge or average across different questions; when asked about a specific question or topic, report the record(s) for that question only, with its response options, counts and percentages. For "all results", present each question separately.
- The Evaluation Results Summary is cumulative: it holds standardized-evaluation-question results gathered since standardized questions began (mid-2026) and was uploaded in one batch. Never say results were "only collected" in the upload month, and never add up respondent counts across different questions or guess at a total number of respondents. Each question's own counts and percentages are its sample.
- Partnerships, results and scholarly outputs are in the data too — report them when asked for "everything" or "all" metrics.
- Zero is a real value. "answered by N of M submissions" means the rest left it blank.

Data format notes:
- "(numeric) TOTAL=… | by period:" lines give the cumulative total and the total per reporting period
- "RECORDS" sections list one submission per line
- Date ranges are YYYY-MM or YYYY-MM-DD

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

    // Fetch ALL submissions, paging past the API's per-request row limit
    const formIds = forms.map(f => f.id)
    const submissions: SubmissionRow[] = []
    if (formIds.length > 0) {
      const PAGE = 1000
      for (let from = 0; from < 50000; from += PAGE) {
        const { data: page, error: pageError } = await service
          .from('submissions')
          .select('id, form_id, submitted_at, data')
          .in('form_id', formIds)
          .eq('status', 'submitted')
          .order('submitted_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1)
        if (pageError) throw new Error(pageError.message)
        for (const s of page ?? []) {
          submissions.push({
            id: s.id,
            form_id: s.form_id,
            submitted_at: s.submitted_at,
            data: (s.data ?? {}) as Record<string, unknown>,
          })
        }
        if (!page || page.length < PAGE) break
      }
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
              max_tokens: 8192,
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
