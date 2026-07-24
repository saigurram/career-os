import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/server'
import { CAREEROS_RULES } from '@/lib/claude'
import { hasContributorLanguage, parseFeedback, hasPersonaLpProbe, type InterviewPersona } from '@/lib/interview'
import { PERSONA_DEFINITIONS } from '@/lib/interview'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const FEEDBACK_SYSTEM = `${CAREEROS_RULES}

You are evaluating interview answers for a senior PM candidate.

Evaluate each answer for:
1. Owner language (led/drove/built/owned/defined/architected/launched) vs contributor language (helped/supported/assisted)
2. Presence of a specific impact number
3. Answer clarity and specificity
4. Whether it directly addresses what was asked

Respond with valid JSON only. No markdown. No extra keys.`

const CURVEBALL_SYSTEM = `${CAREEROS_RULES}

You are conducting a pressure-mode PM interview. Generate ONE curveball follow-up question that directly challenges the weakest part of the candidate's answer. The question must be confrontational but professional. Respond with just the question text, nothing else.`

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not configured' }, { status: 500 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { session_id, question_text, answer_text, persona, question_index } = body

  if (!session_id || !question_text || !answer_text || !persona) {
    return NextResponse.json({ error: 'session_id, question_text, answer_text, and persona are required' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Verify session belongs to this user
  const { data: session } = await admin
    .from('interview_sessions')
    .select('id, company, pressure_mode, completed_at')
    .eq('id', session_id)
    .eq('user_id', user.id)
    .single()

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (session.completed_at) return NextResponse.json({ error: 'Session already completed' }, { status: 400 })

  // Pre-check: contributor language (in-character flag)
  const contributorCheck = hasContributorLanguage(answer_text)
  const personaDef = PERSONA_DEFINITIONS[persona as InterviewPersona]
  const inCharacterFlag = contributorCheck.found && personaDef
    ? personaDef.contributor_language_response
    : null
  const includeLpProbe = personaDef ? hasPersonaLpProbe(persona as InterviewPersona) : false

  const feedbackUserMsg = `Evaluate this answer from a ${session.pressure_mode ? 'pressure-mode' : 'standard'} ${persona} interview.

QUESTION ASKED: "${question_text}"

CANDIDATE'S ANSWER: "${answer_text}"

Respond with valid JSON:
{
  "score": <1-5>,
  "what_landed": "<what was strong about this answer — be specific>",
  "what_missed": "<what was weak or missing — be specific>",
  "better_version": "<the same answer rewritten in 2 sentences with owner framing and an impact number>"${includeLpProbe ? `,
  "lp_probe_question": "<one pointed follow-up: which specific Amazon Leadership Principle did this answer demonstrate, and how? Make it confrontational — the Bar Raiser pushes for precision>"` : ''}
}`

  // Get Claude feedback
  const feedbackResponse = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 700,
    system: [{ type: 'text' as const, text: FEEDBACK_SYSTEM, cache_control: { type: 'ephemeral' as const } }],
    messages: [{ role: 'user', content: feedbackUserMsg }],
  })

  const feedbackText = feedbackResponse.content[0].type === 'text' ? feedbackResponse.content[0].text : '{}'
  const feedbackRaw = JSON.parse(feedbackText)
  const feedback = parseFeedback(feedbackRaw)
  const lpProbeQuestion: string | null = feedbackRaw.lp_probe_question ?? null

  // Save answer
  const { data: savedAnswer } = await admin
    .from('interview_answers')
    .insert({
      session_id,
      question_text,
      answer_text,
      score: feedback?.score ?? null,
      feedback: feedback ? JSON.parse(JSON.stringify(feedback)) : null,
    })
    .select('id')
    .single()

  // Fetch next question from the pre-generated list (questions saved at session start)
  const { data: sessionQuestions } = await admin
    .from('interview_questions')
    .select('question_text, category, difficulty')
    .eq('session_id', session_id)
    .order('created_at')

  const nextIndex = (question_index ?? 0) + 1
  const nextQuestion = sessionQuestions && nextIndex < sessionQuestions.length
    ? sessionQuestions[nextIndex]
    : null

  // Check if this answer triggers a curveball (pressure mode, last question)
  const isLastQuestion = !nextQuestion
  let curveballQuestion: string | null = null

  if (isLastQuestion && session.pressure_mode) {
    // Generate a curveball based on the weakest answer
    const { data: allAnswers } = await admin
      .from('interview_answers')
      .select('question_text, answer_text, score')
      .eq('session_id', session_id)
      .order('score', { ascending: true })
      .limit(1)

    if (allAnswers && allAnswers.length > 0) {
      const weakest = allAnswers[0]
      const curveballUserMsg = `Persona: ${persona} interviewing at ${session.company}.

The candidate's weakest answer was to: "${weakest.question_text}"
Their answer: "${weakest.answer_text}"

Generate ONE curveball follow-up question.`

      const cbResponse = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 200,
        system: [{ type: 'text' as const, text: CURVEBALL_SYSTEM, cache_control: { type: 'ephemeral' as const } }],
        messages: [{ role: 'user', content: curveballUserMsg }],
      })
      curveballQuestion = cbResponse.content[0].type === 'text' ? cbResponse.content[0].text.trim() : null
    }
  }

  return NextResponse.json({
    answer_id: savedAnswer?.id,
    feedback,
    in_character_flag: inCharacterFlag,
    contributor_phrases_found: contributorCheck.phrases,
    lp_probe_question: lpProbeQuestion,
    next_question: curveballQuestion ?? nextQuestion?.question_text ?? null,
    is_curveball: !!curveballQuestion,
    question_index: nextIndex,
    session_complete: isLastQuestion && !curveballQuestion,
  })
}
