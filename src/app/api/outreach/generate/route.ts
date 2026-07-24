import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const TARGET_COMPANIES = ['Google', 'Uber', 'Microsoft', 'Experian', 'ServiceNow', 'Amazon L7']

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not configured' }, { status: 500 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { currentUnitNumber, userName, currentCompany, targetLevel } = await req.json()

  // Fetch current unit theme for context
  const { data: unit } = await supabase
    .from('curriculum_units')
    .select('primary_theme')
    .eq('unit_number', currentUnitNumber)
    .single()

  const unitTheme = unit?.primary_theme ?? 'AI product management'

  const systemPrompt = `You are CareerOS, a career coach for ${userName}, a Senior PM at ${currentCompany} targeting ${targetLevel} roles in Hyderabad.

LANGUAGE RULES:
- Owner language only: led/drove/built/owned. NEVER: helped/supported/assisted/contributed
- No "pick your brain", no "I'd love to connect", no vague asks
- No "passionate about", "thought leader", "game-changing", "excited to share"
- Every message must reference something specific about their work OR the user's published work
- End with a specific, answerable ask

OUTPUT: Respond ONLY with valid JSON:
{
  "name": "<realistic Indian PM name>",
  "role": "<specific PM role>",
  "company": "<one of: ${TARGET_COMPANIES.join(', ')}>",
  "linkedin_url": "https://linkedin.com/in/<realistic-slug>",
  "rationale": "<2 sentences: why this person, what makes them relevant to current unit theme>",
  "message_draft": "<4-sentence LinkedIn message: sentence 1 = specific observation about their work, sentence 2 = what ${userName} built/drove that's relevant, sentence 3 = why this specific connection makes sense now, sentence 4 = specific ask with a clear yes/no answer>"
}`

  const userPrompt = `Current curriculum unit: ${currentUnitNumber} — Theme: "${unitTheme}"
Target companies: ${TARGET_COMPANIES.join(', ')}
User background: Senior PM at ${currentCompany}, targeting ${targetLevel} in Hyderabad

Identify one specific PM at a target company who would be relevant to connect with given this unit's theme. Generate a draft outreach message.`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}'
    const generated = JSON.parse(text)

    return NextResponse.json({
      name: generated.name ?? '',
      role: generated.role ?? '',
      company: generated.company ?? '',
      linkedin_url: generated.linkedin_url ?? '',
      rationale: generated.rationale ?? '',
      message_draft: generated.message_draft ?? '',
    })
  } catch (err) {
    console.error('Outreach generate error:', err)
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
  }
}
