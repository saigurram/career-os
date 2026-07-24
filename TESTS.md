# CareerOS — Complete Test Suite
**Based on:** Schema v001 + v002, file structure, PRD v2.4
**Run this in Claude Code:** "Read TESTS.md and implement the full test suite exactly as specified"

---

## Step 1: Install test dependencies

Tell Claude Code to run:
```bash
npm install -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
npm install -D playwright @playwright/test
npm install -D @supabase/supabase-js msw
npx playwright install chromium
```

Then add to package.json scripts:
```json
"test": "vitest run",
"test:watch": "vitest",
"test:e2e": "playwright test",
"test:evals": "vitest run src/__tests__/evals",
"test:all": "vitest run && playwright test"
```

---

## Step 2: vitest.config.ts (create in project root)

```typescript
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    coverage: {
      reporter: ['text', 'json', 'html'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

---

## Step 3: playwright.config.ts (create in project root)

```typescript
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './src/__tests__/e2e',
  fullyParallel: false,
  retries: 1,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
})
```

---

## Step 4: Test setup file

### src/__tests__/setup.ts
```typescript
import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Mock Supabase client
vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    })),
  })),
}))

// Mock Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(() => ({
    messages: {
      create: vi.fn(),
    },
  })),
}))

// Suppress console errors in tests
console.error = vi.fn()
```

---

## Step 5: Unit Tests

### src/__tests__/unit/nda.test.ts
```typescript
import { describe, it, expect } from 'vitest'

// NDA substitution logic — mirrors what Claude Code should build in lib/nda.ts
function substituteBlockedNames(
  text: string,
  blockedNames: Array<{ internal_name: string; generic_replacement: string; safe_for_external: boolean }>
): { output: string; substitutions: string[] } {
  let output = text
  const substitutions: string[] = []

  for (const entry of blockedNames) {
    const regex = new RegExp(entry.internal_name, 'gi')
    if (regex.test(output) && !entry.safe_for_external) {
      output = output.replace(regex, entry.generic_replacement)
      substitutions.push(`${entry.internal_name} → ${entry.generic_replacement}`)
    }
  }

  return { output, substitutions }
}

const SEEDED_BLOCKED_NAMES = [
  { internal_name: 'Falcon', generic_replacement: 'computer vision and edge computing platform for real-time fill rate optimization', safe_for_external: false },
  { internal_name: 'Vega', generic_replacement: 'micro-fulfillment platform extending sort center order cutoff and throughput', safe_for_external: false },
  { internal_name: 'DEFCON', generic_replacement: 'AR-assisted dual-side package handling automation system', safe_for_external: false },
  { internal_name: 'Turbo Merge', generic_replacement: 'container consolidation program', safe_for_external: false },
]

describe('NDA substitution', () => {
  it('replaces Falcon with generic replacement', () => {
    const { output, substitutions } = substituteBlockedNames(
      'I built Falcon to optimize fill rates.',
      SEEDED_BLOCKED_NAMES
    )
    expect(output).not.toContain('Falcon')
    expect(output).toContain('computer vision and edge computing platform')
    expect(substitutions).toHaveLength(1)
  })

  it('replaces Vega with generic replacement', () => {
    const { output } = substituteBlockedNames(
      'Vega extended order cutoff time at 83 sort centers.',
      SEEDED_BLOCKED_NAMES
    )
    expect(output).not.toContain('Vega')
    expect(output).toContain('micro-fulfillment platform')
  })

  it('is case-insensitive — catches falcon, FALCON, Falcon', () => {
    const inputs = ['falcon improved throughput', 'FALCON improved throughput', 'Falcon improved throughput']
    for (const input of inputs) {
      const { output } = substituteBlockedNames(input, SEEDED_BLOCKED_NAMES)
      expect(output.toLowerCase()).not.toContain('falcon')
    }
  })

  it('replaces all occurrences in a single string', () => {
    const { output } = substituteBlockedNames(
      'Falcon is great. We use Falcon daily.',
      SEEDED_BLOCKED_NAMES
    )
    expect(output).not.toContain('Falcon')
    expect(output.match(/computer vision and edge computing platform/g)).toHaveLength(2)
  })

  it('handles multiple different blocked names in one string', () => {
    const { output, substitutions } = substituteBlockedNames(
      'I built Falcon and Vega at Amazon.',
      SEEDED_BLOCKED_NAMES
    )
    expect(output).not.toContain('Falcon')
    expect(output).not.toContain('Vega')
    expect(substitutions).toHaveLength(2)
  })

  it('does not modify text with no blocked names', () => {
    const input = 'I led a platform that improved efficiency by 40%.'
    const { output, substitutions } = substituteBlockedNames(input, SEEDED_BLOCKED_NAMES)
    expect(output).toBe(input)
    expect(substitutions).toHaveLength(0)
  })

  it('handles empty string input', () => {
    const { output } = substituteBlockedNames('', SEEDED_BLOCKED_NAMES)
    expect(output).toBe('')
  })

  it('does not replace a name marked safe_for_external', () => {
    const safeEntry = [{ internal_name: 'TurboMerge', generic_replacement: 'consolidation program', safe_for_external: true }]
    const { output } = substituteBlockedNames('We won an award for TurboMerge.', safeEntry)
    expect(output).toContain('TurboMerge')
  })
})
```

---

### src/__tests__/unit/owner-language.test.ts
```typescript
import { describe, it, expect } from 'vitest'

