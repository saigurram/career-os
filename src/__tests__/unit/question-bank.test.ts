import { describe, it, expect } from 'vitest'
import {
  QUESTION_CATEGORIES,
  CATEGORY_LABELS,
  getDifficultyRangeForSession,
  parseGeneratedQuestion,
  filterAskedQuestions,
  partitionByEmbeddingNovelty,
  buildQuestionPrompt,
  type QuestionCategory,
  type GeneratedQuestion,
} from '@/lib/interview-questions'
import {
  PLAYBOOK_COMPANIES,
  getCompaniesByTier,
} from '@/lib/company-playbooks'

// ─── Category registry ────────────────────────────────────────────────────────

describe('QUESTION_CATEGORIES', () => {
  it('has exactly 4 categories', () => {
    expect(QUESTION_CATEGORIES).toHaveLength(4)
  })

  it('includes all required categories', () => {
    expect(QUESTION_CATEGORIES).toContain('product_sense')
    expect(QUESTION_CATEGORIES).toContain('execution_metrics')
    expect(QUESTION_CATEGORIES).toContain('behavioral')
    expect(QUESTION_CATEGORIES).toContain('strategy_design')
  })

  it('every category has a label', () => {
    for (const cat of QUESTION_CATEGORIES) {
      expect(CATEGORY_LABELS[cat]).toBeTruthy()
    }
  })
})

// ─── Company registry (19 companies) ─────────────────────────────────────────

describe('PLAYBOOK_COMPANIES', () => {
  it('has exactly 19 companies', () => {
    expect(PLAYBOOK_COMPANIES).toHaveLength(19)
  })

  it('has 6 Tier 1 companies', () => {
    expect(getCompaniesByTier(1)).toHaveLength(6)
  })

  it('has 7 Tier 2 companies', () => {
    expect(getCompaniesByTier(2)).toHaveLength(7)
  })

  it('has 6 Tier 3 companies', () => {
    expect(getCompaniesByTier(3)).toHaveLength(6)
  })

  it('Tier 1 includes all required companies', () => {
    const names = getCompaniesByTier(1).map(c => c.company)
    expect(names).toContain('Google')
    expect(names).toContain('Uber')
    expect(names).toContain('Microsoft')
    expect(names).toContain('Experian')
    expect(names).toContain('ServiceNow')
    expect(names).toContain('Amazon L7')
  })

  it('Tier 2 includes all India-first companies', () => {
    const names = getCompaniesByTier(2).map(c => c.company)
    expect(names).toContain('Flipkart')
    expect(names).toContain('PhonePe')
    expect(names).toContain('Swiggy')
    expect(names).toContain('Zomato')
    expect(names).toContain('CRED')
    expect(names).toContain('Meesho')
    expect(names).toContain('Razorpay')
  })

  it('Tier 3 includes all required companies', () => {
    const names = getCompaniesByTier(3).map(c => c.company)
    expect(names).toContain('Salesforce')
    expect(names).toContain('SAP')
    expect(names).toContain('Oracle')
    expect(names).toContain('Freshworks')
    expect(names).toContain('PayPal')
    expect(names).toContain('InMobi')
  })

  it('all Tier 2 companies are marked india_specific', () => {
    const tier2 = getCompaniesByTier(2)
    for (const c of tier2) {
      expect(c.india_specific).toBe(true)
    }
  })

  it('no Tier 1 or Tier 3 company is marked india_specific', () => {
    for (const c of PLAYBOOK_COMPANIES) {
      if (c.tier !== 2) {
        expect(c.india_specific).toBeFalsy()
      }
    }
  })
})

// ─── Difficulty progression ───────────────────────────────────────────────────

