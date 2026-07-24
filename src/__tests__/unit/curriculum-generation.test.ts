import { describe, it, expect } from 'vitest'
import {
  getPillarForUnit,
  parseGeneratedContent,
  buildSystemPrompt,
  CURRICULUM_PILLARS,
  CAREEROS_RULES,
  extractFinalText,
  isSearchResultsUrl,
  type GeneratedUnitContent,
} from '@/lib/claude'

const VALID_CONTENT: GeneratedUnitContent = {
  learn_resource_title: 'How LLMs Actually Work — Fireship',
  learn_resource_url: 'https://www.youtube.com/results?search_query=how+LLMs+work+Fireship',
  learn_resource_format: 'Video',
  learn_resource_minutes: 8,
  learn_why: 'Understanding attention mechanisms lets you scope transformer-based features accurately and push back on inflated ML estimates.',
  learn_prompt: 'While watching, focus on: what the attention mechanism is doing, and one product implication a PM should care about.',
  create_task: 'Write a 150-word LinkedIn post explaining transformers for a PM audience. Use one specific product example from logistics or ops. No jargon. No numbered lists. Ship it.',
  create_type: 'linkedin_post',
  create_opening_line: 'I asked our AI feature to read six months of data. It confidently answered about week one.',
  create_good_looks_like: 'Strong: Post names a concrete product decision (e.g. context-window trade-off in a search ranking redesign) and explains the PM implication clearly.\nWeak: Post explains transformers at a high level without any PM-specific insight or actionable takeaway.',
  create_nda_note: '',
  outreach_who: 'Connect with a PM at Uber Hyderabad who works on dispatch or marketplace systems — they use transformer-based models in routing decisions.',
  outreach_linkedin_search: 'Principal PM Uber Hyderabad dispatch ML marketplace',
  outreach_message_draft: 'Hi [Name], I saw your work on Uber\'s dispatch ML stack and noticed it aligns closely with transformer decisions I\'ve been studying. I built a LinkedIn post explaining attention mechanisms for PM audiences and would love your feedback on whether the product framing resonates. Would you be open to a 20-minute call next week? Totally fine if timing doesn\'t work.',
  ai_concept_name: 'How LLMs work (tokens, context windows, attention)',
  reflect_question: 'What is one decision you would make differently on a current or past product if you had understood transformers 12 months earlier?',
}

describe('getPillarForUnit', () => {
  it('unit 1 gets first pillar', () => {
    expect(getPillarForUnit(1)).toBe(CURRICULUM_PILLARS[0])
  })

  it('unit 7 gets first pillar again (rotation)', () => {
    expect(getPillarForUnit(7)).toBe(CURRICULUM_PILLARS[0])
  })

  it('unit 2 gets second pillar', () => {
    expect(getPillarForUnit(2)).toBe(CURRICULUM_PILLARS[1])
  })

  it('unit 6 gets last pillar', () => {
    expect(getPillarForUnit(6)).toBe(CURRICULUM_PILLARS[5])
  })

  it('unit 8 gets second pillar (second rotation cycle)', () => {
    // (8-1) % 6 = 1 → second pillar
    expect(getPillarForUnit(8)).toBe(CURRICULUM_PILLARS[1])
  })

  it('unit 48 gets a valid pillar', () => {
    const pillar = getPillarForUnit(48)
    expect(CURRICULUM_PILLARS).toContain(pillar)
  })

  it('no two consecutive units share the same pillar', () => {
    for (let i = 1; i < 48; i++) {
      const current = getPillarForUnit(i)
      const next = getPillarForUnit(i + 1)
      expect(current).not.toBe(next)
    }
  })

  it('all 6 pillars are covered across units 1–6', () => {
    const covered = new Set<string>()
    for (let i = 1; i <= 6; i++) covered.add(getPillarForUnit(i))
    expect(covered.size).toBe(6)
  })

  it('all 6 pillars are covered again in units 7–12', () => {
    const covered = new Set<string>()
    for (let i = 7; i <= 12; i++) covered.add(getPillarForUnit(i))
    expect(covered.size).toBe(6)
  })
})

describe('parseGeneratedContent', () => {
  it('parses a valid content object', () => {
    const result = parseGeneratedContent(VALID_CONTENT)
    expect(result).not.toBeNull()
    expect(result!.learn_resource_title).toBe(VALID_CONTENT.learn_resource_title)
    expect(result!.create_type).toBe('linkedin_post')
  })

  it('returns null for null input', () => {
    expect(parseGeneratedContent(null)).toBeNull()
  })

  it('returns null for non-object input', () => {
    expect(parseGeneratedContent('string')).toBeNull()
    expect(parseGeneratedContent(42)).toBeNull()
  })

  it('returns null if any required field is missing', () => {
    const { learn_resource_title: _, ...noTitle } = VALID_CONTENT
    expect(parseGeneratedContent(noTitle)).toBeNull()
  })

  it('returns null if any required field is empty string', () => {
    const emptyTitle = { ...VALID_CONTENT, learn_resource_title: '' }
    expect(parseGeneratedContent(emptyTitle)).toBeNull()
  })

  it('returns null if any required field is whitespace only', () => {
    const whitespace = { ...VALID_CONTENT, reflect_question: '   ' }
    expect(parseGeneratedContent(whitespace)).toBeNull()
  })

  it('returns null if a required field is not a string', () => {
    const badType = { ...VALID_CONTENT, learn_resource_url: 12345 }
    expect(parseGeneratedContent(badType)).toBeNull()
  })

  it('returns the parsed object when all fields are present', () => {
    const result = parseGeneratedContent(VALID_CONTENT)
    expect(result).toMatchObject({
      learn_resource_title: expect.any(String),
      learn_resource_url: expect.any(String),
      learn_prompt: expect.any(String),
      create_task: expect.any(String),
      create_type: expect.any(String),
      outreach_who: expect.any(String),
      ai_concept_name: expect.any(String),
      reflect_question: expect.any(String),
    })
  })
})