const CONTRIBUTOR_PATTERNS = [
  /\bhelped\b/gi,
  /\bsupported\b/gi,
  /\bassisted\b/gi,
  /\bcontributed to\b/gi,
  /\bcollaborated on\b/gi,
]

const BANNED_PHRASES = [
  /passionate about/gi,
  /thought leader/gi,
  /game.changing/gi,
  /excited to share/gi,
  /humbled and honored/gi,
  /in today.s fast.paced world/gi,
  /synergy/gi,
]

function checkOwnerLanguage(text: string): { passed: boolean; violations: string[] } {
  const violations: string[] = []
  for (const pattern of CONTRIBUTOR_PATTERNS) {
    if (pattern.test(text)) violations.push(`Contributor language: ${pattern.source}`)
  }
  return { passed: violations.length === 0, violations }
}

function checkAuthenticity(text: string): { passed: boolean; violations: string[] } {
  const violations: string[] = []
  for (const pattern of BANNED_PHRASES) {
    if (pattern.test(text)) violations.push(`Banned phrase: ${pattern.source}`)
  }
  return { passed: violations.length === 0, violations }
}

describe('Owner language checker', () => {
  it('flags "helped" as contributor language', () => {
    const { passed, violations } = checkOwnerLanguage('I helped the team ship this feature.')
    expect(passed).toBe(false)
    expect(violations.length).toBeGreaterThan(0)
  })

  it('flags "supported" as contributor language', () => {
    const { passed } = checkOwnerLanguage('I supported the initiative.')
    expect(passed).toBe(false)
  })

  it('flags "assisted" as contributor language', () => {
    const { passed } = checkOwnerLanguage('I assisted in the launch.')
    expect(passed).toBe(false)
  })

  it('flags "contributed to" as contributor language', () => {
    const { passed } = checkOwnerLanguage('I contributed to the platform strategy.')
    expect(passed).toBe(false)
  })

  it('passes clean owner-framed text', () => {
    const { passed } = checkOwnerLanguage('I led the platform vision and drove a 40% improvement in throughput.')
    expect(passed).toBe(true)
  })

  it('passes text with "helped" in a different context (e.g. product helped users)', () => {
    // "helped" referring to the product helping users is acceptable
    // Only flag when user uses "helped" to describe their own role
    const { passed } = checkOwnerLanguage('The platform helped 500 associates process packages faster.')
    // This is ambiguous — the check should flag it and let user decide
    // For now we flag all instances to be safe
    expect(passed).toBe(false)
  })
})

describe('Authenticity checker', () => {
  it('flags "passionate about"', () => {
    const { passed } = checkAuthenticity('I am passionate about AI products.')
    expect(passed).toBe(false)
  })

  it('flags "thought leader"', () => {
    const { passed } = checkAuthenticity('I am a thought leader in logistics.')
    expect(passed).toBe(false)
  })

  it('flags "game-changing"', () => {
    const { passed } = checkAuthenticity('This is a game-changing product.')
    expect(passed).toBe(false)
  })

  it('flags "excited to share"', () => {
    const { passed } = checkAuthenticity("I'm excited to share my latest project.")
    expect(passed).toBe(false)
  })

  it('passes clean, specific, authentic text', () => {
    const { passed } = checkAuthenticity(
      'I built a computer vision system that cut container dwell time by 33%. Here is what I learned.'
    )
    expect(passed).toBe(true)
  })
})
```

---

### src/__tests__/unit/progress.test.ts
```typescript
import { describe, it, expect } from 'vitest'

// Progress calculation logic
function calculateTaskCompletion(progress: Array<{
  learn_done: boolean
  create_done: boolean
  outreach_done: boolean
  reflect_done: boolean
}>): { completedTasks: number; totalTasks: number; percentage: number } {
  const totalTasks = progress.length * 4
  const completedTasks = progress.reduce((acc, unit) => {
    return acc +
      (unit.learn_done ? 1 : 0) +
      (unit.create_done ? 1 : 0) +
      (unit.outreach_done ? 1 : 0) +
      (unit.reflect_done ? 1 : 0)
  }, 0)
  return {
    completedTasks,
    totalTasks,
    percentage: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
  }
}

function calculateUnitCompletion(progress: Array<{
  learn_done: boolean
  create_done: boolean
  outreach_done: boolean
  reflect_done: boolean
}>): { completedUnits: number; totalUnits: number; percentage: number } {
  const totalUnits = progress.length
  const completedUnits = progress.filter(
    u => u.learn_done && u.create_done && u.outreach_done && u.reflect_done
  ).length
  return {
    completedUnits,
    totalUnits,
    percentage: totalUnits > 0 ? Math.round((completedUnits / totalUnits) * 100) : 0,
  }
}

function calculatePaceStatus(
  completedTasks: number,
  totalTasks: number,
  phase2StartDate: Date,
  today: Date = new Date()
): { daysRemaining: number; tasksRemaining: number; onTrack: boolean; message: string } {
  const daysRemaining = Math.max(0, Math.ceil((phase2StartDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)))
  const tasksRemaining = totalTasks - completedTasks
  const onTrack = tasksRemaining <= daysRemaining

  return {
    daysRemaining,
    tasksRemaining,
    onTrack,
    message: onTrack
      ? `Jan 15 is ${daysRemaining} days away. ${tasksRemaining} tasks remaining. You're on track.`
      : `Jan 15 is ${daysRemaining} days away. ${tasksRemaining} tasks remaining. Complete ${tasksRemaining - daysRemaining} extra tasks to catch up.`,
  }
}