describe('getDifficultyRangeForSession', () => {
  it('session 1 → difficulty 1-2', () => {
    expect(getDifficultyRangeForSession(1)).toEqual({ min: 1, max: 2 })
  })

  it('session 2 → difficulty 1-2', () => {
    expect(getDifficultyRangeForSession(2)).toEqual({ min: 1, max: 2 })
  })

  it('session 3 → difficulty 3-4', () => {
    expect(getDifficultyRangeForSession(3)).toEqual({ min: 3, max: 4 })
  })

  it('session 4 → difficulty 3-4', () => {
    expect(getDifficultyRangeForSession(4)).toEqual({ min: 3, max: 4 })
  })

  it('session 5 → difficulty 4-5', () => {
    expect(getDifficultyRangeForSession(5)).toEqual({ min: 4, max: 5 })
  })

  it('session 10 → difficulty 4-5 (no cap)', () => {
    expect(getDifficultyRangeForSession(10)).toEqual({ min: 4, max: 5 })
  })

  it('gauntlet mode → difficulty 5-5 regardless of session count', () => {
    expect(getDifficultyRangeForSession(1, true)).toEqual({ min: 5, max: 5 })
    expect(getDifficultyRangeForSession(3, true)).toEqual({ min: 5, max: 5 })
  })

  it('two companies can be at different difficulty levels independently', () => {
    // Google session 5, Experian session 1 — independent
    const googleRange = getDifficultyRangeForSession(5)
    const experianRange = getDifficultyRangeForSession(1)
    expect(googleRange).toEqual({ min: 4, max: 5 })
    expect(experianRange).toEqual({ min: 1, max: 2 })
  })
})

// ─── parseGeneratedQuestion ───────────────────────────────────────────────────

describe('parseGeneratedQuestion', () => {
  const VALID: GeneratedQuestion = {
    question_text: 'Walk me through a time you made a build vs buy decision at scale.',
    category: 'strategy_design',
    difficulty: 4,
    lp_map: ['Think Big', 'Dive Deep'],
    tags: ['platform', 'strategy', 'tradeoffs'],
  }

  it('parses a valid question', () => {
    const result = parseGeneratedQuestion(VALID)
    expect(result).not.toBeNull()
    expect(result!.question_text).toBe(VALID.question_text)
    expect(result!.difficulty).toBe(4)
  })

  it('returns null for null input', () => {
    expect(parseGeneratedQuestion(null)).toBeNull()
  })

  it('returns null if question_text is empty', () => {
    expect(parseGeneratedQuestion({ ...VALID, question_text: '' })).toBeNull()
  })

  it('returns null for invalid category', () => {
    expect(parseGeneratedQuestion({ ...VALID, category: 'random_category' })).toBeNull()
  })

  it('returns null if difficulty < 1', () => {
    expect(parseGeneratedQuestion({ ...VALID, difficulty: 0 })).toBeNull()
  })

  it('returns null if difficulty > 5', () => {
    expect(parseGeneratedQuestion({ ...VALID, difficulty: 6 })).toBeNull()
  })

  it('accepts all valid difficulties 1-5', () => {
    for (let d = 1; d <= 5; d++) {
      expect(parseGeneratedQuestion({ ...VALID, difficulty: d })).not.toBeNull()
    }
  })

  it('accepts all valid categories', () => {
    for (const cat of QUESTION_CATEGORIES) {
      expect(parseGeneratedQuestion({ ...VALID, category: cat })).not.toBeNull()
    }
  })

  it('defaults lp_map and tags to empty arrays when missing', () => {
    const { lp_map: _, tags: __, ...noArrays } = VALID
    const result = parseGeneratedQuestion(noArrays)
    expect(result).not.toBeNull()
    expect(result!.lp_map).toEqual([])
    expect(result!.tags).toEqual([])
  })
})

// ─── filterAskedQuestions (deduplication) ────────────────────────────────────

describe('filterAskedQuestions', () => {
  it('returns all candidates when nothing has been asked', () => {
    const candidates = ['What is your approach to roadmap prioritization?', 'Tell me about a product failure.']
    expect(filterAskedQuestions(candidates, [])).toHaveLength(2)
  })

  it('filters out an exact duplicate', () => {
    const q = 'Walk me through a time you prioritized ruthlessly.'
    const result = filterAskedQuestions([q, 'Different question here?'], [q])
    expect(result).not.toContain(q)
    expect(result).toContain('Different question here?')
  })

  it('filters out near-duplicate with high word overlap', () => {
    const asked = 'Walk me through a time you prioritized ruthlessly under constraints.'
    const similar = 'Walk me through a time you prioritized ruthlessly under pressure.'
    const result = filterAskedQuestions([similar, 'Completely different topic.'], [asked])
    // Similar question has high overlap — should be filtered
    expect(result).toContain('Completely different topic.')
    // Similar question should be removed (80%+ word overlap)
    expect(result).not.toContain(similar)
  })

  it('keeps a question with low word overlap', () => {
    const asked = 'Tell me about a product failure you owned.'
    const different = 'How do you define success for a platform product?'
    const result = filterAskedQuestions([different], [asked])
    expect(result).toContain(different)
  })

  it('handles empty candidates list', () => {
    expect(filterAskedQuestions([], ['some asked question'])).toHaveLength(0)
  })
})

