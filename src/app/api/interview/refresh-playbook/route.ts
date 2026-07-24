import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/server'
import { CAREEROS_RULES } from '@/lib/claude'
import {
  buildPlaybookPrompt,
  parseGeneratedPlaybook,
  getCompanyEntry,
} from '@/lib/company-playbooks'
import type { CompanyTier } from '@/lib/interview-questions'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not configured' }, { status: 500 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { company } = body

  if (!company) return NextResponse.json({ error: 'company is required' }, { status: 400 })

  const entry = getCompanyEntry(company)
  if (!entry) return NextResponse.json({ error: 'Unknown company' }, { status: 400 })

  const admin = createAdminClient()
  const { data: userRow } = await admin
    .from('users')
    .select('name, current_company, target_level')
    .eq('id', user.id)
    .single()

  const userBackground = `${userRow?.name ?? 'Senior PM'} at ${userRow?.current_company ?? 'Amazon'} (L6, Hyderabad, Transportation Services). Targeting ${userRow?.target_level ?? 'Principal PM'} roles in Hyderabad by June 2027.`

  const prompt = buildPlaybookPrompt(company, entry.tier as CompanyTier, userBackground)

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1200,
    system: [{ type: 'text' as const, text: CAREEROS_RULES, cache_control: { type: 'ephemeral' as const } }],
    messages: [{ role: 'user', content: prompt }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : '{}'
  const playbook = parseGeneratedPlaybook(JSON.parse(text))

  if (!playbook) {
    return NextResponse.json({ error: 'Failed to generate valid playbook' }, { status: 500 })
  }

  await admin.from('company_playbooks').upsert({
    company,
    tier: entry.tier,
    interview_format: playbook.interview_format,
    what_they_test: playbook.what_they_test,
    common_mistakes: playbook.common_mistakes,
    insider_tips: playbook.insider_tips,
    user_specific_angle: playbook.user_specific_angle,
    india_context: playbook.india_context ? JSON.stringify(playbook.india_context) : null,
    comp_context_inr: playbook.comp_context_inr,
    generated_at: new Date().toISOString(),
  }, { onConflict: 'company' })

  return NextResponse.json({ playbook, refreshed_at: new Date().toISOString() })
}
