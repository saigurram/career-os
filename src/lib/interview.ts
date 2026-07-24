import type { BlockedNameEntry } from '@/lib/nda'
import { hasBlockedNames } from '@/lib/nda'

// ─── Personas ────────────────────────────────────────────────────────────────

export const INTERVIEW_PERSONAS = [
  'The Skeptic',
  'The Exhausted Senior PM',
  'The Bar Raiser',
  'The Technical PM',
  'The Friendly Deceiver',
  'The Speed Round',
] as const

export type InterviewPersona = typeof INTERVIEW_PERSONAS[number]

export interface PersonaDefinition {
  name: InterviewPersona
  description: string
  behavior: string
  pressure_escalation: string
  contributor_language_response: string
  // Behavioral flags
  time_limit_seconds: number | null   // null = no hard cutoff (180s soft warning applies)
  question_count: number              // default 5; Speed Round = 8
  has_hidden_scoring: boolean         // Friendly Deceiver: reveal at end
  has_silence_indicator: boolean      // Skeptic: 3s typing pause after weak answer (score ≤ 2)
  has_warmup: boolean                 // Exhausted Senior PM: warms up after crisp answer
  lp_probe: boolean                   // Bar Raiser: appends LP question after behavioral answers
}

export const PERSONA_DEFINITIONS: Record<InterviewPersona, PersonaDefinition> = {
  'The Skeptic': {
    name: 'The Skeptic',
    description: 'Challenges every claim. Assumes vague answers are hiding weak ownership.',
    behavior: 'Follow up every answer with "How do you know that was your decision?" or "What evidence do you have for that impact claim?" Push back until specifics are provided.',
    pressure_escalation: 'If user hedges, respond: "That sounds like someone else\'s decision that you observed. Walk me through what YOU specifically decided."',
    contributor_language_response: 'Help me understand — were you the decision maker or supporting someone else\'s decision? Be direct.',
    time_limit_seconds: 180,
    question_count: 5,
    has_hidden_scoring: false,
    has_silence_indicator: true,
    has_warmup: false,
    lp_probe: false,
  },
  'The Exhausted Senior PM': {
    name: 'The Exhausted Senior PM',
    description: 'Seen everything, hard to impress. Short on patience for rambling or obvious answers.',
    behavior: 'Give short, mildly impatient responses. If answer runs long: "I got it — what\'s the one-sentence version?" Value sharp thinking over comprehensive coverage. If answer is exceptionally crisp, warm up noticeably: "Okay, that\'s actually useful. Tell me more."',
    pressure_escalation: 'If answer is too long or too generic: "I\'ve heard this answer 50 times. What\'s the part that\'s actually specific to you?"',
    contributor_language_response: 'Wait — did you lead this or were you in the room when someone else led it? I need to know.',
    time_limit_seconds: 120,
    question_count: 5,
    has_hidden_scoring: false,
    has_silence_indicator: false,
    has_warmup: true,
    lp_probe: false,
  },
  'The Bar Raiser': {
    name: 'The Bar Raiser',
    description: 'Amazon-style. Tests ownership depth, LP application, and whether candidate operates above their current level.',
    behavior: 'Map every answer to an LP. Ask: "Which Leadership Principle is most relevant here?" and "At L7, what would you have done differently than you did at L6?" After every behavioral answer, append: "Which Leadership Principle drove that specific decision?"',
    pressure_escalation: 'After every answer: "The bar raiser is asking whether you\'re already operating at the next level. Show me evidence."',
    contributor_language_response: 'Help me understand — were you the decision maker or supporting someone else\'s decision? At L7, this distinction matters a lot.',
    time_limit_seconds: 180,
    question_count: 5,
    has_hidden_scoring: false,
    has_silence_indicator: false,
    has_warmup: false,
    lp_probe: true,
  },
  'The Technical PM': {
    name: 'The Technical PM',
    description: 'Digs into the technical details behind product decisions. Wants to know you actually understand what you shipped.',
    behavior: 'Ask: "Walk me through the actual technical architecture." and "Why did you choose that approach vs the alternative?" Probe ML/data choices specifically. Comfortable with silence after asking — do not fill it.',
    pressure_escalation: 'If answer stays at product level: "That\'s the product answer — give me the technical reasoning behind the tradeoff."',
    contributor_language_response: 'Were you the one who made the technical call, or did engineering decide and you approved it?',
    time_limit_seconds: 180,
    question_count: 5,
    has_hidden_scoring: false,
    has_silence_indicator: false,
    has_warmup: false,
    lp_probe: false,
  },
  'The Friendly Deceiver': {
    name: 'The Friendly Deceiver',
    description: 'Warm, supportive tone. Makes you feel safe. Scoring harshly on every answer internally. End of session: step out of character and reveal the real scores.',
    behavior: 'Build rapport: "That\'s a great example!" Then pivot to traps: "One small thing — can you tell me about a time that exact approach failed?" Lull into over-sharing. Never reveal the internal scoring during the session.',
    pressure_escalation: 'After positive reinforcement: "Now tell me about the time this exact approach failed. Be specific about what you got wrong."',
    contributor_language_response: 'Oh interesting! Just to clarify — and this is just for my own understanding — were you running point on this or was it more of a team effort?',
    time_limit_seconds: 180,
    question_count: 5,
    has_hidden_scoring: true,
    has_silence_indicator: false,
    has_warmup: false,
    lp_probe: false,
  },
  'The Speed Round': {
    name: 'The Speed Round',
    description: 'Rapid-fire recruiter screen. 8 questions, 25 minutes total. Auto-cuts off at 2 minutes per answer. Scores on signal density, not elaboration.',
    behavior: 'Ask questions in quick succession. At 2 minutes: cut off mid-sentence if needed: "Time — let\'s move on." Reward crisp, high-signal answers. Penalize rambling and over-qualification.',
    pressure_escalation: 'After 90 seconds of an answer: "30 seconds — land the point."',
    contributor_language_response: 'Quick check — your call or someone else\'s? One word.',
    time_limit_seconds: 120,
    question_count: 8,
    has_hidden_scoring: false,
    has_silence_indicator: false,
    has_warmup: false,
    lp_probe: false,
  },
}

