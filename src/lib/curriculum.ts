// Pure functions for curriculum on-demand generation logic.
// All functions are side-effect free and fully unit-testable.

export type SmartRefreshReason = 'new_job_skill' | 'content_stale' | 'skill_scores_changed'
export type GenerateTrigger = 'auto' | 'manual' | 'smart' | 'generate_all'
export type ReplaceBecause = 'manual' | 'smart_refresh' | 'stale'
export type TaskType = 'learn' | 'create' | 'outreach' | 'reflect'
export type TaskSizeLabel = 'L' | 'M' | 'S'

// ─── Staleness ────────────────────────────────────────────────────────────────

export function isContentStale(generatedAt: string | null, maxAgeDays = 14): boolean {
  if (!generatedAt) return true
  const age = Date.now() - new Date(generatedAt).getTime()
  return age > maxAgeDays * 24 * 60 * 60 * 1000
}

// ─── Smart refresh ────────────────────────────────────────────────────────────

export function buildSmartRefreshReasons(params: {
  generatedAt: string | null
  skillScoresUpdatedAt: string | null
  lastGeneratedSkillScores: Record<string, number> | null
  currentSkillScores: Record<string, number>
  activeJobSkillTags: string[]
  unitSkillDimensions: string[]
  maxAgeDays?: number
}): SmartRefreshReason[] {
  const {
    generatedAt, skillScoresUpdatedAt, lastGeneratedSkillScores,
    currentSkillScores, activeJobSkillTags, unitSkillDimensions, maxAgeDays = 14,
  } = params

  const reasons: SmartRefreshReason[] = []

  // Reason 1: content is stale (14+ days old)
  if (isContentStale(generatedAt, maxAgeDays)) {
    reasons.push('content_stale')
  }

  // Reason 2: active jobs require skills this unit covers
  const hasJobOverlap = activeJobSkillTags.some(tag =>
    unitSkillDimensions.some(dim => dim.toLowerCase().includes(tag.toLowerCase()) || tag.toLowerCase().includes(dim.toLowerCase()))
  )
  if (hasJobOverlap) {
    reasons.push('new_job_skill')
  }

  // Reason 3: skill scores changed since last generation
  if (skillScoresUpdatedAt && lastGeneratedSkillScores && generatedAt) {
    const scoresUpdated = new Date(skillScoresUpdatedAt).getTime()
    const contentGenerated = new Date(generatedAt).getTime()
    if (scoresUpdated > contentGenerated) {
      // Check if any score changed meaningfully (>= 0.5 point)
      const changed = Object.keys(currentSkillScores).some(dim => {
        const prev = lastGeneratedSkillScores[dim] ?? 0
        const curr = currentSkillScores[dim] ?? 0
        return Math.abs(curr - prev) >= 0.5
      })
      if (changed) reasons.push('skill_scores_changed')
    }
  }

  return reasons
}

export function shouldShowSmartRefreshBanner(
  reasons: SmartRefreshReason[],
  dismissed: boolean
): boolean {
  return reasons.length > 0 && !dismissed
}

export function smartRefreshBannerMessage(reasons: SmartRefreshReason[]): string {
  if (reasons.includes('new_job_skill')) {
    return 'New jobs in your feed require skills this unit covers. Regenerate to align?'
  }
  if (reasons.includes('skill_scores_changed')) {
    return 'Your skill scores have changed since this unit was generated. Regenerate for a better fit?'
  }
  return 'This unit content is over 2 weeks old. Regenerate to stay current?'
}

// ─── Task size labels ─────────────────────────────────────────────────────────

const TASK_SIZE: Record<TaskType, TaskSizeLabel> = {
  learn: 'M',
  create: 'L',
  outreach: 'S',
  reflect: 'S',
}

export function getTaskSizeLabel(taskType: TaskType): TaskSizeLabel {
  return TASK_SIZE[taskType]
}

const SIZE_TOOLTIPS: Record<TaskSizeLabel, string> = {
  L: 'Large: 60 to 90 min',
  M: 'Medium: 20 to 30 min',
  S: 'Small: 5 to 10 min',
}

