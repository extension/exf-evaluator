import { NextResponse } from 'next/server'
import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'
import mammoth from 'mammoth'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { logAudit } from '@/lib/audit'

const client = new Anthropic()

const DOCUMENT_TYPES = ['narrative', 'logic_model', 'continuation', 'evaluation', 'budget', 'progress_report', 'other'] as const

const createSchema = z.object({
  program_id: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  document_type: z.enum(DOCUMENT_TYPES).default('narrative'),
  starts_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ends_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // Either a PDF/DOCX as base64, or plain text pasted directly
  file_name: z.string().optional(),
  file_base64: z.string().optional(),  // base64-encoded PDF or DOCX
  text_content: z.string().optional(), // manually pasted text
})

/**
 * Extract meaningful text from a PDF by sending it to Claude as a document.
 * Claude reads the full PDF and returns the extracted narrative text.
 */
async function extractPdfText(base64: string, fileName: string): Promise<string> {
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: base64,
            },
          } as never,
          {
            type: 'text',
            text: `Please extract and return the full text content of this document (${fileName}). Preserve the structure, headings, and key information as faithfully as possible. Do not summarize — return the actual content so it can be used as grounding context for an AI analysis system. If the document is very long, prioritize the program narrative, goals, objectives, and expected outcomes.`,
          },
        ],
      },
    ],
  })
  return msg.content[0].type === 'text' ? msg.content[0].text : ''
}

async function extractDocxText(base64: string): Promise<string> {
  const buffer = Buffer.from(base64, 'base64')
  const result = await mammoth.extractRawText({ buffer })
  return result.value
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const programId = searchParams.get('program_id')
  if (!programId) return NextResponse.json({ error: 'program_id required' }, { status: 400 })

  const { data, error } = await supabase
    .from('program_narratives')
    .select('id, title, description, document_type, file_name, starts_at, ends_at, created_at, created_by')
    .eq('program_id', programId)
    .order('starts_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const service = createServiceClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const { program_id, title, description, document_type, starts_at, ends_at, file_name, file_base64, text_content } = parsed.data

  if (!file_base64 && !text_content) {
    return NextResponse.json({ error: 'Either a file or text content is required' }, { status: 400 })
  }

  if (ends_at < starts_at) {
    return NextResponse.json({ error: 'End date must be after start date' }, { status: 400 })
  }

  // Extract content — PDF via Claude, DOCX via mammoth, or use pasted text
  let content: string
  if (file_base64 && file_name) {
    const isDocx = /\.docx?$/i.test(file_name)
    try {
      content = isDocx
        ? await extractDocxText(file_base64)
        : await extractPdfText(file_base64, file_name)
    } catch (e) {
      console.error('Document extraction failed:', e)
      return NextResponse.json({ error: 'Failed to extract text from the document. Try pasting the text directly.' }, { status: 500 })
    }
  } else {
    content = text_content!
  }

  const { data, error } = await service.from('program_narratives').insert({
    program_id,
    title,
    description: description ?? null,
    document_type: document_type ?? 'narrative',
    content,
    file_name: file_name ?? null,
    starts_at,
    ends_at,
    created_by: user.id,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAudit(service, {
    userId: user.id,
    programId: program_id,
    action: 'narrative.create',
    entityType: 'program_narrative',
    entityId: data.id,
  })

  return NextResponse.json(data, { status: 201 })
}
