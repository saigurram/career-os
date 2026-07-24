'use client'

import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  CheckCircle2, Circle, Clock, BookOpen, Pencil, Users, Brain,
  RefreshCw, AlertCircle, Loader2, ExternalLink, Copy, Check, Search,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { GlassCard } from '@/components/dashboard/GlassCard'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { Tables } from '@/types/database'
import {
  buildSmartRefreshReasons, shouldShowSmartRefreshBanner,
  smartRefreshBannerMessage, getTaskSizeLabel, getTaskSizeTooltip,
} from '@/lib/curriculum'
import { extractDomain, buildLinkedInSearchUrl, hasNdaRisk, isSearchResultsUrl } from '@/lib/claude'

interface Props {
  units: Tables<'curriculum_units'>[]
  progress: Tables<'user_unit_progress'>[]
  contents: Tables<'curriculum_unit_content'>[]
  userId: string
  daysToEnd: number
  doneTasks: number
  remainingTasks: number
  skillScores?: Record<string, number>
  skillScoresUpdatedAt?: string | null
  activeJobSkillTags?: string[]
}

const SIZE_COLORS: Record<string, string> = {
  L: 'text-violet-400 bg-violet-500/10 border-violet-500/20',
  M: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  S: 'text-zinc-400 bg-white/5 border-white/10',
}

const TASK_META = [
  { key: 'learn_done' as const, label: 'Learn', icon: BookOpen, color: 'text-blue-400', taskType: 'learn' as const },
  { key: 'create_done' as const, label: 'Create / Proof-of-Work', icon: Pencil, color: 'text-violet-400', taskType: 'create' as const },
  { key: 'outreach_done' as const, label: 'Outreach', icon: Users, color: 'text-emerald-400', taskType: 'outreach' as const },
  { key: 'reflect_done' as const, label: 'Reflect', icon: Brain, color: 'text-amber-400', taskType: 'reflect' as const },
]

function unitStatus(unit: Tables<'curriculum_units'>, progress: Tables<'user_unit_progress'>[]) {
  const p = progress.find(p => p.unit_id === unit.id)
  if (p?.learn_done && p?.create_done && p?.outreach_done && p?.reflect_done) return 'complete'
  if (p?.learn_done || p?.create_done || p?.outreach_done || p?.reflect_done) return 'active'
  return 'upcoming'
}