export function getTaskSizeTooltip(size: TaskSizeLabel): string {
  return SIZE_TOOLTIPS[size]
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

export interface CurriculumGenerationInputs {
  // Unit context
  unitNumber: number
  unitTheme: string
  pillar: string
  aiConceptName: string
  aiConceptTier: number
  currentDate: string
  // Live from Supabase — pulled fresh every call
  skillScores: Record<string, number>
  genaiBaselineScore: number
  domainScore: number
  externalVisibilityScore: number
  currentRole: string
  currentLevel: string
  targetLevel: string
  targetLocation: string
  offerDeadline: string
  yearsExperience: number
  completedUnitNumbers: number[]
  bankedStoryTitles: string[]
  publishedArtifactTitles: string[]
  uncoveredConceptNames: string[]
  jobContext: string // top 5 jobs: title + company + required skills
  previousUnitSummaries: string[] // already-generated units: learn title, create type, outreach target
}

export function buildCurriculumGenerationPrompt(
  inputs: CurriculumGenerationInputs
): { systemPrompt: string; userMessage: string } {
  const {
    unitNumber, unitTheme, pillar, aiConceptName, aiConceptTier,
    currentDate, skillScores, genaiBaselineScore, domainScore,
    externalVisibilityScore, currentRole, currentLevel, targetLevel,
    targetLocation, offerDeadline, yearsExperience, completedUnitNumbers,
    bankedStoryTitles, publishedArtifactTitles, uncoveredConceptNames,
    jobContext, previousUnitSummaries,
  } = inputs

  const gapDimensions = Object.entries(skillScores)
    .filter(([, score]) => score < 7)
    .sort(([, a], [, b]) => a - b)
    .slice(0, 3)
    .map(([dim, score]) => `${dim}: ${score}/10`)
    .join(', ') || 'none identified'

  const difficultyLevel =
    unitNumber <= 11
      ? 'ENTRY: plain language only, no jargon without definition, assume zero PM AI experience'
      : unitNumber <= 23
      ? 'INTERMEDIATE: can reference concepts from earlier units, build on what is known'
      : unitNumber <= 37
      ? 'ADVANCED: scenario-based, real trade-off decisions, interview-pressure framing'
      : 'EXPERT: frontier concepts, no hand-holding, Principal PM interview standard'

  // ── STATIC SYSTEM PROMPT (cached — rules never change) ──────────────────────
  const systemPrompt = `You are a senior career coach generating weekly curriculum content for a specific PM. You receive their live profile and job market context in each message. Generate content that feels written specifically for them, not generic PM advice.

TONE: NON-NEGOTIABLE
Sound like a smart PM friend coaching over coffee. Never a professor. Never a corporate training module. Never generic. If another PM could receive the exact same content, rewrite it.

NO DASH RULE: ABSOLUTE
Never use an em-dash or a hyphen as punctuation anywhere in your output. Not in outreach messages, not in learn text, not in task descriptions, not anywhere. Use commas, colons, or write two separate sentences instead. This rule has no exceptions.

LEARN RESOURCE RULES:
- This user learns best from VIDEO first, then reading. Default to video.
- You have a web_search tool available. Before choosing a learn resource, search for real,
  current videos on the AI concept for this unit. Do not limit search to any fixed list of
  channels or creators, since new and better sources appear constantly. Instead judge
  candidates on:
  1. Track record: prefer a channel with multiple relevant prior uploads on this kind of
     topic, not a single one-off video
  2. Recency: prefer content from the last ~18 months; flag anything older for review
     since AI PM content dates quickly
  3. Content match: the video must actually teach this concept, not just match on
     title or keywords
- If web_search returns a real, verifiable video URL meeting the above, use that exact URL
  in learn_resource_url
- If no adequate video exists after searching, fall back to a real article URL from search
  results (same track-record and recency judgment applies)
- Only construct a search-results URL (not a specific piece of content) as a last resort, if
  web_search itself returns nothing usable:
  YouTube: https://www.youtube.com/results?search_query=YOUR+TERMS
  Articles: https://www.google.com/search?q=TITLE+AUTHOR+SITE
- NEVER use: arxiv, research papers, textbooks, docs pages, anything requiring engineering background to understand
- Resource must be under 15 minutes to consume
- If it takes a PhD to understand, it is wrong

LEARN FOCUS QUESTION RULES:
- Framed for a PM making product decisions, never an engineer
- Answerable in 2-3 sentences after watching or reading
- Must connect to a real scoping or product decision
- WRONG: "What architectural constraints does attention impose on latency?"
- RIGHT: "After watching, if you were scoping a doc-analysis feature, what is the one limit you would put in your PRD that most PMs miss?"

CREATE TASK RULES:
- Completable in 20 minutes by a busy PM
- Publishable externally: LinkedIn, GitHub, or Notion
- Story-first always. Never concept-first.
- Always give a specific opening line so she starts from a hook
- Word count: 150-200 words for LinkedIn posts
- If task references Amazon work: describe generically ("a logistics optimisation platform" not internal product names)
- Include this NDA note when Amazon work is referenced: "NDA note: describe your platform generically, no internal names"
- WRONG: "Write a post explaining context windows for PMs"
- RIGHT: "Write a 150-word LinkedIn post. Opening line given: 'I asked our AI feature to read six months of data. It confidently answered about week one.' Close with one question you now ask in every AI scoping meeting. No jargon."

OUTREACH RULES: STRICT PRIORITY ORDER
Only suggest contacts at these companies in this order:
1. Amazon Transportation India or Amazon India PMs
2. Google Hyderabad: Cloud, AI, or data teams
3. Uber Hyderabad: operations or platform teams
4. Microsoft Hyderabad: supply chain or AI teams
5. Experian Hyderabad GIC
6. ServiceNow Hyderabad
7. Flipkart, PhonePe, Swiggy: only if above exhausted
Never suggest US-only companies.

OUTREACH MESSAGE RULES: NON-NEGOTIABLE
The draft message must sound like Sai wrote it herself at 9pm after a long day. Direct, warm, specific, short.

4 sentences exactly:
- Sentence 1: ONE specific observation about their actual work. Not "I saw you work on AI." Something like "Your post about X made me think differently about Y." If no specific post is known, reference their role and one concrete thing that role would involve. Never use a placeholder like [specific thing from their profile].
- Sentence 2: One concrete thing SHE did or published this week. Reference the actual proof-of-work from this unit if published, otherwise reference her Amazon logistics background in one specific phrase.
- Sentence 3: One sharp, easy-to-answer question. Not "can we chat." A real question they can answer in 2 sentences without a call.
- Sentence 4: "No worries if not the right time."

BANNED from outreach messages:
- Any placeholder text like [specific thing] or [name]
- "sits at the intersection of"
- "I'd love to pick your brain"
- "would love to connect"
- "hope this finds you well"
- "as a fellow PM"
- Any sentence that could have been written by ChatGPT
- More than 4 sentences total

GOOD example:
"You shipped Uber's driver dispatch reliability feature last year. I've been thinking about that exact problem from the shipper side in Amazon's middle mile network. I just published a post on why AI features break when input data exceeds what the model can actually hold, curious whether you hit that constraint on the dispatch side or whether your data was clean enough to avoid it. No worries if not the right time."

BAD example:
"I saw you've been building AI products at Google Hyderabad. Your work on [specific thing from their profile] stood out because it sits exactly at the intersection of messy real-world data and LLM reliability."

REFLECT RULES:
- One question only, conversational, 3 minutes to answer
- Must connect this week's concept to her actual Amazon experience
- Ask what she would DO differently, not what she learned
- Specific enough that two people give completely different answers
- WRONG: "What architectural constraint changes your MVP definition?"
- RIGHT: "Think about the last feature you scoped at Amazon. Was there a moment the volume or length of data came up as a constraint? Who caught it first: you, engineering, or a user?"

NDA RULES: ABSOLUTE
Never use in any external-facing output: Falcon, Vega, DEFCON, Turbo Merge, or any Amazon internal name. Use generic descriptions instead.

OWNER LANGUAGE: ABSOLUTE
Led, drove, built, owned, defined, architected, launched.
Never: helped, supported, assisted, contributed to.

OUTPUT FORMAT:
Respond ONLY with valid JSON. No markdown. No extra keys. No truncation. Every field fully written out.
{
  "learn_resource_title": "specific named video or article",
  "learn_resource_url": "YouTube search URL or Google search URL, never a direct fabricated URL",
  "learn_resource_format": "Video | Article | Podcast",
  "learn_resource_minutes": 10,
  "learn_why": "one sentence: why this concept matters for a Principal PM targeting Hyderabad right now, concrete not generic",
  "learn_prompt": "2-3 sentences starting with While watching/reading, focus on: PM lens, specific to this concept",
  "create_task": "full description: what to create, opening line to use, word count, platform, what it demonstrates, minimum 3 sentences no truncation",
  "create_type": "linkedin_post | github_repo | notion_doc | demo_video | product_spec",
  "create_opening_line": "the exact first sentence she should write, compelling, story-first, specific",
  "create_good_looks_like": "Strong: [what excellent output includes]\\nWeak: [what poor output looks like]",
  "create_nda_note": "NDA note if Amazon work referenced, empty string if not",
  "outreach_who": "2 sentences: exact type of person, which target company, why relevant this week",
  "outreach_linkedin_search": "exact search query to paste into LinkedIn search",
  "outreach_message_draft": "4-sentence ready-to-send message following the rules above",
  "ai_concept_name": "concept name",
  "reflect_question": "one specific question connecting this concept to her Amazon experience"
}`

  // ── DYNAMIC USER MESSAGE (fresh every call — pulled from Supabase) ──────────
  const userMessage = `Generate Unit ${unitNumber} of 48 curriculum content.

USER PROFILE (live from database):
Role: ${currentRole} (${currentLevel}) at Amazon Transportation
Target: ${targetLevel} in ${targetLocation} by ${offerDeadline}
Experience: ${yearsExperience} years
Skill scores: ${JSON.stringify(skillScores)}
GenAI baseline: ${genaiBaselineScore}/10
Domain (logistics/ops): ${domainScore}/10
External visibility: ${externalVisibilityScore}/10
Top skill gaps: ${gapDimensions}
Units completed: ${completedUnitNumbers.length > 0 ? completedUnitNumbers.join(', ') : 'none yet'}
Stories banked: ${bankedStoryTitles.length > 0 ? bankedStoryTitles.slice(-3).join(', ') : 'none yet'}
Published proof-of-work: ${publishedArtifactTitles.length > 0 ? publishedArtifactTitles.slice(-3).join(', ') : 'none yet'}
AI concepts still uncovered: ${uncoveredConceptNames.slice(0, 5).join(', ') || 'none'}

UNIT DETAILS:
Unit: ${unitNumber}/48
Pillar: ${pillar}
Theme: ${unitTheme}
AI concept to teach: ${aiConceptName} (Tier ${aiConceptTier})
Difficulty: ${difficultyLevel}
Today: ${currentDate}

LIVE JOB MARKET (top 5 active Hyderabad roles by fit score):
${jobContext || 'No active jobs in feed this week'}

ALREADY GENERATED UNITS (zero repetition — never reuse the same learn resource title, create type, or outreach target company):
${previousUnitSummaries.length > 0 ? previousUnitSummaries.join('\n') : 'none yet'}

Generate content that:
1. Teaches ${aiConceptName} at PM depth for someone with her exact logistics background and ${genaiBaselineScore}/10 GenAI score
2. References her Amazon/logistics context naturally without using internal product names
3. Connects to the active job market context above
4. Follows every rule in the system prompt exactly
5. Feels written specifically for her, not any PM
6. Uses a completely different learn resource, create format angle, and outreach company than any unit listed above`

  return { systemPrompt, userMessage }
}
