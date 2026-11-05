'use client'

import { useState, useRef, useEffect, useCallback, memo } from 'react'
import { useProgram } from '@/contexts/program-context'
import { Button } from '@/components/ui/button'
import { Sparkles, Send, RotateCcw, User } from 'lucide-react'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}

// ---------------------------------------------------------------------------
// Lightweight markdown renderer
// ---------------------------------------------------------------------------

function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n')
  const nodes: React.ReactNode[] = []
  let i = 0

  function inlineFormat(str: string): React.ReactNode[] {
    const parts: React.ReactNode[] = []
    // Bold + italic combined (**_text_** or ***text***)
    const regex = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|__(.+?)__|_(.+?)_|\*(.+?)\*|`(.+?)`)/g
    let last = 0
    let m: RegExpExecArray | null
    while ((m = regex.exec(str)) !== null) {
      if (m.index > last) parts.push(str.slice(last, m.index))
      if (m[2]) parts.push(<strong key={m.index}><em>{m[2]}</em></strong>)
      else if (m[3]) parts.push(<strong key={m.index}>{m[3]}</strong>)
      else if (m[4]) parts.push(<strong key={m.index}>{m[4]}</strong>)
      else if (m[5]) parts.push(<em key={m.index}>{m[5]}</em>)
      else if (m[6]) parts.push(<em key={m.index}>{m[6]}</em>)
      else if (m[7]) parts.push(<code key={m.index} className="bg-gray-100 text-gray-800 rounded px-1 py-0.5 text-[12px] font-mono">{m[7]}</code>)
      last = m.index + m[0].length
    }
    if (last < str.length) parts.push(str.slice(last))
    return parts
  }

  while (i < lines.length) {
    const line = lines[i]

    // Heading
    const h3 = line.match(/^### (.+)/)
    const h2 = line.match(/^## (.+)/)
    const h1 = line.match(/^# (.+)/)
    if (h1) { nodes.push(<h2 key={i} className="text-[15px] font-semibold text-gray-900 mt-4 mb-1">{inlineFormat(h1[1])}</h2>); i++; continue }
    if (h2) { nodes.push(<h3 key={i} className="text-[14px] font-semibold text-gray-800 mt-3 mb-1">{inlineFormat(h2[1])}</h3>); i++; continue }
    if (h3) { nodes.push(<h4 key={i} className="text-[13px] font-semibold text-gray-700 mt-2 mb-0.5">{inlineFormat(h3[1])}</h4>); i++; continue }

    // Bullet list
    if (line.match(/^[-*] /)) {
      const items: React.ReactNode[] = []
      while (i < lines.length && lines[i].match(/^[-*] /)) {
        items.push(<li key={i} className="ml-4 list-disc text-[13px] text-gray-700 leading-relaxed">{inlineFormat(lines[i].slice(2))}</li>)
        i++
      }
      nodes.push(<ul key={`ul-${i}`} className="my-2 space-y-0.5">{items}</ul>)
      continue
    }

    // Numbered list
    if (line.match(/^\d+\. /)) {
      const items: React.ReactNode[] = []
      while (i < lines.length && lines[i].match(/^\d+\. /)) {
        const content = lines[i].replace(/^\d+\. /, '')
        items.push(<li key={i} className="ml-4 list-decimal text-[13px] text-gray-700 leading-relaxed">{inlineFormat(content)}</li>)
        i++
      }
      nodes.push(<ol key={`ol-${i}`} className="my-2 space-y-0.5">{items}</ol>)
      continue
    }

    // Horizontal rule
    if (line.match(/^---+$/)) {
      nodes.push(<hr key={i} className="my-3 border-gray-200" />)
      i++; continue
    }

    // Empty line
    if (!line.trim()) {
      nodes.push(<div key={i} className="h-2" />)
      i++; continue
    }

    // Regular paragraph
    nodes.push(<p key={i} className="text-[13px] text-gray-700 leading-relaxed">{inlineFormat(line)}</p>)
    i++
  }

  return nodes
}

// ---------------------------------------------------------------------------
// Starter suggestions
// ---------------------------------------------------------------------------

const STARTERS = [
  "What's the overall trend in participation across all forms?",
  'Which form has the most submissions and when were they collected?',
  "Show me a summary of all numeric metrics we've collected.",
  'Are there any notable patterns or outliers in the data?',
]

// ---------------------------------------------------------------------------
// Message bubble
// ---------------------------------------------------------------------------

// memo: finished messages don't re-render (or re-parse their markdown) while a new reply streams
const MessageBubble = memo(function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'

  return (
    <div className={cn('flex gap-3', isUser ? 'flex-row-reverse' : 'flex-row')}>
      {/* Avatar */}
      <div className={cn(
        'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full mt-0.5',
        isUser ? 'bg-orange-100' : 'bg-gradient-to-br from-orange-500 to-orange-600'
      )}>
        {isUser
          ? <User className="h-3.5 w-3.5 text-orange-600" aria-hidden="true" />
          : <Sparkles className="h-3.5 w-3.5 text-white" aria-hidden="true" />
        }
      <span className="sr-only">{isUser ? 'You' : 'Sidekick'}</span>
      </div>

      {/* Bubble */}
      <div className={cn(
        'max-w-[78%] rounded-2xl px-4 py-3',
        isUser
          ? 'bg-orange-600 text-white rounded-tr-sm'
          : 'bg-white border border-gray-100 shadow-sm rounded-tl-sm'
      )}>
        {isUser ? (
          <p className="text-[13px] leading-relaxed text-white">{message.content}</p>
        ) : (
          <div>
            {renderMarkdown(message.content)}
            {message.streaming && (
              <span className="inline-flex gap-0.5 ml-1 align-middle" role="status" aria-label="Sidekick is responding">
                <span aria-hidden="true" className="w-1 h-1 rounded-full bg-orange-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span aria-hidden="true" className="w-1 h-1 rounded-full bg-orange-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span aria-hidden="true" className="w-1 h-1 rounded-full bg-orange-400 animate-bounce" style={{ animationDelay: '300ms' }} />
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
})

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SidekickClient() {
  const { currentProgram } = useProgram()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const messageCountRef = useRef(0)

  // Scroll behaviour:
  // - Only the chat container is scrolled (never scrollIntoView, which also scrolls the
  //   page and app layout and makes the whole screen jump while a reply streams).
  // - A NEW message always scrolls to the bottom.
  // - While streaming, follow only if the user hasn't scrolled up. That decision is
  //   tracked in onScroll (stickToBottomRef) rather than measured after the text has
  //   already grown, which is what caused the jumping.
  const stickToBottomRef = useRef(true)

  // Re-lock to the bottom only when the user is truly at the bottom (24px). Any manual
  // upward scroll (wheel / touch / keys) releases the lock immediately, so streaming
  // text can never fight the user's scrolling.
  const handleChatScroll = useCallback(() => {
    const c = scrollContainerRef.current
    if (!c) return
    stickToBottomRef.current = c.scrollHeight - c.scrollTop - c.clientHeight < 24
  }, [])

  const releaseStick = useCallback(() => {
    stickToBottomRef.current = false
  }, [])

  const handleChatWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (e.deltaY < 0) stickToBottomRef.current = false
  }, [])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const isNewMessage = messages.length !== messageCountRef.current
    messageCountRef.current = messages.length

    if (isNewMessage) stickToBottomRef.current = true
    if (stickToBottomRef.current) container.scrollTop = container.scrollHeight
  }, [messages])

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || !currentProgram || loading) return

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: text.trim() }
    const assistantId = crypto.randomUUID()

    setMessages(prev => [...prev, userMsg, { id: assistantId, role: 'assistant', content: '', streaming: true }])
    setInput('')
    setLoading(true)

    // Build conversation history for the API (exclude the placeholder assistant message)
    const history = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }))

    abortRef.current = new AbortController()

    try {
      const res = await fetch('/api/ai/sidekick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ program_id: currentProgram.id, messages: history }),
        signal: abortRef.current.signal,
      })

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}))
        throw new Error(typeof err.error === 'string' ? err.error : 'Failed to get response')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''
      let lastFlush = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        accumulated += decoder.decode(value, { stream: true })
        // Throttle UI updates (~8/sec). Re-rendering on every network chunk floods the
        // browser on long replies, which freezes scrolling until the reply finishes.
        const now = performance.now()
        if (now - lastFlush >= 120) {
          lastFlush = now
          const snapshot = accumulated
          setMessages(prev =>
            prev.map(m => m.id === assistantId ? { ...m, content: snapshot, streaming: true } : m)
          )
        }
      }

      // Finalize — remove streaming flag
      setMessages(prev =>
        prev.map(m => m.id === assistantId ? { ...m, content: accumulated, streaming: false } : m)
      )
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        setMessages(prev => prev.filter(m => m.id !== assistantId))
      } else {
        const msg = err instanceof Error ? err.message : 'Something went wrong'
        setMessages(prev =>
          prev.map(m => m.id === assistantId
            ? { ...m, content: `Sorry, I ran into an error: ${msg}`, streaming: false }
            : m
          )
        )
      }
    }

    setLoading(false)
  }, [currentProgram, loading, messages])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  function handleReset() {
    abortRef.current?.abort()
    setMessages([])
    setInput('')
    setLoading(false)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const isEmpty = messages.length === 0

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-gray-50">
      {/* Header */}
      <header className="flex h-14 flex-shrink-0 items-center justify-between border-b bg-white px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 shadow-sm">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div>
            <h1 className="text-[15px] font-semibold text-gray-900 leading-tight">Evaluation Sidekick</h1>
            <p className="text-[11px] text-gray-400 leading-tight">
              {currentProgram?.name ?? 'Select a program'}
            </p>
          </div>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" className="gap-1.5 text-[12px] text-gray-400 hover:text-gray-600 h-8" onClick={handleReset}>
            <RotateCcw className="h-3 w-3" /> New conversation
          </Button>
        )}
      </header>

      {/* Messages area — aria-live so screen readers announce new messages */}
      <div ref={scrollContainerRef} onScroll={handleChatScroll} onWheel={handleChatWheel} onTouchMove={releaseStick} className="flex-1 overflow-y-auto overscroll-contain px-4 py-6" role="log" aria-label="Conversation" aria-live={loading ? 'off' : 'polite'} aria-busy={loading} aria-atomic="false">
        <div className="mx-auto max-w-2xl space-y-5">

          {isEmpty ? (
            /* Welcome / empty state */
            <div className="flex flex-col items-center text-center pt-12 pb-6">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-orange-600 shadow-lg mb-4">
                <Sparkles className="h-8 w-8 text-white" />
              </div>
              <h2 className="text-[20px] font-semibold text-gray-900 mb-2">
                Hey! I&apos;m your Evaluation Sidekick.
              </h2>
              <p className="text-[14px] text-gray-500 max-w-md leading-relaxed">
                Ask me anything about your program data — trends, comparisons, summaries, outliers.
                I have access to all your submissions and can dig across any date range.
              </p>

              {/* Suggested starters */}
              <div className="mt-8 w-full grid grid-cols-1 sm:grid-cols-2 gap-2">
                {STARTERS.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => sendMessage(s)}
                    disabled={!currentProgram}
                    className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-left text-[12px] text-gray-600 hover:border-orange-300 hover:bg-orange-50 hover:text-orange-700 transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {s}
                  </button>
                ))}
              </div>

              {!currentProgram && (
                <p className="mt-4 text-[12px] text-amber-600">Select a program from the sidebar to get started.</p>
              )}
            </div>
          ) : (
            messages.map(m => <MessageBubble key={m.id} message={m} />)
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input bar */}
      <div className="flex-shrink-0 border-t bg-white px-4 py-4">
        <div className="mx-auto max-w-2xl">
          <div className="flex items-end gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 focus-within:border-orange-300 focus-within:ring-2 focus-within:ring-orange-100 transition-all">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={currentProgram ? 'Ask anything about your data… (Shift+Enter for new line)' : 'Select a program first…'}
              disabled={!currentProgram || loading}
              rows={1}
              className="flex-1 resize-none bg-transparent text-[13px] text-gray-800 placeholder-gray-400 focus:outline-none leading-relaxed disabled:opacity-50"
              style={{ maxHeight: '140px', overflowY: 'auto' }}
              aria-label="Message input"
              onInput={e => {
                const el = e.currentTarget
                el.style.height = 'auto'
                el.style.height = Math.min(el.scrollHeight, 140) + 'px'
              }}
            />
            <Button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || !currentProgram || loading}
              className="h-8 w-8 flex-shrink-0 rounded-xl bg-orange-600 hover:bg-orange-700 p-0 disabled:opacity-40"
              aria-label="Send message"
            >
              <Send className="h-3.5 w-3.5 text-white" />
            </Button>
          </div>
          <p className="mt-1.5 text-center text-[11px] text-gray-400">
            Responses are based on your actual submission data · {currentProgram?.name ?? '—'}
          </p>
        </div>
      </div>
    </div>
  )
}
