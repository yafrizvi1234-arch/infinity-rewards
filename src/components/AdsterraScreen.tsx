import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  BarChart3,
  Calendar,
  CheckCircle2,
  Coins,
  ExternalLink,
  Filter,
  Globe,
  KeyRound,
  Layers,
  Link2,
  Lock,
  MousePointerClick,
  Percent,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingUp,
  Unplug,
} from 'lucide-react';
import {
  AdsterraBackendStatus,
  AdsterraDatePreset,
  AdsterraIntegrationRecord,
  AdsterraMetricTotals,
  AdsterraStatRow,
  ManagedLink,
  UserPersonalSmartlink,
} from '../types';
import { validateAndNormalizeUrl } from '../utils/urlValidator';

interface AdsterraScreenProps {
  uid: string;
  userEmail: string | null | undefined;
  isAdmin: boolean;
  integration: AdsterraIntegrationRecord | null;
  backendStatus: AdsterraBackendStatus;
  personalSmartlinks: UserPersonalSmartlink[];
  mySubmittedLinks?: ManagedLink[];
  isMulti5Active: boolean;
  hasPendingMultiPayment: boolean;
  onConnectApiKey: (payload: { apiKey: string; verifyWithAdsterra: boolean }) => Promise<void>;
  onSyncOfficialApi: () => Promise<void>;
  onFetchStats: (params: {
    preset: AdsterraDatePreset;
    startDate?: string;
    finishDate?: string;
    domainId?: string;
    placementId?: string;
    country?: string;
  }) => Promise<void>;
  onDisconnectAll: () => Promise<void>;
  onCreatePersonalSmartlink: (payload: {
    title: string;
    rawUrl: string;
    category: string;
  }) => Promise<void>;
  onDeletePersonalSmartlink: (linkId: string) => Promise<void>;
  onPublishToCommunity?: (payload: {
    title: string;
    url: string;
    category: string;
  }) => Promise<void>;
  onOpenProModal: () => void;
}

type BreakdownTab = 'date' | 'placement' | 'domain' | 'country' | 'inventory';

function formatDateTime(ms?: number | null): string {
  if (!ms) return 'Never';
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

function formatUsd(val: number, decimals = 4): string {
  if (!Number.isFinite(val)) return '$0.0000';
  return `$${val.toFixed(decimals)}`;
}

function countryCodeToFlag(code: string): string {
  const clean = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(clean)) return '';
  return String.fromCodePoint(...[...clean].map((ch) => 127397 + ch.charCodeAt(0)));
}

