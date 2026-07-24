import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/server'
import { CAREEROS_RULES } from '@/lib/claude'
import { parseDebrief, averageScore } from '@/lib/interview'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const DEBRIEF_SYSTEM = `${CAREEROS_RULES}

You are generating an end-of-loop interview debrief. Respond with valid JSON only. No markdown. No extra keys.`

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not configured' }, { status: 500 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { session_id } = body

  if (!session_id) return NextResponse.json({ error: 'session_id is required' }, { status: 400 })

  const admin = createAdminClient()

  // Verify session
  const { data: session } = await admin
    .from('interview_sessions')
    .select('id, company, round_type, pressure_mode, user_id, completed_at')
    .eq('id', session_id)
    .eq('user_id', user.id)
    .single()

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (session.completed_at) return NextResponse.json({ error: 'Session already completed' }, { status: 400 })

  // Fetch all answers for this session
  const { data: answers } = await admin
    .from('interview_answers')
    .select('question_text, answer_text, score, feedback')
    .eq('session_id', session_id)
    .order('created_at')

  if (!answers || answers.length === 0) {
    return NextResponse.json({ error: 'No answers found for this session' }, { status: 400 })
  }

  const overallScore = averageScore(answers.map(a => a.score ?? 0).filter(s => s > 0))

  const answersBlock = answers.map((a, i) =>
    `Q${i + 1}: ${a.question_text}\nAnswer: ${a.answer_text}\nScore: ${a.score ?? 'N/A'}`
  ).join('\n\n')

  const debriefUserMsg = `Generate a comprehensive debrief for this ${session.company} ${session.round_type} interview session.

ANSWERS FROM THIS SESSION:
${answersBlock}

Respond with valid JSON:
{
  "overall_score": <1-10, honest assessment>,
  "best_answer": {
    "question": "<the question text>",
    "answer": "<the candidate's answer>",
    "why": "<why this was the strongest answer — specific, not generic>"
  },
  "weakest_answer": {
    "question": "<the question text>",
    "answer": "<the candidate's answer>",
    "what_was_missing": "<specific gaps — missing impact number? contributor language? no framework?>"
  },
  "session_pattern": "<one sentence describing the overarching pattern across all answers — what they consistently do well or poorly>",
  "fixes": [
    "<specific fix #1 — actionable, not generic>",
    "<specific fix #2 — actionable, not generic>",
    "<specific fix #3 — actionable, not generic>"
  ]
}`

  const debriefResponse = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 700,
    system: [{ type: 'text' as const, text: DEBRIEF_SYSTEM, cache_control: { type: 'ephemeral' as const } }],
    messages: [{ role: 'user', content: debriefUserMsg }],
  })

  const debriefText = debriefResponse.content[0].type === 'text' ? debriefResponse.content[0].text : '{}'
  const debrief = parseDebrief(JSON.parse(debriefText))

  // Save completed session
  await admin.from('interview_sessions').update({
    completed_at: new Date().toISOString(),
    overall_score: Math.round(overallScore * 10) / 10,
    debrief: debrief ? JSON.parse(JSON.stringify(debrief)) : null,
  }).eq('id', session_id)

  // Check if pattern analysis should be triggered (every 3 completed sessions per company)
  const { count: completedCount } = await admin
    .from('interview_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('company', session.company)
    .not('completed_at', 'is', null)

  const shouldTriggerPattern = (completedCount ?? 0) > 0 && (completedCount ?? 0) % 3 === 0

  return NextResponse.json({
    session_id,
    overall_score: Math.round(overallScore * 10) / 10,
    debrief,
    should_trigger_pattern_analysis: shouldTriggerPattern,
    company: session.company,
  })
}
