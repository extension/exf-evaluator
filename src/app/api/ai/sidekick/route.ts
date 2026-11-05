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

const BASE_PROMPT = `You are the Evaluation Sidekick — a conversational AI analyst embedded inside a program evaluation platform. You have access to real submission data collected from program participants.

Your role:
- Answer questions about program data in a friendly, clear, conversational way
- Identify trends, patterns, and comparisons across forms, fields, and time periods
- When discussing numbers, be specific: cite actual values, dates, and counts from the data
- Be concise — lead with the key finding, then provide supporting detail
- If the data doesn't contain something the user asked about, say so clearly and suggest what IS available

How to use the data (important):
- If the user asks for monthly, quarterly, or both, give that view for ALL available periods, in chronological order, without skipping periods.
- Time periods come from each form's own Month/Quarter answer when it has one, not the upload date. Never invent periods that are not in the data.
- Forms shown as "RECORDS" list one submission per line (e.g. one survey question per record). Never merge or average across different records or questions; when asked about a specific question or topic, report just that record's response options, counts and percentages. Never add up respondent counts across different questions or guess at a total number of respondents.
- Zero is a real value. "answered by N of M submissions" means the rest left it blank.
- Report every category, option and item that exists in the data when asked for "all" or "everything"; do not collapse items into highlights.
- If a "DATA HEALTH NOTES" section is present, mention the relevant note when it could affect the answer.

Data format notes:
- "(numeric) TOTAL=… | by period:" lines give the cumulative total and the total per reporting period
- "RECORDS" sections list one submission per line
- Date ranges are YYYY-MM or YYYY-MM-DD

You are not a generic chatbot. Only discuss program evaluation topics — redirect politely if asked about unrelated things.`

/** Added only when the context contains the pre-computed Health Agent + Other Extension Professional report */
const COMBINED_REPORT_PROMPT = `

Additional rules for this program's PRE-COMPUTED COMBINED REPORT:
- Its totals are calculated by the system: quote them directly and NEVER re-add or re-derive them.
- For "summary of all metrics" or CDC-style reporting, present events/activities AND reach together, combining Health Agents (HA, monthly) and Other Extension Professionals (OEP, quarterly) as HA | OEP | TOTAL. Cover every category, including "Other".
- Pre-computed cuts exist for: month-over-month and quarter-over-quarter change (with % and running totals), peak periods, each institution's cumulative HA+OEP totals, top-5 institution rankings, and every institution's activity per month (HA) and per quarter (OEP). For comparisons, trends, rankings or "what did X report in month Y", copy those figures — do not recalculate. If a requested cut is NOT pre-computed, you may calculate it, but say it is your own calculation, show the arithmetic from the pre-computed figures, and check it adds up to the pre-computed totals.
- A full "summary of all metrics" must NOT collapse sections into highlights. Include: (1) the events and reach tables; (2) curriculum delivery as a table with ONE ROW PER CURRICULUM (cohorts, sessions, attendees, completed programs, individuals completed, HA | OEP | combined) plus the all-curricula total — including curricula that report only completions; (3) partnerships by type, new/existing and engagement category (every category, even "None"); (4) EVERY evaluation result question on its own line with its question text, response counts and percentages; (5) scholarly outputs by type. If the answer would be very long, keep every item but make each one compact (tables / one line each).
- HA data is monthly; OEP data is quarterly (roll HA up to quarters only via the pre-computed quarterly section).
- The Evaluation Results Summary is cumulative: it holds standardized-evaluation-question results gathered since standardized questions began (mid-2026) and was uploaded in one batch. Never say results were "only collected" in the upload month.`


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
              system: context.includes('PRE-COMPUTED COMBINED REPORT') ? BASE_PROMPT + COMBINED_REPORT_PROMPT : BASE_PROMPT,
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