export default function CurriculumClient({
  units, progress, contents, userId, daysToEnd, doneTasks, remainingTasks,
  skillScores = {}, skillScoresUpdatedAt = null, activeJobSkillTags = [],
}: Props) {
  const router = useRouter()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createClient() as any
  const [localProgress, setLocalProgress] = useState(progress)
  const [localContents, setLocalContents] = useState(contents)
  const [selectedUnit, setSelectedUnit] = useState<Tables<'curriculum_units'> | null>(
    units.find(u => unitStatus(u, progress) !== 'complete') ?? units[0] ?? null
  )
  const [generating, setGenerating] = useState<string | null>(null)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [confirmRegenUnit, setConfirmRegenUnit] = useState<Tables<'curriculum_units'> | null>(null)
  const [dismissedBanners, setDismissedBanners] = useState<Set<string>>(new Set())
  const [generateAllProgress, setGenerateAllProgress] = useState<{ current: number; total: number } | null>(null)
  const [reflectionTexts, setReflectionTexts] = useState<Record<string, string>>({})
  const [reflectionSaved, setReflectionSaved] = useState<Record<string, boolean>>({})
  const [copiedStates, setCopiedStates] = useState<Record<string, boolean>>({})
  const [regenCounts, setRegenCounts] = useState<Record<string, number>>({})

  async function toggleTask(unitId: string, task: keyof Pick<Tables<'user_unit_progress'>, 'learn_done' | 'create_done' | 'outreach_done' | 'reflect_done'>) {
    const current = localProgress.find(p => p.unit_id === unitId)?.[task] ?? false
    const newVal = !current

    setLocalProgress(prev => {
      const existing = prev.find(p => p.unit_id === unitId)
      if (existing) return prev.map(p => p.unit_id === unitId ? { ...p, [task]: newVal } : p)
      return [...prev, {
        user_id: userId, unit_id: unitId,
        learn_done: false, create_done: false, outreach_done: false, reflect_done: false,
        [task]: newVal, pow_artifact_id: null, notes: null, completed_at: null,
      }]
    })

    await supabase.from('user_unit_progress').upsert(
      { user_id: userId, unit_id: unitId, [task]: newVal, completed_at: newVal ? new Date().toISOString() : null },
      { onConflict: 'user_id,unit_id' }
    )

    if (task === 'learn_done' && newVal) {
      const unitContent = localContents.find(c => c.unit_id === unitId)
      if (unitContent?.ai_concept_id) {
        const unit = units.find(u => u.id === unitId)
        await supabase.from('user_ai_concept_coverage').upsert(
          {
            user_id: userId,
            concept_id: unitContent.ai_concept_id,
            covered_in_unit: unit?.unit_number ?? 0,
            covered_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,concept_id' }
        )
      }
    }

    router.refresh()
  }

  async function saveReflection(unitId: string) {
    const text = reflectionTexts[unitId] ?? ''
    await supabase.from('user_unit_progress').upsert(
      { user_id: userId, unit_id: unitId, notes: text },
      { onConflict: 'user_id,unit_id' }
    )
    setReflectionSaved(prev => ({ ...prev, [unitId]: true }))
    setTimeout(() => setReflectionSaved(prev => ({ ...prev, [unitId]: false })), 2000)
  }

  async function copyToClipboard(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedStates(prev => ({ ...prev, [key]: true }))
      setTimeout(() => setCopiedStates(prev => ({ ...prev, [key]: false })), 2000)
    } catch {
      // clipboard unavailable
    }
  }

  const selectedProgress = selectedUnit ? localProgress.find(p => p.unit_id === selectedUnit.id) : null
  const selectedContent = selectedUnit ? localContents.find(c => c.unit_id === selectedUnit.id) : null
  const doneUnits = localProgress.filter(p => p.learn_done && p.create_done && p.outreach_done && p.reflect_done).length

  async function callGenerate(unitId: string, trigger: string): Promise<boolean> {
    setGenerateError(null)
    const res = await fetch('/api/curriculum/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unit_id: unitId, trigger }),
    })
    let data: Record<string, unknown> = {}
    try {
      data = await res.json()
    } catch {
      setGenerateError(`Server returned non-JSON response (status ${res.status}). Check your ANTHROPIC_API_KEY and SUPABASE_SERVICE_ROLE_KEY env vars.`)
      return false
    }
    if (!res.ok) {
      setGenerateError(String(data.error ?? `HTTP ${res.status}`))
      return false
    }
    if (!data.content) {
      setGenerateError('API returned OK but no content. Check server logs.')
      return false
    }
    setLocalContents(prev => [...prev.filter(c => c.unit_id !== unitId), data.content as Tables<'curriculum_unit_content'>])
    return true
  }

  const handleSelectUnit = useCallback((unit: Tables<'curriculum_units'>) => {
    setSelectedUnit(unit)
  }, [])

  async function handleInitialGenerate(unit: Tables<'curriculum_units'>) {
    setGenerating(unit.id)
    try {
      await callGenerate(unit.id, 'auto')
    } finally {
      setGenerating(null)
    }
  }

  async function handleManualRegenerate(unit: Tables<'curriculum_units'>) {
    setConfirmRegenUnit(null)
    setGenerating(unit.id)
    try {
      const ok = await callGenerate(unit.id, 'manual')
      if (ok) setRegenCounts(prev => ({ ...prev, [unit.id]: (prev[unit.id] ?? 0) + 1 }))
    } finally {
      setGenerating(null)
    }
  }

  async function handleSmartRefresh(unit: Tables<'curriculum_units'>) {
    setDismissedBanners(prev => new Set(Array.from(prev).concat([unit.id])))
    setGenerating(unit.id)
    try {
      const ok = await callGenerate(unit.id, 'smart')
      if (ok) setRegenCounts(prev => ({ ...prev, [unit.id]: (prev[unit.id] ?? 0) + 1 }))
    } finally {
      setGenerating(null)
    }
  }

  async function handleGenerateAll() {
    const unitsWithoutContent = units.filter(u => !localContents.some(c => c.unit_id === u.id))
    if (unitsWithoutContent.length === 0) return
    setGenerateAllProgress({ current: 0, total: unitsWithoutContent.length })
    for (let i = 0; i < unitsWithoutContent.length; i++) {
      const unit = unitsWithoutContent[i]
      setGenerateAllProgress({ current: i + 1, total: unitsWithoutContent.length })
      await callGenerate(unit.id, 'auto')
    }
    setGenerateAllProgress(null)
  }

  const smartRefreshReasons = selectedUnit ? buildSmartRefreshReasons({
    generatedAt: selectedContent?.generated_at ?? null,
    skillScoresUpdatedAt,
    lastGeneratedSkillScores: null,
    currentSkillScores: skillScores,
    activeJobSkillTags,
    unitSkillDimensions: [selectedUnit.primary_theme.toLowerCase()],
  }) : []

  const showSmartBanner = selectedUnit
    ? shouldShowSmartRefreshBanner(smartRefreshReasons, dismissedBanners.has(selectedUnit.id))
      && (regenCounts[selectedUnit.id] ?? 0) < 2
    : false

  const daysPerTask = remainingTasks > 0 ? (daysToEnd / remainingTasks).toFixed(1) : '∞'
  const hasAnyContent = localContents.length > 0
  const allUnitsCount = units.length

  return (
    <div className="px-8 py-8 max-w-7xl mx-auto">
      {/* Generate All progress overlay */}
      <AnimatePresence>
        {generateAllProgress && (
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-2xl bg-indigo-500/20 border border-indigo-500/30 backdrop-blur-sm shadow-xl"
          >
            <Loader2 size={15} className="text-indigo-400 animate-spin" />
            <span className="text-sm text-indigo-200">
              Generating unit {generateAllProgress.current} of {generateAllProgress.total}…
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confirm regen dialog */}
      <AnimatePresence>
        {confirmRegenUnit && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setConfirmRegenUnit(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="rounded-2xl border border-white/10 bg-zinc-900 p-6 max-w-sm w-full mx-4 shadow-2xl"
            >
              <h3 className="font-semibold text-white mb-2">Regenerate Unit {confirmRegenUnit.unit_number}?</h3>
              <p className="text-sm text-muted-foreground mb-5">
                The current content will be saved to history. Claude will generate fresh content using your latest skill scores and job feed.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmRegenUnit(null)}
                  className="flex-1 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-muted-foreground hover:bg-white/8 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleManualRegenerate(confirmRegenUnit)}
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 text-white text-sm font-semibold shadow-lg"
                >
                  Regenerate
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Curriculum</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {daysToEnd} days to Jan 15 · {remainingTasks} tasks left · {daysPerTask} days/task at current pace
          </p>
        </div>
        {!hasAnyContent && !generateAllProgress && (
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleGenerateAll}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 text-white text-sm font-semibold shadow-lg shadow-indigo-500/20"
          >
            <RefreshCw size={14} />
            Generate All {allUnitsCount} Units
          </motion.button>
        )}
      </div>

      {/* Pace signal */}
      <GlassCard className="mb-6 border-indigo-500/15">
        <div className="flex items-center gap-6">
          <div className="text-center">
            <p className="text-2xl font-bold text-white">{doneTasks}</p>
            <p className="text-xs text-muted-foreground">tasks done</p>
          </div>
          <div className="h-8 w-px bg-white/10" />
          <div className="text-center">
            <p className="text-2xl font-bold text-white">{remainingTasks}</p>
            <p className="text-xs text-muted-foreground">remaining</p>
          </div>
          <div className="h-8 w-px bg-white/10" />
          <div className="text-center">
            <p className="text-2xl font-bold text-white">{doneUnits}/48</p>
            <p className="text-xs text-muted-foreground">units complete</p>
          </div>
          <div className="h-8 w-px bg-white/10" />
          <p className="text-sm text-muted-foreground flex-1">
            Jan 15 is <span className="text-white font-medium">{daysToEnd} days</span> away.
            You have <span className="text-white font-medium">{remainingTasks} tasks</span> remaining.
            At your current rate, you need <span className="text-indigo-400 font-medium">{daysPerTask} days per task</span>.
          </p>
        </div>
      </GlassCard>

      <div className="grid grid-cols-3 gap-6">
        {/* Unit map */}
        <div className="col-span-1">
          <h2 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wide">48 Units</h2>
          <div className="space-y-1.5 max-h-[calc(100vh-280px)] overflow-y-auto pr-1">
            {units.map(unit => {
              const status = unitStatus(unit, localProgress)
              const isSelected = selectedUnit?.id === unit.id
              return (
                <motion.button
                  key={unit.id}
                  data-testid="curriculum-unit"
                  whileHover={{ x: 2 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleSelectUnit(unit)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all ${
                    isSelected
                      ? 'bg-indigo-500/15 border border-indigo-500/25'
                      : 'border border-transparent hover:bg-white/5'
                  }`}
                >
                  <div className="flex-shrink-0">
                    {status === 'complete' ? (
                      <CheckCircle2 size={16} className="text-emerald-400" />
                    ) : status === 'active' ? (
                      <Clock size={16} className="text-indigo-400" />
                    ) : (
                      <Circle size={16} className="text-white/20" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-medium truncate ${isSelected ? 'text-white' : status === 'complete' ? 'text-muted-foreground' : 'text-zinc-300'}`}>
                      Unit {unit.unit_number}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{unit.primary_theme}</p>
                  </div>
                </motion.button>
              )
            })}
          </div>
        </div>

        {/* Selected unit detail */}
        <div className="col-span-2">
          {selectedUnit ? (
            <motion.div
              key={selectedUnit.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              <GlassCard>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className="bg-indigo-500/10 text-indigo-300 border-indigo-500/20 text-xs">
                        Unit {selectedUnit.unit_number}
                      </Badge>
                      <Badge className="bg-white/5 text-muted-foreground border-white/10 text-xs">
                        Tier {selectedUnit.required_ai_concept_tier}
                      </Badge>
                    </div>
                    <h2 className="text-lg font-semibold text-white">{selectedUnit.primary_theme}</h2>
                  </div>
                </div>

                {/* Smart refresh banner */}
                <AnimatePresence>
                  {showSmartBanner && selectedUnit && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      className="mb-4 flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20"
                    >
                      <AlertCircle size={14} className="text-amber-400 flex-shrink-0" />
                      <p className="text-xs text-amber-200 flex-1">
                        {smartRefreshBannerMessage(smartRefreshReasons)}
                      </p>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() => handleSmartRefresh(selectedUnit)}
                          className="text-xs font-semibold text-amber-400 hover:text-amber-300 transition-colors"
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => setDismissedBanners(prev => new Set(Array.from(prev).concat([selectedUnit.id])))}
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          Dismiss
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* No content yet — explicit generate button */}
                {!selectedContent && generating !== selectedUnit.id && (
                  <div className="rounded-xl border border-dashed border-indigo-500/20 p-8 flex flex-col items-center gap-3 mb-4">
                    <p className="text-sm text-zinc-500">No content generated for this unit yet.</p>
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => handleInitialGenerate(selectedUnit)}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 text-white text-sm font-semibold shadow-lg shadow-indigo-500/20"
                    >
                      <RefreshCw size={14} />
                      Generate Content
                    </motion.button>
                  </div>
                )}

                {/* Generating in progress */}
                {!selectedContent && generating === selectedUnit.id && (
                  <div className="rounded-xl border border-dashed border-indigo-500/20 p-6 flex items-center gap-3 mb-4">
                    <Loader2 size={16} className="text-indigo-400 animate-spin flex-shrink-0" />
                    <p className="text-sm text-indigo-300">Generating personalised content…</p>
                  </div>
                )}

                {/* Generation error */}
                {generateError && generating !== selectedUnit.id && (
                  <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-4 space-y-1 mb-4">
                    <p className="text-xs font-semibold text-red-400">Generation failed</p>
                    <p className="text-xs text-red-300 font-mono break-all">{generateError}</p>
                  </div>
                )}

                {/* Tasks */}
                <div className="space-y-4 mb-6">
                  {TASK_META.map(({ key, label, icon: Icon, color, taskType }) => {
                    const sizeLabel = getTaskSizeLabel(taskType)
                    const sizeTooltip = getTaskSizeTooltip(sizeLabel)
                    const isDone = selectedProgress?.[key] ?? false

                    return (
                      <div
                        key={key}
                        className={`rounded-xl border transition-all ${
                          isDone
                            ? 'bg-white/3 border-white/8'
                            : 'bg-white/2 border-white/6'
                        }`}
                      >
                        {/* Header row — clicking this toggles the task */}
                        <div
                          data-testid="task-checkbox-row"
                          className="flex items-center gap-3 px-4 py-3.5 cursor-pointer hover:bg-white/3 rounded-xl transition-colors"
                          onClick={() => toggleTask(selectedUnit.id, key)}
                        >
                          <Checkbox
                            data-testid="task-checkbox"
                            checked={isDone}
                            onCheckedChange={() => toggleTask(selectedUnit.id, key)}
                            onClick={e => e.stopPropagation()}
                            className="border-white/20 data-[state=checked]:bg-indigo-500 data-[state=checked]:border-indigo-500 flex-shrink-0"
                          />
                          <Icon size={16} className={`${color} flex-shrink-0`} />
                          <p className={`text-sm font-semibold flex-1 ${isDone ? 'line-through text-muted-foreground' : 'text-white'}`}>
                            {label}
                          </p>
                          <span
                            title={sizeTooltip}
                            className={`text-[11px] font-bold px-2 py-0.5 rounded-full border flex-shrink-0 ${SIZE_COLORS[sizeLabel]}`}
                          >
                            {sizeLabel}
                          </span>
                        </div>

                        {/* Rich content — always visible when content exists */}
                        {selectedContent && (
                          <div
                            className="px-4 pb-4 space-y-3"
                            onClick={e => e.stopPropagation()}
                          >
                            {/* ── LEARN ── */}
                            {taskType === 'learn' && (
                              <>
                                {/* Resource title + format badge */}
                                <div className="flex items-start gap-3">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap mb-1">
                                      <a
                                        href={selectedContent.learn_resource_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-base font-semibold text-blue-300 hover:text-blue-200 transition-colors leading-snug"
                                      >
                                        {selectedContent.learn_resource_title}
                                      </a>
                                      {(selectedContent.learn_resource_format || selectedContent.learn_resource_minutes) && (
                                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-300 font-medium flex-shrink-0">
                                          {[selectedContent.learn_resource_format, selectedContent.learn_resource_minutes ? `${selectedContent.learn_resource_minutes} min` : null].filter(Boolean).join(' · ')}
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                      {extractDomain(selectedContent.learn_resource_url)}
                                    </p>
                                  </div>
                                  <a
                                    href={selectedContent.learn_resource_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/15 border border-blue-500/25 text-blue-300 text-xs font-medium hover:bg-blue-500/25 transition-colors flex-shrink-0 whitespace-nowrap"
                                  >
                                    <ExternalLink size={11} />
                                    {isSearchResultsUrl(selectedContent.learn_resource_url)
                                      ? (selectedContent.learn_resource_url.includes('youtube.com') ? 'Search on YouTube →' : 'Search on Google →')
                                      : (selectedContent.learn_resource_url.includes('youtube.com') ? 'Watch on YouTube →' : `Read on ${extractDomain(selectedContent.learn_resource_url)} →`)}
                                  </a>
                                </div>

                                {/* Why this matters */}
                                {selectedContent.learn_why && (
                                  <div className="flex gap-2 items-start">
                                    <span className="text-xs font-semibold text-blue-400 flex-shrink-0 mt-0.5">Why:</span>
                                    <p className="text-sm text-zinc-300">{selectedContent.learn_why}</p>
                                  </div>
                                )}

                                {/* Learn prompt */}
                                <div className="rounded-xl bg-blue-500/5 border border-blue-500/15 p-3">
                                  <p className="text-xs font-semibold text-blue-400 mb-1.5">
                                    {selectedContent.learn_resource_format === 'Video' ? 'While watching, focus on:' : 'While reading, focus on:'}
                                  </p>
                                  <p className="text-sm text-zinc-300 leading-relaxed">{selectedContent.learn_prompt}</p>
                                </div>
                              </>
                            )}

                            {/* ── CREATE ── */}
                            {taskType === 'create' && (
                              <>
                                {/* Full task description */}
                                <p className="text-sm text-zinc-300 leading-relaxed">{selectedContent.create_task}</p>

                                {/* Opening line — highlighted quoted copyable box */}
                                {selectedContent.create_opening_line && (
                                  <div className="rounded-xl bg-violet-500/8 border border-violet-500/20 p-3">
                                    <div className="flex items-center justify-between mb-2">
                                      <p className="text-xs font-semibold text-violet-400 uppercase tracking-wide">Start with this line:</p>
                                      <button
                                        onClick={() => copyToClipboard(selectedContent.create_opening_line!, `opening-${selectedUnit.id}`)}
                                        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium transition-all ${
                                          copiedStates[`opening-${selectedUnit.id}`]
                                            ? 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-300'
                                            : 'bg-white/5 border border-white/10 text-zinc-400 hover:text-zinc-200 hover:bg-white/8'
                                        }`}
                                      >
                                        {copiedStates[`opening-${selectedUnit.id}`]
                                          ? <><Check size={11} /> Copied</>
                                          : <><Copy size={11} /> Copy</>
                                        }
                                      </button>
                                    </div>
                                    <p className="text-sm text-violet-100 leading-relaxed italic">&ldquo;{selectedContent.create_opening_line}&rdquo;</p>
                                  </div>
                                )}

                                {/* What good looks like */}
                                {selectedContent.create_good_looks_like && (() => {
                                  const lines = selectedContent.create_good_looks_like.split('\n').filter(l => l.trim())
                                  const strong = lines.find(l => l.trim().startsWith('Strong:'))
                                  const weak = lines.find(l => l.trim().startsWith('Weak:'))
                                  return (
                                    <div className="rounded-xl bg-white/3 border border-white/8 p-3 space-y-2">
                                      <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">What good looks like</p>
                                      {strong && (
                                        <div className="flex gap-2 items-start">
                                          <span className="text-emerald-400 text-xs font-bold flex-shrink-0 mt-0.5">✓</span>
                                          <p className="text-xs text-zinc-300">{strong.replace(/^Strong:\s*/i, '')}</p>
                                        </div>
                                      )}
                                      {weak && (
                                        <div className="flex gap-2 items-start">
                                          <span className="text-red-400 text-xs font-bold flex-shrink-0 mt-0.5">✗</span>
                                          <p className="text-xs text-zinc-400">{weak.replace(/^Weak:\s*/i, '')}</p>
                                        </div>
                                      )}
                                    </div>
                                  )
                                })()}

                                {/* NDA note from Claude (explicit) */}
                                {selectedContent.create_nda_note && (
                                  <div className="flex gap-2 items-start rounded-xl bg-amber-500/8 border border-amber-500/20 px-3 py-2.5">
                                    <AlertCircle size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />
                                    <p className="text-xs text-amber-200">{selectedContent.create_nda_note}</p>
                                  </div>
                                )}

                                {/* Fallback NDA scan */}
                                {!selectedContent.create_nda_note && hasNdaRisk(selectedContent.create_task) && (
                                  <div className="flex gap-2 items-start rounded-xl bg-amber-500/8 border border-amber-500/20 px-3 py-2.5">
                                    <AlertCircle size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />
                                    <p className="text-xs text-amber-200">
                                      <span className="font-semibold">NDA reminder:</span> Use generic descriptions, not internal names. Check your blocked names list before publishing.
                                    </p>
                                  </div>
                                )}
                              </>
                            )}

                            {/* ── OUTREACH ── */}
                            {taskType === 'outreach' && (
                              <>
                                {/* Who to reach out to */}
                                <div>
                                  <p className="text-xs font-semibold text-emerald-400 mb-1.5 uppercase tracking-wide">Who to contact this week</p>
                                  <p className="text-sm text-zinc-300 leading-relaxed">{selectedContent.outreach_criteria}</p>
                                </div>

                                {/* Draft message */}
                                {selectedContent.outreach_message_draft && (
                                  <div className="rounded-xl bg-white/3 border border-white/8 p-3">
                                    <div className="flex items-center justify-between mb-2">
                                      <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Draft message</p>
                                      <button
                                        onClick={() => copyToClipboard(selectedContent.outreach_message_draft!, `outreach-${selectedUnit.id}`)}
                                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                                          copiedStates[`outreach-${selectedUnit.id}`]
                                            ? 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-300'
                                            : 'bg-white/5 border border-white/10 text-zinc-400 hover:text-zinc-200 hover:bg-white/8'
                                        }`}
                                      >
                                        {copiedStates[`outreach-${selectedUnit.id}`]
                                          ? <><Check size={11} /> Copied</>
                                          : <><Copy size={11} /> Copy message</>
                                        }
                                      </button>
                                    </div>
                                    <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap font-mono text-[13px]">
                                      {selectedContent.outreach_message_draft}
                                    </p>
                                  </div>
                                )}

                                {/* LinkedIn search — use stored query if available */}
                                <a
                                  href={
                                    selectedContent.outreach_linkedin_search
                                      ? `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(selectedContent.outreach_linkedin_search)}`
                                      : buildLinkedInSearchUrl(selectedContent.outreach_criteria)
                                  }
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs font-medium hover:bg-blue-500/20 transition-colors"
                                >
                                  <Search size={11} />
                                  Find on LinkedIn →
                                </a>
                              </>
                            )}

                            {/* ── REFLECT ── */}
                            {taskType === 'reflect' && (
                              <>
                                {/* Reflection question */}
                                <div className="rounded-xl bg-amber-500/5 border border-amber-500/15 p-3">
                                  <p className="text-xs font-semibold text-amber-400 mb-1.5">This week&apos;s reflection</p>
                                  <p className="text-sm text-amber-100 leading-relaxed">{selectedContent.reflect_question}</p>
                                </div>

                                {/* Answer textarea + word count */}
                                {(() => {
                                  const reflectText = reflectionTexts[selectedUnit.id] !== undefined
                                    ? reflectionTexts[selectedUnit.id]
                                    : (localProgress.find(p => p.unit_id === selectedUnit.id)?.notes ?? '')
                                  const wordCount = reflectText.trim() ? reflectText.trim().split(/\s+/).length : 0
                                  return (
                                    <div>
                                      <textarea
                                        value={reflectText}
                                        onChange={e => setReflectionTexts(prev => ({ ...prev, [selectedUnit.id]: e.target.value }))}
                                        placeholder="Write your answer here. Be specific. Generic answers don't stick."
                                        rows={4}
                                        className="w-full bg-white/3 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-zinc-300 placeholder:text-zinc-600 resize-none focus:outline-none focus:border-amber-500/30 focus:bg-white/5 transition-all leading-relaxed"
                                      />
                                      {wordCount > 0 && (
                                        <p className="text-xs text-zinc-600 mt-1 text-right">{wordCount} word{wordCount !== 1 ? 's' : ''}</p>
                                      )}
                                    </div>
                                  )
                                })()}

                                {/* Save button */}
                                <div className="flex items-center gap-3">
                                  <button
                                    onClick={() => saveReflection(selectedUnit.id)}
                                    className="px-3 py-2 rounded-lg bg-amber-500/15 border border-amber-500/25 text-amber-300 text-xs font-semibold hover:bg-amber-500/25 transition-colors"
                                  >
                                    Save reflection
                                  </button>
                                  {reflectionSaved[selectedUnit.id] && (
                                    <motion.span
                                      initial={{ opacity: 0, x: -4 }}
                                      animate={{ opacity: 1, x: 0 }}
                                      exit={{ opacity: 0 }}
                                      className="flex items-center gap-1 text-xs text-emerald-400"
                                    >
                                      <Check size={11} /> Saved
                                    </motion.span>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Footer: timestamp + regenerate (max 2) */}
                {selectedContent && generating !== selectedUnit.id && (
                  <div className="flex items-center justify-between pt-2 border-t border-white/5">
                    <span className="text-xs text-muted-foreground">
                      Generated {new Date(selectedContent.generated_at).toLocaleDateString()}
                      {(regenCounts[selectedUnit.id] ?? 0) > 0 && (
                        <span className="ml-2 text-zinc-600">· {regenCounts[selectedUnit.id]}/2 regenerations used</span>
                      )}
                    </span>
                    {(regenCounts[selectedUnit.id] ?? 0) < 2 ? (
                      <button
                        onClick={() => setConfirmRegenUnit(selectedUnit)}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-indigo-400 transition-colors"
                      >
                        <RefreshCw size={11} />
                        Regenerate
                      </button>
                    ) : (
                      <span className="text-xs text-zinc-600">Max regenerations reached</span>
                    )}
                  </div>
                )}
              </GlassCard>
            </motion.div>
          ) : (
            <GlassCard className="text-center py-16">
              <p className="text-muted-foreground">Select a unit to see tasks</p>
            </GlassCard>
          )}
        </div>
      </div>
    </div>
  )
}
