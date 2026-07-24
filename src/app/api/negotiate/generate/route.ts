import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import {
  getBenchmark, getTotalComp, computeCounterRange,
  getBatnaFraming, getCounterEmailAnchor, formatCrore,
} from '@/lib/negotiation'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const NEGOTIATION_SYSTEM = `You are CareerOS Negotiation Coach, helping a Senior PM (L6) at Amazon Hyderabad negotiate a job offer.

RULES — ABSOLUTE:
- Owner language only: led, drove, built, owned, architected. Never: helped, supported, collaborated.
- Never reveal the user is "desperate" or "will take anything."
- BATNA is always: continue at Amazon L6 while applying elsewhere.
- Never fabricate competing offers that don't exist.
- Anchoring strategy: target 15% above offer. Never settle below 8% above.
- All compensation in INR (Crore / Lakh format).

OUTPUT: Respond ONLY with valid JSON:
{
  "counter_email": "<3-5 sentence professional counter offer email body. Specific number. Market anchor. Owner framing.>",
  "call_script": "<Bullet-point talking points for negotiation call. 4-6 bullets. Direct, confident, no filler.>",
  "key_leverage": "<One sentence: the single strongest leverage point to lead with.>",
  "red_lines": "<One sentence: the minimum acceptable outcome, never to reveal aloud.>"
}
No markdown. No extra keys.`

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not configured' }, { status: 500 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { company, role, baseInr, bonusInr, rsuInr, joiningBonusInr } = await req.json()

  if (!company || !role || baseInr == null) {
    return NextResponse.json({ error: 'company, role, baseInr required' }, { status: 400 })
  }

  const benchmark = getBenchmark(company)
  const offerTotal = getTotalComp(
    Number(baseInr),
    Number(bonusInr ?? 0),
    Number(rsuInr ?? 0),
    Number(joiningBonusInr ?? 0),
  )
  const counter = computeCounterRange(offerTotal, benchmark)
  const batna = getBatnaFraming(company, benchmark)
  const emailAnchor = getCounterEmailAnchor(offerTotal, benchmark, counter)

  const userMessage = `Offer details:
Company: ${company}
Role: ${role}
Offer total: ${formatCrore(offerTotal)} (base: ${formatCrore(Number(baseInr))}, bonus: ${formatCrore(Number(bonusInr ?? 0))}, RSU: ${formatCrore(Number(rsuInr ?? 0))}, joining: ${formatCrore(Number(joiningBonusInr ?? 0))})
Target counter: ${formatCrore(counter.targetInr)} (${counter.percentAboveOffer}% above)
${benchmark ? `Market benchmark: ${benchmark.level} at ${benchmark.company} = ${formatCrore(Number((benchmark.minCr + benchmark.maxCr) / 2 * 10_000_000))} midpoint` : 'No benchmark found for this company.'}

BATNA context: ${batna}
Email anchor phrase to use: "${emailAnchor}"

Generate the counter email and negotiation call script.`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 900,
      system: [{ type: 'text' as const, text: NEGOTIATION_SYSTEM, cache_control: { type: 'ephemeral' as const } }],
      messages: [{ role: 'user', content: userMessage }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}'
    const result = JSON.parse(text)

    return NextResponse.json({
      counter_email: result.counter_email ?? '',
      call_script: result.call_script ?? '',
      key_leverage: result.key_leverage ?? '',
      red_lines: result.red_lines ?? '',
      counter,
      benchmark: benchmark ?? null,
    })
  } catch (err) {
    console.error('Negotiate generate error:', err)
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
  }
}