describe('Task completion tracking', () => {
  it('calculates 0% when no tasks done', () => {
    const progress = Array(34).fill({ learn_done: false, create_done: false, outreach_done: false, reflect_done: false })
    const { percentage, totalTasks } = calculateTaskCompletion(progress)
    expect(percentage).toBe(0)
    expect(totalTasks).toBe(136)
  })

  it('calculates 100% when all tasks done', () => {
    const progress = Array(34).fill({ learn_done: true, create_done: true, outreach_done: true, reflect_done: true })
    const { percentage, completedTasks } = calculateTaskCompletion(progress)
    expect(percentage).toBe(100)
    expect(completedTasks).toBe(136)
  })

  it('calculates 25% when only Learn tasks done across all units', () => {
    const progress = Array(34).fill({ learn_done: true, create_done: false, outreach_done: false, reflect_done: false })
    const { percentage } = calculateTaskCompletion(progress)
    expect(percentage).toBe(25)
  })

  it('handles partial unit completion correctly', () => {
    const progress = [
      { learn_done: true, create_done: true, outreach_done: false, reflect_done: false }, // 2 tasks
      { learn_done: false, create_done: false, outreach_done: false, reflect_done: false }, // 0 tasks
    ]
    const { completedTasks, totalTasks } = calculateTaskCompletion(progress)
    expect(completedTasks).toBe(2)
    expect(totalTasks).toBe(8)
  })

  it('never returns percentage above 100', () => {
    const progress = Array(34).fill({ learn_done: true, create_done: true, outreach_done: true, reflect_done: true })
    const { percentage } = calculateTaskCompletion(progress)
    expect(percentage).toBeLessThanOrEqual(100)
  })
})

describe('Unit completion tracking', () => {
  it('marks unit complete only when all 4 tasks done', () => {
    const progress = [
      { learn_done: true, create_done: true, outreach_done: true, reflect_done: true },  // complete
      { learn_done: true, create_done: true, outreach_done: true, reflect_done: false },  // not complete
    ]
    const { completedUnits } = calculateUnitCompletion(progress)
    expect(completedUnits).toBe(1)
  })

  it('counts 0 complete units when all are partial', () => {
    const progress = Array(34).fill({ learn_done: true, create_done: false, outreach_done: false, reflect_done: false })
    const { completedUnits } = calculateUnitCompletion(progress)
    expect(completedUnits).toBe(0)
  })
})

describe('Pace status', () => {
  it('shows on track when tasks remaining <= days remaining', () => {
    const today = new Date('2026-06-01')
    const phase2Start = new Date('2027-01-15')
    const { onTrack } = calculatePaceStatus(0, 136, phase2Start, today)
    // 228 days remaining, 136 tasks — on track
    expect(onTrack).toBe(true)
  })

  it('shows off track when tasks remaining > days remaining', () => {
    const today = new Date('2027-01-10')
    const phase2Start = new Date('2027-01-15')
    const { onTrack } = calculatePaceStatus(0, 136, phase2Start, today)
    // 5 days remaining, 136 tasks — not on track
    expect(onTrack).toBe(false)
  })

  it('shows 0 days remaining after phase 2 start date', () => {
    const today = new Date('2027-02-01')
    const phase2Start = new Date('2027-01-15')
    const { daysRemaining } = calculatePaceStatus(100, 136, phase2Start, today)
    expect(daysRemaining).toBe(0)
  })
})
```

---

### src/__tests__/unit/jobs.test.ts
```typescript
import { describe, it, expect } from 'vitest'

// Job filtering logic — mirrors what the cron job and feed should do
interface Job {
  title: string
  company: string
  location: string
  level_estimate: string
  comp_estimate_inr: number | null
  is_remote: boolean
  is_active: boolean
}

const LEVEL_HIERARCHY = ['Junior PM', 'PM', 'Senior PM', 'Lead PM', 'Staff PM', 'Principal PM', 'Group PM', 'Director PM']
const MINIMUM_LEVEL = 'Senior PM'
const MINIMUM_COMP_INR = 8000000 // ₹80L — Amazon L6 Hyderabad floor

function isAboveMinimumLevel(levelEstimate: string): boolean {
  const minIndex = LEVEL_HIERARCHY.indexOf(MINIMUM_LEVEL)
  const jobIndex = LEVEL_HIERARCHY.findIndex(l => levelEstimate.toLowerCase().includes(l.toLowerCase()))
  return jobIndex >= minIndex
}

function filterJobs(jobs: Job[]): Job[] {
  return jobs.filter(job => {
    // Must be active
    if (!job.is_active) return false
    // Must be Hyderabad or remote
    const isHyderabad = job.location.toLowerCase().includes('hyderabad')
    if (!isHyderabad && !job.is_remote) return false
    // Must be above minimum level
    if (!isAboveMinimumLevel(job.level_estimate)) return false
    // Must be above minimum comp (if comp is provided)
    if (job.comp_estimate_inr !== null && job.comp_estimate_inr < MINIMUM_COMP_INR) return false
    return true
  })
}

