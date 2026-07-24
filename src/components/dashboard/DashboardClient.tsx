'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  Flame, Target, BookOpen, Award, Briefcase, TrendingUp,
  KanbanSquare, FileText, Clock, CheckCircle2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { GlassCard } from '@/components/dashboard/GlassCard'
import { ProgressRing } from '@/components/dashboard/ProgressRing'
import { StatCard } from '@/components/dashboard/StatCard'
import { JobCard } from '@/components/dashboard/JobCard'
import PhaseTransitionBanner from '@/components/PhaseTransitionBanner'
import type { Tables } from '@/types/database'
import type { Phase, Phase1Stats } from '@/lib/phase'
import { getPhase2Label, daysUntilDeadline } from '@/lib/phase'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Application {
  id: string
  status: string
  company: string | null
  role: string | null
  fit_score: number | null
}

interface Props {
  phase: Phase
  profile: Tables<'users'> | null
  userProfile: Tables<'user_profile'> | null
  units: Tables<'curriculum_units'>[]
  progress: Tables<'user_unit_progress'>[]
  concepts: Tables<'ai_concepts'>[]
  coveredCount: number
  artifacts: Tables<'pow_artifacts'>[]
  jobs: Tables<'jobs'>[]
  applications: Application[]
  streak: number
  daysToEnd: number
  doneTasks: number
  remainingTasks: number
  doneUnits: number
  phase1Stats: Phase1Stats
}

import type { Variants } from 'framer-motion'

const staggerContainer: Variants = {
  animate: { transition: { staggerChildren: 0.06 } },
}
const staggerItem: Variants = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3 } },
}

// ─── Kanban stage order ───────────────────────────────────────────────────────
const STAGE_ORDER = [
  'spotted', 'interested', 'applied', 'recruiter_screen',
  'hm_round', 'loop', 'offer', 'negotiating', 'closed',
]

const STAGE_LABELS: Record<string, string> = {
  spotted: 'Spotted', interested: 'Interested', applied: 'Applied',
  recruiter_screen: 'Recruiter', hm_round: 'HM Round', loop: 'Loop',
  offer: 'Offer', negotiating: 'Negotiating', closed: 'Closed',
}