// ─── Eval criteria (hardcoded, never dynamic) ─────────────────────────────────

const CONTRIBUTOR_PHRASES = [
  { phrase: 'helped', pattern: /\bhelped\b/i },
  { phrase: 'supported', pattern: /\bsupported\b/i },
  { phrase: 'assisted', pattern: /\bassisted\b/i },
  { phrase: 'contributed', pattern: /\bcontributed\b/i },
  { phrase: 'collaborated', pattern: /\bcollaborated\b/i },
]

const OWNER_PHRASES = [
  /\bled\b/i, /\bdrove\b/i, /\bbuilt\b/i, /\bdefined\b/i,
  /\bowned\b/i, /\barchitected\b/i, /\blaunched\b/i,
]

const IMPACT_PATTERN = /\b(\d+[\d,]*\.?\d*)\s*(%|x|×|percent|bps|ms|s\b|minutes?|hours?|days?|weeks?|crore|lakh|k\b|million|billion|users?|sessions?|requests?|queries?|orders?|shipments?|packages?)/i

export function hasContributorLanguage(text: string): { found: boolean; phrases: string[] } {
  const found: string[] = []
  for (const { phrase, pattern } of CONTRIBUTOR_PHRASES) {
    if (pattern.test(text)) found.push(phrase)
  }
  return { found: found.length > 0, phrases: found }
}

export function hasOwnerLanguage(text: string): boolean {
  return OWNER_PHRASES.some(p => p.test(text))
}

export function hasImpactNumber(text: string): boolean {
  return IMPACT_PATTERN.test(text)
}

export function isAnswerTooLong(text: string, maxWords = 250): boolean {
  const wordCount = text.trim().split(/\s+/).filter(w => w.length > 0).length
  return wordCount > maxWords
}

export function checkAnswerForNda(text: string, blockedNames: BlockedNameEntry[]): boolean {
  return hasBlockedNames(text, blockedNames)
}

// ─── Response parsing ─────────────────────────────────────────────────────────

export interface AnswerFeedback {
  score: 1 | 2 | 3 | 4 | 5
  what_landed: string
  what_missed: string
  better_version: string
}

export function parseFeedback(raw: unknown): AnswerFeedback | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.score !== 'number') return null
  const score = Math.round(r.score)
  if (score < 1 || score > 5) return null
  if (typeof r.what_landed !== 'string' || !r.what_landed.trim()) return null
  if (typeof r.what_missed !== 'string' || !r.what_missed.trim()) return null
  if (typeof r.better_version !== 'string' || !r.better_version.trim()) return null
  return {
    score: score as 1 | 2 | 3 | 4 | 5,
    what_landed: r.what_landed,
    what_missed: r.what_missed,
    better_version: r.better_version,
  }
}

export interface BestAnswer {
  question: string
  answer: string
  why: string
}

export interface WeakestAnswer {
  question: string
  answer: string
  what_was_missing: string
}

