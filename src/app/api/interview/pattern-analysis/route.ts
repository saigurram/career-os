import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/server'
import { CAREEROS_RULES } from '@/lib/claude'
import { parsePatternAnalysis } from '@/lib/interview'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const PATTERN_SYSTEM = `${CAREEROS_RULES}

You are analyzing interview session patterns for a senior PM candidate. Identify the single most important recurring issue across multiple sessions. Respond with valid JSON only. No markdown. No extra keys.`

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not configured' }, { status: 500 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { company } = body

  const admin = createAdminClient()

  // Get last 3 completed sessions for this company (or all sessions if company not specified)
  const sessionsQuery = admin
    .from('interview_sessions')
    .select('id, company, round_type, overall_score, completed_at')
    .eq('user_id', user.id)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(3)

  if (company) sessionsQuery.eq('company', company)

  const { data: sessions } = await sessionsQuery

  if (!sessions || sessions.length < 3) {
    return NextResponse.json({ error: 'Need at least 3 completed sessions for pattern analysis' }, { status: 400 })
  }

  // Fetch all answers for those sessions
  const sessionIds = sessions.map(s => s.id)
  const { data: answers } = await admin
    .from('interview_answers')
    .select('session_id, question_text, answer_text, score, feedback')
    .in('session_id', sessionIds)
    .order('created_at')

  if (!answers || answers.length === 0) {
    return NextResponse.json({ error: 'No answers found in recent sessions' }, { status: 400 })
  }

  const sessionBlocks = sessions.map(s => {
    const sessionAnswers = answers.filter(a => a.session_id === s.id)
    return `Session at ${s.company} (${s.round_type}), score: ${s.overall_score ?? 'N/A'}/10:
${sessionAnswers.map((a, i) => `  Q${i + 1}: ${a.question_text}\n  Score: ${a.score ?? 'N/A'}/5\n  Answer excerpt: ${a.answer_text.slice(0, 200)}...`).join('\n')}`
  }).join('\n\n')

  const patternUserMsg = `Analyze the following 3 interview sessions to identify a recurring pattern.

${sessionBlocks}

Identify the SINGLE most important recurring issue across all 3 sessions. Be specific — not "needs improvement" but exactly what keeps happening and why it matters.

Respond with valid JSON:
{
  "sessions_analyzed": 3,
  "recurring_issue": "<one sentence describing the exact pattern — e.g., 'Missing impact numbers in behavioral answers' or 'Defaults to strategy frameworks without grounding in specific outcomes'>",
  "example_from_session": "<quote the specific moment from one session where this issue appeared most clearly>",
  "how_to_fix": "<concrete, specific fix — not 'be more specific' but 'before every behavioral answer, state the outcome with a number first, then walk backwards to the context'>"
}`

  const patternResponse = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    system: [{ type: 'text' as const, text: PATTERN_SYSTEM, cache_control: { type: 'ephemeral' as const } }],
    messages: [{ role: 'user', content: patternUserMsg }],
  })

  const patternText = patternResponse.content[0].type === 'text' ? patternResponse.content[0].text : '{}'
  const analysis = parsePatternAnalysis(JSON.parse(patternText))

  if (!analysis) {
    return NextResponse.json({ error: 'Failed to parse pattern analysis' }, { status: 500 })
  }

  // Save pattern analysis to the most recent session
  await admin.from('interview_sessions').update({
    pattern_analysis: JSON.parse(JSON.stringify(analysis)),
  }).eq('id', sessions[0].id)

  return NextResponse.json({ analysis, sessions_analyzed: sessions.length })
}
