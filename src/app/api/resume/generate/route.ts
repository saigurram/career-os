import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { buildTailoringPrompt, selectBestTrackForJob, type ResumeTrack } from '@/lib/resume'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not configured' }, { status: 500 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { jdText, trackOverride } = await req.json()
  if (!jdText || typeof jdText !== 'string') {
    return NextResponse.json({ error: 'jdText required' }, { status: 400 })
  }

  const admin = createAdminClient()

  const [profileRes, storiesRes] = await Promise.all([
    admin.from('user_profile').select('skill_scores, target_companies').eq('user_id', user.id).single(),
    admin.from('story_bank').select('title, outcome').eq('user_id', user.id).order('owner_framing_score', { ascending: false }).limit(10),
  ])

  const profile = profileRes.data
  const stories = storiesRes.data ?? []

  const track: ResumeTrack = trackOverride ?? selectBestTrackForJob(jdText)

  const userBackground = profile
    ? `Senior PM (L6) at Amazon Transportation Services. Skills: ${JSON.stringify(profile.skill_scores ?? {})}. Target companies: ${(profile.target_companies ?? []).join(', ')}.`
    : 'Senior PM (L6) at Amazon Transportation Services with 7+ years PM experience.'

  const storyTitles = stories.map(s => s.title).filter(Boolean) as string[]

  const { systemPrompt, userMessage } = buildTailoringPrompt(track, jdText, userBackground, storyTitles)

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      system: [{ type: 'text' as const, text: systemPrompt, cache_control: { type: 'ephemeral' as const } }],
      messages: [{ role: 'user', content: userMessage }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}'
    const result = JSON.parse(text)

    return NextResponse.json({
      track,
      summary: result.summary ?? '',
      achievements: Array.isArray(result.achievements) ? result.achievements : [],
      skills_section: result.skills_section ?? '',
      tailoring_note: result.tailoring_note ?? '',
    })
  } catch (err) {
    console.error('Resume generate error:', err)
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
  }
}
