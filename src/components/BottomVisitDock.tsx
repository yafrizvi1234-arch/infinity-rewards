import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  Layers,
  Pause,
  Play,
  SkipForward,
  Sparkles,
  X,
} from 'lucide-react';
import { ManagedLink, VisitMode, VisitTab } from '../types';

export interface AutoVisitQueueItem {
  id: string;
  title: string;
  url: string;
  domain: string;
  category: string;
  type: VisitTab;
  cooldownSec: number;
  isCommunityLink: boolean;
  managedLink?: ManagedLink;
}

interface BottomVisitDockProps {
  isOpen: boolean;
  links: AutoVisitQueueItem[];
  initialLinkId?: string | null;
  sessionNonce: number;
  isMulti5Active: boolean;
  visitMode: VisitMode;
  cooldowns: Record<string, number>;
  nowMs: number;
  onCompleteLinkVisit: (item: AutoVisitQueueItem) => Promise<void>;
  onOpenProLocked: () => void;
  onClose: () => void;
}

type SlotVisitState = 'visiting' | 'processing' | 'done' | 'error';

interface SparkParticle {
  id: number;
  dx: number;
  dy: number;
  rotate: number;
  delay: number;
  sizeClass: string;
  colorClass: string;
  originLeftClass: string;
}

interface CelebrationBurst {
  id: number;
  earnedPts: number;
  count: number;
}

const CYCLE_DURATION_SEC = 8;
const MULTI_CONCURRENCY_LIMIT = 5;
const CELEBRATION_DURATION_MS = 950;

const SPARK_PARTICLES: SparkParticle[] = [
  { id: 0, dx: -38, dy: -42, rotate: -65, delay: 0.0, sizeClass: 'h-1.5 w-1.5 rounded-full', colorClass: 'bg-[#00F5FF]', originLeftClass: 'left-7' },
  { id: 1, dx: -16, dy: -54, rotate: 40, delay: 0.02, sizeClass: 'h-2 w-1 rounded-[1px]', colorClass: 'bg-[#00FF87]', originLeftClass: 'left-7' },
  { id: 2, dx: 12, dy: -58, rotate: 110, delay: 0.01, sizeClass: 'h-1.5 w-1.5 rounded-full', colorClass: 'bg-[#FFB800]', originLeftClass: 'left-7' },
  { id: 3, dx: 38, dy: -46, rotate: 145, delay: 0.03, sizeClass: 'h-2 w-1 rounded-[1px]', colorClass: 'bg-[#FF2E93]', originLeftClass: 'left-7' },
  { id: 4, dx: 58, dy: -26, rotate: -95, delay: 0.04, sizeClass: 'h-1.5 w-1.5 rounded-full', colorClass: 'bg-[#B84DFF]', originLeftClass: 'left-7' },
  { id: 5, dx: -52, dy: -18, rotate: -120, delay: 0.03, sizeClass: 'h-1.5 w-1 rounded-[1px]', colorClass: 'bg-[#00FF87]', originLeftClass: 'left-7' },
  { id: 6, dx: -28, dy: 24, rotate: 75, delay: 0.05, sizeClass: 'h-1 w-1 rounded-full', colorClass: 'bg-[#3B82F6]', originLeftClass: 'left-7' },
  { id: 7, dx: 30, dy: 22, rotate: -45, delay: 0.04, sizeClass: 'h-1.5 w-1 rounded-[1px]', colorClass: 'bg-[#FFB800]', originLeftClass: 'left-7' },
  { id: 8, dx: -24, dy: -48, rotate: 95, delay: 0.02, sizeClass: 'h-2 w-1 rounded-[1px]', colorClass: 'bg-[#00F5FF]', originLeftClass: 'left-1/2' },
  { id: 9, dx: 4, dy: -56, rotate: -55, delay: 0.0, sizeClass: 'h-1.5 w-1.5 rounded-full', colorClass: 'bg-[#00FF87]', originLeftClass: 'left-1/2' },
  { id: 10, dx: 32, dy: -44, rotate: 130, delay: 0.03, sizeClass: 'h-2 w-1 rounded-[1px]', colorClass: 'bg-[#FF2E93]', originLeftClass: 'left-1/2' },
  { id: 11, dx: -44, dy: -32, rotate: -80, delay: 0.05, sizeClass: 'h-1 w-1 rounded-full', colorClass: 'bg-[#FFB800]', originLeftClass: 'left-1/2' },
  { id: 12, dx: 48, dy: -30, rotate: 60, delay: 0.04, sizeClass: 'h-1.5 w-1.5 rounded-full', colorClass: 'bg-[#B84DFF]', originLeftClass: 'left-1/2' },
  { id: 13, dx: -14, dy: -36, rotate: -140, delay: 0.06, sizeClass: 'h-1.5 w-1 rounded-[1px]', colorClass: 'bg-white', originLeftClass: 'left-1/2' },
  { id: 14, dx: 18, dy: -38, rotate: 85, delay: 0.06, sizeClass: 'h-1 w-1 rounded-full', colorClass: 'bg-[#00FF87]', originLeftClass: 'left-1/2' },
  { id: 15, dx: 0, dy: -62, rotate: 180, delay: 0.02, sizeClass: 'h-2 w-1 rounded-[1px]', colorClass: 'bg-[#00F5FF]', originLeftClass: 'left-1/2' },
];

