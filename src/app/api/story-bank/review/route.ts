import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/server'
import { substituteBlockedNames } from '@/lib/nda'
import type { BlockedNameEntry } from '@/lib/nda'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not configured' }, { status: 500 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { storyId } = await req.json()

  const [storyRes, blockedNamesRes] = await Promise.all([
    supabase.from('story_bank').select('*').eq('id', storyId).eq('user_id', user.id).single(),
    supabase.from('blocked_names').select('internal_name, generic_replacement, safe_for_external').eq('user_id', user.id),
  ])

  if (storyRes.error || !storyRes.data) {
    return NextResponse.json({ error: 'Story not found' }, { status: 404 })
  }

  const story = storyRes.data
  const blockedNames = (blockedNamesRes.data ?? []) as BlockedNameEntry[]

  // NDA pre-check
  const fullText = `${story.situation} ${story.what_i_drove} ${story.outcome}`
  const { substitutions: ndaSubstitutions } = substituteBlockedNames(fullText, blockedNames)

  const systemPrompt = `You are CareerOS, evaluating a PM story for interview readiness.

Check for:
1. OWNER LANGUAGE: Every action verb must be in first-person ownership. NEVER: helped/supported/assisted/contributed to/collaborated on. REQUIRED: led/drove/built/defined/owned/architected/launched/designed.
2. NDA SAFETY: Flag any internal Amazon codenames that appear (Falcon, Vega, DEFCON, Turbo Merge, or others that sound like internal platform names).
3. AUTHENTICITY: No "passionate about", "thought leader", "game-changing", "excited to share", "humbled".

OUTPUT: Respond ONLY with valid JSON:
{
  "owner_framing_score": <0-100 integer>,
  "violations": ["<specific quote + fix>"],
  "rewrite": "<rewrite of 'what_i_drove' field in clean owner language, 2-3 sentences max>",
  "nda_flags": ["<internal name found + suggested replacement>"]
}
No markdown. No extra keys.`

  const userPrompt = `Story title: ${story.title}

Situation: ${story.situation}

What I drove: ${story.what_i_drove}

Outcome: ${story.outcome}${story.impact_number ? `\n\nImpact: ${story.impact_number}` : ''}

Evaluate this story for owner framing quality, NDA safety, and authenticity.`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 700,
      system: [{ type: 'text' as const, text: systemPrompt, cache_control: { type: 'ephemeral' as const } }],
      messages: [{ role: 'user', content: userPrompt }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}'
    const review = JSON.parse(text)

    // Merge NDA substitutions found locally with any Claude found
    const allNdaFlags = [
      ...ndaSubstitutions.map(s => s),
      ...(Array.isArray(review.nda_flags) ? review.nda_flags : []),
    ]
    const dedupedNdaFlags = Array.from(new Set(allNdaFlags))

    const result = {
      owner_framing_score: typeof review.owner_framing_score === 'number' ? review.owner_framing_score : 0,
      violations: Array.isArray(review.violations) ? review.violations : [],
      rewrite: typeof review.rewrite === 'string' ? review.rewrite : '',
      nda_flags: dedupedNdaFlags,
    }

    // Persist score back to story
    const admin = createAdminClient()
    await admin.from('story_bank').update({ owner_framing_score: result.owner_framing_score }).eq('id', storyId)

    return NextResponse.json(result)
  } catch (err) {
    console.error('Story review error:', err)
    return NextResponse.json({ error: 'Review failed' }, { status: 500 })
  }
}
