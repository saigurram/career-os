import { describe, it, expect } from 'vitest'
import {
  HUMAN_MOCK_UNITS,
  isHumanMockUnit,
  validateHumanMockEntry,
  type HumanMockEntry,
} from '@/lib/interview'

// ─── HUMAN_MOCK_UNITS constant ────────────────────────────────────────────────

describe('HUMAN_MOCK_UNITS', () => {
  it('has exactly 2 entries', () => {
    expect(HUMAN_MOCK_UNITS).toHaveLength(2)
  })

  it('contains unit 37', () => {
    expect(HUMAN_MOCK_UNITS).toContain(37)
  })

  it('contains unit 45', () => {
    expect(HUMAN_MOCK_UNITS).toContain(45)
  })

  it('both entries are within valid curriculum range (1–48)', () => {
    for (const unit of HUMAN_MOCK_UNITS) {
      expect(unit).toBeGreaterThanOrEqual(1)
      expect(unit).toBeLessThanOrEqual(48)
    }
  })
})

// ─── isHumanMockUnit ──────────────────────────────────────────────────────────

describe('isHumanMockUnit', () => {
  it('returns true for unit 37', () => {
    expect(isHumanMockUnit(37)).toBe(true)
  })

  it('returns true for unit 45', () => {
    expect(isHumanMockUnit(45)).toBe(true)
  })

  it('returns false for unit 1', () => {
    expect(isHumanMockUnit(1)).toBe(false)
  })

  it('returns false for unit 48', () => {
    expect(isHumanMockUnit(48)).toBe(false)
  })

  it('returns false for unit 36 (one before first mock)', () => {
    expect(isHumanMockUnit(36)).toBe(false)
  })

  it('returns false for unit 38 (one after first mock)', () => {
    expect(isHumanMockUnit(38)).toBe(false)
  })

  it('returns false for unit 44 (one before second mock)', () => {
    expect(isHumanMockUnit(44)).toBe(false)
  })

  it('returns false for unit 46 (one after second mock)', () => {
    expect(isHumanMockUnit(46)).toBe(false)
  })

  it('returns false for unit 0 (out of range)', () => {
    expect(isHumanMockUnit(0)).toBe(false)
  })

  it('returns false for unit 49 (past curriculum end)', () => {
    expect(isHumanMockUnit(49)).toBe(false)
  })

  it('exactly 2 units in 1–48 range are human mock', () => {
    const mockUnits = Array.from({ length: 48 }, (_, i) => i + 1).filter(isHumanMockUnit)
    expect(mockUnits).toHaveLength(2)
  })
})

// ─── validateHumanMockEntry ───────────────────────────────────────────────────

const VALID_ENTRY: HumanMockEntry = {
  contact_name: 'Priya Sharma',
  company_context: 'Senior PM at Google, worked on Maps logistics',
  key_learning: 'Need to lead with the outcome before the context in every behavioral answer',
}

describe('validateHumanMockEntry', () => {
  it('returns valid for a complete entry', () => {
    const result = validateHumanMockEntry(VALID_ENTRY)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('returns invalid for null', () => {
    const result = validateHumanMockEntry(null)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('returns invalid for non-object', () => {
    expect(validateHumanMockEntry('string').valid).toBe(false)
    expect(validateHumanMockEntry(42).valid).toBe(false)
  })

  it('returns error when contact_name is missing', () => {
    const { contact_name: _, ...noName } = VALID_ENTRY
    const result = validateHumanMockEntry(noName)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('contact_name'))).toBe(true)
  })

  it('returns error when contact_name is empty string', () => {
    const result = validateHumanMockEntry({ ...VALID_ENTRY, contact_name: '' })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('contact_name'))).toBe(true)
  })

  it('returns error when contact_name is whitespace only', () => {
    const result = validateHumanMockEntry({ ...VALID_ENTRY, contact_name: '   ' })
    expect(result.valid).toBe(false)
  })

  it('returns error when company_context is missing', () => {
    const { company_context: _, ...noContext } = VALID_ENTRY
    const result = validateHumanMockEntry(noContext)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('company_context'))).toBe(true)
  })

  it('returns error when key_learning is missing', () => {
    const { key_learning: _, ...noLearning } = VALID_ENTRY
    const result = validateHumanMockEntry(noLearning)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('key_learning'))).toBe(true)
  })

  it('reports all missing fields at once', () => {
    const result = validateHumanMockEntry({})
    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(3)
  })

  it('returns valid for entry with extra fields (permissive validation)', () => {
    const withExtra = { ...VALID_ENTRY, extra_field: 'ignored' }
    const result = validateHumanMockEntry(withExtra)
    expect(result.valid).toBe(true)
  })
})