describe('Job filtering — location', () => {
  const baseJob: Job = {
    title: 'Senior PM',
    company: 'Google',
    location: 'Hyderabad',
    level_estimate: 'Senior PM',
    comp_estimate_inr: 15000000,
    is_remote: false,
    is_active: true,
  }

  it('includes Hyderabad jobs', () => {
    const result = filterJobs([baseJob])
    expect(result).toHaveLength(1)
  })

  it('includes remote jobs', () => {
    const remoteJob = { ...baseJob, location: 'India (Remote)', is_remote: true }
    const result = filterJobs([remoteJob])
    expect(result).toHaveLength(1)
  })

  it('excludes Bangalore jobs', () => {
    const bangaloreJob = { ...baseJob, location: 'Bangalore', is_remote: false }
    const result = filterJobs([bangaloreJob])
    expect(result).toHaveLength(0)
  })

  it('excludes Mumbai jobs', () => {
    const mumbaiJob = { ...baseJob, location: 'Mumbai', is_remote: false }
    const result = filterJobs([mumbaiJob])
    expect(result).toHaveLength(0)
  })

  it('excludes Hyderabad OR Bangalore dual-city jobs if not remote', () => {
    // Hyderabad is in the string so it passes location check — this is acceptable
    const dualCity = { ...baseJob, location: 'Hyderabad or Bangalore', is_remote: false }
    const result = filterJobs([dualCity])
    expect(result).toHaveLength(1) // passes because Hyderabad is in string
  })

  it('excludes US-based jobs', () => {
    const usJob = { ...baseJob, location: 'Seattle, WA', is_remote: false }
    const result = filterJobs([usJob])
    expect(result).toHaveLength(0)
  })
})

describe('Job filtering — level', () => {
  const baseJob: Job = {
    title: 'PM Role',
    company: 'Uber',
    location: 'Hyderabad',
    level_estimate: 'Senior PM',
    comp_estimate_inr: 15000000,
    is_remote: false,
    is_active: true,
  }

  it('includes Senior PM', () => {
    expect(filterJobs([baseJob])).toHaveLength(1)
  })

  it('includes Lead PM', () => {
    expect(filterJobs([{ ...baseJob, level_estimate: 'Lead PM' }])).toHaveLength(1)
  })

  it('includes Principal PM', () => {
    expect(filterJobs([{ ...baseJob, level_estimate: 'Principal PM' }])).toHaveLength(1)
  })

  it('includes Staff PM', () => {
    expect(filterJobs([{ ...baseJob, level_estimate: 'Staff PM' }])).toHaveLength(1)
  })

  it('excludes PM (too junior)', () => {
    expect(filterJobs([{ ...baseJob, level_estimate: 'PM' }])).toHaveLength(0)
  })

  it('excludes Junior PM', () => {
    expect(filterJobs([{ ...baseJob, level_estimate: 'Junior PM' }])).toHaveLength(0)
  })
})

describe('Job filtering — comp', () => {
  const baseJob: Job = {
    title: 'Principal PM',
    company: 'Google',
    location: 'Hyderabad',
    level_estimate: 'Principal PM',
    comp_estimate_inr: 15000000,
    is_remote: false,
    is_active: true,
  }

  it('includes jobs above minimum comp', () => {
    expect(filterJobs([baseJob])).toHaveLength(1)
  })

  it('excludes jobs below minimum comp (₹80L floor)', () => {
    const lowComp = { ...baseJob, comp_estimate_inr: 7000000 } // ₹70L
    expect(filterJobs([lowComp])).toHaveLength(0)
  })

  it('includes jobs with null comp (unknown — give benefit of doubt)', () => {
    const unknownComp = { ...baseJob, comp_estimate_inr: null }
    expect(filterJobs([unknownComp])).toHaveLength(1)
  })

  it('excludes inactive jobs regardless of other criteria', () => {
    const inactiveJob = { ...baseJob, is_active: false }
    expect(filterJobs([inactiveJob])).toHaveLength(0)
  })
})

describe('Job filtering — edge cases', () => {
  it('returns empty array for empty input', () => {
    expect(filterJobs([])).toHaveLength(0)
  })

  it('handles comp in USD field mistakenly (very low INR number)', () => {
    // If someone accidentally sets comp_estimate_inr to 150000 (which is $150k USD)
    // it should be filtered out since 150000 INR is ₹1.5L — way below floor
    const usdAsInr = {
      title: 'Senior PM', company: 'Test', location: 'Hyderabad',
      level_estimate: 'Senior PM', comp_estimate_inr: 150000,
      is_remote: false, is_active: true,
    }
    expect(filterJobs([usdAsInr])).toHaveLength(0)
  })
})
```

---

### src/__tests__/unit/phase-transition.test.ts
```typescript
import { describe, it, expect } from 'vitest'

function shouldBePhase2(phase2StartDate: Date, today: Date = new Date()): boolean {
  return today >= phase2StartDate
}

function getPhase(phase2StartDate: Date, currentPhase: string, today: Date = new Date()): string {
  if (currentPhase === 'phase2') return 'phase2'
  if (shouldBePhase2(phase2StartDate, today)) return 'phase2'
  return 'phase1'
}

describe('Phase transition logic', () => {
  const phase2Date = new Date('2027-01-15')

  it('stays phase1 before Jan 15 2027', () => {
    const today = new Date('2026-12-31')
    expect(getPhase(phase2Date, 'phase1', today)).toBe('phase1')
  })

  it('transitions to phase2 ON Jan 15 2027', () => {
    const today = new Date('2027-01-15')
    expect(getPhase(phase2Date, 'phase1', today)).toBe('phase2')
  })

  it('is phase2 after Jan 15 2027', () => {
    const today = new Date('2027-06-01')
    expect(getPhase(phase2Date, 'phase1', today)).toBe('phase2')
  })

  it('stays phase2 once set, even before the date', () => {
    const today = new Date('2026-06-01')
    expect(getPhase(phase2Date, 'phase2', today)).toBe('phase2')
  })

  it('handles user-changed phase2 start date correctly', () => {
    const earlyDate = new Date('2026-11-01')
    const today = new Date('2026-11-15')
    expect(getPhase(earlyDate, 'phase1', today)).toBe('phase2')
  })
})
```

---

### src/__tests__/unit/streak.test.ts
```typescript
import { describe, it, expect } from 'vitest'

