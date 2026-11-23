import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Clock,
  Coins,
  Eye,
  Filter,
  Flag,
  Globe,
  History,
  Link2,
  Lock,
  Play,
  PlusCircle,
  RotateCcw,
  Search,
  ShieldCheck,
  SkipBack,
  SkipForward,
  Sparkles,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  AdsterraBackendStatus,
  LINK_CATEGORIES,
  LinkVisitRecord,
  ManagedLink,
  SuggestedUser,
  UserPersonalSmartlink,
  VisitMode,
  VisitTab,
} from '../types';
import { validateAndNormalizeUrl } from '../utils/urlValidator';
import { Avatar } from './Avatar';

interface HomeDashboardProps {
  currentUid: string;
  demoPoints: number;
  totalVisits: number;
  visitedToday: number;
  activeCooldownCount: number;
  activeUsersCount: number;
  liveLinksCount: number;
  suggestedUsers: SuggestedUser[];
  followedUserIds: string[];
  visitTab: VisitTab;
  visitMode: VisitMode;
  isMulti5Active: boolean;
  hasPendingMultiPayment: boolean;
  queueLinks: ManagedLink[];
  availableLinks: ManagedLink[];
  totalLinksInTab: number;
  ownLiveLinksCount?: number;
  otherContributorsCount?: number;
  removedCountInTab: number;
  nextUpLink: ManagedLink | null;
  queuePosition: number;
  shortestCooldownLink: { link: ManagedLink; remainingSec: number } | null;
  myLinkVisits: LinkVisitRecord[];
  mySubmittedLinks?: ManagedLink[];
  nowMs: number;
  cooldowns: Record<string, number>;
  isAdmin: boolean;
  adminPendingCount: number;
  isAdsterraConnected?: boolean;
  hasAdsterraApiKey?: boolean;
  adsterraPlacements?: AdsterraBackendStatus['placementsPreview'];
  personalSmartlinks?: UserPersonalSmartlink[];
  primaryAdsterraSmartlink?: { title: string; url: string } | null;
  onToggleFollow: (userId: string) => void;
  onChangeVisitTab: (tab: VisitTab) => void;
  onChangeVisitMode: (mode: VisitMode) => void;
  onOpenProLocked: () => void;
  onStartAutoVisit: (startId?: string, preferredBatchIds?: string[]) => void;
  onReportLink?: (link: ManagedLink) => void;
  onNextQueue: () => void;
  onPrevQueue: () => void;
  onRemoveFromQueue: (linkId: string) => void;
  onRestoreQueue: () => void;
  onOpenLinkManager: () => void;
  onOpenAdsterra: () => void;
  onOpenAdminPanel: () => void;
  onPublishToCommunity?: (payload: {
    title: string;
    url: string;
    category: string;
  }) => Promise<void>;
}

function formatShortDateTime(ms: number): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(ms));
  } catch {
    return 'Recent';
  }
}

