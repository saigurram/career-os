'use client'

import { motion } from 'framer-motion'
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis,
  ResponsiveContainer, Tooltip,
} from 'recharts'
import { BarChart3, TrendingUp, AlertTriangle, CheckCircle2, Brain } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { GlassCard } from '@/components/dashboard/GlassCard'
import {
  computeGaps,
  computeReadinessScore,
  getTop3Gaps,
  buildRadarData,
  estimateUnitsToClose,
  type GapResult,
} from '@/lib/skill-gap'
import type { Tables } from '@/types/database'

interface Props {
  skillScores: Record<string, number>
  jobs: Pick<Tables<'jobs'>, 'id' | 'company' | 'fit_score' | 'fit_analysis'>[]
  coveredCount: number
  uncoveredCount: number
}

const stagger = { animate: { transition: { staggerChildren: 0.07 } } }
const fadeUp = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.28 } },
}

function severityColor(s: GapResult['severity']) {
  if (s === 'blocking') return 'text-red-400 bg-red-500/10 border-red-500/20'
  if (s === 'manageable') return 'text-amber-400 bg-amber-500/10 border-amber-500/20'
  return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
}

function readinessColor(score: number) {
  if (score >= 70) return 'text-emerald-400'
  if (score >= 50) return 'text-amber-400'
  return 'text-red-400'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/90 backdrop-blur px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-white mb-1">{d?.dimension}</p>
      {payload.map((p: { name: string; value: number; color: string }) => (
        <p key={p.name} style={{ color: p.color }}>{p.name}: {p.value}/10</p>
      ))}
    </div>
  )
}