export default function DashboardClient({
  phase, profile, units, progress, coveredCount, artifacts, jobs,
  applications, streak, daysToEnd, remainingTasks, doneUnits, phase1Stats,
}: Props) {
  const router = useRouter()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createClient() as any
  const [localProgress, setLocalProgress] = useState(progress)

  // Show Phase 1 completion banner once when user first reaches Phase 2
  // (controlled via sessionStorage so it only appears once per session)
  const [bannerDismissed, setBannerDismissed] = useState(() => {
    if (typeof window === 'undefined') return true
    return sessionStorage.getItem('phase2_welcomed') === '1'
  })

  function handleEnterPhase2() {
    if (typeof window !== 'undefined') sessionStorage.setItem('phase2_welcomed', '1')
    setBannerDismissed(true)
  }

  // Show celebration banner once on first Phase 2 load
  if (phase === 'phase2' && !bannerDismissed) {
    return <PhaseTransitionBanner stats={phase1Stats} onEnterPhase2={handleEnterPhase2} />
  }

  // ── Phase 1 helpers ──────────────────────────────────────────────────────────
  const currentUnit = units.find(u => {
    const p = localProgress.find(pr => pr.unit_id === u.id)
    return !p || !(p.learn_done && p.create_done && p.outreach_done && p.reflect_done)
  }) ?? units[0]

  const currentProgress = localProgress.find(p => p.unit_id === currentUnit?.id)

  async function toggleTask(task: 'learn_done' | 'create_done' | 'outreach_done' | 'reflect_done') {
    if (!currentUnit || !profile) return
    const current = currentProgress?.[task] ?? false
    const newVal = !current

    setLocalProgress(prev => {
      const existing = prev.find(p => p.unit_id === currentUnit.id)
      if (existing) {
        return prev.map(p => p.unit_id === currentUnit.id ? { ...p, [task]: newVal } : p)
      }
      return [...prev, {
        user_id: profile.id, unit_id: currentUnit.id,
        learn_done: false, create_done: false, outreach_done: false, reflect_done: false,
        [task]: newVal, pow_artifact_id: null, notes: null, completed_at: null,
      }]
    })

    await supabase.from('user_unit_progress').upsert({
      user_id: profile.id,
      unit_id: currentUnit.id,
      [task]: newVal,
      completed_at: newVal ? new Date().toISOString() : null,
    }, { onConflict: 'user_id,unit_id' })

    router.refresh()
  }

  const tasks = [
    { key: 'learn_done' as const, label: 'Learn', sub: '~15 min' },
    { key: 'create_done' as const, label: 'Create / Proof-of-Work', sub: '~20 min' },
    { key: 'outreach_done' as const, label: 'Outreach', sub: '~7 min' },
    { key: 'reflect_done' as const, label: 'Reflect', sub: '~3 min' },
  ]

  const tasksDoneThisUnit = tasks.filter(t => currentProgress?.[t.key]).length
  const unitPct = Math.round((tasksDoneThisUnit / 4) * 100)
  const totalPct = Math.round((doneUnits / 48) * 100)
  const conceptPct = Math.round((coveredCount / 85) * 100)
  const daysPerTask = remainingTasks > 0 && daysToEnd > 0
    ? (daysToEnd / remainingTasks).toFixed(1)
    : null

  // ── Phase 2 helpers ──────────────────────────────────────────────────────────
  const activeApps = applications.filter(a => a.status !== 'closed')
  const pipelineSummary = STAGE_ORDER.map(stage => ({
    stage,
    label: STAGE_LABELS[stage],
    count: applications.filter(a => a.status === stage).length,
  })).filter(s => s.count > 0)

  const daysLeft = daysUntilDeadline()
  const phase2Subtitle = getPhase2Label()

  // ── Phase 2 Dashboard ────────────────────────────────────────────────────────
  if (phase === 'phase2') {
    return (
      <div className="px-8 py-8 max-w-7xl mx-auto">
        {/* Header */}
        <motion.div {...staggerItem} initial="initial" animate="animate" className="mb-8">
          <h1 className="text-3xl font-bold text-white">
            Good {getTimeOfDay()},{' '}
            <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-purple-400 bg-clip-text text-transparent">
              {profile?.name ?? 'Sai'}
            </span>
          </h1>
          <p className="text-muted-foreground mt-1">{phase2Subtitle}</p>
        </motion.div>

        {/* Stats row */}
        <motion.div variants={staggerContainer} initial="initial" animate="animate" className="grid grid-cols-4 gap-4 mb-8">
          <motion.div variants={staggerItem}>
            <StatCard
              icon={<KanbanSquare className="text-indigo-400" size={20} />}
              label="Active applications"
              value={activeApps.length}
              sub={`${applications.length} total`}
              accent="indigo"
            />
          </motion.div>
          <motion.div variants={staggerItem}>
            <StatCard
              icon={<Briefcase className="text-violet-400" size={20} />}
              label="In interview stage"
              value={applications.filter(a => ['hm_round', 'loop'].includes(a.status)).length}
              sub="HM + Loop rounds"
              accent="violet"
            />
          </motion.div>
          <motion.div variants={staggerItem}>
            <StatCard
              icon={<Award className="text-emerald-400" size={20} />}
              label="Offers"
              value={applications.filter(a => ['offer', 'negotiating'].includes(a.status)).length}
              sub="active + negotiating"
              accent="emerald"
            />
          </motion.div>
          <motion.div variants={staggerItem}>
            <StatCard
              icon={<Clock className="text-orange-400" size={20} />}
              label="Days to deadline"
              value={daysLeft}
              sub="June 30, 2027"
              accent="orange"
            />
          </motion.div>
        </motion.div>

        {/* Main grid */}
        <div className="grid grid-cols-3 gap-6">
          <motion.div variants={staggerItem} initial="initial" animate="animate" className="col-span-2 space-y-6">
            {/* Pipeline summary */}
            <GlassCard>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-white">Application pipeline</h2>
                <Link href="/tracker">
                  <Button variant="ghost" size="sm" className="text-indigo-400 hover:text-indigo-300 text-xs h-7 px-2">
                    Open tracker
                  </Button>
                </Link>
              </div>
              {pipelineSummary.length === 0 ? (
                <div className="text-center py-8">
                  <KanbanSquare size={32} className="mx-auto mb-2 text-muted-foreground opacity-30" />
                  <p className="text-sm text-muted-foreground">No applications yet.</p>
                  <Link href="/jobs">
                    <Button size="sm" className="mt-3 bg-gradient-to-r from-indigo-600 to-violet-600 border-0 text-xs">
                      Browse jobs
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="flex gap-2 flex-wrap">
                  {pipelineSummary.map(({ stage, label, count }) => (
                    <div key={stage} className="flex items-center gap-1.5 bg-white/5 border border-white/8 rounded-lg px-3 py-2">
                      <span className="text-sm font-bold text-white">{count}</span>
                      <span className="text-xs text-muted-foreground">{label}</span>
                    </div>
                  ))}
                </div>
              )}
            </GlassCard>

            {/* Live job feed preview */}
            <GlassCard>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Briefcase size={18} className="text-indigo-400" />
                  <h2 className="text-base font-semibold text-white">Live job feed</h2>
                  <span className="flex items-center gap-1 text-xs text-emerald-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    live
                  </span>
                </div>
                <Link href="/jobs">
                  <Button variant="ghost" size="sm" className="text-indigo-400 hover:text-indigo-300 text-xs h-7 px-2">
                    View all
                  </Button>
                </Link>
              </div>
              {jobs.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">Refreshes every 10 minutes</p>
              ) : (
                <div className="space-y-3">
                  {jobs.slice(0, 3).map((job, i) => (
                    <motion.div key={job.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}>
                      <JobCard job={job} phase2 />
                    </motion.div>
                  ))}
                </div>
              )}
            </GlassCard>
          </motion.div>

          {/* Right column */}
          <motion.div variants={staggerItem} initial="initial" animate="animate" className="space-y-6">
            {/* Offer deadline countdown */}
            <GlassCard className="border-indigo-500/30 bg-gradient-to-br from-indigo-500/8 to-violet-500/5">
              <div className="flex items-center gap-2 mb-3">
                <Target size={16} className="text-indigo-400" />
                <p className="text-sm font-medium text-white">Offer deadline</p>
              </div>
              <p className="text-4xl font-bold text-white">{daysLeft}</p>
              <p className="text-sm text-muted-foreground mt-1">days to June 2027</p>
              <div className="mt-3 pt-3 border-t border-white/8">
                <p className="text-xs text-muted-foreground">Target: {profile?.target_level ?? 'Principal PM'}</p>
                <p className="text-xs text-muted-foreground">{profile?.target_location ?? 'Hyderabad'}</p>
              </div>
            </GlassCard>

            {/* Quick actions */}
            <GlassCard>
              <p className="text-sm font-medium text-white mb-3">Quick actions</p>
              <div className="space-y-2">
                {[
                  { label: 'Add application', href: '/tracker', icon: KanbanSquare },
                  { label: 'Tailor resume', href: '/resume', icon: FileText },
                  { label: 'Run mock interview', href: '/interview', icon: CheckCircle2 },
                ].map(({ label, href, icon: Icon }) => (
                  <Link key={href} href={href}>
                    <div className="flex items-center gap-2.5 p-2.5 rounded-lg hover:bg-white/5 transition-colors cursor-pointer group">
                      <Icon size={15} className="text-muted-foreground group-hover:text-indigo-400 transition-colors" />
                      <span className="text-sm text-muted-foreground group-hover:text-white transition-colors">{label}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </GlassCard>

            {/* Portfolio */}
            <GlassCard>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium text-white">Portfolio</p>
                <TrendingUp size={15} className="text-emerald-400" />
              </div>
              <p className="text-2xl font-bold text-white">{artifacts.filter(a => a.published_at).length}</p>
              <p className="text-xs text-muted-foreground mt-1">published artifacts</p>
            </GlassCard>
          </motion.div>
        </div>
      </div>
    )
  }

  // ── Phase 1 Dashboard (unchanged layout) ────────────────────────────────────
  return (
    <div className="px-8 py-8 max-w-7xl mx-auto">
      {/* Header */}
      <motion.div {...staggerItem} initial="initial" animate="animate" className="mb-8">
        <h1 className="text-3xl font-bold text-white">
          Good {getTimeOfDay()},{' '}
          <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-purple-400 bg-clip-text text-transparent">
            {profile?.name ?? 'Sai'}
          </span>
        </h1>
        <p className="text-muted-foreground mt-1">
          {daysToEnd} days to Jan 15 · {remainingTasks} tasks remaining
          {daysPerTask && ` · ${daysPerTask} days per task at current pace`}
        </p>
      </motion.div>

      {/* Stats row */}
      <motion.div variants={staggerContainer} initial="initial" animate="animate" className="grid grid-cols-4 gap-4 mb-8">
        <motion.div variants={staggerItem}>
          <StatCard icon={<Flame className="text-orange-400" size={20} />} label="Day streak" value={streak} sub="consecutive days" accent="orange" />
        </motion.div>
        <motion.div variants={staggerItem}>
          <StatCard icon={<BookOpen className="text-indigo-400" size={20} />} label="Units complete" value={`${doneUnits}/48`} sub={`${totalPct}% done`} accent="indigo" />
        </motion.div>
        <motion.div variants={staggerItem}>
          <StatCard icon={<TrendingUp className="text-violet-400" size={20} />} label="AI concepts" value={`${coveredCount}/85`} sub={`${conceptPct}% covered`} accent="violet" />
        </motion.div>
        <motion.div variants={staggerItem}>
          <StatCard icon={<Award className="text-emerald-400" size={20} />} label="Portfolio" value={artifacts.filter(a => a.published_at).length} sub={`${artifacts.length} total artifacts`} accent="emerald" />
        </motion.div>
      </motion.div>

      {/* Main grid */}
      <div className="grid grid-cols-3 gap-6">
        <motion.div variants={staggerItem} initial="initial" animate="animate" className="col-span-2 space-y-6">
          {/* Current unit task checklist */}
          <GlassCard>
            <div className="flex items-start justify-between mb-4">
              <div>
                <Badge variant="secondary" className="mb-2 text-xs bg-indigo-500/10 text-indigo-300 border-indigo-500/20">
                  Unit {currentUnit?.unit_number} of 48
                </Badge>
                <h2 className="text-lg font-semibold text-white">{currentUnit?.primary_theme}</h2>
                <p className="text-sm text-muted-foreground mt-0.5">{tasksDoneThisUnit} of 4 tasks done this week</p>
              </div>
              <div className="text-right">
                <span className="text-2xl font-bold text-white">{unitPct}%</span>
                <p className="text-xs text-muted-foreground">this unit</p>
              </div>
            </div>

            <Progress value={unitPct} className="h-1.5 mb-5 bg-white/5" />

            <div className="space-y-3">
              {tasks.map(({ key, label, sub }) => (
                <motion.div
                  key={key}
                  whileTap={{ scale: 0.98 }}
                  className={`flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer
                    ${currentProgress?.[key]
                      ? 'bg-white/5 border-white/10'
                      : 'bg-white/2 border-white/5 hover:bg-white/5'
                    }`}
                  onClick={() => toggleTask(key)}
                >
                  <Checkbox
                    checked={currentProgress?.[key] ?? false}
                    onCheckedChange={() => toggleTask(key)}
                    className="border-white/20 data-[state=checked]:bg-indigo-500 data-[state=checked]:border-indigo-500"
                  />
                  <div className="flex-1">
                    <span className={`text-sm font-medium ${currentProgress?.[key] ? 'line-through text-muted-foreground' : 'text-white'}`}>
                      {label}
                    </span>
                    <span className="text-xs text-muted-foreground ml-2">{sub}</span>
                  </div>
                  {currentProgress?.[key] && (
                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="w-2 h-2 rounded-full bg-emerald-400" />
                  )}
                </motion.div>
              ))}
            </div>
          </GlassCard>

          {/* Weekly job digest */}
          <GlassCard>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Briefcase size={18} className="text-indigo-400" />
                <h2 className="text-base font-semibold text-white">Weekly Job Digest</h2>
              </div>
              <Badge variant="secondary" className="text-xs bg-white/5 text-muted-foreground border-white/10">
                Read-only · Phase 1
              </Badge>
            </div>
            {jobs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                <Briefcase size={32} className="mx-auto mb-2 opacity-30" />
                Job feed refreshes every Monday 9am IST
              </div>
            ) : (
              <div className="space-y-3">
                {jobs.slice(0, 5).map((job, i) => (
                  <motion.div key={job.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}>
                    <JobCard job={job} />
                  </motion.div>
                ))}
              </div>
            )}
          </GlassCard>
        </motion.div>

        {/* Right column */}
        <motion.div variants={staggerItem} initial="initial" animate="animate" className="space-y-6">
          <GlassCard className="flex flex-col items-center py-6">
            <p className="text-sm text-muted-foreground mb-4">Overall progress</p>
            <ProgressRing value={totalPct} size={160} strokeWidth={12} />
            <p className="mt-4 text-sm text-muted-foreground text-center">{doneUnits} of 48 units complete</p>
          </GlassCard>

          <GlassCard>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-white">AI concepts covered</p>
              <span className="text-sm font-bold text-indigo-400">{coveredCount}/85</span>
            </div>
            <Progress value={conceptPct} className="h-2 bg-white/5" />
            <p className="text-xs text-muted-foreground mt-2">Concepts surface progressively as units unlock</p>
          </GlassCard>

          <GlassCard className="border-indigo-500/20 bg-gradient-to-br from-indigo-500/5 to-violet-500/5">
            <div className="flex items-center gap-2 mb-3">
              <Target size={16} className="text-indigo-400" />
              <p className="text-sm font-medium text-white">Offer target</p>
            </div>
            <p className="text-2xl font-bold text-white">June 2027</p>
            <p className="text-xs text-muted-foreground mt-1">Principal PM · Hyderabad</p>
            <div className="mt-3 pt-3 border-t border-white/8">
              <p className="text-xs text-muted-foreground">Phase 1 ends</p>
              <p className="text-sm font-medium text-indigo-300">Jan 15, 2027</p>
            </div>
          </GlassCard>
        </motion.div>
      </div>
    </div>
  )
}

function getTimeOfDay() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}