export interface SessionDebrief {
  overall_score: number
  best_answer: BestAnswer
  weakest_answer: WeakestAnswer
  session_pattern: string
  fixes: string[]
}

export function parseDebrief(raw: unknown): SessionDebrief | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.overall_score !== 'number') return null
  const score = r.overall_score as number
  if (score < 1 || score > 10) return null
  if (!r.best_answer || typeof r.best_answer !== 'object') return null
  if (!r.weakest_answer || typeof r.weakest_answer !== 'object') return null
  if (typeof r.session_pattern !== 'string' || !r.session_pattern.trim()) return null
  if (!Array.isArray(r.fixes) || r.fixes.length !== 3) return null
  if (!r.fixes.every((f: unknown) => typeof f === 'string' && (f as string).trim())) return null

  const best = r.best_answer as Record<string, unknown>
  const weak = r.weakest_answer as Record<string, unknown>
  if (typeof best.question !== 'string' || typeof best.answer !== 'string' || typeof best.why !== 'string') return null
  if (typeof weak.question !== 'string' || typeof weak.answer !== 'string' || typeof weak.what_was_missing !== 'string') return null

  return {
    overall_score: score,
    best_answer: { question: best.question, answer: best.answer, why: best.why },
    weakest_answer: { question: weak.question, answer: weak.answer, what_was_missing: weak.what_was_missing },
    session_pattern: r.session_pattern,
    fixes: r.fixes as string[],
  }
}

export interface PatternAnalysis {
  sessions_analyzed: number
  recurring_issue: string
  example_from_session: string
  how_to_fix: string
}

export function parsePatternAnalysis(raw: unknown): PatternAnalysis | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.sessions_analyzed !== 'number' || r.sessions_analyzed < 1) return null
  if (typeof r.recurring_issue !== 'string' || !r.recurring_issue.trim()) return null
  if (typeof r.example_from_session !== 'string' || !r.example_from_session.trim()) return null
  if (typeof r.how_to_fix !== 'string' || !r.how_to_fix.trim()) return null
  return {
    sessions_analyzed: r.sessions_analyzed,
    recurring_issue: r.recurring_issue,
    example_from_session: r.example_from_session,
    how_to_fix: r.how_to_fix,
  }
}

// ─── Persona accessors ────────────────────────────────────────────────────────

export function getPersonaTimeLimitSeconds(persona: InterviewPersona): number | null {
  return PERSONA_DEFINITIONS[persona].time_limit_seconds
}

export function getPersonaQuestionCount(persona: InterviewPersona): number {
  return PERSONA_DEFINITIONS[persona].question_count
}

export function isPersonaHiddenScorer(persona: InterviewPersona): boolean {
  return PERSONA_DEFINITIONS[persona].has_hidden_scoring
}

export function hasPersonaSilenceIndicator(persona: InterviewPersona): boolean {
  return PERSONA_DEFINITIONS[persona].has_silence_indicator
}

export function hasPersonaWarmup(persona: InterviewPersona): boolean {
  return PERSONA_DEFINITIONS[persona].has_warmup
}

export function hasPersonaLpProbe(persona: InterviewPersona): boolean {
  return PERSONA_DEFINITIONS[persona].lp_probe
}

// ─── Human mock milestones ────────────────────────────────────────────────────

export const HUMAN_MOCK_UNITS = [37, 45] as const
export type HumanMockUnitNumber = typeof HUMAN_MOCK_UNITS[number]

export function isHumanMockUnit(unitNumber: number): boolean {
  return (HUMAN_MOCK_UNITS as readonly number[]).includes(unitNumber)
}

export interface HumanMockEntry {
  contact_name: string
  company_context: string
  key_learning: string
}

export function validateHumanMockEntry(entry: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!entry || typeof entry !== 'object') return { valid: false, errors: ['Entry must be an object'] }
  const e = entry as Record<string, unknown>

  if (typeof e.contact_name !== 'string' || !e.contact_name.trim()) {
    errors.push('contact_name is required')
  }
  if (typeof e.company_context !== 'string' || !e.company_context.trim()) {
    errors.push('company_context is required')
  }
  if (typeof e.key_learning !== 'string' || !e.key_learning.trim()) {
    errors.push('key_learning is required')
  }

  return { valid: errors.length === 0, errors }
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

export function averageScore(scores: number[]): number {
  if (scores.length === 0) return 0
  return scores.reduce((sum, s) => sum + s, 0) / scores.length
}

export function scoreToGrade(score: number): 'strong' | 'needs-work' | 'poor' {
  if (score >= 8) return 'strong'
  if (score >= 5) return 'needs-work'
  return 'poor'
}