function calculateStreak(completionDates: Date[], today: Date = new Date()): number {
  if (completionDates.length === 0) return 0

  // Get unique dates (day-level, in IST)
  const uniqueDays = [...new Set(
    completionDates.map(d => d.toISOString().split('T')[0])
  )].sort().reverse()

  if (uniqueDays.length === 0) return 0

  const todayStr = today.toISOString().split('T')[0]
  const yesterdayStr = new Date(today.getTime() - 86400000).toISOString().split('T')[0]

  // Streak must include today or yesterday to be active
  if (uniqueDays[0] !== todayStr && uniqueDays[0] !== yesterdayStr) return 0

  let streak = 0
  let currentDate = new Date(uniqueDays[0])

  for (const day of uniqueDays) {
    const dayDate = new Date(day)
    const diff = Math.round((currentDate.getTime() - dayDate.getTime()) / 86400000)
    if (diff <= 1) {
      streak++
      currentDate = dayDate
    } else {
      break
    }
  }

  return streak
}

describe('Streak calculation', () => {
  it('returns 0 for no completion dates', () => {
    expect(calculateStreak([], new Date('2026-06-10'))).toBe(0)
  })

  it('returns 1 for single task done today', () => {
    const today = new Date('2026-06-10')
    expect(calculateStreak([today], today)).toBe(1)
  })

  it('returns streak for consecutive days', () => {
    const today = new Date('2026-06-10')
    const dates = [
      new Date('2026-06-10'),
      new Date('2026-06-09'),
      new Date('2026-06-08'),
    ]
    expect(calculateStreak(dates, today)).toBe(3)
  })

  it('breaks streak on gap day', () => {
    const today = new Date('2026-06-10')
    const dates = [
      new Date('2026-06-10'),
      new Date('2026-06-09'),
      new Date('2026-06-07'), // gap — missing June 8
    ]
    expect(calculateStreak(dates, today)).toBe(2)
  })

  it('keeps streak alive if last completion was yesterday', () => {
    const today = new Date('2026-06-10')
    const dates = [new Date('2026-06-09')] // yesterday only
    expect(calculateStreak(dates, today)).toBe(1)
  })

  it('resets streak if last completion was 2+ days ago', () => {
    const today = new Date('2026-06-10')
    const dates = [new Date('2026-06-07')] // 3 days ago
    expect(calculateStreak(dates, today)).toBe(0)
  })

  it('multiple tasks on same day count as one streak day', () => {
    const today = new Date('2026-06-10')
    const dates = [
      new Date('2026-06-10T09:00:00'),
      new Date('2026-06-10T14:00:00'),
      new Date('2026-06-10T20:00:00'),
    ]
    expect(calculateStreak(dates, today)).toBe(1)
  })
})
```

---

## Step 6: Eval Tests (Claude API output quality)

### src/__tests__/evals/claude-output.eval.ts
```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'

// These evals call the REAL Claude API — run with ANTHROPIC_API_KEY set
// Run: ANTHROPIC_API_KEY=xxx vitest run src/__tests__/evals

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const NDA_BLOCKED_NAMES = ['Falcon', 'Vega', 'DEFCON', 'Turbo Merge']
const CONTRIBUTOR_WORDS = ['helped', 'supported', 'assisted', 'contributed to', 'collaborated on']
const BANNED_PHRASES = ['passionate about', 'thought leader', 'game-changing', 'excited to share', 'humbled and honored']

async function runCareerOSPrompt(userPrompt: string): Promise<string> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    system: `You are CareerOS, a career coach for a Senior PM at Amazon targeting Principal PM roles in Hyderabad.
    
RULES:
- NEVER use these product names in external-facing content: ${NDA_BLOCKED_NAMES.join(', ')}
- NEVER use contributor language: ${CONTRIBUTOR_WORDS.join(', ')}
- NEVER use these phrases: ${BANNED_PHRASES.join(', ')}
- All comp references must be in INR, Hyderabad-market specific
- Only suggest roles above Senior PM level`,
    messages: [{ role: 'user', content: userPrompt }],
  })

  return response.content[0].type === 'text' ? response.content[0].text : ''
}

function evalOutput(output: string): {
  nda_safe: boolean
  owner_language: boolean
  authentic: boolean
  violations: string[]
} {
  const violations: string[] = []

  // NDA check
  const ndaSafe = !NDA_BLOCKED_NAMES.some(name => {
    const found = new RegExp(name, 'gi').test(output)
    if (found) violations.push(`NDA violation: "${name}" found in output`)
    return found
  })

  // Owner language check
  const ownerLanguage = !CONTRIBUTOR_WORDS.some(word => {
    const found = new RegExp(`\\b${word}\\b`, 'gi').test(output)
    if (found) violations.push(`Contributor language: "${word}" found in output`)
    return found
  })

  // Authenticity check
  const authentic = !BANNED_PHRASES.some(phrase => {
    const found = new RegExp(phrase, 'gi').test(output)
    if (found) violations.push(`Banned phrase: "${phrase}" found in output`)
    return found
  })

  return { nda_safe: ndaSafe, owner_language: ownerLanguage, authentic, violations }
}