export const BottomVisitDock: React.FC<BottomVisitDockProps> = ({
  isOpen,
  links,
  initialLinkId,
  sessionNonce,
  isMulti5Active,
  visitMode,
  cooldowns,
  nowMs,
  onCompleteLinkVisit,
  onOpenProLocked,
  onClose,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const isMultiRunning = isMulti5Active && visitMode === 'multi';
  const concurrencyLimit = isMultiRunning ? MULTI_CONCURRENCY_LIMIT : 1;

  const [isPaused, setIsPaused] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [remainingSec, setRemainingSec] = useState(CYCLE_DURATION_SEC);
  const [activeBatchIds, setActiveBatchIds] = useState<string[]>([]);
  const [slotStates, setSlotStates] = useState<Record<string, SlotVisitState>>({});
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);
  const [completedCount, setCompletedCount] = useState(0);
  const [celebrationBurst, setCelebrationBurst] = useState<CelebrationBurst | null>(null);

  const cursorRef = useRef(0);
  const localHoldUntilRef = useRef<Record<string, number>>({});
  const completingCycleRef = useRef(false);
  const sessionTokenRef = useRef(0);
  const celebrationTimerRef = useRef<number | null>(null);
  const burstCounterRef = useRef(0);

  const clearCelebrationTimer = useCallback(() => {
    if (celebrationTimerRef.current !== null) {
      window.clearTimeout(celebrationTimerRef.current);
      celebrationTimerRef.current = null;
    }
  }, []);

  const triggerCelebrationBurst = useCallback(
    (count: number) => {
      if (count <= 0) return;
      clearCelebrationTimer();
      burstCounterRef.current += 1;
      setCelebrationBurst({
        id: burstCounterRef.current,
        earnedPts: count * 10,
        count,
      });
      celebrationTimerRef.current = window.setTimeout(() => {
        celebrationTimerRef.current = null;
        setCelebrationBurst(null);
      }, CELEBRATION_DURATION_MS);
    },
    [clearCelebrationTimer]
  );

  useEffect(() => {
    return () => clearCelebrationTimer();
  }, [clearCelebrationTimer]);

  // Refs for latest props so intervals and async Promise.all batches never hold stale closures
  const linksRef = useRef(links);
  linksRef.current = links;

  const cooldownsRef = useRef(cooldowns);
  cooldownsRef.current = cooldowns;

  const concurrencyLimitRef = useRef(concurrencyLimit);
  concurrencyLimitRef.current = concurrencyLimit;

  const onCompleteLinkVisitRef = useRef(onCompleteLinkVisit);
  onCompleteLinkVisitRef.current = onCompleteLinkVisit;

  const linksById = useMemo(() => {
    const map = new Map<string, AutoVisitQueueItem>();
    for (const item of links) {
      map.set(item.id, item);
    }
    return map;
  }, [links]);

  const getEffectiveCooldownEnd = useCallback((item: AutoVisitQueueItem): number => {
    return Math.max(cooldownsRef.current[item.id] ?? 0, localHoldUntilRef.current[item.id] ?? 0);
  }, []);

  const pickNextBatch = useCallback(
    (preferredFirstId?: string | null, limitOverride?: number): string[] => {
      const pool = linksRef.current;
      if (pool.length === 0) return [];

      const limit = Math.max(1, limitOverride ?? concurrencyLimitRef.current);
      const currentNow = Date.now();

      // Strictly respect individual link cooldowns — only select links whose cooldown expired
      const ready = pool.filter((item) => getEffectiveCooldownEnd(item) <= currentNow);
      if (ready.length === 0) return [];

      const picked: AutoVisitQueueItem[] = [];
      const usedIds = new Set<string>();

      let startIdx = cursorRef.current % ready.length;

      if (preferredFirstId) {
        const preferredReadyIdx = ready.findIndex((item) => item.id === preferredFirstId);
        if (preferredReadyIdx >= 0) {
          const preferred = ready[preferredReadyIdx];
          picked.push(preferred);
          usedIds.add(preferred.id);
          startIdx = (preferredReadyIdx + 1) % ready.length;
        }
      }

      for (let offset = 0; offset < ready.length && picked.length < limit; offset++) {
        const candidate = ready[(startIdx + offset) % ready.length];
        if (!usedIds.has(candidate.id)) {
          picked.push(candidate);
          usedIds.add(candidate.id);
        }
      }

      cursorRef.current = (startIdx + picked.length) % Math.max(1, ready.length);
      return picked.map((item) => item.id);
    },
    [getEffectiveCooldownEnd]
  );

  // Reset / start session when dock opens or user explicitly starts a new Visit session
  useEffect(() => {
    sessionTokenRef.current += 1;

    if (!isOpen) {
      clearCelebrationTimer();
      setCelebrationBurst(null);
      setActiveBatchIds([]);
      setSlotStates({});
      setIsProcessingBatch(false);
      setIsPaused(false);
      setRemainingSec(CYCLE_DURATION_SEC);
      completingCycleRef.current = false;
      return;
    }

    cursorRef.current = 0;
    localHoldUntilRef.current = {};
    completingCycleRef.current = false;
    setIsPaused(false);
    setIsProcessingBatch(false);
    setRemainingSec(CYCLE_DURATION_SEC);

    const initialBatch = pickNextBatch(initialLinkId, concurrencyLimit);
    setActiveBatchIds(initialBatch);
    const initStates: Record<string, SlotVisitState> = {};
    for (const id of initialBatch) {
      initStates[id] = 'visiting';
    }
    setSlotStates(initStates);
    // Intentionally reset only on open, sessionNonce, or explicit initialLinkId trigger
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, sessionNonce, initialLinkId]);

  // Adjust active concurrent slots cleanly when switching Single <-> Multi (5) or when links list changes
  useEffect(() => {
    if (!isOpen || completingCycleRef.current) return;

    setActiveBatchIds((prev) => {
      const currentNow = Date.now();
      const valid = prev.filter((id) => {
        const item = linksById.get(id);
        return Boolean(item) && getEffectiveCooldownEnd(item!) <= currentNow;
      });

      if (valid.length === 0) {
        return pickNextBatch(null, concurrencyLimit);
      }

      if (valid.length > concurrencyLimit) {
        return valid.slice(0, concurrencyLimit);
      }

      if (valid.length < concurrencyLimit) {
        const used = new Set(valid);
        const extras = links
          .filter(
            (item) => !used.has(item.id) && getEffectiveCooldownEnd(item) <= currentNow
          )
          .slice(0, concurrencyLimit - valid.length)
          .map((item) => item.id);
        return extras.length > 0 ? [...valid, ...extras] : valid;
      }

      return valid.length === prev.length ? prev : valid;
    });
  }, [concurrencyLimit, getEffectiveCooldownEnd, isOpen, links, linksById, pickNextBatch]);

  const activeItems = useMemo(
    () =>
      activeBatchIds
        .map((id) => linksById.get(id))
        .filter((item): item is AutoVisitQueueItem => Boolean(item)),
    [activeBatchIds, linksById]
  );

  const queueCooldownMetrics = useMemo(() => {
    let readyCount = 0;
    let coolingCount = 0;
    let minRemainingMs = Infinity;

    for (const item of links) {
      const cooldownEnd = Math.max(cooldowns[item.id] ?? 0, localHoldUntilRef.current[item.id] ?? 0);
      const remMs = cooldownEnd - nowMs;
      if (remMs > 0) {
        coolingCount += 1;
        if (remMs < minRemainingMs) {
          minRemainingMs = remMs;
        }
      } else {
        readyCount += 1;
      }
    }

    return {
      readyCount,
      coolingCount,
      shortestCooldownSec: minRemainingMs === Infinity ? 0 : Math.max(1, Math.ceil(minRemainingMs / 1000)),
    };
  }, [cooldowns, links, nowMs]);

  const executeConcurrentBatch = useCallback(
    async (recordCurrent: boolean) => {
      if (completingCycleRef.current) return;
      completingCycleRef.current = true;
      const activeSessionToken = sessionTokenRef.current;

      try {
        const snapshot = activeBatchIds
          .map((id) => linksById.get(id))
          .filter((item): item is AutoVisitQueueItem => Boolean(item));

        if (recordCurrent && snapshot.length > 0) {
          setIsProcessingBatch(true);
          const processingStates: Record<string, SlotVisitState> = {};
          for (const item of snapshot) {
            processingStates[item.id] = 'processing';
          }
          setSlotStates(processingStates);

          // Concurrent execution of up to 5 links (or 1 in Single mode) using Promise.all
          // while enforcing each link's individual cooldown window.
          const batchSlice = snapshot.slice(0, concurrencyLimitRef.current);
          const results = await Promise.all(
            batchSlice.map(async (item) => {
              const cooldownMs = Math.max(15, item.cooldownSec || 60) * 1000;
              try {
                await onCompleteLinkVisitRef.current(item);
                localHoldUntilRef.current[item.id] = Date.now() + cooldownMs;
                if (sessionTokenRef.current === activeSessionToken) {
                  setSlotStates((prev) => ({ ...prev, [item.id]: 'done' }));
                }
                return true;
              } catch {
                localHoldUntilRef.current[item.id] = Date.now() + cooldownMs;
                if (sessionTokenRef.current === activeSessionToken) {
                  setSlotStates((prev) => ({ ...prev, [item.id]: 'error' }));
                }
                return false;
              }
            })
          );

          if (sessionTokenRef.current !== activeSessionToken) {
            return;
          }

          const succeededCount = results.filter(Boolean).length;
          if (succeededCount > 0) {
            setCompletedCount((c) => c + succeededCount);
            triggerCelebrationBurst(succeededCount);
          }
        }

        if (sessionTokenRef.current !== activeSessionToken) {
          return;
        }

        const nextBatch = pickNextBatch(null, concurrencyLimitRef.current);
        setActiveBatchIds(nextBatch);
        const nextStates: Record<string, SlotVisitState> = {};
        for (const id of nextBatch) {
          nextStates[id] = 'visiting';
        }
        setSlotStates(nextStates);
        setRemainingSec(CYCLE_DURATION_SEC);
      } finally {
        if (sessionTokenRef.current === activeSessionToken) {
          setIsProcessingBatch(false);
        }
        completingCycleRef.current = false;
      }
    },
    [activeBatchIds, linksById, pickNextBatch, triggerCelebrationBurst]
  );

  // Auto-resume as soon as any cooled-down link becomes eligible again
  useEffect(() => {
    if (!isOpen || isPaused || isProcessingBatch || activeItems.length > 0 || links.length === 0) {
      return;
    }
    const readyNow = pickNextBatch(null, concurrencyLimit);
    if (readyNow.length > 0) {
      setActiveBatchIds(readyNow);
      const nextStates: Record<string, SlotVisitState> = {};
      for (const id of readyNow) {
        nextStates[id] = 'visiting';
      }
      setSlotStates(nextStates);
      setRemainingSec(CYCLE_DURATION_SEC);
    }
  }, [activeItems.length, concurrencyLimit, isOpen, isPaused, isProcessingBatch, links.length, nowMs, pickNextBatch]);

  const executeConcurrentBatchRef = useRef(executeConcurrentBatch);
  executeConcurrentBatchRef.current = executeConcurrentBatch;

  // 1-second timer countdown for active concurrent batch
  useEffect(() => {
    if (!isOpen || isPaused || isProcessingBatch || activeItems.length === 0) return;

    const timer = window.setInterval(() => {
      setRemainingSec((prev) => {
        if (prev <= 1) {
          void executeConcurrentBatchRef.current(true);
          return CYCLE_DURATION_SEC;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [activeItems.length, isOpen, isPaused, isProcessingBatch]);

  if (!isOpen) return null;

  const progressPct =
    activeItems.length > 0
      ? isProcessingBatch
        ? 100
        : Math.min(100, Math.max(0, ((CYCLE_DURATION_SEC - remainingSec) / CYCLE_DURATION_SEC) * 100))
      : 0;

  return (
    <aside
      aria-label="Compact auto visit dock"
      className={`fixed right-3 bottom-[72px] left-3 z-40 transition-all lg:right-5 lg:bottom-5 lg:left-auto ${
        isMultiRunning ? 'lg:w-[560px]' : 'lg:w-[430px]'
      }`}
    >
      {/* Spark / confetti particle celebration layer (overflow-visible above dock) */}
      <AnimatePresence>
        {celebrationBurst && (
          <motion.div
            key={celebrationBurst.id}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-20 overflow-visible"
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {!prefersReducedMotion && (
              <>
                <motion.span
                  className="absolute top-6 left-6 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-300/80 bg-cyan-300/10"
                  initial={{ scale: 0.5, opacity: 0.9 }}
                  animate={{ scale: 2.3, opacity: 0 }}
                  transition={{ duration: 0.65, ease: 'easeOut' }}
                />

                {SPARK_PARTICLES.map((particle) => (
                  <motion.span
                    key={particle.id}
                    className={`absolute top-5 ${particle.originLeftClass} ${particle.sizeClass} ${particle.colorClass} shadow-[0_0_8px_rgba(34,211,238,0.65)]`}
                    initial={{ x: 0, y: 0, scale: 0.5, opacity: 1, rotate: 0 }}
                    animate={{
                      x: particle.dx,
                      y: particle.dy,
                      scale: [0.6, 1.2, 0.25],
                      opacity: [1, 1, 0],
                      rotate: particle.rotate,
                    }}
                    transition={{
                      duration: 0.82,
                      delay: particle.delay,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                  />
                ))}
              </>
            )}

            <motion.div
              className="font-mono-num absolute -top-3 right-4 flex items-center gap-1 rounded-md border border-emerald-400/50 bg-emerald-950/95 px-2 py-0.5 text-[11px] font-bold text-emerald-300 shadow-lg shadow-emerald-500/20"
              initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.9 }}
              animate={
                prefersReducedMotion
                  ? { opacity: [0, 1, 1, 0] }
                  : { opacity: [0, 1, 1, 0], y: [8, -6, -12, -18], scale: [0.9, 1.05, 1, 0.98] }
              }
              transition={{ duration: 0.9, ease: 'easeOut' }}
            >
              <Sparkles className="h-3 w-3 text-cyan-300" />
              <span>+{celebrationBurst.earnedPts} PTS</span>
              {celebrationBurst.count > 1 && (
                <span className="text-[10px] text-cyan-300">×{celebrationBurst.count}</span>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className={`neon-prism-panel overflow-hidden rounded-2xl border transition-colors duration-300 ${
          celebrationBurst
            ? 'border-[#00FF87]/85 shadow-[0_0_32px_-6px_rgba(0,255,135,0.5)]'
            : 'border-[#00F5FF]/45'
        }`}
      >
        {/* Top thin cycle progress bar */}
        <div className="h-1.5 w-full bg-[#050817]">
          <div
            className={`h-full transition-[width] duration-700 ${
              celebrationBurst
                ? 'bg-gradient-to-r from-[#00FF87] via-[#00F5FF] to-[#FFB800]'
                : 'bg-gradient-to-r from-[#00F5FF] via-[#3B82F6] via-[#B84DFF] to-[#FF2E93]'
            }`}
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* Compact Control Header */}
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <motion.span
              animate={
                celebrationBurst && !prefersReducedMotion
                  ? { scale: [1, 1.22, 1], rotate: [0, -8, 8, 0] }
                  : { scale: 1, rotate: 0 }
              }
              transition={{ duration: 0.45, ease: 'easeOut' }}
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                celebrationBurst
                  ? 'border-[#00FF87]/80 bg-[#00FF87]/25 text-[#00FF87]'
                  : isMultiRunning
                    ? 'border-[#FF2E93]/55 bg-[#FF2E93]/20 text-[#FF8DC7]'
                    : 'border-[#00F5FF]/55 bg-[#00F5FF]/20 text-[#00F5FF]'
              }`}
            >
              {isMultiRunning ? (
                <Layers className="h-3.5 w-3.5" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
            </motion.span>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                <span className="truncate">
                  {isMultiRunning
                    ? `Multi (5) · ${activeItems.length}/5 Concurrent`
                    : 'Auto Visit'}
                </span>
                {activeItems.length > 0 && (
                  <span className="font-mono-num rounded bg-[#00F5FF]/20 px-1.5 py-0.5 text-[10px] font-bold text-[#00F5FF]">
                    {isProcessingBatch ? 'Sync' : `${remainingSec}s`}
                  </span>
                )}
              </div>
              <p className="font-mono-num truncate text-[11px] text-slate-300">
                {activeItems.length > 0
                  ? `${activeItems[0].title}${activeItems.length > 1 ? ` +${activeItems.length - 1}` : ''} · Ready ${queueCooldownMetrics.readyCount} · Done ${completedCount}`
                  : links.length === 0
                    ? 'No links in queue'
                    : `Cooldown ${queueCooldownMetrics.shortestCooldownSec}s · ${queueCooldownMetrics.coolingCount} waiting`}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {!isMulti5Active && (
              <button
                type="button"
                onClick={onOpenProLocked}
                className="rounded-lg border border-[#FFB800]/50 bg-[#FFB800]/15 px-2 py-1 text-[10px] font-bold text-[#FFD166] hover:bg-[#FFB800]/25"
              >
                5x PRO
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsPaused((p) => !p)}
              aria-label={isPaused ? 'Resume auto visit' : 'Pause auto visit'}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
            >
              {isPaused ? (
                <Play className="h-3.5 w-3.5 text-cyan-300" />
              ) : (
                <Pause className="h-3.5 w-3.5 text-cyan-300" />
              )}
            </button>

            <button
              type="button"
              disabled={links.length === 0 || isProcessingBatch}
              onClick={() => void executeConcurrentBatch(false)}
              aria-label="Skip to next links"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 disabled:opacity-40"
            >
              <SkipForward className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={() => setShowPreview((s) => !s)}
              aria-label={showPreview ? 'Minimize mini frames' : 'Show mini frames'}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
            >
              {showPreview ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronUp className="h-3.5 w-3.5" />
              )}
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Stop and close auto visit"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-rose-400/25 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Compact Bottom Mini Viewports (always mounted while active; visually minimized when collapsed) */}
        {activeItems.length > 0 ? (
          <div
            className={
              showPreview
                ? 'border-t border-white/10 bg-slate-950/75 px-3 py-2'
                : 'pointer-events-none h-0 overflow-hidden opacity-0'
            }
          >
            <div
              className={`grid gap-2 ${
                isMultiRunning && activeItems.length > 1
                  ? 'grid-cols-2 sm:grid-cols-5'
                  : 'grid-cols-1'
              }`}
            >
              {activeItems.map((item, idx) => {
                const status = slotStates[item.id] ?? 'visiting';
                return (
                  <div
                    key={item.id}
                    className="overflow-hidden rounded-xl border border-white/10 bg-slate-900/90"
                  >
                    <div className="flex items-center justify-between gap-1 border-b border-white/10 px-2 py-1 text-[10px]">
                      <span className="truncate font-semibold text-slate-200">
                        {isMultiRunning ? `${idx + 1}. ` : ''}
                        {item.domain || item.title}
                      </span>
                      <div className="flex shrink-0 items-center gap-1">
                        {status === 'processing' && (
                          <span className="text-[9px] font-bold text-amber-300">...</span>
                        )}
                        {status === 'done' && (
                          <span className="text-[9px] font-bold text-emerald-300">OK</span>
                        )}
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Open ${item.title} in new tab`}
                          className="shrink-0 text-cyan-300 hover:text-cyan-200"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    </div>
                    <iframe
                      src={item.url}
                      title={item.title}
                      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                      referrerPolicy="no-referrer-when-downgrade"
                      loading="eager"
                      className={`w-full border-0 bg-white ${
                        isMultiRunning && activeItems.length > 1 ? 'h-16' : 'h-24'
                      }`}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between border-t border-white/10 bg-slate-950/70 px-3 py-2 text-[11px] text-slate-300">
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-purple-300" />
              <span>
                {links.length === 0
                  ? "Listening for other members' links · auto-starts when a new member publishes."
                  : `All ${queueCooldownMetrics.coolingCount} links on cooldown · resuming in ${queueCooldownMetrics.shortestCooldownSec}s`}
              </span>
            </span>
          </div>
        )}
      </div>
    </aside>
  );
};