// ─── partitionByEmbeddingNovelty (authoritative second-pass dedup) ───────────

describe('partitionByEmbeddingNovelty', () => {
  it('treats a similarity at or below the threshold as novel', () => {
    const { novel, nearDuplicate } = partitionByEmbeddingNovelty([
      { text: 'Q1', maxSimilarity: 0.85 },
    ])
    expect(novel).toEqual(['Q1'])
    expect(nearDuplicate).toEqual([])
  })

  it('flags a similarity above the threshold as a near duplicate', () => {
    const { novel, nearDuplicate } = partitionByEmbeddingNovelty([
      { text: 'Q1', maxSimilarity: 0.86 },
    ])
    expect(novel).toEqual([])
    expect(nearDuplicate).toEqual(['Q1'])
  })

  it('respects a custom threshold', () => {
    const { novel, nearDuplicate } = partitionByEmbeddingNovelty(
      [{ text: 'Q1', maxSimilarity: 0.5 }],
      0.4
    )
    expect(novel).toEqual([])
    expect(nearDuplicate).toEqual(['Q1'])
  })

  it('partitions a mixed batch correctly', () => {
    const { novel, nearDuplicate } = partitionByEmbeddingNovelty([
      { text: 'Novel question', maxSimilarity: 0.2 },
      { text: 'Duplicate question', maxSimilarity: 0.95 },
      { text: 'Another novel one', maxSimilarity: 0.4 },
    ])
    expect(novel).toEqual(['Novel question', 'Another novel one'])
    expect(nearDuplicate).toEqual(['Duplicate question'])
  })

  it('handles an empty input array', () => {
    const { novel, nearDuplicate } = partitionByEmbeddingNovelty([])
    expect(novel).toEqual([])
    expect(nearDuplicate).toEqual([])
  })
})

// ─── buildQuestionPrompt ──────────────────────────────────────────────────────

describe('buildQuestionPrompt', () => {
  const BASE_PARAMS = {
    company: 'Google',
    tier: 1 as const,
    roundType: 'Product Sense',
    difficultyRange: { min: 3, max: 4 },
    userAnswerHistory: [],
    jdText: null,
    skillGaps: { genai_fluency: 2.5, external_visibility: 3.0 },
    askedQuestions: [],
    persona: 'The Bar Raiser',
    count: 5,
  }

  it('includes the company name', () => {
    const prompt = buildQuestionPrompt(BASE_PARAMS)
    expect(prompt).toContain('Google')
  })

  it('includes the round type', () => {
    const prompt = buildQuestionPrompt(BASE_PARAMS)
    expect(prompt).toContain('Product Sense')
  })

  it('includes difficulty range', () => {
    const prompt = buildQuestionPrompt(BASE_PARAMS)
    expect(prompt).toContain('3')
    expect(prompt).toContain('4')
  })

  it('includes top skill gaps', () => {
    const prompt = buildQuestionPrompt(BASE_PARAMS)
    expect(prompt).toMatch(/genai_fluency|external_visibility/)
  })

  it('includes DO NOT REPEAT block when questions have been asked', () => {
    const prompt = buildQuestionPrompt({
      ...BASE_PARAMS,
      askedQuestions: ['Tell me about a product failure.'],
    })
    expect(prompt).toContain('DO NOT REPEAT')
    expect(prompt).toContain('Tell me about a product failure.')
  })

  it('does not include DO NOT REPEAT block when no prior questions', () => {
    const prompt = buildQuestionPrompt(BASE_PARAMS)
    expect(prompt).not.toContain('DO NOT REPEAT')
  })

  it('includes JD context when provided', () => {
    const prompt = buildQuestionPrompt({ ...BASE_PARAMS, jdText: 'Lead PM for Google Maps logistics' })
    expect(prompt).toContain('Google Maps logistics')
  })

  it('includes India context for Tier 2 companies', () => {
    const prompt = buildQuestionPrompt({ ...BASE_PARAMS, company: 'Swiggy', tier: 2 })
    expect(prompt.toLowerCase()).toContain('india')
  })

  it('does not include India context for Tier 1 companies', () => {
    const prompt = buildQuestionPrompt(BASE_PARAMS)
    expect(prompt).not.toMatch(/speed.vs.process|growth.stage/i)
  })
})