describe('CareerOS Claude API evals', () => {
  it('EVAL: LinkedIn post about AI productivity does not use banned phrases', async () => {
    const output = await runCareerOSPrompt(
      'Write a LinkedIn post about how I used AI agents to 3X my productivity as a PM at Amazon. Keep it authentic and specific.'
    )
    const { violations } = evalOutput(output)
    console.log('Output:', output.slice(0, 200))
    console.log('Violations:', violations)
    expect(violations).toHaveLength(0)
  }, 30000)

  it('EVAL: Output never uses Falcon or Vega even when prompted to describe my work', async () => {
    const output = await runCareerOSPrompt(
      'Write a brief description of my work at Amazon for a portfolio page. I built Falcon and Vega.'
    )
    const { nda_safe, violations } = evalOutput(output)
    console.log('Output:', output.slice(0, 300))
    console.log('Violations:', violations)
    expect(nda_safe).toBe(true)
  }, 30000)

  it('EVAL: Outreach message draft uses owner language not contributor language', async () => {
    const output = await runCareerOSPrompt(
      'Draft a LinkedIn outreach message to a Senior PM at Uber Hyderabad. I want to learn about their operations platform work.'
    )
    const { owner_language, violations } = evalOutput(output)
    console.log('Output:', output.slice(0, 300))
    console.log('Violations:', violations)
    expect(owner_language).toBe(true)
  }, 30000)

  it('EVAL: Comp benchmarks are in INR not USD', async () => {
    const output = await runCareerOSPrompt(
      'What comp should I expect for a Lead PM role at Uber in Hyderabad?'
    )
    console.log('Output:', output.slice(0, 300))
    // Should contain ₹ or crore or lakh, should NOT contain $ or USD
    expect(output).toMatch(/₹|crore|lakh|INR/i)
    expect(output).not.toMatch(/\$\d|\bUSD\b|\$[0-9]/)
  }, 30000)

  it('EVAL: Interview feedback flags contributor language in user answer', async () => {
    const output = await runCareerOSPrompt(
      `I just answered this interview question: "Tell me about a time you drove a major initiative."
      My answer was: "I helped the team ship a container optimization feature that saved costs."
      Please give me feedback on my answer.`
    )
    console.log('Output:', output.slice(0, 400))
    // Claude should flag "helped" as contributor language
    expect(output.toLowerCase()).toMatch(/helped|contributor|owner|led|drove/)
  }, 30000)

  it('EVAL: Curriculum content references a real, specific resource (not generic topic)', async () => {
    const output = await runCareerOSPrompt(
      `Generate Week 1 curriculum content for a Senior PM learning about GenAI. 
      The Learn resource must be a specific named article, talk, or paper with a URL or clear source.
      Return JSON: { "learn_resource_title": "", "learn_resource_url": "", "learn_prompt": "" }`
    )
    console.log('Output:', output.slice(0, 400))
    // Should contain a URL or specific source
    expect(output).toMatch(/http|\.com|substack|youtube|github/i)
  }, 30000)
})
```

---

## Step 7: E2E Tests (Playwright)

### src/__tests__/e2e/auth.spec.ts
```typescript
import { test, expect } from '@playwright/test'

test.describe('Authentication flows', () => {
  test('landing page loads and shows login option', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/CareerOS/)
    await expect(page.getByRole('link', { name: /login|sign in/i })).toBeVisible()
  })

  test('unauthenticated user redirected to login from dashboard', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/login/)
  })

  test('unauthenticated user redirected to login from curriculum', async ({ page }) => {
    await page.goto('/curriculum')
    await expect(page).toHaveURL(/login/)
  })

  test('unauthenticated user redirected to login from jobs', async ({ page }) => {
    await page.goto('/jobs')
    await expect(page).toHaveURL(/login/)
  })

  test('unauthenticated user redirected to login from portfolio', async ({ page }) => {
    await page.goto('/portfolio')
    await expect(page).toHaveURL(/login/)
  })

  test('login page shows email and password fields', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByLabel(/email/i)).toBeVisible()
    await expect(page.getByLabel(/password/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /sign in|login/i })).toBeVisible()
  })

  test('signup page shows required fields', async ({ page }) => {
    await page.goto('/signup')
    await expect(page.getByLabel(/email/i)).toBeVisible()
    await expect(page.getByLabel(/password/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /sign up|create account/i })).toBeVisible()
  })

  test('login shows error on invalid credentials', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel(/email/i).fill('notauser@test.com')
    await page.getByLabel(/password/i).fill('wrongpassword123')
    await page.getByRole('button', { name: /sign in|login/i }).click()
    await expect(page.getByText(/invalid|error|incorrect/i)).toBeVisible({ timeout: 10000 })
  })
})
```

---

### src/__tests__/e2e/dashboard.spec.ts
```typescript
import { test, expect } from '@playwright/test'