export const HomeDashboard: React.FC<HomeDashboardProps> = ({
  currentUid,
  demoPoints,
  totalVisits,
  visitedToday,
  activeCooldownCount,
  activeUsersCount,
  liveLinksCount,
  suggestedUsers,
  followedUserIds,
  visitTab,
  visitMode,
  isMulti5Active,
  hasPendingMultiPayment,
  queueLinks,
  availableLinks,
  totalLinksInTab,
  ownLiveLinksCount = 0,
  otherContributorsCount = 0,
  removedCountInTab,
  nextUpLink,
  queuePosition,
  shortestCooldownLink,
  myLinkVisits,
  mySubmittedLinks = [],
  nowMs,
  cooldowns,
  isAdmin,
  adminPendingCount,
  isAdsterraConnected = false,
  hasAdsterraApiKey = false,
  adsterraPlacements = [],
  personalSmartlinks = [],
  primaryAdsterraSmartlink = null,
  onToggleFollow,
  onChangeVisitTab,
  onChangeVisitMode,
  onOpenProLocked,
  onStartAutoVisit,
  onReportLink,
  onNextQueue,
  onPrevQueue,
  onRemoveFromQueue,
  onRestoreQueue,
  onOpenLinkManager,
  onOpenAdsterra,
  onOpenAdminPanel,
  onPublishToCommunity,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [multiBatchIds, setMultiBatchIds] = useState<string[]>([]);
  const [publishingUrl, setPublishingUrl] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);

  useEffect(() => {
    const availableIds = new Set(availableLinks.map((l) => l.id));
    setMultiBatchIds((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.filter((id) => availableIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [availableLinks]);

  const statsCards = [
    {
      label: 'Visits',
      value: totalVisits.toLocaleString(),
      sub: `${demoPoints} PTS`,
      icon: Sparkles,
      accent: 'text-[#00F5FF]',
      cardClass: 'neon-card-cyan',
      valueClass: 'text-[#00F5FF]',
    },
    {
      label: 'Today',
      value: visitedToday.toLocaleString(),
      sub: 'Logged',
      icon: Eye,
      accent: 'text-[#00FF87]',
      cardClass: 'neon-card-green',
      valueClass: 'text-[#00FF87]',
    },
    {
      label: 'Cooldown',
      value: activeCooldownCount.toLocaleString(),
      sub: 'Active',
      icon: Clock,
      accent: 'text-[#C084FC]',
      cardClass: 'neon-card-purple',
      valueClass: 'text-[#E9D5FF]',
    },
    {
      label: 'Members',
      value: activeUsersCount.toLocaleString(),
      sub: 'Verified',
      icon: Users,
      accent: 'text-[#FF4DA6]',
      cardClass: 'neon-card-pink',
      valueClass: 'text-[#FF9AD0]',
    },
    {
      label: 'Pool',
      value: liveLinksCount.toLocaleString(),
      sub: 'Live',
      icon: Coins,
      accent: 'text-[#FFB800]',
      cardClass: 'neon-card-amber',
      valueClass: 'text-[#FFD166]',
    },
  ];

  const filteredDirectoryLinks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const seen = new Set<string>();
    return queueLinks.filter((link) => {
      if (link.ownerId === currentUid) return false;
      if (seen.has(link.id)) return false;
      seen.add(link.id);

      if (selectedCategory !== 'All' && link.category !== selectedCategory) {
        return false;
      }
      if (!q) return true;
      return (
        link.title.toLowerCase().includes(q) ||
        link.domain.toLowerCase().includes(q) ||
        link.category.toLowerCase().includes(q) ||
        link.ownerName.toLowerCase().includes(q) ||
        link.ownerUsername.toLowerCase().includes(q)
      );
    });
  }, [currentUid, queueLinks, searchQuery, selectedCategory]);

  const recentLinkOpens = useMemo(() => myLinkVisits.slice(0, 5), [myLinkVisits]);

  const pinnedBatchIdsSet = useMemo(
    () => new Set(multiBatchIds),
    [multiBatchIds]
  );

  const multiBatchLinks = useMemo(() => {
    const availableById = new Map(availableLinks.map((l) => [l.id, l]));
    const picked: ManagedLink[] = [];
    const usedIds = new Set<string>();

    for (const id of multiBatchIds) {
      if (picked.length >= 5) break;
      const found = availableById.get(id);
      if (found && !usedIds.has(found.id)) {
        picked.push(found);
        usedIds.add(found.id);
      }
    }

    for (const candidate of availableLinks) {
      if (picked.length >= 5) break;
      if (!usedIds.has(candidate.id)) {
        picked.push(candidate);
        usedIds.add(candidate.id);
      }
    }

    return picked;
  }, [availableLinks, multiBatchIds]);

  const toggleMultiBatchSelection = (linkId: string) => {
    if (isMulti5Active && visitMode !== 'multi') {
      onChangeVisitMode('multi');
    }
    setMultiBatchIds((prev) => {
      if (prev.includes(linkId)) return prev.filter((id) => id !== linkId);
      if (prev.length >= 5) return [...prev.slice(1), linkId];
      return [...prev, linkId];
    });
  };

  // Combine API-synced Smartlinks + saved personal Smartlinks (deduplicated)
  const mySyncedSmartlinks = useMemo(() => {
    const items: Array<{ id: string; title: string; url: string; source: string }> = [];
    const seen = new Set<string>();

    const pushItem = (id: string, title: string, rawUrl: string, source: string) => {
      const check = validateAndNormalizeUrl(rawUrl);
      const key = check.valid && check.normalizedUrl ? check.normalizedUrl : rawUrl.trim();
      if (!key || seen.has(key)) return;
      seen.add(key);
      items.push({ id, title, url: rawUrl.trim(), source });
    };

    for (const p of adsterraPlacements) {
      if (!p.directUrl) continue;
      pushItem(`api_${p.id}`, p.title, p.directUrl, `API #${p.id}`);
    }

    for (const l of personalSmartlinks) {
      pushItem(l.id, l.title, l.url, l.domain);
    }

    if (primaryAdsterraSmartlink?.url) {
      pushItem(
        'primary_adsterra_smartlink',
        primaryAdsterraSmartlink.title || 'Adsterra Smartlink',
        primaryAdsterraSmartlink.url,
        'Primary Smartlink'
      );
    }

    return items;
  }, [adsterraPlacements, personalSmartlinks, primaryAdsterraSmartlink]);

  const unpublishedSmartlinks = useMemo(
    () =>
      mySyncedSmartlinks.filter((item) => {
        const check = validateAndNormalizeUrl(item.url);
        const normalized = check.valid && check.normalizedUrl ? check.normalizedUrl : item.url.trim();
        return !mySubmittedLinks.some(
          (l) => l.normalizedUrl === normalized || l.url === item.url.trim()
        );
      }),
    [mySubmittedLinks, mySyncedSmartlinks]
  );

  const handleQuickPublish = async (title: string, url: string) => {
    if (!onPublishToCommunity || publishingUrl) return;
    setPublishError(null);
    setPublishingUrl(url);
    try {
      await onPublishToCommunity({ title, url, category: 'Other' });
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Could not publish Smartlink.');
    } finally {
      setPublishingUrl(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Compact Header */}
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="neon-text-spectrum text-xs font-bold tracking-wider">INFINITY REWARDS</p>
          <h1 className="font-display mt-0.5 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
            Dashboard
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenAdsterra}
            className={`flex min-h-[40px] items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-all ${
              hasAdsterraApiKey || isAdsterraConnected
                ? 'border-[#00FF87]/55 bg-[#00FF87]/15 text-[#00FF87] shadow-[0_0_16px_-4px_rgba(0,255,135,0.45)] hover:bg-[#00FF87]/25'
                : 'border-[#B84DFF]/50 bg-gradient-to-r from-[#B84DFF]/25 via-[#FF2E93]/20 to-[#00F5FF]/20 text-white shadow-[0_0_18px_-4px_rgba(184,77,255,0.45)] hover:brightness-110'
            }`}
          >
            <Link2 className="h-4 w-4" />
            <span>{hasAdsterraApiKey || isAdsterraConnected ? 'Adsterra API' : 'Connect Adsterra'}</span>
          </button>

          <button
            type="button"
            onClick={onOpenLinkManager}
            className="flex min-h-[40px] items-center gap-2 rounded-xl border border-[#00F5FF]/45 bg-[#00F5FF]/14 px-3.5 py-2 text-xs font-semibold text-[#67E8F9] shadow-[0_0_16px_-4px_rgba(0,245,255,0.35)] transition-all hover:bg-[#00F5FF]/24"
          >
            <PlusCircle className="h-4 w-4" />
            <span>My Links</span>
          </button>

          {isAdmin && (
            <button
              type="button"
              onClick={onOpenAdminPanel}
              className="flex min-h-[40px] items-center gap-2 rounded-xl border border-[#FF2E93]/45 bg-[#FF2E93]/15 px-3.5 py-2 text-xs font-semibold text-[#FF8DC7] shadow-[0_0_16px_-4px_rgba(255,46,147,0.38)] transition-all hover:bg-[#FF2E93]/25"
            >
              <ShieldCheck className="h-4 w-4" />
              <span className="font-mono-num">Admin ({adminPendingCount})</span>
            </button>
          )}
        </div>
      </section>

      {/* 5-Tile Multi-Neon KPI Strip */}
      <section aria-label="Statistics overview">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {statsCards.map((card, idx) => {
            const Icon = card.icon;
            return (
              <div
                key={card.label}
                className={`${card.cardClass} rounded-2xl p-4 transition-transform hover:-translate-y-0.5 ${
                  idx === 4 ? 'col-span-2 sm:col-span-1' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-300">{card.label}</span>
                  <Icon className={`h-4 w-4 ${card.accent}`} />
                </div>
                <p className={`font-mono-num mt-2 text-2xl font-extrabold ${card.valueClass}`}>
                  {card.value}
                </p>
                <p className="font-mono-num mt-0.5 text-xs text-slate-300/80">{card.sub}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Main Workspace: Visit Hub + Next Up */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <section
          aria-label="Visit controls"
          className="neon-prism-panel rounded-3xl p-5 sm:p-6 xl:col-span-7"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display neon-text-spectrum text-lg font-extrabold">
                Mutual Exchange Ring
              </h2>
              <p className="text-xs text-slate-300">
                {isMulti5Active && visitMode === 'multi'
                  ? 'Visits 5 other members concurrently · Own links hidden'
                  : 'Round-robin auto-visit · Own links hidden from your queue'}
              </p>
            </div>
            <span className="font-mono-num text-xs font-bold text-[#00FF87]">
              {availableLinks.length}/{totalLinksInTab} ready
            </span>
          </div>

          {/* Smartlink / Website Switch */}
          <div
            role="tablist"
            aria-label="Link type"
            className="mt-4 grid grid-cols-2 gap-1.5 rounded-2xl border border-[#B84DFF]/25 bg-[#050816]/85 p-1.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={visitTab === 'smartlink'}
              onClick={() => onChangeVisitTab('smartlink')}
              className={`flex min-h-[42px] items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all ${
                visitTab === 'smartlink'
                  ? 'border border-[#00F5FF]/50 bg-gradient-to-r from-[#00F5FF]/22 via-[#3B82F6]/26 to-[#B84DFF]/22 text-white shadow-[0_0_16px_-4px_rgba(0,245,255,0.4)]'
                  : 'border border-transparent text-slate-400 hover:text-white'
              }`}
            >
              <Link2 className="h-4 w-4 text-[#00F5FF]" />
              <span>Smartlink</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={visitTab === 'website'}
              onClick={() => onChangeVisitTab('website')}
              className={`flex min-h-[42px] items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all ${
                visitTab === 'website'
                  ? 'border border-[#FF2E93]/50 bg-gradient-to-r from-[#FF2E93]/22 via-[#B84DFF]/25 to-[#3B82F6]/22 text-white shadow-[0_0_16px_-4px_rgba(255,46,147,0.4)]'
                  : 'border border-transparent text-slate-400 hover:text-white'
              }`}
            >
              <Globe className="h-4 w-4 text-[#FF4DA6]" />
              <span>Website</span>
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#00FF87]/25 bg-[#00FF87]/8 px-3 py-2 text-[11px] text-slate-200">
            <span>
              <span className="font-semibold text-[#00FF87]">
                {otherContributorsCount} other member{otherContributorsCount === 1 ? '' : 's'}
              </span>{' '}
              in rotation · Your own links never appear in your visit queue; new members join live.
            </span>
            {ownLiveLinksCount > 0 && (
              <span className="font-mono-num shrink-0 font-bold text-[#00F5FF]">
                {ownLiveLinksCount} shared for others
              </span>
            )}
          </div>

          {/* Single vs Multi (5) */}
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => onChangeVisitMode('single')}
              className={`flex min-h-[54px] items-center justify-between rounded-2xl border px-4 py-2.5 text-left transition-all ${
                !isMulti5Active || visitMode === 'single'
                  ? 'neon-card-cyan'
                  : 'border-white/10 bg-[#070C20]/70 hover:border-[#00F5FF]/35'
              }`}
            >
              <div>
                <p className="text-sm font-semibold text-white">Single Visit</p>
                <p className="text-xs text-slate-300">1 link at a time</p>
              </div>
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  !isMulti5Active || visitMode === 'single'
                    ? 'bg-[#00F5FF] shadow-[0_0_10px_#00F5FF]'
                    : 'bg-slate-600'
                }`}
              />
            </button>

            <button
              type="button"
              onClick={() => {
                if (isMulti5Active) {
                  onChangeVisitMode('multi');
                } else {
                  onOpenProLocked();
                }
              }}
              className={`flex min-h-[54px] items-center justify-between rounded-2xl border px-4 py-2.5 text-left transition-all ${
                isMulti5Active && visitMode === 'multi'
                  ? 'neon-card-pink'
                  : 'border-[#B84DFF]/25 bg-[#0A0C24]/75 hover:border-[#FF2E93]/50'
              }`}
            >
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-white">Multi (5)</p>
                  <span
                    className={`text-[11px] font-bold ${
                      isMulti5Active ? 'text-[#00FF87]' : 'text-[#FFB800]'
                    }`}
                  >
                    {isMulti5Active ? '· ACTIVE' : '· 50 BDT'}
                  </span>
                </div>
                <p className="text-xs text-slate-300">
                  {isMulti5Active
                    ? '5 links at once'
                    : hasPendingMultiPayment
                      ? 'Payment pending review'
                      : 'bKash / Nagad unlock'}
                </p>
              </div>
              {isMulti5Active ? (
                <Sparkles className="h-4 w-4 shrink-0 text-[#00FF87]" />
              ) : (
                <Lock className="h-4 w-4 shrink-0 text-[#FF4DA6]" />
              )}
            </button>
          </div>

          {/* Action / Multi Batch */}
          {isMulti5Active && visitMode === 'multi' ? (
            <div className="mt-4 space-y-3 rounded-2xl border border-[#FF2E93]/35 bg-[#090B21]/80 p-4 shadow-[0_0_24px_-10px_rgba(255,46,147,0.35)]">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-bold text-[#FF8DC7]">
                  Multi (5) Concurrent Queue ({multiBatchLinks.length}/5 slots)
                </span>
                <div className="flex items-center gap-3">
                  {multiBatchIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setMultiBatchIds([])}
                      className="font-semibold text-slate-300 hover:text-white"
                    >
                      Clear Picks ({multiBatchIds.length})
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onOpenProLocked}
                    className="font-semibold text-[#00F5FF] hover:underline"
                  >
                    {isAdmin ? 'PRO Status' : 'Receipt'}
                  </button>
                </div>
              </div>

              {multiBatchLinks.length === 0 ? (
                <div className="space-y-2.5">
                  <p className="text-xs text-slate-300">
                    {totalLinksInTab === 0
                      ? `Waiting for other members to publish ${visitTab === 'smartlink' ? 'Smartlinks' : 'Websites'}. Your own links are hidden from your queue.`
                      : `All ${totalLinksInTab} links are on cooldown — live queue will resume automatically.`}
                  </p>
                  <button
                    type="button"
                    onClick={() => onStartAutoVisit()}
                    className="neon-btn-primary flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl px-5 py-2 text-xs font-bold"
                  >
                    <Play className="h-4 w-4" />
                    <span>
                      {totalLinksInTab === 0
                        ? 'Open Live Listener (Auto-Starts on New Member)'
                        : 'Open Auto-Resume Queue'}
                    </span>
                  </button>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      onStartAutoVisit(
                        multiBatchLinks[0]?.id,
                        multiBatchLinks.map((l) => l.id)
                      )
                    }
                    className="neon-btn-primary flex min-h-[46px] w-full items-center justify-center gap-2 rounded-2xl px-5 py-2.5 text-sm font-bold"
                  >
                    <Play className="h-4 w-4" />
                    <span>
                      Auto Visit All ({multiBatchLinks.length} at once)
                    </span>
                  </button>

                  {availableLinks.length < 5 && (
                    <p className="text-[11px] text-slate-300">
                      {availableLinks.length} of 5 slots ready in {visitTab === 'smartlink' ? 'Smartlinks' : 'Websites'} right now — extra slots fill automatically as more members publish or finish cooldown.
                    </p>
                  )}

                  <div className="space-y-2">
                    {multiBatchLinks.map((batchItem, idx) => (
                      <div
                        key={batchItem.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-[#B84DFF]/25 bg-[#050817]/85 px-3 py-2"
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="font-mono-num flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#FF2E93]/30 to-[#B84DFF]/30 text-xs font-bold text-[#FF9AD0]">
                            {idx + 1}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-white">
                              {batchItem.title}
                              {pinnedBatchIdsSet.has(batchItem.id) && (
                                <span className="ml-1.5 text-[10px] font-bold text-[#00F5FF]">
                                  · Pinned
                                </span>
                              )}
                            </p>
                            <p className="truncate text-[11px] text-slate-400">
                              {batchItem.domain} · {batchItem.category}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            onStartAutoVisit(
                              batchItem.id,
                              multiBatchLinks.map((l) => l.id)
                            )
                          }
                          className="neon-btn-emerald flex min-h-[34px] shrink-0 items-center gap-1 rounded-lg px-3 py-1 text-xs font-bold"
                        >
                          <span>Visit</span>
                          <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              {nextUpLink ? (
                <button
                  type="button"
                  onClick={() => onStartAutoVisit(nextUpLink.id)}
                  className="neon-btn-primary flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl px-6 py-3 text-sm font-bold"
                >
                  <Play className="h-4 w-4" />
                  <span>
                    Auto Visit All {visitTab === 'smartlink' ? 'Smartlinks' : 'Websites'} (
                    {availableLinks.length})
                  </span>
                </button>
              ) : totalLinksInTab === 0 ? (
                <div className="space-y-2.5 rounded-2xl border border-[#00F5FF]/25 bg-[#060B20]/70 p-3.5 text-xs text-slate-300">
                  <p className="leading-relaxed">
                    No other members&apos; {visitTab === 'smartlink' ? 'Smartlinks' : 'Websites'} are live right now. Your own links are excluded so you never self-visit; any new member who joins enters your loop automatically.
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => onStartAutoVisit()}
                      className="neon-btn-primary flex min-h-[42px] flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-bold"
                    >
                      <Play className="h-4 w-4" />
                      <span>Start Live Listener</span>
                    </button>
                    <button
                      type="button"
                      onClick={onOpenAdsterra}
                      className="flex min-h-[42px] items-center justify-center gap-2 rounded-xl border border-[#00FF87]/40 bg-[#00FF87]/12 px-4 py-2 text-xs font-semibold text-[#00FF87] hover:bg-[#00FF87]/20"
                    >
                      <Link2 className="h-4 w-4" />
                      <span>{ownLiveLinksCount > 0 ? 'Adsterra Stats' : 'Publish Smartlink'}</span>
                    </button>
                    {isAdmin && visitTab === 'website' && adminPendingCount > 0 && (
                      <button
                        type="button"
                        onClick={onOpenAdminPanel}
                        className="flex min-h-[42px] items-center justify-center gap-2 rounded-xl border border-[#FFB800]/45 bg-[#FFB800]/15 px-4 py-2 text-xs font-semibold text-[#FFD166] hover:bg-[#FFB800]/25"
                      >
                        <ShieldCheck className="h-4 w-4" />
                        <span>Approve ({adminPendingCount})</span>
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onStartAutoVisit()}
                  className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border border-[#B84DFF]/40 bg-[#0B1028]/80 px-6 py-3 text-sm font-semibold text-slate-100 hover:border-[#00F5FF]/50"
                >
                  <Clock className="h-4 w-4 text-[#C084FC]" />
                  <span>
                    {shortestCooldownLink
                      ? `Cooldown (${shortestCooldownLink.remainingSec}s) · Queue Auto Visit`
                      : 'Open Auto-Resume Queue'}
                  </span>
                </button>
              )}
            </div>
          )}

          {onPublishToCommunity && unpublishedSmartlinks.length > 0 && (
            <div className="mt-4 space-y-2 rounded-2xl border border-[#B84DFF]/30 bg-[#070B1E]/75 p-3.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-bold text-[#E8C5FF]">
                  Ready to Share With Community ({unpublishedSmartlinks.length})
                </span>
                <span className="text-[11px] text-slate-400">Visible to other members only</span>
              </div>
              {publishError && (
                <p role="alert" className="text-xs text-rose-300">
                  {publishError}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {unpublishedSmartlinks.slice(0, 3).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    disabled={publishingUrl === item.url}
                    onClick={() => void handleQuickPublish(item.title, item.url)}
                    className="neon-btn-emerald flex min-h-[34px] items-center gap-1.5 rounded-xl px-3 py-1 text-xs font-bold disabled:opacity-50"
                  >
                    <Globe className="h-3.5 w-3.5" />
                    <span className="max-w-[160px] truncate">
                      {publishingUrl === item.url ? 'Publishing...' : `Publish: ${item.title}`}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Next Up Card */}
        <section
          aria-label="Next up in queue"
          className="glass-panel flex flex-col justify-between rounded-3xl p-5 sm:p-6 xl:col-span-5"
        >
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-lg font-bold text-white">Next Up</h2>
                <p className="font-mono-num text-xs text-slate-400">
                  {availableLinks.length > 0
                    ? `${queuePosition + 1} of ${availableLinks.length}`
                    : 'Queue'}
                </p>
              </div>

              <div className="flex items-center gap-1.5">
                {availableLinks.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={onPrevQueue}
                      aria-label="Previous link"
                      className="flex min-h-[36px] items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-200 hover:bg-white/10"
                    >
                      <SkipBack className="h-3.5 w-3.5 text-cyan-300" />
                      <span>Prev</span>
                    </button>
                    <button
                      type="button"
                      onClick={onNextQueue}
                      aria-label="Next link"
                      className="flex min-h-[36px] items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-200 hover:bg-white/10"
                    >
                      <span>Next</span>
                      <SkipForward className="h-3.5 w-3.5 text-cyan-300" />
                    </button>
                  </>
                )}

                {nextUpLink && (
                  <button
                    type="button"
                    onClick={() => onRemoveFromQueue(nextUpLink.id)}
                    aria-label="Skip link"
                    className="flex min-h-[36px] items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300 hover:text-rose-200"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            {nextUpLink ? (
              <div className="neon-card-purple mt-4 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Avatar
                      src={nextUpLink.ownerAvatar}
                      alt={nextUpLink.ownerName}
                      size="md"
                      accent="cyan"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">
                        {nextUpLink.ownerName}
                        {nextUpLink.ownerId === currentUid && (
                          <span className="ml-1.5 text-[11px] font-semibold text-[#C084FC]">
                            · You
                          </span>
                        )}
                      </p>
                      <p className="truncate text-xs text-slate-400">{nextUpLink.ownerUsername}</p>
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-[#00F5FF]">{nextUpLink.category}</span>
                </div>

                <div className="border-t border-white/10 pt-3">
                  <h3 className="font-display text-base font-bold text-white">{nextUpLink.title}</h3>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-300">
                    {nextUpLink.description}
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-2.5 text-xs text-slate-400">
                  <span className="truncate">{nextUpLink.domain}</span>
                  <span className="font-mono-num shrink-0">
                    <span className={nextUpLink.isHttps ? 'text-[#00FF87]' : 'text-[#FFB800]'}>
                      {nextUpLink.isHttps ? 'HTTPS' : 'HTTP'}
                    </span>{' '}
                    · {nextUpLink.cooldownSec}s
                  </span>
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-white/10 bg-slate-900/45 p-6 text-center">
                <Clock className="mx-auto h-6 w-6 text-purple-300" />
                <p className="mt-2 text-sm font-semibold text-white">
                  {totalLinksInTab === 0 ? 'No Links Yet' : 'Cooling Down'}
                </p>
                {shortestCooldownLink && (
                  <p className="font-mono-num mt-1 text-xs text-slate-400">
                    Ready in {shortestCooldownLink.remainingSec}s
                  </p>
                )}
                {removedCountInTab > 0 && (
                  <button
                    type="button"
                    onClick={onRestoreQueue}
                    className="mt-3 inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-cyan-400/30 bg-cyan-500/15 px-3 py-1 text-xs font-semibold text-cyan-200"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Restore ({removedCountInTab})</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {removedCountInTab > 0 && nextUpLink && (
            <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
              <span>{removedCountInTab} hidden</span>
              <button
                type="button"
                onClick={onRestoreQueue}
                className="font-semibold text-cyan-300 hover:underline"
              >
                Restore Queue
              </button>
            </div>
          )}
        </section>
      </div>

      {/* Approved Directory */}
      <section aria-label="Approved links directory" className="glass-panel rounded-3xl p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-display text-lg font-bold text-white">
            Live {visitTab === 'smartlink' ? 'Smartlinks' : 'Websites'}
          </h2>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search links..."
                className="min-h-[38px] w-full rounded-xl border border-white/15 bg-slate-950/70 py-1.5 pr-3 pl-9 text-xs text-white placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none sm:w-52"
              />
            </div>

            <div className="relative flex items-center">
              <Filter className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-cyan-300" />
              <select
                aria-label="Filter by category"
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="min-h-[38px] w-full rounded-xl border border-white/15 bg-slate-950/70 py-1.5 pr-3 pl-8 text-xs text-white focus:border-cyan-400 focus:outline-none sm:w-40"
              >
                <option value="All" className="bg-slate-900">
                  All Categories
                </option>
                {LINK_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat} className="bg-slate-900">
                    {cat}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          {filteredDirectoryLinks.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-[#070B1E]/60 p-6 text-center text-xs text-slate-400 md:col-span-2">
              {totalLinksInTab === 0
                ? `No other members' ${visitTab === 'smartlink' ? 'Smartlinks' : 'Websites'} are live yet. When other members join and publish, they will appear here.`
                : `No live ${visitTab === 'smartlink' ? 'Smartlinks' : 'Websites'} match your filter.`}
            </div>
          ) : (
            filteredDirectoryLinks.map((item, idx) => {
              const cdRemaining = Math.max(
                0,
                Math.ceil(((cooldowns[item.id] ?? 0) - nowMs) / 1000)
              );
              const inBatch = pinnedBatchIdsSet.has(item.id);
              const isOwn = item.ownerId === currentUid;
              const neonHoverBorder = [
                'hover:border-[#00F5FF]/55 hover:shadow-[0_0_20px_-8px_rgba(0,245,255,0.45)]',
                'hover:border-[#B84DFF]/55 hover:shadow-[0_0_20px_-8px_rgba(184,77,255,0.45)]',
                'hover:border-[#00FF87]/55 hover:shadow-[0_0_20px_-8px_rgba(0,255,135,0.45)]',
                'hover:border-[#FF2E93]/55 hover:shadow-[0_0_20px_-8px_rgba(255,46,147,0.45)]',
              ][idx % 4];

              return (
                <div
                  key={item.id}
                  className={`flex flex-col justify-between rounded-2xl border border-white/12 bg-[#070B20]/75 p-4 transition-all ${neonHoverBorder}`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <Avatar src={item.ownerAvatar} alt={item.ownerName} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-white">
                            {item.ownerName}
                            {isOwn && <span className="ml-1 text-[#C084FC]">· You</span>}
                          </p>
                          <p className="truncate text-[11px] text-slate-400">{item.ownerUsername}</p>
                        </div>
                      </div>
                      <span className="text-[11px] font-semibold text-[#00F5FF]">{item.category}</span>
                    </div>

                    <h3 className="font-display mt-2.5 truncate text-sm font-bold text-white">
                      {item.title}
                    </h3>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-300">{item.description}</p>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-2.5">
                    <span className="truncate text-[11px] text-slate-400">
                      {item.domain} ·{' '}
                      <span className={item.isHttps ? 'text-[#00FF87]' : 'text-[#FFB800]'}>
                        {item.isHttps ? 'HTTPS' : 'HTTP'}
                      </span>
                    </span>

                    <div className="flex items-center gap-1.5">
                      {isMulti5Active && cdRemaining === 0 && (
                        <button
                          type="button"
                          onClick={() => toggleMultiBatchSelection(item.id)}
                          className={`min-h-[34px] rounded-xl border px-2.5 py-1 text-xs font-semibold ${
                            inBatch
                              ? 'border-[#FF2E93]/60 bg-[#FF2E93]/20 text-[#FF9AD0]'
                              : 'border-white/15 bg-white/5 text-slate-300 hover:bg-white/10'
                          }`}
                        >
                          {inBatch ? 'Pinned' : '+ Batch'}
                        </button>
                      )}

                      {onReportLink && (
                        <button
                          type="button"
                          onClick={() => onReportLink(item)}
                          aria-label={`Report ${item.title}`}
                          className="flex min-h-[34px] items-center justify-center rounded-xl border border-white/10 bg-white/5 px-2.5 text-slate-400 hover:border-[#FF4D6D]/45 hover:text-[#FF4D6D]"
                        >
                          <Flag className="h-3.5 w-3.5" />
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() =>
                          onStartAutoVisit(
                            item.id,
                            isMulti5Active && visitMode === 'multi'
                              ? multiBatchLinks.map((l) => l.id)
                              : undefined
                          )
                        }
                        className="neon-btn-primary flex min-h-[34px] items-center gap-1.5 rounded-xl px-3 py-1 text-xs font-bold"
                      >
                        <Play className="h-3.5 w-3.5" />
                        <span>{cdRemaining > 0 ? `${cdRemaining}s` : 'Visit'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Bottom Grid: Recent Visits + Verified Members */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <section
          aria-label="Recent link openings"
          className="glass-panel rounded-3xl p-5 sm:p-6 xl:col-span-7"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-[#00F5FF]" />
              <h2 className="font-display text-base font-bold text-white">Recent Visits</h2>
            </div>
            <button
              type="button"
              onClick={onOpenLinkManager}
              className="text-xs font-semibold text-[#00F5FF] hover:text-[#00FF87]"
            >
              View All
            </button>
          </div>

          <div className="mt-4 space-y-2">
            {recentLinkOpens.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-[#070B20]/65 p-5 text-center text-xs text-slate-400">
                No visits recorded yet.
              </div>
            ) : (
              recentLinkOpens.map((entry) => {
                const remaining = Math.max(
                  0,
                  Math.ceil(((cooldowns[entry.linkId] ?? 0) - nowMs) / 1000)
                );
                return (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#070B20]/75 px-3.5 py-2.5 transition-colors hover:border-[#00F5FF]/35"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">{entry.linkTitle}</p>
                      <p className="truncate text-xs text-slate-400">
                        {entry.domain} · {formatShortDateTime(entry.createdAtMs)}
                      </p>
                    </div>
                    <span
                      className={`font-mono-num shrink-0 text-xs font-bold ${
                        remaining > 0 ? 'text-[#C084FC]' : 'text-[#00FF87]'
                      }`}
                    >
                      {remaining > 0 ? `${remaining}s` : 'Ready'}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section
          aria-label="Verified community members"
          className="glass-panel rounded-3xl p-5 sm:p-6 xl:col-span-5"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-bold text-white">Verified Members</h2>
            <span className="font-mono-num text-xs font-semibold text-[#00FF87]">
              {suggestedUsers.length} active
            </span>
          </div>

          <div className="mt-4 space-y-2.5">
            {suggestedUsers.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-[#070B20]/65 p-5 text-center text-xs text-slate-400">
                Other verified members will appear here once they join.
              </div>
            ) : (
              suggestedUsers.slice(0, 5).map((user) => {
                const isFollowing = followedUserIds.includes(user.id);
                return (
                  <div
                    key={user.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#070B20]/75 p-3 transition-colors hover:border-[#B84DFF]/40"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Avatar
                        src={user.avatar}
                        alt={user.username}
                        size="sm"
                        accent={isFollowing ? 'cyan' : 'none'}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{user.username}</p>
                        <p className="truncate text-xs text-slate-400">{user.handle}</p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => onToggleFollow(user.id)}
                      className={`flex min-h-[36px] shrink-0 items-center gap-1 rounded-xl px-3 py-1 text-xs font-semibold transition-all ${
                        isFollowing
                          ? 'border border-[#00FF87]/45 bg-[#00FF87]/15 text-[#00FF87]'
                          : 'neon-btn-primary'
                      }`}
                    >
                      {isFollowing ? (
                        <>
                          <UserCheck className="h-3.5 w-3.5" />
                          <span>Following</span>
                        </>
                      ) : (
                        <>
                          <UserPlus className="h-3.5 w-3.5" />
                          <span>Follow</span>
                        </>
                      )}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