describe('buildSystemPrompt', () => {
  it('includes the user name', () => {
    const prompt = buildSystemPrompt('Sai', 'Amazon', 'Principal PM', [])
    expect(prompt).toContain('Sai')
  })

  it('includes the target level', () => {
    const prompt = buildSystemPrompt('Sai', 'Amazon', 'Principal PM', [])
    expect(prompt).toContain('Principal PM')
  })

  it('includes NDA entries for unsafe names', () => {
    const blockedNames = [{
      internal_name: 'Falcon',
      generic_replacement: 'computer vision platform',
      safe_for_external: false,
    }]
    const prompt = buildSystemPrompt('Sai', 'Amazon', 'Principal PM', blockedNames)
    expect(prompt).toContain('Falcon')
    expect(prompt).toContain('computer vision platform')
  })

  it('excludes safe_for_external names from NDA section', () => {
    const blockedNames = [{
      internal_name: 'SafeName',
      generic_replacement: 'safe replacement',
      safe_for_external: true,
    }]
    const prompt = buildSystemPrompt('Sai', 'Amazon', 'Principal PM', blockedNames)
    expect(prompt).not.toContain('SafeName')
  })

  it('includes Hyderabad location constraint', () => {
    const prompt = buildSystemPrompt('Sai', 'Amazon', 'Principal PM', [])
    expect(prompt).toContain('Hyderabad')
  })
})

describe('CAREEROS_RULES', () => {
  it('prohibits contributor language', () => {
    expect(CAREEROS_RULES).toMatch(/helped.*never|never.*helped/i)
  })

  it('requires owner language', () => {
    expect(CAREEROS_RULES).toMatch(/led|drove|built|owned/i)
  })

  it('prohibits "passionate about"', () => {
    expect(CAREEROS_RULES.toLowerCase()).toContain('passionate')
  })

  it('requires INR comp format', () => {
    expect(CAREEROS_RULES).toContain('INR')
  })

  it('requires Hyderabad or remote only', () => {
    expect(CAREEROS_RULES.toLowerCase()).toContain('hyderabad')
  })
})

describe('extractFinalText', () => {
  it('returns the text of a plain single text block', () => {
    const content = [{ type: 'text', text: '{"ok":true}' }] as never
    expect(extractFinalText(content)).toBe('{"ok":true}')
  })

  it('returns the LAST text block when web_search tool blocks are interleaved', () => {
    const content = [
      { type: 'server_tool_use', id: 'srv1', name: 'web_search', input: {} },
      { type: 'web_search_tool_result', tool_use_id: 'srv1', content: [] },
      { type: 'text', text: 'intermediate reasoning, not the answer' },
      { type: 'text', text: '{"final":"answer"}' },
    ] as never
    expect(extractFinalText(content)).toBe('{"final":"answer"}')
  })

  it('returns "{}" when there are no text blocks', () => {
    const content = [
      { type: 'server_tool_use', id: 'srv1', name: 'web_search', input: {} },
    ] as never
    expect(extractFinalText(content)).toBe('{}')
  })

  it('returns "{}" for an empty content array', () => {
    expect(extractFinalText([])).toBe('{}')
  })
})

describe('isSearchResultsUrl', () => {
  it('is true for a YouTube search-results URL', () => {
    expect(isSearchResultsUrl('https://www.youtube.com/results?search_query=llms')).toBe(true)
  })

  it('is true for a Google search URL', () => {
    expect(isSearchResultsUrl('https://www.google.com/search?q=llms')).toBe(true)
  })

  it('is false for a real YouTube video URL', () => {
    expect(isSearchResultsUrl('https://www.youtube.com/watch?v=abc123')).toBe(false)
  })

  it('is false for a real article URL', () => {
    expect(isSearchResultsUrl('https://newsletter.pragmaticengineer.com/p/some-post')).toBe(false)
  })

  it('is false for an unparseable URL', () => {
    expect(isSearchResultsUrl('not-a-url')).toBe(false)
  })
})

describe('curriculum rotation completeness', () => {
  it('all 6 pillars appear exactly 8 times across 48 units', () => {
    const counts: Record<string, number> = {}
    for (let i = 1; i <= 48; i++) {
      const pillar = getPillarForUnit(i)
      counts[pillar] = (counts[pillar] ?? 0) + 1
    }
    for (const pillar of CURRICULUM_PILLARS) {
      expect(counts[pillar]).toBe(8)
    }
  })

  it('no pillar goes more than 6 consecutive units without appearing', () => {
    for (const pillar of CURRICULUM_PILLARS) {
      let maxGap = 0
      let gap = 0
      for (let i = 1; i <= 48; i++) {
        if (getPillarForUnit(i) !== pillar) {
          gap++
          maxGap = Math.max(maxGap, gap)
        } else {
          gap = 0
        }
      }
      // With 6-pillar rotation, max gap is 5 (one full cycle minus one appearance)
      expect(maxGap).toBeLessThanOrEqual(5)
    }
  })
})
