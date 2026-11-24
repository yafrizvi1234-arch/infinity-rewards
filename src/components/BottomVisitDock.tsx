import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  Globe,
  Layers,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  ShieldCheck,
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
  preferredBatchIds?: string[];
  sessionNonce: number;
  isMulti5Active: boolean;
  visitMode: VisitMode;
  cooldowns: Record<string, number>;
  nowMs: number;
  onChangeVisitMode?: (mode: VisitMode) => void;
  onCompleteLinkVisit: (item: AutoVisitQueueItem) => Promise<void>;
  onOpenProLocked: () => void;
  onClose: () => void;
}

type SlotVisitState = 'queued' | 'visiting' | 'processing' | 'done' | 'error';

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

const SINGLE_DWELL_MIN_SEC = 18;
const SINGLE_DWELL_MAX_SEC = 26;
const STAGGER_MIN_MS = 4000;
const STAGGER_MAX_MS = 7500;
const POST_LAST_OPEN_MIN_SEC = 14;
const POST_LAST_OPEN_MAX_SEC = 18;
const TICK_INTERVAL_MS = 250;
const MULTI_CONCURRENCY_LIMIT = 5;
const CELEBRATION_DURATION_MS = 950;

function randomInt(min: number, max: number): number {
  const low = Math.ceil(min);
  const high = Math.floor(max);
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

function buildStaggerSchedule(batchIds: string[]): {
  openAtMsById: Record<string, number>;
  cycleDurationSec: number;
} {
  const openAtMsById: Record<string, number> = {};
  if (batchIds.length === 0) {
    return { openAtMsById, cycleDurationSec: SINGLE_DWELL_MIN_SEC };
  }

  let cumulativeMs = 0;
  batchIds.forEach((id, idx) => {
    if (idx === 0) {
      openAtMsById[id] = 0;
    } else {
      cumulativeMs += randomInt(STAGGER_MIN_MS, STAGGER_MAX_MS);
      openAtMsById[id] = cumulativeMs;
    }
  });

  if (batchIds.length === 1) {
    return {
      openAtMsById,
      cycleDurationSec: randomInt(SINGLE_DWELL_MIN_SEC, SINGLE_DWELL_MAX_SEC),
    };
  }

  const lastOpenSec = Math.ceil(cumulativeMs / 1000);
  const postLastDwellSec = randomInt(POST_LAST_OPEN_MIN_SEC, POST_LAST_OPEN_MAX_SEC);
  return {
    openAtMsById,
    cycleDurationSec: Math.max(32, lastOpenSec + postLastDwellSec),
  };
}

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
  preferredBatchIds,
  sessionNonce,
  isMulti5Active,
  visitMode,
  cooldowns,
  nowMs,
  onChangeVisitMode,
  onCompleteLinkVisit,
  onOpenProLocked,
  onClose,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const isMultiRunning = isMulti5Active && visitMode === 'multi';
  const concurrencyLimit = isMultiRunning ? MULTI_CONCURRENCY_LIMIT : 1;

  const [isPaused, setIsPaused] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [cycleDurationSec, setCycleDurationSec] = useState(SINGLE_DWELL_MIN_SEC);
  const [elapsedActiveMs, setElapsedActiveMs] = useState(0);
  const [activeBatchIds, setActiveBatchIds] = useState<string[]>([]);
  const [openAtMsById, setOpenAtMsById] = useState<Record<string, number>>({});
  const [focusedSlotId, setFocusedSlotId] = useState<string | null>(null);
  const [slotStates, setSlotStates] = useState<Record<string, SlotVisitState>>({});
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);
  const [completedCount, setCompletedCount] = useState(0);
  const [celebrationBurst, setCelebrationBurst] = useState<CelebrationBurst | null>(null);

  const cursorRef = useRef(0);
  const elapsedActiveMsRef = useRef(0);
  const cycleDurationSecRef = useRef(SINGLE_DWELL_MIN_SEC);
  const openAtMsByIdRef = useRef<Record<string, number>>({});
  const userSelectedTabInBatchRef = useRef(false);
  const lastAutoFocusedIdRef = useRef<string | null>(null);
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

  const preferredBatchIdsRef = useRef(preferredBatchIds);
  preferredBatchIdsRef.current = preferredBatchIds;

  const activeBatchIdsRef = useRef<string[]>([]);
  activeBatchIdsRef.current = activeBatchIds;

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

  // Pick next batch prioritizing distinct owners/domains so no single publisher fires repeatedly in the same burst
  const pickNextBatch = useCallback(
    (
      preferredFirstId?: string | null,
      limitOverride?: number,
      preferredIds?: string[] | null
    ): string[] => {
      const pool = linksRef.current;
      if (pool.length === 0) return [];

      const limit = Math.max(1, limitOverride ?? concurrencyLimitRef.current);
      const currentNow = Date.now();

      const ready = pool.filter((item) => getEffectiveCooldownEnd(item) <= currentNow);
      if (ready.length === 0) return [];

      const picked: AutoVisitQueueItem[] = [];
      const usedIds = new Set<string>();
      const usedOwners = new Set<string>();
      const usedDomains = new Set<string>();

      const addCandidate = (item: AutoVisitQueueItem) => {
        picked.push(item);
        usedIds.add(item.id);
        if (item.managedLink?.ownerId) usedOwners.add(item.managedLink.ownerId);
        if (item.domain) usedDomains.add(item.domain.toLowerCase());
      };

      let startIdx = cursorRef.current % ready.length;

      if (preferredFirstId) {
        const preferredReadyIdx = ready.findIndex((item) => item.id === preferredFirstId);
        if (preferredReadyIdx >= 0) {
          addCandidate(ready[preferredReadyIdx]);
          startIdx = (preferredReadyIdx + 1) % ready.length;
        }
      }

      if (preferredIds && preferredIds.length > 0 && picked.length < limit) {
        for (const prefId of preferredIds) {
          if (picked.length >= limit) break;
          if (usedIds.has(prefId)) continue;
          const candidate = ready.find((item) => item.id === prefId);
          if (candidate) addCandidate(candidate);
        }
      }

      // Pass 1: diversify by distinct publisher & domain
      for (let offset = 0; offset < ready.length && picked.length < limit; offset++) {
        const candidate = ready[(startIdx + offset) % ready.length];
        if (usedIds.has(candidate.id)) continue;
        const ownerId = candidate.managedLink?.ownerId || '';
        const domainKey = candidate.domain.toLowerCase();
        if (ownerId && usedOwners.has(ownerId)) continue;
        if (domainKey && usedDomains.has(domainKey)) continue;
        addCandidate(candidate);
      }

      // Pass 2: fill any remaining slots if fewer unique publishers/domains are ready
      for (let offset = 0; offset < ready.length && picked.length < limit; offset++) {
        const candidate = ready[(startIdx + offset) % ready.length];
        if (!usedIds.has(candidate.id)) {
          addCandidate(candidate);
        }
      }

      cursorRef.current = (startIdx + picked.length) % Math.max(1, ready.length);
      return picked.map((item) => item.id);
    },
    [getEffectiveCooldownEnd]
  );

  const initializeBatchSchedule = useCallback((batchIds: string[]) => {
    const schedule = buildStaggerSchedule(batchIds);
    elapsedActiveMsRef.current = 0;
    cycleDurationSecRef.current = schedule.cycleDurationSec;
    openAtMsByIdRef.current = schedule.openAtMsById;
    userSelectedTabInBatchRef.current = false;
    lastAutoFocusedIdRef.current = batchIds[0] ?? null;

    setElapsedActiveMs(0);
    setCycleDurationSec(schedule.cycleDurationSec);
    setOpenAtMsById(schedule.openAtMsById);
    setActiveBatchIds(batchIds);
    setFocusedSlotId(batchIds[0] ?? null);

    const initStates: Record<string, SlotVisitState> = {};
    for (const id of batchIds) {
      initStates[id] = (schedule.openAtMsById[id] ?? 0) === 0 ? 'visiting' : 'queued';
    }
    setSlotStates(initStates);
  }, []);

  // Reset / start session when dock opens or user explicitly starts a new Visit session
  useEffect(() => {
    sessionTokenRef.current += 1;

    if (!isOpen) {
      clearCelebrationTimer();
      setCelebrationBurst(null);
      setActiveBatchIds([]);
      setOpenAtMsById({});
      openAtMsByIdRef.current = {};
      setFocusedSlotId(null);
      setSlotStates({});
      setIsProcessingBatch(false);
      setIsPaused(false);
      setIsExpanded(false);
      elapsedActiveMsRef.current = 0;
      setElapsedActiveMs(0);
      cycleDurationSecRef.current = SINGLE_DWELL_MIN_SEC;
      setCycleDurationSec(SINGLE_DWELL_MIN_SEC);
      completingCycleRef.current = false;
      return;
    }

    cursorRef.current = 0;
    localHoldUntilRef.current = {};
    completingCycleRef.current = false;
    setIsPaused(false);
    setIsProcessingBatch(false);

    const initialBatch = pickNextBatch(
      initialLinkId,
      concurrencyLimit,
      preferredBatchIdsRef.current
    );
    initializeBatchSchedule(initialBatch);
    // Intentionally reset only on open, sessionNonce, or explicit initialLinkId trigger
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, sessionNonce, initialLinkId]);

  // Adjust active concurrent slots cleanly when switching Single <-> Multi (5) or when links list changes
  useEffect(() => {
    if (!isOpen || completingCycleRef.current) return;

    const currentNow = Date.now();
    const prev = activeBatchIdsRef.current;
    const valid = prev.filter((id) => {
      const item = linksById.get(id);
      return Boolean(item) && getEffectiveCooldownEnd(item!) <= currentNow;
    });

    if (valid.length === 0) {
      const nextBatch = pickNextBatch(null, concurrencyLimit, preferredBatchIdsRef.current);
      if (nextBatch.length === 0 && prev.length === 0) return;
      initializeBatchSchedule(nextBatch);
      return;
    }

    if (valid.length > concurrencyLimit) {
      const sliced = valid.slice(0, concurrencyLimit);
      initializeBatchSchedule(sliced);
      return;
    }

    if (valid.length < concurrencyLimit) {
      const used = new Set(valid);
      const ready = links.filter((item) => getEffectiveCooldownEnd(item) <= currentNow);
      const extras: string[] = [];
      const needed = concurrencyLimit - valid.length;

      if (preferredBatchIdsRef.current && preferredBatchIdsRef.current.length > 0) {
        for (const prefId of preferredBatchIdsRef.current) {
          if (extras.length >= needed) break;
          if (used.has(prefId)) continue;
          const match = ready.find((item) => item.id === prefId);
          if (match) {
            extras.push(match.id);
            used.add(match.id);
          }
        }
      }

      if (extras.length < needed && ready.length > 0) {
        const startIdx = cursorRef.current % ready.length;
        for (let offset = 0; offset < ready.length && extras.length < needed; offset++) {
          const candidate = ready[(startIdx + offset) % ready.length];
          if (!used.has(candidate.id)) {
            extras.push(candidate.id);
            used.add(candidate.id);
          }
        }
      }

      if (extras.length > 0) {
        if (ready.length > 0) {
          cursorRef.current = (cursorRef.current + extras.length) % ready.length;
        }
        const combined = [...valid, ...extras];
        const nextOpenAt = { ...openAtMsByIdRef.current };
        let maxScheduled = 0;
        for (const id of valid) {
          maxScheduled = Math.max(maxScheduled, nextOpenAt[id] ?? 0);
        }
        let cursorMs = Math.max(elapsedActiveMsRef.current, maxScheduled);
        for (const extraId of extras) {
          cursorMs += randomInt(STAGGER_MIN_MS, STAGGER_MAX_MS);
          nextOpenAt[extraId] = cursorMs;
        }
        const nextTotalSec = Math.max(
          cycleDurationSecRef.current,
          Math.ceil(cursorMs / 1000) + randomInt(POST_LAST_OPEN_MIN_SEC, POST_LAST_OPEN_MAX_SEC)
        );
        openAtMsByIdRef.current = nextOpenAt;
        cycleDurationSecRef.current = nextTotalSec;
        setOpenAtMsById(nextOpenAt);
        setCycleDurationSec(nextTotalSec);
        setActiveBatchIds(combined);
        setSlotStates((prevStates) => {
          const updated = { ...prevStates };
          for (const extraId of extras) {
            updated[extraId] =
              elapsedActiveMsRef.current >= (nextOpenAt[extraId] ?? 0) ? 'visiting' : 'queued';
          }
          return updated;
        });
        return;
      }
    }

    if (valid.length !== prev.length) {
      setActiveBatchIds(valid);
      if (focusedSlotId && !valid.includes(focusedSlotId)) {
        setFocusedSlotId(valid[0] ?? null);
      }
    }
  }, [
    concurrencyLimit,
    focusedSlotId,
    getEffectiveCooldownEnd,
    initializeBatchSchedule,
    isOpen,
    links,
    linksById,
    pickNextBatch,
  ]);

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
        const snapshot = activeBatchIdsRef.current
          .map((id) => linksById.get(id))
          .filter((item): item is AutoVisitQueueItem => Boolean(item));

        if (recordCurrent && snapshot.length > 0) {
          setIsProcessingBatch(true);
          const openedSnapshot = snapshot.filter(
            (item) => elapsedActiveMsRef.current >= (openAtMsByIdRef.current[item.id] ?? 0)
          );
          const batchSlice = (openedSnapshot.length > 0 ? openedSnapshot : snapshot).slice(
            0,
            concurrencyLimitRef.current
          );

          const processingStates: Record<string, SlotVisitState> = {};
          for (const item of batchSlice) {
            processingStates[item.id] = 'processing';
          }
          setSlotStates((prev) => ({ ...prev, ...processingStates }));

          const results = await Promise.all(
            batchSlice.map(async (item) => {
              const cooldownMs = Math.max(30, item.cooldownSec || 60) * 1000;
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
        initializeBatchSchedule(nextBatch);
      } finally {
        if (sessionTokenRef.current === activeSessionToken) {
          setIsProcessingBatch(false);
        }
        completingCycleRef.current = false;
      }
    },
    [initializeBatchSchedule, linksById, pickNextBatch, triggerCelebrationBurst]
  );

  // Auto-resume as soon as any cooled-down link becomes eligible again
  useEffect(() => {
    if (!isOpen || isPaused || isProcessingBatch || activeItems.length > 0 || links.length === 0) {
      return;
    }
    const readyNow = pickNextBatch(null, concurrencyLimit);
    if (readyNow.length > 0) {
      initializeBatchSchedule(readyNow);
    }
  }, [
    activeItems.length,
    concurrencyLimit,
    initializeBatchSchedule,
    isOpen,
    isPaused,
    isProcessingBatch,
    links.length,
    nowMs,
    pickNextBatch,
  ]);

  const executeConcurrentBatchRef = useRef(executeConcurrentBatch);
  executeConcurrentBatchRef.current = executeConcurrentBatch;

  // High-precision active timer (250ms tick) that drives staggered 4–7.5s openings & random cycle end
  useEffect(() => {
    if (!isOpen || isPaused || isProcessingBatch || activeItems.length === 0) return;

    const timer = window.setInterval(() => {
      const nextElapsed = elapsedActiveMsRef.current + TICK_INTERVAL_MS;
      const totalCycleMs = cycleDurationSecRef.current * 1000;

      if (nextElapsed >= totalCycleMs) {
        elapsedActiveMsRef.current = totalCycleMs;
        setElapsedActiveMs(totalCycleMs);
        void executeConcurrentBatchRef.current(true);
        return;
      }

      elapsedActiveMsRef.current = nextElapsed;
      setElapsedActiveMs(nextElapsed);

      // Unlock staggered slots as their randomized delay arrives
      const schedule = openAtMsByIdRef.current;
      let newlyOpenedId: string | null = null;

      setSlotStates((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const id of activeBatchIdsRef.current) {
          const openAt = schedule[id] ?? 0;
          if (nextElapsed >= openAt && next[id] === 'queued') {
            next[id] = 'visiting';
            newlyOpenedId = id;
            changed = true;
          }
        }
        return changed ? next : prev;
      });

      if (
        newlyOpenedId &&
        !userSelectedTabInBatchRef.current &&
        lastAutoFocusedIdRef.current !== newlyOpenedId
      ) {
        lastAutoFocusedIdRef.current = newlyOpenedId;
        setFocusedSlotId(newlyOpenedId);
      }
    }, TICK_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [activeItems.length, isOpen, isPaused, isProcessingBatch]);

  if (!isOpen) return null;

  const remainingSec = Math.max(
    0,
    cycleDurationSec - Math.floor(elapsedActiveMs / 1000)
  );
  const progressPct =
    activeItems.length > 0
      ? isProcessingBatch
        ? 100
        : Math.min(100, Math.max(0, (elapsedActiveMs / (cycleDurationSec * 1000)) * 100))
      : 0;

  const effectiveFocusedId =
    focusedSlotId && activeItems.some((i) => i.id === focusedSlotId)
      ? focusedSlotId
      : activeItems[0]?.id ?? null;
  const focusedItem = activeItems.find((i) => i.id === effectiveFocusedId) ?? activeItems[0] ?? null;

  const openedCount = activeItems.filter(
    (item) => elapsedActiveMs >= (openAtMsById[item.id] ?? 0)
  ).length;

  return (
    <aside
      aria-label="In-app visit browser dock"
      className={`fixed z-40 transition-all ${
        isExpanded
          ? 'inset-2 sm:inset-5'
          : `right-3 bottom-[72px] left-3 lg:right-5 lg:bottom-5 lg:left-auto ${
              isMultiRunning ? 'lg:w-[680px]' : 'lg:w-[540px]'
            }`
      }`}
    >
      {/* Spark / confetti particle celebration layer */}
      <AnimatePresence>
        {celebrationBurst && (
          <motion.div
            key={celebrationBurst.id}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-30 overflow-visible"
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
        className={`neon-prism-panel flex h-full flex-col overflow-hidden rounded-2xl border transition-colors duration-300 ${
          celebrationBurst
            ? 'border-[#00FF87]/85 shadow-[0_0_32px_-6px_rgba(0,255,135,0.5)]'
            : 'border-[#00F5FF]/45'
        }`}
      >
        {/* Top cycle progress bar */}
        <div className="h-1.5 w-full shrink-0 bg-[#050817]">
          <div
            className={`h-full transition-[width] duration-300 ${
              celebrationBurst
                ? 'bg-gradient-to-r from-[#00FF87] via-[#00F5FF] to-[#FFB800]'
                : 'bg-gradient-to-r from-[#00F5FF] via-[#3B82F6] via-[#B84DFF] to-[#FF2E93]'
            }`}
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* Header Bar */}
        <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
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
                <Globe className="h-3.5 w-3.5" />
              )}
            </motion.span>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                <span className="truncate">
                  {isMultiRunning
                    ? `Multi (5) · ${openedCount}/${activeItems.length} Open`
                    : 'In-App Browser Visit'}
                </span>
                {activeItems.length > 0 && (
                  <span className="font-mono-num rounded bg-[#00F5FF]/20 px-1.5 py-0.5 text-[10px] font-bold text-[#00F5FF]">
                    {isProcessingBatch ? 'Sync' : `${remainingSec}s`}
                  </span>
                )}
              </div>
              <p className="font-mono-num truncate text-[11px] text-slate-300">
                {activeItems.length > 0
                  ? `${focusedItem?.domain || focusedItem?.title || ''} · Ready ${queueCooldownMetrics.readyCount} · Done ${completedCount}`
                  : links.length === 0
                    ? 'No links in queue'
                    : `Cooldown ${queueCooldownMetrics.shortestCooldownSec}s · ${queueCooldownMetrics.coolingCount} waiting`}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {isMulti5Active && onChangeVisitMode ? (
              <button
                type="button"
                onClick={() => onChangeVisitMode(isMultiRunning ? 'single' : 'multi')}
                className={`rounded-lg border px-2 py-1 text-[10px] font-bold transition-colors ${
                  isMultiRunning
                    ? 'border-[#FF2E93]/55 bg-[#FF2E93]/20 text-[#FF9AD0] hover:bg-[#FF2E93]/30'
                    : 'border-[#00F5FF]/50 bg-[#00F5FF]/15 text-[#00F5FF] hover:bg-[#00F5FF]/25'
                }`}
              >
                {isMultiRunning ? '5x ON' : '1x · Go 5x'}
              </button>
            ) : (
              !isMulti5Active && (
                <button
                  type="button"
                  onClick={onOpenProLocked}
                  className="rounded-lg border border-[#FFB800]/50 bg-[#FFB800]/15 px-2 py-1 text-[10px] font-bold text-[#FFD166] hover:bg-[#FFB800]/25"
                >
                  5x PRO
                </button>
              )
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
              onClick={() => {
                setShowPreview(true);
                setIsExpanded((e) => !e);
              }}
              aria-label={isExpanded ? 'Restore dock size' : 'Expand full in-app view'}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
            >
              {isExpanded ? (
                <Minimize2 className="h-3.5 w-3.5 text-[#00FF87]" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
            </button>

            {!isExpanded && (
              <button
                type="button"
                onClick={() => setShowPreview((s) => !s)}
                aria-label={showPreview ? 'Minimize viewer' : 'Show viewer'}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
              >
                {showPreview ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronUp className="h-3.5 w-3.5" />
                )}
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              aria-label="Stop and close in-app visit"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-rose-400/25 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Full-Height In-App Browser Viewer (opened slots run staggered 4-7.5s apart inside real spacious viewports) */}
        {activeItems.length > 0 ? (
          <div
            className={
              showPreview || isExpanded
                ? 'flex min-h-0 flex-1 flex-col border-t border-white/10 bg-slate-950/90'
                : 'pointer-events-none h-0 overflow-hidden opacity-0'
            }
          >
            {/* Tab Strip for Multi (5) Staggered In-App Tabs */}
            <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-white/10 bg-[#050817]/95 px-2.5 py-1.5">
              {activeItems.map((item, idx) => {
                const openAtMs = openAtMsById[item.id] ?? 0;
                const isOpened = elapsedActiveMs >= openAtMs;
                const waitSec = Math.max(1, Math.ceil((openAtMs - elapsedActiveMs) / 1000));
                const status = slotStates[item.id] ?? (isOpened ? 'visiting' : 'queued');
                const isFocused = item.id === effectiveFocusedId;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      userSelectedTabInBatchRef.current = true;
                      setFocusedSlotId(item.id);
                    }}
                    className={`flex max-w-[170px] shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] transition-colors ${
                      isFocused
                        ? 'border-[#00F5FF]/60 bg-[#00F5FF]/15 font-bold text-white'
                        : isOpened
                          ? 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                          : 'border-white/5 bg-white/[0.02] text-slate-400'
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        status === 'done'
                          ? 'bg-[#00FF87]'
                          : status === 'processing'
                            ? 'animate-pulse bg-[#FFB800]'
                            : isOpened
                              ? 'bg-[#00F5FF]'
                              : 'bg-slate-500'
                      }`}
                    />
                    <span className="truncate">
                      {activeItems.length > 1 ? `${idx + 1}. ` : ''}
                      {item.domain || item.title}
                    </span>
                    {!isOpened && (
                      <span className="font-mono-num shrink-0 text-[9px] text-amber-300">
                        {waitSec}s
                      </span>
                    )}
                    {status === 'done' && (
                      <span className="shrink-0 text-[9px] font-bold text-[#00FF87]">OK</span>
                    )}
                  </button>
                );
              })}

              {focusedItem && (
                <a
                  href={focusedItem.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open ${focusedItem.title} in browser tab`}
                  className="ml-auto flex shrink-0 items-center gap-1 rounded-lg border border-[#00F5FF]/35 bg-[#00F5FF]/10 px-2 py-1 text-[10px] font-semibold text-[#00F5FF] hover:bg-[#00F5FF]/20"
                >
                  <ExternalLink className="h-3 w-3" />
                  <span className="hidden sm:inline">Open Tab</span>
                </a>
              )}
            </div>

            {/* Spacious Real In-App Viewport Stage (never tiny 80px frames; all opened tabs keep full visible dimensions) */}
            <div
              className={`relative w-full bg-white ${
                isExpanded
                  ? 'min-h-[320px] flex-1'
                  : 'h-[260px] sm:h-[320px]'
              }`}
            >
              {activeItems.map((item) => {
                const openAtMs = openAtMsById[item.id] ?? 0;
                const isOpened = elapsedActiveMs >= openAtMs;
                const isFocused = item.id === effectiveFocusedId;

                if (!isOpened) {
                  if (!isFocused) return null;
                  const waitSec = Math.max(1, Math.ceil((openAtMs - elapsedActiveMs) / 1000));
                  return (
                    <div
                      key={item.id}
                      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-[#070B20] px-4 text-center"
                    >
                      <Clock className="h-7 w-7 animate-pulse text-[#00F5FF]" />
                      <p className="text-xs font-bold text-white">
                        Opening {item.domain || item.title} in {waitSec}s...
                      </p>
                      <p className="max-w-xs text-[11px] text-slate-400">
                        Staggered human-paced delay (4–7.5s) prevents burst traffic spikes.
                      </p>
                    </div>
                  );
                }

                return (
                  <iframe
                    key={item.id}
                    src={item.url}
                    title={item.title}
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                    referrerPolicy="no-referrer"
                    loading="eager"
                    className={`absolute inset-0 h-full w-full border-0 bg-white ${
                      isFocused ? 'z-20' : 'z-10'
                    }`}
                  />
                );
              })}
            </div>

            {/* Subtle Safety Footer */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-t border-white/10 bg-[#050817] px-3 py-1.5 text-[10px] text-slate-400">
              <span className="flex items-center gap-1 truncate">
                <ShieldCheck className="h-3 w-3 shrink-0 text-[#00FF87]" />
                <span className="truncate">
                  Human-paced {cycleDurationSec}s cycle · Staggered 4–7.5s · No-Referrer
                </span>
              </span>
              <span className="font-mono-num shrink-0 text-slate-300">
                {isPaused ? 'Paused' : `${remainingSec}s left`}
              </span>
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