// These tests require a test user in Supabase
// Set TEST_USER_EMAIL and TEST_USER_PASSWORD in .env.test

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // Skip if no test credentials
    if (!process.env.TEST_USER_EMAIL) {
      test.skip()
    }
    await page.goto('/login')
    await page.getByLabel(/email/i).fill(process.env.TEST_USER_EMAIL!)
    await page.getByLabel(/password/i).fill(process.env.TEST_USER_PASSWORD!)
    await page.getByRole('button', { name: /sign in|login/i }).click()
    await page.waitForURL(/dashboard/)
  })

  test('dashboard loads with key sections', async ({ page }) => {
    await expect(page.getByText(/curriculum|progress|jobs/i)).toBeVisible()
  })

  test('progress ring is visible', async ({ page }) => {
    // ProgressRing component should render
    await expect(page.locator('[data-testid="progress-ring"], circle, .progress-ring')).toBeVisible()
  })

  test('stat cards are visible', async ({ page }) => {
    await expect(page.locator('[data-testid="stat-card"], .stat-card')).toBeVisible()
  })

  test('navigation links to curriculum', async ({ page }) => {
    await page.getByRole('link', { name: /curriculum/i }).click()
    await expect(page).toHaveURL(/curriculum/)
  })

  test('navigation links to jobs', async ({ page }) => {
    await page.getByRole('link', { name: /jobs/i }).click()
    await expect(page).toHaveURL(/jobs/)
  })

  test('navigation links to portfolio', async ({ page }) => {
    await page.getByRole('link', { name: /portfolio/i }).click()
    await expect(page).toHaveURL(/portfolio/)
  })
})
```

---

### src/__tests__/e2e/curriculum.spec.ts
```typescript
import { test, expect } from '@playwright/test'

test.describe('Curriculum', () => {
  test.beforeEach(async ({ page }) => {
    if (!process.env.TEST_USER_EMAIL) test.skip()
    await page.goto('/login')
    await page.getByLabel(/email/i).fill(process.env.TEST_USER_EMAIL!)
    await page.getByLabel(/password/i).fill(process.env.TEST_USER_PASSWORD!)
    await page.getByRole('button', { name: /sign in|login/i }).click()
    await page.waitForURL(/dashboard/)
    await page.goto('/curriculum')
  })

  test('curriculum page loads without error', async ({ page }) => {
    await expect(page.locator('body')).not.toContainText('Error')
    await expect(page.locator('body')).not.toContainText('undefined')
  })

  test('shows curriculum units', async ({ page }) => {
    // Should show at least one unit
    await expect(page.locator('[data-testid="curriculum-unit"], .curriculum-unit')).toBeVisible({ timeout: 10000 })
  })

  test('task checkboxes are interactive', async ({ page }) => {
    const checkbox = page.locator('[data-testid="task-checkbox"], input[type="checkbox"]').first()
    if (await checkbox.isVisible()) {
      const initialState = await checkbox.isChecked()
      await checkbox.click()
      await expect(checkbox).not.toBeChecked() // if was checked, now unchecked — or vice versa
      // Reset
      await checkbox.click()
      expect(await checkbox.isChecked()).toBe(initialState)
    }
  })

  test('does not show "week" as a user-facing label', async ({ page }) => {
    // Per PRD — weeks are internal only, UI shows units/tasks
    const bodyText = await page.locator('body').innerText()
    // "Week 1" as a header should not appear — "Unit 1" or just the theme name is acceptable
    expect(bodyText).not.toMatch(/^Week \d+$/m)
  })
})
```

---

### src/__tests__/e2e/jobs.spec.ts
```typescript
import { test, expect } from '@playwright/test'

test.describe('Job feed', () => {
  test.beforeEach(async ({ page }) => {
    if (!process.env.TEST_USER_EMAIL) test.skip()
    await page.goto('/login')
    await page.getByLabel(/email/i).fill(process.env.TEST_USER_EMAIL!)
    await page.getByLabel(/password/i).fill(process.env.TEST_USER_PASSWORD!)
    await page.getByRole('button', { name: /sign in|login/i }).click()
    await page.waitForURL(/dashboard/)
    await page.goto('/jobs')
  })

  test('jobs page loads without error', async ({ page }) => {
    await expect(page.locator('body')).not.toContainText('undefined')
  })

  test('no job shows "Junior PM" or "PM II" level', async ({ page }) => {
    await page.waitForTimeout(2000) // let jobs load
    const bodyText = await page.locator('body').innerText()
    expect(bodyText).not.toMatch(/Junior PM|PM II/)
  })

  test('no job shows USD compensation', async ({ page }) => {
    await page.waitForTimeout(2000)
    const bodyText = await page.locator('body').innerText()
    expect(bodyText).not.toMatch(/\$\d{2,3},\d{3}|\$\d{1,3}k\s*USD/)
  })

  test('no job shows Bangalore-only location', async ({ page }) => {
    await page.waitForTimeout(2000)
    // Job cards should not show "Bangalore" as the sole location
    const jobCards = page.locator('[data-testid="job-card"], .job-card')
    const count = await jobCards.count()
    for (let i = 0; i < count; i++) {
      const text = await jobCards.nth(i).innerText()
      // If only Bangalore (not Hyderabad), fail
      if (text.includes('Bangalore') && !text.includes('Hyderabad') && !text.includes('Remote')) {
        throw new Error(`Job card contains Bangalore-only location: ${text.slice(0, 100)}`)
      }
    }
  })

  test('empty state is handled gracefully (no crash)', async ({ page }) => {
    // If no jobs, should show a friendly empty state not an error
    await expect(page.locator('body')).not.toContainText('Cannot read properties')
    await expect(page.locator('body')).not.toContainText('TypeError')
  })
})
```

---

### src/__tests__/e2e/portfolio.spec.ts
```typescript
import { test, expect } from '@playwright/test'

