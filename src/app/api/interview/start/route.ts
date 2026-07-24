import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/server'
import { CAREEROS_RULES, extractFinalText, createWithWebSearch, WEB_SEARCH_TOOL } from '@/lib/claude'
import {
  getDifficultyRangeForSession,
  buildQuestionPrompt,
  parseGeneratedQuestion,
  filterAskedQuestions,
  partitionByEmbeddingNovelty,
  type CompanyTier,
  type GeneratedQuestion,
} from '@/lib/interview-questions'
import {
  shouldRegeneratePlaybook,
  buildPlaybookPrompt,
  parseGeneratedPlaybook,
  getCompanyEntry,
} from '@/lib/company-playbooks'
import { embedBatch, cosineSimilarity } from '@/lib/embeddings'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const TARGET_QUESTION_COUNT = 5
const REQUEST_QUESTION_COUNT = 8 // ask for extra candidates so novelty filtering doesn't leave us short
const MAX_QUESTION_RETRIES = 2
const EMBEDDING_SIMILARITY_THRESHOLD = 0.85
const DO_NOT_REPEAT_PROMPT_LIMIT = 50 // cap the in-prompt hint list; the actual dedup check below covers full history

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not configured' }, { status: 500 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { company, round_type, persona, pressure_mode = false, jd_id } = body

  if (!company || !round_type || !persona) {
    return NextResponse.json({ error: 'company, round_type, and persona are required' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Fetch user profile for skill gaps
  const { data: profile } = await admin
    .from('user_profile')
    .select('skill_scores')
    .eq('user_id', user.id)
    .single()

  const skillScores = (profile?.skill_scores as Record<string, number>) ?? {}

  // Compute skill gaps (target - current, 0 if already at target)
  const TARGETS: Record<string, number> = {
    genai_fluency: 8, platform_thinking: 9, executive_communication: 8,
    stakeholder_influence: 8, data_analytics: 8, domain_depth: 9, external_visibility: 7,
  }
  const skillGaps: Record<string, number> = {}
  for (const [dim, target] of Object.entries(TARGETS)) {
    const current = skillScores[dim] ?? 5
    skillGaps[dim] = Math.max(0, target - current)
  }

  // Count prior sessions with this company (for difficulty progression)
  const { count: priorSessionCount } = await admin
    .from('interview_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('company', company)

  const sessionCount = (priorSessionCount ?? 0) + 1
  const isGauntlet = sessionCount > 30 // Late-program gauntlet mode, triggered by caller near the end of the unit sequence
  const difficultyRange = getDifficultyRangeForSession(sessionCount, isGauntlet)

  // Prior questions for this user ACROSS ALL COMPANIES (not just this one) — concepts
  // overlap across Amazon/Microsoft/Google loops even when phrasing differs, so the
  // never-repeat guarantee needs to check the user's full question history, not just
  // this company's.
  const { data: priorQuestionRows } = await admin
    .from('interview_questions')
    .select('question_text, embedding')
    .eq('user_id', user.id)

  const priorAskedTexts = (priorQuestionRows ?? []).map(q => q.question_text)
  const priorEmbeddings = (priorQuestionRows ?? [])
    .map(q => q.embedding as number[] | null)
    .filter((e): e is number[] => Array.isArray(e) && e.length > 0)

  // Fetch optional JD text
  let jdText: string | null = null
  if (jd_id) {
    const { data: job } = await admin.from('jobs').select('jd_text').eq('id', jd_id).single()
    jdText = job?.jd_text ?? null
  }

  // Fetch or generate playbook
  const companyEntry = getCompanyEntry(company)
  const tier = (companyEntry?.tier ?? 1) as CompanyTier

  const { data: existingPlaybook } = await admin
    .from('company_playbooks')
    .select('*')
    .eq('company', company)
    .single()

  if (!existingPlaybook || shouldRegeneratePlaybook(existingPlaybook.generated_at)) {
    // Generate playbook via Claude, grounded in live web search (last-90-days interview
    // experience reports etc). Cost is naturally bounded to once per company per month by
    // the shouldRegeneratePlaybook TTL check above.
    const userBackground = `Senior PM at Amazon (L6, Hyderabad, Transportation Services). Targeting Principal PM roles in Hyderabad by June 2027.`
    const playbookPrompt = buildPlaybookPrompt(company, tier, userBackground)

    try {
      const playbookResponse = await createWithWebSearch(anthropic, {
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        tools: [WEB_SEARCH_TOOL],
        system: [{ type: 'text' as const, text: CAREEROS_RULES, cache_control: { type: 'ephemeral' as const } }],
        messages: [{ role: 'user', content: playbookPrompt }],
      })
      const playbookText = extractFinalText(playbookResponse.content)
      const parsedPlaybook = parseGeneratedPlaybook(JSON.parse(playbookText))
      if (parsedPlaybook) {
        await admin.from('company_playbooks').upsert({
          company,
          tier,
          interview_format: parsedPlaybook.interview_format,
          what_they_test: parsedPlaybook.what_they_test,
          common_mistakes: parsedPlaybook.common_mistakes,
          insider_tips: parsedPlaybook.insider_tips,
          user_specific_angle: parsedPlaybook.user_specific_angle,
          india_context: parsedPlaybook.india_context ? JSON.stringify(parsedPlaybook.india_context) : null,
          comp_context_inr: parsedPlaybook.comp_context_inr,
          generated_at: new Date().toISOString(),
        }, { onConflict: 'company' })
      }
    } catch {
      // Non-fatal — proceed without playbook regeneration
    }
  }

  // Create the session
  const { data: session, error: sessionError } = await admin
    .from('interview_sessions')
    .insert({
      user_id: user.id,
      company,
      round_type,
      pressure_mode,
      completed_at: null,
      overall_score: null,
      debrief: null,
      pattern_analysis: null,
    })
    .select('id')
    .single()

  if (sessionError || !session) {
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 })
  }

  // ── Generate questions with lexical + embedding novelty checks ──────────────
  // Lexical filter runs first (cheap, in-process). Embedding similarity is the
  // authoritative second pass, catching paraphrases the word-overlap check misses.
  // Up to MAX_QUESTION_RETRIES regenerations; anything still colliding after that is
  // accepted but flagged rather than leaving the session short of questions.
  let acceptedQuestions: GeneratedQuestion[] = []
  const nearDuplicatePool: GeneratedQuestion[] = []

  for (
    let attempt = 0;
    attempt <= MAX_QUESTION_RETRIES && acceptedQuestions.length < TARGET_QUESTION_COUNT;
    attempt++
  ) {
    const alreadyAcceptedTexts = acceptedQuestions.map(q => q.question_text)
    const askedForDedup = [...priorAskedTexts, ...alreadyAcceptedTexts]
    const askedForPrompt = askedForDedup.slice(-DO_NOT_REPEAT_PROMPT_LIMIT)

    const questionPrompt = buildQuestionPrompt({
      company,
      tier,
      roundType: round_type,
      difficultyRange,
      userAnswerHistory: [],
      jdText,
      skillGaps,
      askedQuestions: askedForPrompt,
      persona,
      count: REQUEST_QUESTION_COUNT,
    })

    const qResponse = await createWithWebSearch(anthropic, {
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      tools: [WEB_SEARCH_TOOL],
      system: [{ type: 'text' as const, text: CAREEROS_RULES, cache_control: { type: 'ephemeral' as const } }],
      messages: [{ role: 'user', content: questionPrompt }],
    })

    const qText = extractFinalText(qResponse.content)
    let rawQuestions: unknown
    try {
      rawQuestions = JSON.parse(qText)
    } catch {
      rawQuestions = []
    }
    const candidates = Array.isArray(rawQuestions)
      ? rawQuestions.map(parseGeneratedQuestion).filter((q): q is GeneratedQuestion => q !== null)
      : []

    if (candidates.length === 0) continue

    // Lexical pass
    const candidateTexts = candidates.map(c => c.question_text)
    const lexicalSurvivorTexts = new Set(filterAskedQuestions(candidateTexts, askedForDedup))
    const lexicalSurvivors = candidates.filter(c => lexicalSurvivorTexts.has(c.question_text))

    if (lexicalSurvivors.length === 0) continue

    // Embedding pass — compare each survivor against every prior embedding for this user
    const survivorEmbeddings = await embedBatch(lexicalSurvivors.map(c => c.question_text))
    const similarityResults = lexicalSurvivors.map((c, i) => ({
      text: c.question_text,
      maxSimilarity: priorEmbeddings.reduce(
        (max, priorEmb) => Math.max(max, cosineSimilarity(survivorEmbeddings[i], priorEmb)),
        0
      ),
    }))
    const { novel, nearDuplicate } = partitionByEmbeddingNovelty(similarityResults, EMBEDDING_SIMILARITY_THRESHOLD)

    const novelSet = new Set(novel)
    const nearDupSet = new Set(nearDuplicate)
    const novelQuestions = lexicalSurvivors.filter(c => novelSet.has(c.question_text))
    const nearDupQuestions = lexicalSurvivors.filter(c => nearDupSet.has(c.question_text))

    acceptedQuestions = [...acceptedQuestions, ...novelQuestions].slice(0, TARGET_QUESTION_COUNT)
    nearDuplicatePool.push(...nearDupQuestions)
  }

  // Still short after retries — accept the best-available near-duplicates rather than
  // leaving the session with fewer than TARGET_QUESTION_COUNT questions, but flag them.
  if (acceptedQuestions.length < TARGET_QUESTION_COUNT && nearDuplicatePool.length > 0) {
    const stillNeeded = TARGET_QUESTION_COUNT - acceptedQuestions.length
    const flagged = nearDuplicatePool.slice(0, stillNeeded).map(q => ({
      ...q,
      tags: [...q.tags, 'near_duplicate_accepted'],
    }))
    console.warn(
      `[interview/start] accepting ${flagged.length} near-duplicate question(s) after ${MAX_QUESTION_RETRIES} retries for user ${user.id}`
    )
    acceptedQuestions = [...acceptedQuestions, ...flagged]
  }

  const questions = acceptedQuestions

  // Save generated questions for future dedup, including their embeddings
  if (questions.length > 0) {
    const questionEmbeddings = await embedBatch(questions.map(q => q.question_text))
    await admin.from('interview_questions').insert(
      questions.map((q, i) => ({
        session_id: session.id,
        user_id: user.id,
        company,
        tier,
        category: q.category,
        question_text: q.question_text,
        difficulty: q.difficulty,
        lp_map: q.lp_map,
        tags: q.tags,
        embedding: questionEmbeddings[i],
      }))
    )
  }

  return NextResponse.json({
    session_id: session.id,
    company,
    round_type,
    persona,
    pressure_mode,
    difficulty_range: difficultyRange,
    session_number: sessionCount,
    questions: questions.map(q => ({
      question_text: q.question_text,
      category: q.category,
      difficulty: q.difficulty,
    })),
    first_question: questions[0]?.question_text ?? null,
  })
}
