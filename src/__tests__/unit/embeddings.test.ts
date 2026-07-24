import { describe, it, expect } from 'vitest'
import { cosineSimilarity } from '@/lib/embeddings'

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10)
  })

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10)
  })

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [-1, -2, -3])).toBeCloseTo(-1, 10)
  })

  it('is scale-invariant', () => {
    const a = [1, 2, 3]
    const b = [2, 4, 6]
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 10)
  })

  it('returns 0 for mismatched lengths', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0)
  })

  it('returns 0 for empty vectors', () => {
    expect(cosineSimilarity([], [])).toBe(0)
  })

  it('returns 0 when a vector is all zeros', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0)
  })

  it('is symmetric', () => {
    const a = [0.5, -1.2, 3.4]
    const b = [2.1, 0.3, -0.7]
    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 10)
  })
})
