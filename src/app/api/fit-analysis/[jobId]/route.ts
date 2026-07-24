import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/server'
import { parseFitAnalysis } from '@/lib/fit-analyzer'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(
  _req: Request,
  { params }: { params: { jobId: string } }
) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not configured' }, { status: 500 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { jobId } = params

  const [jobRes, profileRes, storiesRes] = await Promise.all([
    supabase.from('jobs').select('id, title, company, jd_text, level_estimate').eq('id', jobId).single(),
    supabase.from('user_profile').select('skill_scores').eq('user_id', user.id).single(),
    supabase.from('story_bank').select('title, outcome, impact_number').eq('user_id', user.id).limit(10),
  ])

  if (jobRes.error || !jobRes.data) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  const job = jobRes.data
  const skillScores = (profileRes.data?.skill_scores ?? {}) as Record<string, number>
  const stories = storiesRes.data ?? []

  const skillSummary = Object.entries(skillScores)
    .map(([k, v]) => `${k}: ${v}/10`)
    .join(', ')

  const storySummary = stories.length > 0
    ? stories.map(s => `• ${s.title}: ${s.outcome}${s.impact_number ? ` (${s.impact_number})` : ''}`).join('\n')
    : 'No stories in bank yet.'

  const systemPrompt = `You are CareerOS, a career coach for a Senior PM at Amazon (L6, Hyderabad) targeting Principal PM roles.
Analyze job fit honestly. Be direct. No filler language.
LANGUAGE RULES: Owner language only (led/drove/built/owned). Never: helped/supported/assisted/contributed.
OUTPUT: Respond ONLY with valid JSON matching this schema exactly:
{
  "fit_score": <number 0-100>,
  "strengths": [{ "skill": "<string>", "story_suggestion": "<which story to use or what to highlight>" }],
  "gaps": [{ "skill": "<string>", "severity": "blocking|manageable|minor", "action": "<specific closure action>" }],
  "recommendation": "Apply now|Close gap first|Skip",
  "resume_note": "<one sentence on which resume angle to emphasize>"
}
Return exactly 3 strengths and 3 gaps. No extra keys. No markdown.`

  const userPrompt = `Job: ${job.title} at ${job.company} (${job.level_estimate ?? 'level unknown'})

Job description:
${job.jd_text?.slice(0, 2000) ?? 'No JD available'}

My current skill scores: ${skillSummary || 'Not assessed yet'}

My story bank:
${storySummary}

Analyze fit for this role.`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}'
    const parsed = JSON.parse(text)
    const analysis = parseFitAnalysis(parsed)
    if (!analysis) return NextResponse.json({ error: 'Invalid analysis response' }, { status: 500 })

    // Persist to jobs table using admin client (bypasses RLS on jobs)
    const admin = createAdminClient()
    await admin.from('jobs').update({
      fit_score: analysis.fit_score,
      fit_analysis: analysis as unknown as Record<string, unknown>,
    }).eq('id', jobId)

    return NextResponse.json(analysis)
  } catch (err) {
    console.error('Fit analysis error:', err)
    return NextResponse.json({ error: 'Analysis failed' }, { status: 500 })
  }
}
