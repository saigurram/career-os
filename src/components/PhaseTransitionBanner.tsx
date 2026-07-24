'use client'

import { motion } from 'framer-motion'
import { CheckCircle2, Rocket, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GlassCard } from '@/components/dashboard/GlassCard'

interface Phase1Stats {
  unitsCompleted: number
  artifactsPublished: number
  storiesBanked: number
  outreachContacts: number
  aiConceptsCovered: number
}

interface Props {
  stats: Phase1Stats
  onEnterPhase2: () => void
}

export default function PhaseTransitionBanner({ stats, onEnterPhase2 }: Props) {
  const statItems = [
    { label: 'Units completed', value: stats.unitsCompleted, max: 48 },
    { label: 'Artifacts published', value: stats.artifactsPublished, max: 48 },
    { label: 'Stories banked', value: stats.storiesBanked, max: null },
    { label: 'Outreach contacts', value: stats.outreachContacts, max: null },
    { label: 'AI concepts covered', value: stats.aiConceptsCovered, max: 85 },
  ]

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'oklch(0.10 0.02 264)' }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="w-full max-w-2xl"
      >
        <GlassCard className="text-center border-indigo-500/30 bg-gradient-to-br from-indigo-500/8 to-violet-500/5">
          {/* Icon */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
            className="flex justify-center mb-6"
          >
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-indigo-500/20 blur-xl" />
              <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
                <Rocket size={36} className="text-white" />
              </div>
            </div>
          </motion.div>

          {/* Heading */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
            <h1 className="text-3xl font-bold text-white mb-2">Phase 1 complete.</h1>
            <p className="text-muted-foreground text-base mb-8">
              You built the foundation. Now you apply it.
            </p>
          </motion.div>

          {/* Stats */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="grid grid-cols-5 gap-3 mb-8"
          >
            {statItems.map(({ label, value, max }) => (
              <div key={label} className="bg-white/5 rounded-xl p-3 border border-white/8">
                <p className="text-2xl font-bold text-white">
                  {value}
                  {max && <span className="text-sm font-normal text-muted-foreground">/{max}</span>}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-tight">{label}</p>
              </div>
            ))}
          </motion.div>

          {/* What changes */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="bg-white/3 rounded-xl p-4 border border-white/8 mb-8 text-left"
          >
            <p className="text-sm font-medium text-white mb-3">Phase 2 unlocks:</p>
            <div className="space-y-2">
              {[
                'Live job feed refreshes every 10 minutes',
                'Application tracker with all 9 stages',
                'Per-job resume tailoring in 15 minutes',
                'Negotiation coach activated on every offer',
              ].map(item => (
                <div key={item} className="flex items-center gap-2.5 text-sm text-muted-foreground">
                  <CheckCircle2 size={14} className="text-emerald-400 flex-shrink-0" />
                  {item}
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}>
            <Button
              onClick={onEnterPhase2}
              className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 border-0 h-12 text-base font-semibold"
            >
              Enter Phase 2 <ArrowRight size={18} className="ml-2" />
            </Button>
          </motion.div>
        </GlassCard>
      </motion.div>
    </div>
  )
}
