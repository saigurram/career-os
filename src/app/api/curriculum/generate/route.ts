import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/server'
import { parseGeneratedContent, getPillarForUnit, extractFinalText, createWithWebSearch, WEB_SEARCH_TOOL } from '@/lib/claude'
import { buildCurriculumGenerationPrompt, isContentStale, type GenerateTrigger, type ReplaceBecause, type CurriculumGenerationInputs } from '@/lib/curriculum'
import { embedText, cosineSimilarity } from '@/lib/embeddings'

const CONTENT_SIMILARITY_THRESHOLD = 0.85
const MAX_CONTENT_RETRIES = 2

function contentSimilarityText(content: { learn_resource_title: string; create_task: string; outreach_who: string }): string {
  return `${content.learn_resource_title} ${content.create_task} ${content.outreach_who}`
}

export async function POST(request: Request) {
  try {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not configured in .env.local' }, { status: 500 })
  }
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { unit_id, trigger = 'auto' } = body as { unit_id: string; trigger: GenerateTrigger }

  if (!unit_id) return NextResponse.json({ error: 'unit_id is required' }, { status: 400 })

  const admin = createAdminClient()

  // ── Fetch unit ───────────────────────────────────────────────────────────────
  const { data: unit } = await admin
    .from('curriculum_units')
    .select('id, unit_number, primary_theme, required_ai_concept_tier')
    .eq('id', unit_id)
    .single()

  if (!unit) return NextResponse.json({ error: 'Unit not found' }, { status: 404 })

  // ── Check existing content ───────────────────────────────────────────────────
  const { data: existing } = await admin
    .from('curriculum_unit_content')
    .select('*')
    .eq('unit_id', unit_id)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (trigger === 'auto' && existing && !isContentStale(existing.generated_at)) {
    return NextResponse.json({ content: existing, skipped: true })
  }

  // ── Save history before replacing ────────────────────────────────────────────
  const replaceBecause: ReplaceBecause = trigger === 'manual' ? 'manual'
    : trigger === 'smart' ? 'smart_refresh'
    : 'stale'

  if (existing && (trigger === 'manual' || trigger === 'smart')) {
    await admin.from('curriculum_unit_content_history').insert({
      unit_id,
      user_id: user.id,
      content: JSON.parse(JSON.stringify(existing)),
      replaced_because: replaceBecause,
      embedding: existing.embedding ?? null,
    })
  }

  // ── Fetch all live context in parallel ──────────────────────────────────────
  const [
    { data: userData },
    { data: profile },
    { data: intakeRows },
    { data: stories },
    { data: powArtifacts },
    { data: coveredConcepts },
    { data: allConcepts },
    { data: topJobs },
    { data: progressRows },
    { data: allUnits },
    { data: otherUnitContents },
    { data: historyRows },
  ] = await Promise.all([
    admin.from('users')
      .select('current_level, current_company, target_level, target_location, offer_deadline, job_title')
      .eq('id', user.id)
      .single(),

    admin.from('user_profile')
      .select('skill_scores, genai_baseline_score, years_experience, total_impact_usd, last_reassessed_at')
      .eq('user_id', user.id)
      .single(),

    admin.from('intake_responses')
      .select('dimension, score')
      .eq('user_id', user.id),

    admin.from('story_bank')
      .select('title')
      .eq('user_id', user.id)
      .order('id', { ascending: false })
      .limit(3),

    admin.from('pow_artifacts')
      .select('title')
      .eq('user_id', user.id)
      .not('published_at', 'is', null)
      .order('published_at', { ascending: false })
      .limit(3),

    admin.from('user_ai_concept_coverage')
      .select('concept_id')
      .eq('user_id', user.id),

    admin.from('ai_concepts')
      .select('id, name, tier, concept_number')
      .lte('tier', unit.required_ai_concept_tier)
      .order('concept_number'),

    admin.from('jobs')
      .select('title, company, fit_score, fit_analysis')
      .eq('is_active', true)
      .order('fit_score', { ascending: false, nullsFirst: false })
      .limit(5),

    admin.from('user_unit_progress')
      .select('unit_id')
      .eq('user_id', user.id)
      .not('completed_at', 'is', null),

    admin.from('curriculum_units')
      .select('id, unit_number')
      .order('unit_number'),

    admin.from('curriculum_unit_content')
      .select('unit_id, learn_resource_title, create_type, outreach_criteria, ai_concept_id, embedding')
      .neq('unit_id', unit_id),

    admin.from('curriculum_unit_content_history')
      .select('embedding'),
  ])

  // ── Derive values from fetched data ─────────────────────────────────────────
  const skillScores = (profile?.skill_scores as Record<string, number>) ?? {}

  // Intake dimension scores
  const intake = (intakeRows ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.dimension] = r.score
    return acc
  }, {})
  const domainScore = intake['domain'] ?? intake['domain_depth'] ?? 0
  const externalVisibilityScore = intake['external_visibility'] ?? 0
  // Use intake genai score if profile baseline is 0 or missing
  const genaiBaselineScore = (profile?.genai_baseline_score && profile.genai_baseline_score > 0)
    ? profile.genai_baseline_score
    : (intake['genai_pm_fluency'] ?? intake['genai_fluency'] ?? 0)

  // Concepts already assigned to other units (even if not yet completed by user)
  const assignedConceptIds = new Set(
    (otherUnitContents ?? [])
      .map(c => c.ai_concept_id)
      .filter((id): id is string => id !== null)
  )

  // Uncovered = not completed by user AND not already assigned to another unit
  const coveredIds = new Set(
    [...(coveredConcepts ?? []).map(c => c.concept_id), ...Array.from(assignedConceptIds)]
  )
  const uncoveredConcepts = (allConcepts ?? []).filter(c => !coveredIds.has(c.id))
  const targetConcept = uncoveredConcepts[0] ?? null
  const uncoveredConceptNames = uncoveredConcepts.slice(0, 8).map(c => c.name)

  // Summaries of already-generated units so Claude never repeats topics, create formats, or outreach targets
  const unitNumberById = new Map((allUnits ?? []).map(u => [u.id, u.unit_number]))
  const previousUnitSummaries = (otherUnitContents ?? [])
    .map(c => {
      const num = unitNumberById.get(c.unit_id)
      if (!num) return null
      const outreachHint = c.outreach_criteria?.split('.')[0]?.slice(0, 80) ?? ''
      return `Unit ${num}: learn "${c.learn_resource_title}", create type: ${c.create_type}, outreach: ${outreachHint}`
    })
    .filter((s): s is string => s !== null)
    .sort()

  // Completed units
  const completedUnitIds = new Set((progressRows ?? []).map(p => p.unit_id))
  const completedUnitNumbers = (allUnits ?? [])
    .filter(u => completedUnitIds.has(u.id))
    .map(u => u.unit_number)

  // Job context string
  const jobContext = (topJobs ?? []).map(j => {
    const analysis = j.fit_analysis as { gaps?: { skill: string }[] } | null
    const gaps = (analysis?.gaps ?? []).map(g => g.skill).slice(0, 3).join(', ')
    return `Role: ${j.title} at ${j.company}${gaps ? ` | Gaps: ${gaps.slice(0, 100)}` : ''}`
  }).join('\n')

  // Prior content embeddings — both currently-live content on other units and anything
  // previously replaced (a "smart refresh" shouldn't regenerate something identical to a
  // version from 3 refreshes ago just because it's no longer the live row).
  const priorContentEmbeddings = [
    ...(otherUnitContents ?? []).map(c => c.embedding as number[] | null),
    ...(historyRows ?? []).map(h => h.embedding as number[] | null),
  ].filter((e): e is number[] => Array.isArray(e) && e.length > 0)

  // ── Build prompt inputs ──────────────────────────────────────────────────────
  const pillar = getPillarForUnit(unit.unit_number)
  const promptInputs: CurriculumGenerationInputs = {
    unitNumber: unit.unit_number,
    unitTheme: unit.primary_theme,
    pillar,
    aiConceptName: targetConcept?.name ?? `Tier ${unit.required_ai_concept_tier} AI concept`,
    aiConceptTier: unit.required_ai_concept_tier,
    currentDate: new Date().toISOString().split('T')[0],
    skillScores,
    genaiBaselineScore,
    domainScore,
    externalVisibilityScore,
    currentRole: userData?.job_title ?? 'Senior PM',
    currentLevel: userData?.current_level ?? 'L6',
    targetLevel: userData?.target_level ?? 'Principal PM',
    targetLocation: userData?.target_location ?? 'Hyderabad',
    offerDeadline: userData?.offer_deadline ?? 'June 2027',
    yearsExperience: profile?.years_experience ?? 0,
    completedUnitNumbers,
    bankedStoryTitles: (stories ?? []).map(s => s.title),
    publishedArtifactTitles: (powArtifacts ?? []).map(p => p.title),
    uncoveredConceptNames,
    jobContext,
    previousUnitSummaries,
  }

  const { systemPrompt, userMessage } = buildCurriculumGenerationPrompt(promptInputs)

  // ── Call Claude with prompt caching + web_search, retrying on embedding-similarity
  // collisions against prior content (own or any other unit's) up to MAX_CONTENT_RETRIES ──
  let content: ReturnType<typeof parseGeneratedContent> = null
  let contentEmbedding: number[] | null = null
  let flaggedNearDuplicate = false
  let lastRawText = ''
  let lastParseFailed = false

  for (let attempt = 0; attempt <= MAX_CONTENT_RETRIES; attempt++) {
    const response = await createWithWebSearch(anthropic, {
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      tools: [WEB_SEARCH_TOOL],
      system: [
        {
          type: 'text' as const,
          text: systemPrompt,
          cache_control: { type: 'ephemeral' as const },
        },
      ],
      messages: [{ role: 'user', content: userMessage }],
    })

    const rawText = extractFinalText(response.content)
    lastRawText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()

    let parsed: unknown
    try {
      parsed = JSON.parse(lastRawText)
      lastParseFailed = false
    } catch {
      lastParseFailed = true
      continue
    }

    const candidate = parseGeneratedContent(parsed)
    if (!candidate) continue

    const candidateEmbedding = await embedText(contentSimilarityText(candidate))
    const maxSimilarity = priorContentEmbeddings.reduce(
      (max, prior) => Math.max(max, cosineSimilarity(candidateEmbedding, prior)),
      0
    )

    if (maxSimilarity <= CONTENT_SIMILARITY_THRESHOLD || attempt === MAX_CONTENT_RETRIES) {
      content = candidate
      contentEmbedding = candidateEmbedding
      flaggedNearDuplicate = maxSimilarity > CONTENT_SIMILARITY_THRESHOLD
      break
    }
  }

  if (lastParseFailed && !content) {
    return NextResponse.json({ error: 'Claude returned non-JSON output', raw: lastRawText.slice(0, 300) }, { status: 500 })
  }
  if (!content) {
    return NextResponse.json({ error: 'Invalid content shape from Claude', raw: lastRawText.slice(0, 300) }, { status: 500 })
  }
  if (flaggedNearDuplicate) {
    console.warn(`[curriculum/generate] accepting near-duplicate content for unit ${unit_id} after ${MAX_CONTENT_RETRIES} retries`)
  }

  // ── Persist ──────────────────────────────────────────────────────────────────
  const { error: deleteError } = await admin
    .from('curriculum_unit_content')
    .delete()
    .eq('unit_id', unit_id)

  if (deleteError) {
    return NextResponse.json({ error: `Delete failed: ${deleteError.message}` }, { status: 500 })
  }

  const { data: saved, error: insertError } = await admin
    .from('curriculum_unit_content')
    .insert({
      unit_id,
      learn_resource_title: content.learn_resource_title,
      learn_resource_url: content.learn_resource_url,
      learn_resource_format: content.learn_resource_format,
      learn_resource_minutes: content.learn_resource_minutes,
      learn_why: content.learn_why,
      learn_prompt: content.learn_prompt,
      create_task: content.create_task,
      create_type: content.create_type,
      create_opening_line: content.create_opening_line,
      create_good_looks_like: content.create_good_looks_like,
      create_nda_note: content.create_nda_note || null,
      outreach_criteria: content.outreach_who,       // outreach_who → outreach_criteria column
      outreach_linkedin_search: content.outreach_linkedin_search,
      outreach_message_draft: content.outreach_message_draft,
      ai_concept_id: targetConcept?.id ?? null,
      reflect_question: content.reflect_question,
      embedding: contentEmbedding,
    })
    .select('*')
    .single()

  if (insertError || !saved) {
    console.error('[curriculum/generate] insert error:', insertError)
    return NextResponse.json({ error: insertError?.message ?? 'Insert returned no data' }, { status: 500 })
  }

  return NextResponse.json({
    content: saved,
    trigger,
    replaced_existing: !!(existing && trigger !== 'auto'),
    unit_number: unit.unit_number,
    concept_name: targetConcept?.name ?? null,
  })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[curriculum/generate] unhandled error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