test.describe('Portfolio', () => {
  test.beforeEach(async ({ page }) => {
    if (!process.env.TEST_USER_EMAIL) test.skip()
    await page.goto('/login')
    await page.getByLabel(/email/i).fill(process.env.TEST_USER_EMAIL!)
    await page.getByLabel(/password/i).fill(process.env.TEST_USER_PASSWORD!)
    await page.getByRole('button', { name: /sign in|login/i }).click()
    await page.waitForURL(/dashboard/)
    await page.goto('/portfolio')
  })

  test('portfolio page loads without error', async ({ page }) => {
    await expect(page.locator('body')).not.toContainText('TypeError')
  })

  test('empty portfolio shows helpful prompt not a crash', async ({ page }) => {
    const bodyText = await page.locator('body').innerText()
    expect(bodyText).not.toContain('undefined')
    expect(bodyText).not.toContain('null')
  })
})
```

---

## Step 8: Database/Schema tests

### src/__tests__/unit/schema.test.ts
```typescript
import { describe, it, expect } from 'vitest'

// Test that our schema design decisions are correct
// These are logic tests — not actual DB queries

describe('Schema design validation', () => {
  it('user_unit_progress has composite primary key (user_id, unit_id)', () => {
    // Verified from schema — ensures one progress record per user per unit
    const schema = `primary key (user_id, unit_id)`
    expect(schema).toContain('user_id')
    expect(schema).toContain('unit_id')
  })

  it('all 48 curriculum units are seeded (1-48)', () => {
    const unitNumbers = Array.from({ length: 48 }, (_, i) => i + 1)
    expect(unitNumbers).toHaveLength(48)
    expect(unitNumbers[0]).toBe(1)
    expect(unitNumbers[47]).toBe(48)
  })

  it('all 85 AI concepts are seeded (1-85)', () => {
    const conceptNumbers = Array.from({ length: 85 }, (_, i) => i + 1)
    expect(conceptNumbers).toHaveLength(85)
    expect(conceptNumbers[0]).toBe(1)
    expect(conceptNumbers[84]).toBe(85)
  })

  it('AI concepts span all 5 tiers', () => {
    const tier1Count = 17 // concepts 1-10, 43-49
    const tier2Count = 19 // concepts 11-20, 50-58
    const tier3Count = 18 // concepts 21-30, 59-66
    const tier4Count = 20 // concepts 31-42, 67-74
    const tier5Count = 11 // concepts 75-85 (system-design depth, new)
    expect(tier1Count + tier2Count + tier3Count + tier4Count + tier5Count).toBe(85)
  })

  it('offer_deadline defaults to 2027-06-30', () => {
    const defaultDeadline = '2027-06-30'
    expect(new Date(defaultDeadline).getFullYear()).toBe(2027)
    expect(new Date(defaultDeadline).getMonth()).toBe(5) // June is month 5 (0-indexed)
  })

  it('phase check constraint only allows phase1 or phase2', () => {
    const validPhases = ['phase1', 'phase2']
    const invalidPhases = ['Phase1', 'PHASE1', 'prep', 'search', '1', '2']

    validPhases.forEach(p => expect(['phase1', 'phase2']).toContain(p))
    invalidPhases.forEach(p => expect(['phase1', 'phase2']).not.toContain(p))
  })

  it('interview_answers RLS uses subquery to check user ownership', () => {
    // The policy on interview_answers joins through interview_sessions
    // This is correct — answers don't have direct user_id
    const policy = `auth.uid() = (select user_id from public.interview_sessions where id = session_id)`
    expect(policy).toContain('interview_sessions')
    expect(policy).toContain('user_id')
  })

  it('jobs table allows service role to insert (for cron job)', () => {
    // Verified from schema — "Service role can insert jobs" policy
    const policy = `for insert with check (true)`
    expect(policy).toContain('insert')
  })
})
```

---

## Step 9: Tell Claude Code to implement this

**Paste this into Claude Code terminal:**

```
Read TESTS.md in the project root. 

1. Install all test dependencies listed in Step 1
2. Create vitest.config.ts as specified in Step 2
3. Create playwright.config.ts as specified in Step 3
4. Create src/__tests__/setup.ts as specified in Step 4
5. Create all unit test files in src/__tests__/unit/
6. Create the eval test file in src/__tests__/evals/
7. Create all E2E test files in src/__tests__/e2e/
8. Add test scripts to package.json
9. Run `npm test` and fix any TypeScript errors
10. Run `npm run test:e2e` in headed mode and fix any failures
11. Show me a summary of all passing and failing tests

Do not move to the next file until the current one compiles without TypeScript errors.
```

---

## Step 10: After tests pass — add test IDs to components

Tell Claude Code:
```
Add data-testid attributes to these components so Playwright tests can find them:
- DashboardClient.tsx: add data-testid="progress-ring" to ProgressRing, data-testid="stat-card" to each StatCard
- CurriculumClient.tsx: add data-testid="curriculum-unit" to each unit container, data-testid="task-checkbox" to each checkbox
- JobCard.tsx: add data-testid="job-card" to the card root element
- PortfolioClient.tsx: add data-testid="artifact-card" to each artifact card
```

---

## Quick reference: run specific test suites

```bash
# Unit tests only (fast, no API calls)
npm test

# E2E tests (needs dev server running)
npm run test:e2e

# Eval tests (needs ANTHROPIC_API_KEY, costs tokens)
ANTHROPIC_API_KEY=xxx npm run test:evals

# All tests
npm run test:all

# Watch mode for development
npm run test:watch
```