function utcYmd(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const EMPTY_TOTALS: AdsterraMetricTotals = {
  impressions: 0,
  clicks: 0,
  ctr: 0,
  cpm: 0,
  revenue: 0,
  rpc: 0,
};

export const AdsterraScreen: React.FC<AdsterraScreenProps> = ({
  userEmail,
  isAdmin,
  integration,
  backendStatus,
  personalSmartlinks,
  mySubmittedLinks = [],
  isMulti5Active,
  hasPendingMultiPayment,
  onConnectApiKey,
  onSyncOfficialApi,
  onFetchStats,
  onDisconnectAll,
  onCreatePersonalSmartlink,
  onDeletePersonalSmartlink,
  onPublishToCommunity,
  onOpenProModal,
}) => {
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [savingApiKey, setSavingApiKey] = useState(false);
  const [syncingApi, setSyncingApi] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [attachingPlacementId, setAttachingPlacementId] = useState<string | null>(null);
  const [attachUrlInput, setAttachUrlInput] = useState('');
  const [savingAttachedUrl, setSavingAttachedUrl] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Analytics filter states
  const [preset, setPreset] = useState<AdsterraDatePreset>(
    backendStatus.detailedStats?.preset ?? '30d'
  );
  const [customStart, setCustomStart] = useState<string>(
    backendStatus.detailedStats?.startDate ?? utcYmd(-29)
  );
  const [customFinish, setCustomFinish] = useState<string>(
    backendStatus.detailedStats?.finishDate ?? utcYmd(0)
  );
  const [filterDomainId, setFilterDomainId] = useState<string>('');
  const [filterPlacementId, setFilterPlacementId] = useState<string>('');
  const [filterCountry, setFilterCountry] = useState<string>('');
  const [loadingStats, setLoadingStats] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [breakdownTab, setBreakdownTab] = useState<BreakdownTab>('date');

  const [batchIds, setBatchIds] = useState<string[]>([]);
  const [publishingUrl, setPublishingUrl] = useState<string | null>(null);
  const [deletingPersonalId, setDeletingPersonalId] = useState<string | null>(null);

  const hasBackendKey = backendStatus.hasApiKey || Boolean(integration?.hasApiKey);
  const isConnected = integration?.status === 'connected' || hasBackendKey;
  const keyHint = backendStatus.apiKeyHint || integration?.apiKeyHint || '';
  const domainsCount = backendStatus.verifiedDomainsCount || integration?.verifiedDomainsCount || 0;
  const placementsCount =
    backendStatus.verifiedPlacementsCount || integration?.verifiedPlacementsCount || 0;

  const detailedStats = backendStatus.detailedStats ?? null;
  const periods = detailedStats?.periods ?? {
    today: EMPTY_TOTALS,
    yesterday: EMPTY_TOTALS,
    last7d: backendStatus.statsSummary
      ? {
          impressions: backendStatus.statsSummary.impressions,
          clicks: backendStatus.statsSummary.clicks,
          revenue: backendStatus.statsSummary.revenue,
          cpm:
            backendStatus.statsSummary.cpm ??
            (backendStatus.statsSummary.impressions > 0
              ? (backendStatus.statsSummary.revenue / backendStatus.statsSummary.impressions) * 1000
              : 0),
          ctr:
            backendStatus.statsSummary.ctr ??
            (backendStatus.statsSummary.impressions > 0
              ? (backendStatus.statsSummary.clicks / backendStatus.statsSummary.impressions) * 100
              : 0),
          rpc:
            backendStatus.statsSummary.clicks > 0
              ? backendStatus.statsSummary.revenue / backendStatus.statsSummary.clicks
              : 0,
        }
      : EMPTY_TOTALS,
    last30d: EMPTY_TOTALS,
  };

  const activeTotals = detailedStats?.totals ?? periods.last7d;

  useEffect(() => {
    if (detailedStats) {
      setPreset(detailedStats.preset);
      setCustomStart(detailedStats.startDate);
      setCustomFinish(detailedStats.finishDate);
    }
  }, [detailedStats]);

  const hasAutoFetchedRef = useRef(false);

  // Auto-load detailedStats once if user has an older saved API key without detailedStats yet
  useEffect(() => {
    if (!hasBackendKey) {
      hasAutoFetchedRef.current = false;
      return;
    }
    if (!detailedStats && !loadingStats && !hasAutoFetchedRef.current) {
      hasAutoFetchedRef.current = true;
      setLoadingStats(true);
      onFetchStats({ preset: '30d' })
        .catch(() => {
          // Silent fallback; user can manually click Sync Now
        })
        .finally(() => setLoadingStats(false));
    }
  }, [hasBackendKey, detailedStats, loadingStats, onFetchStats]);

  const domainTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of backendStatus.domainsPreview) {
      map.set(d.id, d.title);
    }
    return map;
  }, [backendStatus.domainsPreview]);

  // Unified synced + saved Smartlinks (deduplicated by normalized URL)
  const syncedSmartlinkItems = useMemo(() => {
    const items: Array<{
      id: string;
      title: string;
      url: string;
      meta: string;
      personalId?: string;
    }> = [];
    const seen = new Set<string>();

    const pushUrl = (
      id: string,
      title: string,
      rawUrl: string,
      meta: string,
      personalId?: string
    ) => {
      const check = validateAndNormalizeUrl(rawUrl);
      const key = check.valid && check.normalizedUrl ? check.normalizedUrl : rawUrl.trim();
      if (!key || seen.has(key)) return;
      seen.add(key);
      items.push({ id, title, url: rawUrl.trim(), meta, personalId });
    };

    for (const p of backendStatus.placementsPreview) {
      if (!p.directUrl) continue;
      const domainName = domainTitleById.get(p.domainId) || 'Adsterra API';
      pushUrl(`api_${p.id}`, p.title, p.directUrl, `${domainName} · ID #${p.id}`);
    }

    for (const l of personalSmartlinks) {
      pushUrl(`saved_${l.id}`, l.title, l.url, `${l.domain} · ${l.category}`, l.id);
    }

    if (integration?.smartlinkUrl) {
      pushUrl(
        'primary_smartlink',
        integration.smartlinkTitle || 'Primary Adsterra Smartlink',
        integration.smartlinkUrl,
        'Primary Account Smartlink'
      );
    }

    return items;
  }, [backendStatus.placementsPreview, domainTitleById, integration, personalSmartlinks]);

  useEffect(() => {
    const validIds = new Set(syncedSmartlinkItems.map((l) => l.id));
    setBatchIds((prev) => prev.filter((id) => validIds.has(id)));
  }, [syncedSmartlinkItems]);

  const selectedBatchLinks = useMemo(() => {
    const map = new Map(syncedSmartlinkItems.map((l) => [l.id, l]));
    const picked = batchIds
      .map((id) => map.get(id))
      .filter((item): item is (typeof syncedSmartlinkItems)[number] => Boolean(item));
    if (picked.length > 0) return picked.slice(0, 5);
    return syncedSmartlinkItems.slice(0, 5);
  }, [batchIds, syncedSmartlinkItems]);

  const toggleBatchItem = (id: string) => {
    setBatchIds((prev) => {
      if (prev.includes(id)) return prev.filter((item) => item !== id);
      if (prev.length >= 5) return [...prev.slice(1), id];
      return [...prev, id];
    });
  };

  const findCommunityLink = (rawUrl: string): ManagedLink | undefined => {
    const check = validateAndNormalizeUrl(rawUrl);
    const normalized = check.valid && check.normalizedUrl ? check.normalizedUrl : rawUrl.trim();
    return mySubmittedLinks.find(
      (l) => l.normalizedUrl === normalized || l.url === rawUrl.trim()
    );
  };

  const runStatsQuery = async (
    nextPreset: AdsterraDatePreset,
    overrides?: {
      startDate?: string;
      finishDate?: string;
      domainId?: string;
      placementId?: string;
      country?: string;
    }
  ) => {
    if (!hasBackendKey || loadingStats) return;
    setStatsError(null);
    setLoadingStats(true);
    try {
      await onFetchStats({
        preset: nextPreset,
        startDate: overrides?.startDate ?? (nextPreset === 'custom' ? customStart : undefined),
        finishDate: overrides?.finishDate ?? (nextPreset === 'custom' ? customFinish : undefined),
        domainId: (overrides?.domainId ?? filterDomainId) || undefined,
        placementId: (overrides?.placementId ?? filterPlacementId) || undefined,
        country: (overrides?.country ?? filterCountry) || undefined,
      });
    } catch (err) {
      setStatsError(err instanceof Error ? err.message : 'Failed to load Adsterra stats.');
    } finally {
      setLoadingStats(false);
    }
  };

  const handleSaveApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingApiKey || !apiKeyInput.trim()) return;
    setFeedback(null);
    setSavingApiKey(true);
    try {
      await onConnectApiKey({
        apiKey: apiKeyInput,
        verifyWithAdsterra: true,
      });
      setApiKeyInput('');
      setFeedback({
        type: 'success',
        message: 'Adsterra API connected & full analytics synced.',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to verify API Key.',
      });
    } finally {
      setSavingApiKey(false);
    }
  };

  const handleSyncApi = async () => {
    if (syncingApi) return;
    setFeedback(null);
    setStatsError(null);
    setSyncingApi(true);
    try {
      await onSyncOfficialApi();
      setFeedback({
        type: 'success',
        message: 'Live Adsterra dollars, CPM, CTR, domains & placements synced.',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to sync from Adsterra API.',
      });
    } finally {
      setSyncingApi(false);
    }
  };

  const handleDisconnect = async () => {
    if (disconnecting) return;
    setFeedback(null);
    setDisconnecting(true);
    try {
      await onDisconnectAll();
      setApiKeyInput('');
      setFeedback({
        type: 'success',
        message: 'Adsterra API disconnected.',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to disconnect.',
      });
    } finally {
      setDisconnecting(false);
    }
  };

  const handleBindPlacementUrl = async (placementTitle: string) => {
    if (savingAttachedUrl || !attachUrlInput.trim()) return;
    setFeedback(null);
    setSavingAttachedUrl(true);
    try {
      await onCreatePersonalSmartlink({
        title: placementTitle || 'Adsterra Smartlink',
        rawUrl: attachUrlInput,
        category: 'Other',
      });
      setAttachingPlacementId(null);
      setAttachUrlInput('');
      setFeedback({
        type: 'success',
        message: `Smartlink URL linked for "${placementTitle}".`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Invalid Smartlink URL.',
      });
    } finally {
      setSavingAttachedUrl(false);
    }
  };

  const handlePublishSmartlink = async (payload: {
    title: string;
    url: string;
    category: string;
  }) => {
    if (!onPublishToCommunity || publishingUrl) return;
    setFeedback(null);
    setPublishingUrl(payload.url);
    try {
      await onPublishToCommunity(payload);
      setFeedback({
        type: 'success',
        message: `"${payload.title}" published live to Community Exchange (no approval needed).`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to publish Smartlink.',
      });
    } finally {
      setPublishingUrl(null);
    }
  };

  const handleDeleteSaved = async (personalId: string, title: string) => {
    if (deletingPersonalId) return;
    setFeedback(null);
    setDeletingPersonalId(personalId);
    try {
      await onDeletePersonalSmartlink(personalId);
      setFeedback({
        type: 'success',
        message: `"${title}" removed.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to remove item.',
      });
    } finally {
      setDeletingPersonalId(null);
    }
  };

  const unlinkedPlacements = useMemo(() => {
    const linkedTitles = new Set(syncedSmartlinkItems.map((i) => i.title.toLowerCase()));
    return backendStatus.placementsPreview.filter(
      (p) => !p.directUrl && !linkedTitles.has(p.title.toLowerCase())
    );
  }, [backendStatus.placementsPreview, syncedSmartlinkItems]);

  // Chronological daily chart data (oldest -> newest, up to 30 days)
  const chartDays = useMemo(() => {
    const rows = detailedStats?.byDate ?? [];
    return [...rows].sort((a, b) => a.key.localeCompare(b.key)).slice(-30);
  }, [detailedStats?.byDate]);

  const activeRows: AdsterraStatRow[] = useMemo(() => {
    if (!detailedStats) return [];
    if (breakdownTab === 'date') return detailedStats.byDate;
    if (breakdownTab === 'placement') return detailedStats.byPlacement;
    if (breakdownTab === 'domain') return detailedStats.byDomain;
    if (breakdownTab === 'country') return detailedStats.byCountry;
    return [];
  }, [breakdownTab, detailedStats]);

  return (
    <div className="space-y-6">
      {/* Compact Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold tracking-wide text-[#00FF87]">
            {isAdmin ? 'Admin Personal Publisher' : 'Private Publisher'} · {userEmail}
          </p>
          <h1 className="font-display neon-text-spectrum mt-0.5 text-2xl font-extrabold tracking-tight sm:text-3xl">
            Adsterra Live Dashboard
          </h1>
          <p className="mt-0.5 text-xs text-slate-300">
            Real-time Dollars ($), CPM, CTR, Impressions, Clicks &amp; GEO/Placement analytics via Official API
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold ${
              isConnected
                ? 'border-[#00FF87]/55 bg-[#00FF87]/15 text-[#00FF87]'
                : 'border-white/15 bg-[#070B1E]/80 text-slate-300'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                isConnected ? 'bg-[#00FF87]' : 'bg-slate-500'
              }`}
            />
            <span>{isConnected ? `API Connected (${keyHint || 'Active'})` : 'Not Connected'}</span>
          </span>

          {hasBackendKey && (
            <button
              type="button"
              disabled={syncingApi || loadingStats}
              onClick={() => void handleSyncApi()}
              className="flex min-h-[38px] items-center gap-1.5 rounded-xl border border-[#00F5FF]/45 bg-[#00F5FF]/15 px-3.5 py-1.5 text-xs font-semibold text-[#00F5FF] hover:bg-[#00F5FF]/25 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncingApi || loadingStats ? 'animate-spin' : ''}`} />
              <span>{syncingApi || loadingStats ? 'Syncing...' : 'Refresh All Stats'}</span>
            </button>
          )}

          {isConnected && (
            <button
              type="button"
              disabled={disconnecting}
              onClick={() => void handleDisconnect()}
              className="flex min-h-[38px] items-center gap-1.5 rounded-xl border border-[#FF4D6D]/40 bg-[#FF4D6D]/12 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-[#FF4D6D]/22 disabled:opacity-50"
            >
              <Unplug className="h-3.5 w-3.5" />
              <span>{disconnecting ? 'Disconnecting...' : 'Disconnect'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Period Comparison Strip: Today, Yesterday, Last 7 Days, Last 30 Days */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="neon-card-green rounded-2xl p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-200">Today (USD)</span>
            <Coins className="h-4 w-4 text-[#00FF87]" />
          </div>
          <p className="font-mono-num mt-1.5 text-2xl font-extrabold text-[#00FF87]">
            {hasBackendKey ? formatUsd(periods.today.revenue) : '—'}
          </p>
          <p className="font-mono-num mt-1 text-[11px] text-slate-300">
            {hasBackendKey
              ? `CPM $${periods.today.cpm.toFixed(3)} · CTR ${periods.today.ctr.toFixed(2)}%`
              : 'Connect API to view'}
          </p>
          <p className="font-mono-num mt-0.5 text-[11px] text-slate-400">
            {hasBackendKey
              ? `${periods.today.impressions.toLocaleString()} impr · ${periods.today.clicks.toLocaleString()} clicks`
              : ''}
          </p>
        </div>

        <div className="neon-card-cyan rounded-2xl p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-200">Yesterday (USD)</span>
            <TrendingUp className="h-4 w-4 text-[#00F5FF]" />
          </div>
          <p className="font-mono-num mt-1.5 text-2xl font-extrabold text-[#00F5FF]">
            {hasBackendKey ? formatUsd(periods.yesterday.revenue) : '—'}
          </p>
          <p className="font-mono-num mt-1 text-[11px] text-slate-300">
            {hasBackendKey
              ? `CPM $${periods.yesterday.cpm.toFixed(3)} · CTR ${periods.yesterday.ctr.toFixed(2)}%`
              : 'Connect API to view'}
          </p>
          <p className="font-mono-num mt-0.5 text-[11px] text-slate-400">
            {hasBackendKey
              ? `${periods.yesterday.impressions.toLocaleString()} impr · ${periods.yesterday.clicks.toLocaleString()} clicks`
              : ''}
          </p>
        </div>

        <div className="neon-card-purple rounded-2xl p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-200">Last 7 Days</span>
            <BarChart3 className="h-4 w-4 text-[#C084FC]" />
          </div>
          <p className="font-mono-num mt-1.5 text-2xl font-extrabold text-[#C084FC]">
            {hasBackendKey ? formatUsd(periods.last7d.revenue) : '—'}
          </p>
          <p className="font-mono-num mt-1 text-[11px] text-slate-300">
            {hasBackendKey
              ? `CPM $${periods.last7d.cpm.toFixed(3)} · CTR ${periods.last7d.ctr.toFixed(2)}%`
              : 'Connect API to view'}
          </p>
          <p className="font-mono-num mt-0.5 text-[11px] text-slate-400">
            {hasBackendKey
              ? `${periods.last7d.impressions.toLocaleString()} impr · ${periods.last7d.clicks.toLocaleString()} clicks`
              : ''}
          </p>
        </div>

        <div className="neon-card-amber rounded-2xl p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-200">Last 30 Days</span>
            <Activity className="h-4 w-4 text-[#FFB800]" />
          </div>
          <p className="font-mono-num mt-1.5 text-2xl font-extrabold text-[#FFB800]">
            {hasBackendKey ? formatUsd(periods.last30d.revenue) : '—'}
          </p>
          <p className="font-mono-num mt-1 text-[11px] text-slate-300">
            {hasBackendKey
              ? `CPM $${periods.last30d.cpm.toFixed(3)} · CTR ${periods.last30d.ctr.toFixed(2)}%`
              : 'Connect API to view'}
          </p>
          <p className="font-mono-num mt-0.5 text-[11px] text-slate-400">
            {domainsCount} domains · {placementsCount} placements
          </p>
        </div>
      </div>

      {/* Complete Adsterra Analytics Console (when API connected) */}
      {hasBackendKey && (
        <section
          aria-label="Full Adsterra Analytics"
          className="neon-prism-panel rounded-3xl p-5 sm:p-6 space-y-5"
        >
          {/* Range Preset Pills & Filters */}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 flex items-center gap-1.5 text-xs font-bold text-[#00F5FF]">
                <Calendar className="h-3.5 w-3.5" />
                <span>Range:</span>
              </span>
              {(
                [
                  { id: 'today', label: 'Today' },
                  { id: 'yesterday', label: 'Yesterday' },
                  { id: '7d', label: '7 Days' },
                  { id: '30d', label: '30 Days' },
                  { id: 'custom', label: 'Custom' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={loadingStats}
                  onClick={() => {
                    setPreset(item.id);
                    if (item.id !== 'custom') {
                      void runStatsQuery(item.id);
                    }
                  }}
                  className={`min-h-[34px] rounded-xl px-3 py-1 text-xs font-semibold transition-all whitespace-nowrap ${
                    preset === item.id
                      ? 'border border-[#00F5FF]/60 bg-[#00F5FF]/20 text-white shadow-[0_0_12px_-4px_rgba(0,245,255,0.5)]'
                      : 'border border-white/10 bg-[#070B20]/75 text-slate-300 hover:border-white/25 hover:text-white'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
              <span className="font-mono-num rounded-lg border border-white/10 bg-[#050817]/80 px-2.5 py-1 text-[#00FF87]">
                {detailedStats ? `${detailedStats.startDate} → ${detailedStats.finishDate}` : 'UTC'}
              </span>
              <span className="text-slate-400">
                Synced: {formatDateTime(detailedStats?.fetchedAtMs ?? backendStatus.lastSyncedAtMs)}
              </span>
            </div>
          </div>

          {/* Filter Bar: Custom Dates + Domain + Placement + Country */}
          <div className="grid grid-cols-1 gap-2.5 rounded-2xl border border-white/10 bg-[#050817]/75 p-3 sm:grid-cols-2 lg:grid-cols-12">
            {preset === 'custom' && (
              <>
                <div className="lg:col-span-2">
                  <label className="mb-1 block text-[11px] text-slate-400">Start Date</label>
                  <input
                    type="date"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                    className="font-mono-num min-h-[38px] w-full rounded-xl border border-white/15 bg-[#070B20] px-2.5 text-xs text-white focus:border-[#00F5FF] focus:outline-none"
                  />
                </div>
                <div className="lg:col-span-2">
                  <label className="mb-1 block text-[11px] text-slate-400">End Date</label>
                  <input
                    type="date"
                    value={customFinish}
                    onChange={(e) => setCustomFinish(e.target.value)}
                    className="font-mono-num min-h-[38px] w-full rounded-xl border border-white/15 bg-[#070B20] px-2.5 text-xs text-white focus:border-[#00F5FF] focus:outline-none"
                  />
                </div>
              </>
            )}

            <div className={preset === 'custom' ? 'lg:col-span-3' : 'lg:col-span-4'}>
              <label className="mb-1 flex items-center gap-1 text-[11px] text-slate-400">
                <Globe className="h-3 w-3 text-[#3B82F6]" />
                <span>Filter by Domain</span>
              </label>
              <select
                value={filterDomainId}
                onChange={(e) => setFilterDomainId(e.target.value)}
                className="min-h-[38px] w-full rounded-xl border border-white/15 bg-[#070B20] px-2.5 text-xs text-white focus:border-[#3B82F6] focus:outline-none"
              >
                <option value="">All Domains ({backendStatus.domainsPreview.length})</option>
                {backendStatus.domainsPreview.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title} (#{d.id})
                  </option>
                ))}
              </select>
            </div>

            <div className={preset === 'custom' ? 'lg:col-span-3' : 'lg:col-span-4'}>
              <label className="mb-1 flex items-center gap-1 text-[11px] text-slate-400">
                <Layers className="h-3 w-3 text-[#B84DFF]" />
                <span>Filter by Placement / Smartlink</span>
              </label>
              <select
                value={filterPlacementId}
                onChange={(e) => setFilterPlacementId(e.target.value)}
                className="min-h-[38px] w-full rounded-xl border border-white/15 bg-[#070B20] px-2.5 text-xs text-white focus:border-[#B84DFF] focus:outline-none"
              >
                <option value="">
                  All Placements ({backendStatus.placementsPreview.length})
                </option>
                {backendStatus.placementsPreview.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} (#{p.id})
                  </option>
                ))}
              </select>
            </div>

            <div className="lg:col-span-2">
              <label className="mb-1 flex items-center gap-1 text-[11px] text-slate-400">
                <Filter className="h-3 w-3 text-[#FF2E93]" />
                <span>GEO (ISO)</span>
              </label>
              <input
                type="text"
                maxLength={2}
                value={filterCountry}
                onChange={(e) => setFilterCountry(e.target.value.toUpperCase())}
                placeholder="e.g. US, BD"
                className="font-mono-num min-h-[38px] w-full rounded-xl border border-white/15 bg-[#070B20] px-2.5 text-xs uppercase text-white placeholder:normal-case placeholder:text-slate-500 focus:border-[#FF2E93] focus:outline-none"
              />
            </div>

            <div className="flex items-end lg:col-span-2">
              <button
                type="button"
                disabled={loadingStats}
                onClick={() => void runStatsQuery(preset)}
                className="neon-btn-primary flex min-h-[38px] w-full items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loadingStats ? 'animate-spin' : ''}`} />
                <span>{loadingStats ? 'Loading...' : 'Apply Filter'}</span>
              </button>
            </div>
          </div>

          {statsError && (
            <div
              role="alert"
              className="rounded-xl border border-[#FF4D6D]/45 bg-[#FF2E93]/10 px-3.5 py-2.5 text-xs text-rose-200"
            >
              {statsError}
            </div>
          )}

          {/* 6 Complete Live Metrics for Selected Range */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div className="neon-card-green rounded-2xl p-3.5">
              <div className="flex items-center justify-between text-[11px] text-slate-300">
                <span>Dollars (Revenue)</span>
                <Coins className="h-3.5 w-3.5 text-[#00FF87]" />
              </div>
              <p className="font-mono-num mt-1.5 text-xl font-extrabold text-[#00FF87]">
                {formatUsd(activeTotals.revenue)}
              </p>
              <p className="mt-0.5 text-[10px] text-slate-400">Net Earnings</p>
            </div>

            <div className="neon-card-cyan rounded-2xl p-3.5">
              <div className="flex items-center justify-between text-[11px] text-slate-300">
                <span>CPM (eCPM)</span>
                <TrendingUp className="h-3.5 w-3.5 text-[#00F5FF]" />
              </div>
              <p className="font-mono-num mt-1.5 text-xl font-extrabold text-[#00F5FF]">
                {formatUsd(activeTotals.cpm, 3)}
              </p>
              <p className="mt-0.5 text-[10px] text-slate-400">Per 1,000 Impr.</p>
            </div>

            <div className="neon-card-pink rounded-2xl p-3.5">
              <div className="flex items-center justify-between text-[11px] text-slate-300">
                <span>CTR (Rate)</span>
                <Percent className="h-3.5 w-3.5 text-[#FF2E93]" />
              </div>
              <p className="font-mono-num mt-1.5 text-xl font-extrabold text-[#FF2E93]">
                {activeTotals.ctr.toFixed(2)}%
              </p>
              <p className="mt-0.5 text-[10px] text-slate-400">Clicks / Impr.</p>
            </div>

            <div className="neon-card-blue rounded-2xl p-3.5">
              <div className="flex items-center justify-between text-[11px] text-slate-300">
                <span>Impressions</span>
                <Activity className="h-3.5 w-3.5 text-[#60A5FA]" />
              </div>
              <p className="font-mono-num mt-1.5 text-xl font-extrabold text-[#60A5FA]">
                {activeTotals.impressions.toLocaleString()}
              </p>
              <p className="mt-0.5 text-[10px] text-slate-400">Verified Views</p>
            </div>

            <div className="neon-card-purple rounded-2xl p-3.5">
              <div className="flex items-center justify-between text-[11px] text-slate-300">
                <span>Clicks</span>
                <MousePointerClick className="h-3.5 w-3.5 text-[#C084FC]" />
              </div>
              <p className="font-mono-num mt-1.5 text-xl font-extrabold text-[#C084FC]">
                {activeTotals.clicks.toLocaleString()}
              </p>
              <p className="mt-0.5 text-[10px] text-slate-400">Ad Interactions</p>
            </div>

            <div className="neon-card-amber rounded-2xl p-3.5">
              <div className="flex items-center justify-between text-[11px] text-slate-300">
                <span>Avg CPC / RPC</span>
                <BarChart3 className="h-3.5 w-3.5 text-[#FFB800]" />
              </div>
              <p className="font-mono-num mt-1.5 text-xl font-extrabold text-[#FFB800]">
                {formatUsd(activeTotals.rpc)}
              </p>
              <p className="mt-0.5 text-[10px] text-slate-400">Per Click Earn</p>
            </div>
          </div>

          {/* Daily Revenue & CPM SVG Spark-Bar Visualization */}
          {chartDays.length > 0 && (
            <div className="rounded-2xl border border-[#00F5FF]/20 bg-[#050817]/80 p-4 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-display font-bold text-white">
                  Daily Revenue &amp; CPM Trend ({chartDays.length}d)
                </span>
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="flex items-center gap-1 text-[#00FF87]">
                    <span className="h-2 w-2 rounded-full bg-[#00FF87]" /> Revenue ($)
                  </span>
                  <span className="flex items-center gap-1 text-[#00F5FF]">
                    <span className="h-2 w-2 rounded-full bg-[#00F5FF]" /> CPM ($)
                  </span>
                </div>
              </div>

              {(() => {
                const maxRev = Math.max(0.0001, ...chartDays.map((d) => d.revenue));
                const maxCpm = Math.max(0.001, ...chartDays.map((d) => d.cpm));
                const svgWidth = Math.max(320, chartDays.length * 24);
                const chartHeight = 96;
                const barWidth = Math.max(8, Math.floor((svgWidth - 16) / chartDays.length) - 4);

                const cpmPoints = chartDays
                  .map((d, idx) => {
                    const x = 8 + idx * ((svgWidth - 16) / chartDays.length) + barWidth / 2;
                    const y = chartHeight - 8 - (d.cpm / maxCpm) * (chartHeight - 20);
                    return `${x.toFixed(1)},${y.toFixed(1)}`;
                  })
                  .join(' ');

                return (
                  <div className="overflow-x-auto no-scrollbar">
                    <svg
                      viewBox={`0 0 ${svgWidth} ${chartHeight}`}
                      className="h-28 w-full min-w-[320px]"
                      role="img"
                      aria-label="Daily Adsterra revenue and CPM chart"
                    >
                      <defs>
                        <linearGradient id="neonBarGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#00FF87" stopOpacity="0.95" />
                          <stop offset="60%" stopColor="#00F5FF" stopOpacity="0.65" />
                          <stop offset="100%" stopColor="#B84DFF" stopOpacity="0.3" />
                        </linearGradient>
                      </defs>

                      {chartDays.map((d, idx) => {
                        const slot = (svgWidth - 16) / chartDays.length;
                        const x = 8 + idx * slot;
                        const h = Math.max(3, (d.revenue / maxRev) * (chartHeight - 22));
                        const y = chartHeight - 6 - h;
                        return (
                          <g key={d.key}>
                            <rect
                              x={x}
                              y={y}
                              width={barWidth}
                              height={h}
                              rx={3}
                              fill="url(#neonBarGrad)"
                            >
                              <title>
                                {`${d.key}: Revenue ${formatUsd(d.revenue)} · CPM ${formatUsd(d.cpm, 3)} · CTR ${d.ctr.toFixed(2)}% · ${d.impressions.toLocaleString()} impr`}
                              </title>
                            </rect>
                          </g>
                        );
                      })}

                      {chartDays.length > 1 && (
                        <polyline
                          fill="none"
                          stroke="#00F5FF"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          points={cpmPoints}
                        />
                      )}
                    </svg>
                    <div className="flex justify-between text-[10px] font-mono-num text-slate-400">
                      <span>{chartDays[0]?.key}</span>
                      <span>Peak Day: {formatUsd(maxRev)}</span>
                      <span>{chartDays[chartDays.length - 1]?.key}</span>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Breakdown Tabs: Date / Placements / Domains / Countries / Inventory */}
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5 rounded-2xl border border-[#B84DFF]/25 bg-[#050817]/80 p-1.5">
              {(
                [
                  { id: 'date', label: `Daily (${detailedStats?.byDate.length ?? 0})` },
                  {
                    id: 'placement',
                    label: `Placements / Smartlinks (${detailedStats?.byPlacement.length ?? 0})`,
                  },
                  { id: 'domain', label: `Domains (${detailedStats?.byDomain.length ?? 0})` },
                  { id: 'country', label: `Countries (${detailedStats?.byCountry.length ?? 0})` },
                  {
                    id: 'inventory',
                    label: `Zones & Domains (${domainsCount}/${placementsCount})`,
                  },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setBreakdownTab(tab.id)}
                  className={`min-h-[36px] rounded-xl px-3 py-1.5 text-xs font-semibold transition-all whitespace-nowrap ${
                    breakdownTab === tab.id
                      ? 'border border-[#B84DFF]/60 bg-gradient-to-r from-[#00F5FF]/20 via-[#B84DFF]/25 to-[#FF2E93]/20 text-white shadow-[0_0_12px_-4px_rgba(184,77,255,0.5)]'
                      : 'border border-transparent text-slate-400 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {breakdownTab === 'inventory' ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-[#070B20]/75 p-4 space-y-2.5">
                  <h3 className="font-display text-sm font-bold text-[#00F5FF]">
                    Connected Domains ({backendStatus.domainsPreview.length})
                  </h3>
                  {backendStatus.domainsPreview.length === 0 ? (
                    <p className="text-xs text-slate-400">No domains returned by Adsterra API.</p>
                  ) : (
                    <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                      {backendStatus.domainsPreview.map((d) => (
                        <div
                          key={d.id}
                          className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#050817]/80 px-3 py-2 text-xs"
                        >
                          <span className="truncate font-semibold text-white">{d.title}</span>
                          <span className="font-mono-num shrink-0 text-[#60A5FA]">ID #{d.id}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-white/10 bg-[#070B20]/75 p-4 space-y-2.5">
                  <h3 className="font-display text-sm font-bold text-[#C084FC]">
                    All Placements / Ad Units ({backendStatus.placementsPreview.length})
                  </h3>
                  {backendStatus.placementsPreview.length === 0 ? (
                    <p className="text-xs text-slate-400">
                      No placements returned by Adsterra API.
                    </p>
                  ) : (
                    <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                      {backendStatus.placementsPreview.map((p) => (
                        <div
                          key={p.id}
                          className="rounded-xl border border-white/10 bg-[#050817]/80 px-3 py-2 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-semibold text-white">{p.title}</span>
                            <span className="font-mono-num shrink-0 text-[#00FF87]">#{p.id}</span>
                          </div>
                          <p className="mt-0.5 text-[11px] text-slate-400">
                            {domainTitleById.get(p.domainId) || `Domain #${p.domainId}`}
                            {p.type ? ` · ${p.type}` : ''}
                            {p.status ? ` · ${p.status}` : ''}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : activeRows.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-[#070B20]/65 p-6 text-center text-xs text-slate-400">
                No statistics rows returned by Adsterra for the selected date range &amp; filters yet.
                Once impressions or clicks register in Adsterra, full CPM, CTR, and dollar earnings
                will appear here automatically.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-white/12 bg-[#070B20]/75">
                <table className="w-full min-w-[600px] border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/10 bg-[#050817]/90 text-[11px] uppercase tracking-wide text-slate-400">
                      <th className="px-4 py-3 font-semibold">
                        {breakdownTab === 'date'
                          ? 'Date'
                          : breakdownTab === 'placement'
                            ? 'Placement / Smartlink'
                            : breakdownTab === 'domain'
                              ? 'Domain'
                              : 'Country (GEO)'}
                      </th>
                      <th className="px-3 py-3 text-right font-semibold text-[#60A5FA]">
                        Impressions
                      </th>
                      <th className="px-3 py-3 text-right font-semibold text-[#C084FC]">Clicks</th>
                      <th className="px-3 py-3 text-right font-semibold text-[#FF2E93]">CTR</th>
                      <th className="px-3 py-3 text-right font-semibold text-[#00F5FF]">CPM</th>
                      <th className="px-4 py-3 text-right font-semibold text-[#00FF87]">
                        Revenue ($)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {activeRows.map((row) => {
                      const flag = breakdownTab === 'country' ? countryCodeToFlag(row.label) : '';
                      return (
                        <tr
                          key={row.key}
                          className="transition-colors hover:bg-[#00F5FF]/[0.05]"
                        >
                          <td className="px-4 py-3">
                            <p className="font-semibold text-white">
                              {flag ? `${flag} ` : ''}
                              {row.label}
                            </p>
                            {row.sublabel && (
                              <p className="text-[11px] text-slate-400">{row.sublabel}</p>
                            )}
                          </td>
                          <td className="font-mono-num px-3 py-3 text-right text-slate-200">
                            {row.impressions.toLocaleString()}
                          </td>
                          <td className="font-mono-num px-3 py-3 text-right text-slate-200">
                            {row.clicks.toLocaleString()}
                          </td>
                          <td className="font-mono-num px-3 py-3 text-right font-semibold text-[#FF9AD0]">
                            {row.ctr.toFixed(2)}%
                          </td>
                          <td className="font-mono-num px-3 py-3 text-right font-semibold text-[#00F5FF]">
                            {formatUsd(row.cpm, 3)}
                          </td>
                          <td className="font-mono-num px-4 py-3 text-right font-extrabold text-[#00FF87]">
                            {formatUsd(row.revenue)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}

      {/* 1. API Token Connection */}
      <section className="glass-panel rounded-3xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <KeyRound className="h-5 w-5 text-[#00FF87]" />
            <div>
              <h2 className="font-display text-base font-bold text-white sm:text-lg">
                Connect Adsterra API
              </h2>
              <p className="text-xs text-slate-300">
                Adsterra Dashboard → Settings → API Token
              </p>
            </div>
          </div>

          {hasBackendKey && (
            <button
              type="button"
              disabled={syncingApi}
              onClick={() => void handleSyncApi()}
              className="flex min-h-[38px] items-center gap-1.5 rounded-xl border border-[#00F5FF]/45 bg-[#00F5FF]/15 px-3.5 py-1.5 text-xs font-semibold text-[#67E8F9] hover:bg-[#00F5FF]/25 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncingApi ? 'animate-spin' : ''}`} />
              <span>{syncingApi ? 'Syncing...' : 'Sync Now'}</span>
            </button>
          )}
        </div>

        <form onSubmit={handleSaveApiKey} className="flex flex-col gap-2.5 sm:flex-row">
          <input
            type="password"
            autoComplete="off"
            maxLength={200}
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            placeholder={
              hasBackendKey
                ? `Connected (${keyHint}) — paste new token to update`
                : 'Paste your Adsterra API Token...'
            }
            className="font-mono-num min-h-[44px] flex-1 rounded-xl border border-[#00F5FF]/25 bg-[#050817]/90 px-3.5 py-2 text-xs text-white placeholder:text-slate-400 focus:border-[#00FF87] focus:outline-none"
          />
          <button
            type="submit"
            disabled={savingApiKey || !apiKeyInput.trim()}
            className="neon-btn-emerald flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-xl px-5 py-2 text-xs font-extrabold disabled:opacity-50"
          >
            <ShieldCheck className="h-4 w-4" />
            <span>{savingApiKey ? 'Connecting...' : 'Verify & Connect'}</span>
          </button>
        </form>

        {backendStatus.domainsPreview.length > 0 && (
          <p className="text-xs text-slate-400">
            Domains:{' '}
            <span className="text-slate-200">
              {backendStatus.domainsPreview.map((d) => d.title).join(' · ')}
            </span>
          </p>
        )}

        {feedback && (
          <div
            role="status"
            className={`rounded-xl border px-3.5 py-2.5 text-xs ${
              feedback.type === 'success'
                ? 'border-[#00FF87]/45 bg-[#00FF87]/10 text-[#00FF87]'
                : 'border-[#FF4D6D]/45 bg-[#FF2E93]/10 text-rose-200'
            }`}
          >
            {feedback.message}
          </div>
        )}
      </section>

      {/* 2. Synced Smartlinks & Community Exchange Publishing */}
      <section className="glass-panel rounded-3xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-bold text-white sm:text-lg">
              My Adsterra Smartlinks ({syncedSmartlinkItems.length})
            </h2>
            <p className="text-xs text-slate-400">
              Publish Smartlinks to Community Exchange so other real members visit them from their devices
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onOpenProModal}
              className={`flex min-h-[38px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold ${
                isMulti5Active
                  ? 'border-[#00F5FF]/45 bg-[#00F5FF]/15 text-[#00F5FF]'
                  : 'border-[#B84DFF]/45 bg-[#B84DFF]/15 text-[#E8C5FF] hover:bg-[#B84DFF]/25'
              }`}
            >
              {isMulti5Active ? <Sparkles className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
              <span>
                {isMulti5Active
                  ? `Multi (5) Active · ${selectedBatchLinks.length}/5`
                  : hasPendingMultiPayment
                    ? 'Multi (5) Pending'
                    : 'Unlock Multi (5) — 50 BDT'}
              </span>
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-[#00FF87]/30 bg-[#00FF87]/8 px-4 py-2.5 text-xs text-slate-200">
          <span className="font-bold text-[#00FF87]">Mutual Exchange Active:</span> Your own Smartlinks are hidden from your own Auto-Visit queue so you never self-click. Click <span className="font-bold text-white">Publish to Community</span> so other members visit your Smartlinks from their devices while you visit theirs.
        </div>

        {/* Ready Smartlinks List */}
        {syncedSmartlinkItems.length === 0 && unlinkedPlacements.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-[#070B20]/65 p-6 text-center text-xs text-slate-400">
            {hasBackendKey
              ? 'No placements synced yet. Tap "Sync Now" above after creating a Smartlink in Adsterra.'
              : 'Connect your Adsterra API Token above to load your Smartlinks and full stats automatically.'}
          </div>
        ) : (
          <div className="space-y-2.5">
            {syncedSmartlinkItems.map((item) => {
              const communityMatch = findCommunityLink(item.url);
              const isPublishingThis = publishingUrl === item.url;
              const inBatch = selectedBatchLinks.some((b) => b.id === item.id);

              return (
                <div
                  key={item.id}
                  className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#070B20]/75 p-4 transition-colors hover:border-[#00F5FF]/40 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display truncate text-sm font-bold text-white">
                        {item.title}
                      </h3>
                      {communityMatch && (
                        <span
                          className={`text-[11px] font-semibold ${
                            communityMatch.status === 'rejected'
                              ? 'text-[#FF4D6D]'
                              : 'text-[#00FF87]'
                          }`}
                        >
                          · {communityMatch.status === 'rejected' ? 'Rejected' : 'Live in Community'}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-slate-400">
                      {item.meta} · {item.url}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {onPublishToCommunity && !communityMatch && (
                      <button
                        type="button"
                        disabled={isPublishingThis}
                        onClick={() =>
                          void handlePublishSmartlink({
                            title: item.title,
                            url: item.url,
                            category: 'Other',
                          })
                        }
                        className="flex min-h-[36px] items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#B84DFF] to-[#00F5FF] px-3 py-1 text-xs font-bold text-white hover:opacity-95 disabled:opacity-50"
                      >
                        <Globe className="h-3.5 w-3.5" />
                        <span>{isPublishingThis ? 'Publishing...' : 'Publish to Community'}</span>
                      </button>
                    )}

                    {isMulti5Active && (
                      <button
                        type="button"
                        onClick={() => toggleBatchItem(item.id)}
                        className={`flex min-h-[36px] items-center rounded-xl border px-2.5 py-1 text-xs font-semibold ${
                          inBatch
                            ? 'border-[#FF2E93]/55 bg-[#FF2E93]/20 text-[#FF9AD0]'
                            : 'border-white/15 bg-white/5 text-slate-300 hover:bg-white/10'
                        }`}
                      >
                        {inBatch ? 'In Batch' : '+ Batch'}
                      </button>
                    )}

                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-h-[36px] items-center gap-1.5 rounded-xl border border-[#00F5FF]/40 bg-[#00F5FF]/15 px-3 py-1 text-xs font-semibold text-[#00F5FF] hover:bg-[#00F5FF]/25"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      <span>Open</span>
                    </a>

                    {item.personalId && (
                      <button
                        type="button"
                        disabled={deletingPersonalId === item.personalId}
                        onClick={() => void handleDeleteSaved(item.personalId!, item.title)}
                        aria-label={`Remove ${item.title}`}
                        className="flex min-h-[36px] items-center rounded-xl border border-[#FF4D6D]/30 bg-[#FF2E93]/10 px-2.5 py-1 text-xs text-[#FF9AD0] hover:bg-[#FF2E93]/20 disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Placements returned by Adsterra placements.json that omit a direct URL */}
            {unlinkedPlacements.map((p) => {
              const domainName = domainTitleById.get(p.domainId);
              const isAttaching = attachingPlacementId === p.id;
              return (
                <div
                  key={p.id}
                  className="rounded-2xl border border-white/10 bg-[#070B20]/65 p-4 space-y-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-white">{p.title}</p>
                      <p className="text-xs text-slate-400">
                        ID #{p.id}
                        {domainName ? ` · ${domainName}` : ''}
                        {p.type ? ` · ${p.type}` : ''}
                        {p.status ? ` · ${p.status}` : ''}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setAttachingPlacementId(isAttaching ? null : p.id);
                        setAttachUrlInput('');
                      }}
                      className="flex min-h-[36px] items-center gap-1.5 rounded-xl border border-[#00F5FF]/40 bg-[#00F5FF]/15 px-3 py-1 text-xs font-semibold text-[#00F5FF] hover:bg-[#00F5FF]/25"
                    >
                      <Link2 className="h-3.5 w-3.5" />
                      <span>{isAttaching ? 'Close' : 'Link URL'}</span>
                    </button>
                  </div>

                  {isAttaching && (
                    <div className="flex flex-col gap-2 border-t border-white/10 pt-2.5 sm:flex-row">
                      <input
                        type="url"
                        value={attachUrlInput}
                        onChange={(e) => setAttachUrlInput(e.target.value)}
                        placeholder={`Paste Adsterra URL for "${p.title}"...`}
                        className="min-h-[40px] flex-1 rounded-xl border border-white/15 bg-[#050817]/85 px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-[#00F5FF] focus:outline-none"
                      />
                      <button
                        type="button"
                        disabled={savingAttachedUrl || !attachUrlInput.trim()}
                        onClick={() => void handleBindPlacementUrl(p.title)}
                        className="neon-btn-emerald min-h-[40px] rounded-xl px-4 py-1.5 text-xs font-bold disabled:opacity-50"
                      >
                        {savingAttachedUrl ? 'Saving...' : 'Save URL'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Active Multi (5) Batch Quick Launcher */}
        {isMulti5Active && selectedBatchLinks.length > 0 && (
          <div className="neon-card-purple rounded-2xl p-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-[#E8C5FF]">
                Multi (5) Batch ({selectedBatchLinks.length}/5)
              </span>
              <span className="text-slate-300">Manual open</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedBatchLinks.map((item, idx) => (
                <a
                  key={item.id}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[34px] items-center gap-1.5 rounded-xl border border-[#00F5FF]/35 bg-[#050817]/80 px-3 py-1 text-xs font-semibold text-[#00F5FF] hover:bg-[#00F5FF]/15"
                >
                  <span className="font-mono-num text-[#C084FC]">{idx + 1}.</span>
                  <span className="max-w-[160px] truncate text-white">{item.title}</span>
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              ))}
            </div>
          </div>
        )}
      </section>

      <p className="flex items-center gap-2 px-1 text-xs text-slate-400">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#00FF87]" />
        <span>
          Encrypted per-user API vault · Official Adsterra Publisher API v3 stats (USD, CPM, CTR, GEO, Placements &amp; Domains)
        </span>
      </p>
    </div>
  );
};