export default function SkillGapClient({ skillScores, jobs, coveredCount, uncoveredCount }: Props) {
  const gaps = computeGaps(skillScores)
  const readiness = computeReadinessScore(skillScores)
  const top3 = getTop3Gaps(gaps)
  const radarData = buildRadarData(gaps)

  const hasScores = Object.keys(skillScores).length > 0

  return (
    <div className="px-8 py-8 max-w-7xl mx-auto">
      {/* Header */}
      <motion.div {...fadeUp} initial="initial" animate="animate" className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <BarChart3 size={22} className="text-indigo-400" />
          <h1 className="text-2xl font-bold text-white">Skill Gap Mapper</h1>
        </div>
        <p className="text-muted-foreground text-sm">
          Your current scores vs Principal PM targets · Updated after every 4 completed units
        </p>
      </motion.div>

      {/* Top row: readiness score + AI concepts */}
      <motion.div
        variants={stagger} initial="initial" animate="animate"
        className="grid grid-cols-3 gap-4 mb-8"
      >
        {/* Phase 2 Readiness */}
        <motion.div variants={fadeUp} className="col-span-1">
          <GlassCard className={`border ${readiness >= 70 ? 'border-emerald-500/20 bg-emerald-500/5' : readiness >= 50 ? 'border-amber-500/20 bg-amber-500/5' : 'border-red-500/20 bg-red-500/5'}`}>
            <p className="text-xs text-muted-foreground mb-1">Phase 2 Readiness</p>
            <p className={`text-5xl font-bold ${readinessColor(readiness)}`}>{readiness}</p>
            <p className="text-xs text-muted-foreground mt-1">out of 100 · need 70+ by Jan 15</p>
            <div className="mt-3 pt-3 border-t border-white/8">
              {readiness >= 70
                ? <p className="text-xs text-emerald-400 flex items-center gap-1"><CheckCircle2 size={12} /> On track for Phase 2</p>
                : <p className="text-xs text-amber-400 flex items-center gap-1"><AlertTriangle size={12} /> {70 - readiness} points to reach threshold</p>
              }
            </div>
          </GlassCard>
        </motion.div>

        {/* AI Concepts */}
        <motion.div variants={fadeUp} className="col-span-1">
          <GlassCard>
            <div className="flex items-center gap-2 mb-1">
              <Brain size={15} className="text-violet-400" />
              <p className="text-xs text-muted-foreground">AI Concepts</p>
            </div>
            <p className="text-5xl font-bold text-violet-400">{coveredCount}<span className="text-xl text-muted-foreground">/85</span></p>
            <p className="text-xs text-muted-foreground mt-1">concepts covered</p>
            <div className="mt-3 pt-3 border-t border-white/8">
              <p className="text-xs text-muted-foreground">{uncoveredCount} concepts remaining to surface</p>
            </div>
          </GlassCard>
        </motion.div>

        {/* Jobs analyzed */}
        <motion.div variants={fadeUp} className="col-span-1">
          <GlassCard>
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp size={15} className="text-indigo-400" />
              <p className="text-xs text-muted-foreground">Active Roles Tracked</p>
            </div>
            <p className="text-5xl font-bold text-indigo-400">{jobs.length}</p>
            <p className="text-xs text-muted-foreground mt-1">roles in feed</p>
            <div className="mt-3 pt-3 border-t border-white/8">
              <p className="text-xs text-muted-foreground">
                {jobs.filter(j => j.fit_score !== null).length} analyzed · {jobs.filter(j => (j.fit_score ?? 0) >= 70).length} strong fits
              </p>
            </div>
          </GlassCard>
        </motion.div>
      </motion.div>

      {/* Main: Radar chart + Top 3 gaps */}
      <div className="grid grid-cols-5 gap-6 mb-8">
        {/* Radar chart */}
        <motion.div variants={fadeUp} initial="initial" animate="animate" className="col-span-3">
          <GlassCard>
            <h2 className="text-base font-semibold text-white mb-1">Skills Radar</h2>
            <p className="text-xs text-muted-foreground mb-6">
              {hasScores ? 'Your profile vs Principal PM target' : 'Complete the intake assessment to see your scores'}
            </p>
            {hasScores ? (
              <ResponsiveContainer width="100%" height={320}>
                <RadarChart data={radarData} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
                  <PolarGrid stroke="rgba(255,255,255,0.08)" />
                  <PolarAngleAxis
                    dataKey="dimension"
                    tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }}
                  />
                  <Radar
                    name="Target"
                    dataKey="target"
                    stroke="rgba(99,102,241,0.4)"
                    fill="rgba(99,102,241,0.07)"
                    strokeDasharray="4 3"
                    strokeWidth={1.5}
                  />
                  <Radar
                    name="Current"
                    dataKey="current"
                    stroke="rgba(139,92,246,0.9)"
                    fill="rgba(139,92,246,0.20)"
                    strokeWidth={2}
                  />
                  <Tooltip content={<CustomTooltip />} />
                </RadarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[320px] flex items-center justify-center">
                <div className="text-center">
                  <BarChart3 size={40} className="mx-auto text-muted-foreground/20 mb-3" />
                  <p className="text-sm text-muted-foreground">No skill scores yet</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">Complete onboarding to populate your radar</p>
                </div>
              </div>
            )}
            {/* Legend */}
            <div className="flex items-center gap-5 mt-4 pt-4 border-t border-white/8">
              <div className="flex items-center gap-2">
                <div className="w-4 h-0.5 bg-violet-400 rounded" />
                <span className="text-xs text-muted-foreground">Current</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-0.5 border-t-2 border-dashed border-indigo-400" />
                <span className="text-xs text-muted-foreground">Principal PM target</span>
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* Top 3 gaps */}
        <motion.div variants={stagger} initial="initial" animate="animate" className="col-span-2 space-y-4">
          <h2 className="text-base font-semibold text-white">Top 3 Gaps to Close</h2>
          {top3.length === 0 ? (
            <GlassCard className="text-center py-8">
              <CheckCircle2 size={32} className="mx-auto text-emerald-400 mb-2" />
              <p className="text-sm text-white font-medium">All gaps closed</p>
              <p className="text-xs text-muted-foreground mt-1">You&apos;re at or above target on all dimensions</p>
            </GlassCard>
          ) : (
            top3.map((gap, i) => (
              <motion.div key={gap.dimension} variants={fadeUp}>
                <GlassCard className={`border ${severityColor(gap.severity).split(' ').slice(1).join(' ')}`}>
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="text-sm font-semibold text-white">{gap.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{gap.current}/10 current · {gap.target}/10 target</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">#{i + 1}</span>
                      <Badge className={`text-xs border ${severityColor(gap.severity)}`}>
                        {gap.severity}
                      </Badge>
                    </div>
                  </div>
                  {/* Gap bar */}
                  <div className="relative h-1.5 rounded-full bg-white/5 mb-3">
                    <div
                      className="absolute left-0 top-0 h-1.5 rounded-full bg-gradient-to-r from-indigo-500 to-violet-500"
                      style={{ width: `${(gap.current / 10) * 100}%` }}
                    />
                    <div
                      className="absolute top-0 h-1.5 w-0.5 bg-white/30 rounded-full"
                      style={{ left: `${(gap.target / 10) * 100}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{gap.closureAction}</p>
                  <p className="text-xs text-muted-foreground/60 mt-2">
                    ~{estimateUnitsToClose(gap.gap)} unit{estimateUnitsToClose(gap.gap) !== 1 ? 's' : ''} to close
                  </p>
                </GlassCard>
              </motion.div>
            ))
          )}
        </motion.div>
      </div>

      {/* All dimensions table */}
      <motion.div variants={fadeUp} initial="initial" animate="animate">
        <GlassCard>
          <h2 className="text-base font-semibold text-white mb-4">All Dimensions</h2>
          <div className="space-y-3">
            {gaps.map(gap => (
              <div key={gap.dimension} className="flex items-center gap-4">
                <p className="text-sm text-white w-44 flex-shrink-0">{gap.label}</p>
                <div className="flex-1 relative h-1.5 rounded-full bg-white/5">
                  <div
                    className="absolute left-0 top-0 h-1.5 rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-500"
                    style={{ width: `${(gap.current / 10) * 100}%` }}
                  />
                  <div
                    className="absolute top-0 h-1.5 w-0.5 bg-white/25"
                    style={{ left: `${(gap.target / 10) * 100}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground w-16 text-right flex-shrink-0">
                  {gap.current}/{gap.target}
                </p>
                <Badge className={`text-xs border ${severityColor(gap.severity)} w-20 justify-center flex-shrink-0`}>
                  {gap.severity}
                </Badge>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground/60 mt-4 pt-4 border-t border-white/8">
            Scores update after every 4 completed curriculum units · Vertical bar marks Principal PM target
          </p>
        </GlassCard>
      </motion.div>
    </div>
  )
}
