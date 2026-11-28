import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import * as repo from './src/db/repository.ts';
import {
  ADMIN_EMAIL,
  type AuthRequest,
  requireAdmin,
  requireAuth,
} from './src/middleware/auth.ts';

interface PlacementPreviewItem {
  id: string;
  domainId: string;
  title: string;
  type?: string;
  status?: string;
  directUrl?: string;
}

interface StatsSummary {
  startDate: string;
  finishDate: string;
  impressions: number;
  clicks: number;
  revenue: number;
  cpm?: number;
  ctr?: number;
}

type AdsterraDatePreset = 'today' | 'yesterday' | '7d' | '30d' | 'custom';

interface AdsterraMetricTotals {
  impressions: number;
  clicks: number;
  ctr: number;
  cpm: number;
  revenue: number;
  rpc: number;
}

interface AdsterraStatRow extends AdsterraMetricTotals {
  key: string;
  label: string;
  sublabel?: string;
}

interface AdsterraDetailedStats {
  startDate: string;
  finishDate: string;
  preset: AdsterraDatePreset;
  totals: AdsterraMetricTotals;
  periods: {
    today: AdsterraMetricTotals;
    yesterday: AdsterraMetricTotals;
    last7d: AdsterraMetricTotals;
    last30d: AdsterraMetricTotals;
  };
  byDate: AdsterraStatRow[];
  byPlacement: AdsterraStatRow[];
  byDomain: AdsterraStatRow[];
  byCountry: AdsterraStatRow[];
  fetchedAtMs: number;
}

interface VaultSafeInput {
  keyHint: string;
  apiVerified: boolean;
  verifiedDomainsCount: number;
  verifiedPlacementsCount: number;
  domainsPreview: Array<{ id: string; title: string }>;
  placementsPreview: PlacementPreviewItem[];
  statsSummary?: Record<string, unknown> | null;
  detailedStats?: Record<string, unknown> | null;
  lastSyncedAtMs: number | null;
}

const ROOT_DIR = process.cwd();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(ROOT_DIR, '.data');
const MASTER_KEY_FILE = path.join(DATA_DIR, '.master.key');
const ADSTERRA_API_BASE = 'https://api3.adsterratools.com/publisher';

let fallbackEphemeralKey: Buffer | null = null;

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  }
}

function getEncryptionKey(): Buffer {
  const envMaster = process.env.ADSTERRA_SECRET_MASTER_KEY?.trim();
  if (envMaster && envMaster.length >= 16) {
    return crypto.createHash('sha256').update(envMaster).digest();
  }
  try {
    ensureDataDir();
    if (fs.existsSync(MASTER_KEY_FILE)) {
      const existingHex = fs.readFileSync(MASTER_KEY_FILE, 'utf8').trim();
      if (/^[a-f0-9]{64}$/i.test(existingHex)) {
        return Buffer.from(existingHex, 'hex');
      }
    }
    const generated = crypto.randomBytes(32);
    fs.writeFileSync(MASTER_KEY_FILE, generated.toString('hex'), { mode: 0o600 });
    return generated;
  } catch {
    if (!fallbackEphemeralKey) {
      fallbackEphemeralKey = crypto.randomBytes(32);
    }
    return fallbackEphemeralKey;
  }
}

function encryptSecret(plaintext: string): { iv: string; authTag: string; ciphertext: string } {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: encrypted.toString('base64'),
  };
}

function decryptSecret(record: { iv: string; authTag: string; ciphertext: string }): string {
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(record.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(record.authTag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

function maskKeyHint(apiKey: string): string {
  const trimmed = apiKey.trim();
  const tail = trimmed.slice(-4);
  return `••••${tail}`;
}

function toSafeStatusPayload(record: VaultSafeInput | null | undefined) {
  if (!record) {
    return {
      backendReachable: true,
      hasApiKey: false,
      apiKeyHint: '',
      apiVerified: false,
      verifiedDomainsCount: 0,
      verifiedPlacementsCount: 0,
      domainsPreview: [] as Array<{ id: string; title: string }>,
      placementsPreview: [] as PlacementPreviewItem[],
      statsSummary: null as StatsSummary | null,
      detailedStats: null as AdsterraDetailedStats | null,
      lastSyncedAtMs: null as number | null,
    };
  }
  return {
    backendReachable: true,
    hasApiKey: true,
    apiKeyHint: record.keyHint,
    apiVerified: record.apiVerified,
    verifiedDomainsCount: record.verifiedDomainsCount,
    verifiedPlacementsCount: record.verifiedPlacementsCount,
    domainsPreview: record.domainsPreview,
    placementsPreview: record.placementsPreview,
    statsSummary: (record.statsSummary as StatsSummary | null) ?? null,
    detailedStats: (record.detailedStats as AdsterraDetailedStats | null) ?? null,
    lastSyncedAtMs: record.lastSyncedAtMs ?? null,
  };
}

function handleRouteError(res: Response, error: unknown, fallbackMessage: string): void {
  if (error instanceof repo.DomainError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  console.error(fallbackMessage, error);
  res.status(500).json({
    error: error instanceof Error ? error.message : fallbackMessage,
  });
}

function formatUtcYmd(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function isValidYmd(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function extractApiItemsArray(json: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(json)) return json as Array<Record<string, unknown>>;
  if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>;
    if (Array.isArray(obj.items)) return obj.items as Array<Record<string, unknown>>;
    if (Array.isArray(obj.result)) return obj.result as Array<Record<string, unknown>>;
    if (Array.isArray(obj.data)) return obj.data as Array<Record<string, unknown>>;
  }
  return [];
}

function normalizeRowMetrics(row: Record<string, unknown>): AdsterraMetricTotals {
  const impressions = Math.max(
    0,
    Number(row.impressions ?? row.impression ?? row.views ?? 0) || 0
  );
  const clicks = Math.max(0, Number(row.clicks ?? row.click ?? 0) || 0);
  const revenue = Math.max(
    0,
    Number(row.revenue ?? row.earning ?? row.earnings ?? row.payout ?? 0) || 0
  );
  const apiCpm = Number(row.cpm ?? row.ecpm ?? NaN);
  const apiCtr = Number(row.ctr ?? NaN);

  const cpm =
    impressions > 0
      ? Number(((revenue / impressions) * 1000).toFixed(4))
      : Number.isFinite(apiCpm)
        ? Number(apiCpm.toFixed(4))
        : 0;
  const ctr =
    impressions > 0
      ? Number(((clicks / impressions) * 100).toFixed(3))
      : Number.isFinite(apiCtr)
        ? Number(apiCtr.toFixed(3))
        : 0;
  const rpc = clicks > 0 ? Number((revenue / clicks).toFixed(5)) : 0;

  return {
    impressions,
    clicks,
    ctr,
    cpm,
    revenue: Number(revenue.toFixed(5)),
    rpc,
  };
}

function aggregateStatTotals(rows: AdsterraMetricTotals[]): AdsterraMetricTotals {
  let impressions = 0;
  let clicks = 0;
  let revenue = 0;
  for (const r of rows) {
    impressions += r.impressions;
    clicks += r.clicks;
    revenue += r.revenue;
  }
  const cpm = impressions > 0 ? Number(((revenue / impressions) * 1000).toFixed(4)) : 0;
  const ctr = impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(3)) : 0;
  const rpc = clicks > 0 ? Number((revenue / clicks).toFixed(5)) : 0;

  return {
    impressions,
    clicks,
    ctr,
    cpm,
    revenue: Number(revenue.toFixed(5)),
    rpc,
  };
}

function normalizeAdsterraGeoCode(raw?: string): string {
  const clean = (raw || '').trim().toUpperCase();
  if (!clean) return '';
  if (clean === 'UK') return 'GB';
  if (clean === 'UAE') return 'AE';
  if (clean === 'USA') return 'US';
  if (clean === 'AUS') return 'AU';
  if (clean === 'CAN') return 'CA';
  return /^[A-Z]{2}$/.test(clean) ? clean : '';
}

async function fetchAdsterraStatsGroup(params: {
  apiKey: string;
  startDate: string;
  finishDate: string;
  groupBy: 'date' | 'placement' | 'domain' | 'country';
  domainId?: string;
  placementId?: string;
  country?: string;
}): Promise<Array<Record<string, unknown>>> {
  const qs = new URLSearchParams({
    start_date: params.startDate,
    finish_date: params.finishDate,
    group_by: params.groupBy,
  });
  if (params.domainId && /^\d+$/.test(params.domainId.trim())) {
    qs.set('domain', params.domainId.trim());
  }
  if (params.placementId && /^\d+$/.test(params.placementId.trim())) {
    qs.set('placement', params.placementId.trim());
  }
  const normalizedCountry = normalizeAdsterraGeoCode(params.country);
  if (normalizedCountry) {
    qs.set('country', normalizedCountry);
  }

  const res = await fetch(`${ADSTERRA_API_BASE}/stats.json?${qs.toString()}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-API-Key': params.apiKey,
    },
    signal: AbortSignal.timeout(9000),
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error('Adsterra Publisher API rejected your API Key while fetching statistics.');
  }
  if (!res.ok) {
    return [];
  }
  const json = await res.json().catch(() => null);
  return extractApiItemsArray(json);
}

async function fetchAdsterraDetailedStats(params: {
  apiKey: string;
  preset: AdsterraDatePreset;
  startDate: string;
  finishDate: string;
  domainId?: string;
  placementId?: string;
  country?: string;
  domainsPreview: Array<{ id: string; title: string }>;
  placementsPreview: PlacementPreviewItem[];
  cachedPeriods?: AdsterraDetailedStats['periods'] | null;
  cachedFetchedAtMs?: number | null;
}): Promise<AdsterraDetailedStats> {
  const domainMap = new Map(params.domainsPreview.map((d) => [d.id, d.title]));
  const placementMap = new Map(params.placementsPreview.map((p) => [p.id, p]));

  const todayYmd = formatUtcYmd(0);
  const yesterdayYmd = formatUtcYmd(-1);
  const last7StartYmd = formatUtcYmd(-6);
  const last30StartYmd = formatUtcYmd(-29);
  const cachedDayYmd = params.cachedFetchedAtMs
    ? new Date(params.cachedFetchedAtMs).toISOString().slice(0, 10)
    : null;
  const hasEntityFilters = Boolean(params.domainId || params.placementId || params.country);

  const shouldRefreshPeriodRollup =
    !hasEntityFilters &&
    (!params.cachedPeriods ||
      cachedDayYmd !== todayYmd ||
      params.preset !== 'custom' ||
      (params.startDate <= last30StartYmd && params.finishDate >= todayYmd));

  const mainCoversLast30Unfiltered =
    !hasEntityFilters &&
    params.startDate <= last30StartYmd &&
    params.finishDate >= todayYmd;

  const [dateRaw, placementRaw, domainRaw, countryRaw, periodDateRaw] = await Promise.all([
    fetchAdsterraStatsGroup({
      apiKey: params.apiKey,
      startDate: params.startDate,
      finishDate: params.finishDate,
      groupBy: 'date',
      domainId: params.domainId,
      placementId: params.placementId,
      country: params.country,
    }),
    fetchAdsterraStatsGroup({
      apiKey: params.apiKey,
      startDate: params.startDate,
      finishDate: params.finishDate,
      groupBy: 'placement',
      domainId: params.domainId,
      placementId: params.placementId,
      country: params.country,
    }),
    fetchAdsterraStatsGroup({
      apiKey: params.apiKey,
      startDate: params.startDate,
      finishDate: params.finishDate,
      groupBy: 'domain',
      domainId: params.domainId,
      placementId: params.placementId,
      country: params.country,
    }),
    fetchAdsterraStatsGroup({
      apiKey: params.apiKey,
      startDate: params.startDate,
      finishDate: params.finishDate,
      groupBy: 'country',
      domainId: params.domainId,
      placementId: params.placementId,
      country: params.country,
    }),
    shouldRefreshPeriodRollup && !mainCoversLast30Unfiltered
      ? fetchAdsterraStatsGroup({
          apiKey: params.apiKey,
          startDate: last30StartYmd,
          finishDate: todayYmd,
          groupBy: 'date',
        })
      : Promise.resolve(null),
  ]);

  const byDate: AdsterraStatRow[] = dateRaw
    .map((row, idx) => {
      const dateStr = String(row.dbDateTime ?? row.date ?? row.day ?? `Day ${idx + 1}`).slice(
        0,
        10
      );
      return {
        key: dateStr,
        label: dateStr,
        ...normalizeRowMetrics(row),
      };
    })
    .sort((a, b) => b.key.localeCompare(a.key));

  const byPlacement: AdsterraStatRow[] = placementRaw
    .map((row, idx) => {
      const pid = String(row.placement_id ?? row.placementId ?? row.placement ?? row.id ?? '').trim();
      const matched = pid ? placementMap.get(pid) : undefined;
      const rawTitle = String(
        row.placement_title ??
          row.title ??
          matched?.title ??
          (pid ? `Placement #${pid}` : `Placement #${idx + 1}`)
      ).slice(0, 80);
      const dTitle = matched?.domainId ? domainMap.get(matched.domainId) : undefined;
      return {
        key: pid || `pl_${idx}`,
        label: rawTitle,
        sublabel: [pid ? `ID #${pid}` : null, matched?.type || null, dTitle || null]
          .filter(Boolean)
          .join(' · '),
        ...normalizeRowMetrics(row),
      };
    })
    .sort((a, b) => b.revenue - a.revenue || b.impressions - a.impressions);

  const byDomain: AdsterraStatRow[] = domainRaw
    .map((row, idx) => {
      const did = String(row.domain_id ?? row.domainId ?? row.domain ?? row.id ?? '').trim();
      const matchedTitle = did ? domainMap.get(did) : undefined;
      const rawTitle = String(
        row.domain_title ?? row.title ?? matchedTitle ?? (did ? `Domain #${did}` : `Domain #${idx + 1}`)
      ).slice(0, 80);
      return {
        key: did || `dom_${idx}`,
        label: rawTitle,
        sublabel: did ? `Domain ID #${did}` : undefined,
        ...normalizeRowMetrics(row),
      };
    })
    .sort((a, b) => b.revenue - a.revenue || b.impressions - a.impressions);

  const byCountry: AdsterraStatRow[] = countryRaw
    .map((row, idx) => {
      const code = String(row.country ?? row.country_code ?? row.geo ?? 'XX')
        .trim()
        .toUpperCase()
        .slice(0, 8);
      return {
        key: code || `geo_${idx}`,
        label: code || 'Unknown',
        ...normalizeRowMetrics(row),
      };
    })
    .sort((a, b) => b.revenue - a.revenue || b.impressions - a.impressions);

  const totals = aggregateStatTotals(
    byDate.length > 0 ? byDate : byPlacement.length > 0 ? byPlacement : byDomain
  );

  let periods: AdsterraDetailedStats['periods'];
  const rollupRowsSource: AdsterraStatRow[] | null =
    periodDateRaw !== null
      ? periodDateRaw.map((row, idx) => {
          const dateStr = String(row.dbDateTime ?? row.date ?? row.day ?? `Day ${idx + 1}`).slice(
            0,
            10
          );
          return { key: dateStr, label: dateStr, ...normalizeRowMetrics(row) };
        })
      : mainCoversLast30Unfiltered
        ? byDate
        : null;

  if (rollupRowsSource) {
    const todayRows = rollupRowsSource.filter((r) => r.key === todayYmd);
    const yesterdayRows = rollupRowsSource.filter((r) => r.key === yesterdayYmd);
    const last7Rows = rollupRowsSource.filter((r) => r.key >= last7StartYmd && r.key <= todayYmd);
    const last30Rows = rollupRowsSource.filter(
      (r) => r.key >= last30StartYmd && r.key <= todayYmd
    );
    periods = {
      today: aggregateStatTotals(todayRows),
      yesterday: aggregateStatTotals(yesterdayRows),
      last7d: aggregateStatTotals(last7Rows),
      last30d: aggregateStatTotals(last30Rows),
    };
  } else if (params.cachedPeriods) {
    periods = params.cachedPeriods;
  } else {
    const emptyTotals: AdsterraMetricTotals = {
      impressions: 0,
      clicks: 0,
      ctr: 0,
      cpm: 0,
      revenue: 0,
      rpc: 0,
    };
    periods = {
      today: emptyTotals,
      yesterday: emptyTotals,
      last7d: emptyTotals,
      last30d: emptyTotals,
    };
  }

  return {
    startDate: params.startDate,
    finishDate: params.finishDate,
    preset: params.preset,
    totals,
    periods,
    byDate,
    byPlacement,
    byDomain,
    byCountry,
    fetchedAtMs: Date.now(),
  };
}

async function fetchAdsterraOfficialSnapshot(apiKey: string): Promise<{
  domainsCount: number;
  placementsCount: number;
  domainsPreview: Array<{ id: string; title: string }>;
  placementsPreview: PlacementPreviewItem[];
  statsSummary: StatsSummary | null;
  detailedStats: AdsterraDetailedStats | null;
}> {
  const headers = {
    Accept: 'application/json',
    'X-API-Key': apiKey,
  };

  const domainsRes = await fetch(`${ADSTERRA_API_BASE}/domains.json`, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(8000),
  });

  if (domainsRes.status === 401 || domainsRes.status === 403) {
    throw new Error(
      'Adsterra Publisher API rejected your API Key (401/403). Verify your token under Adsterra → Settings → API.'
    );
  }
  if (!domainsRes.ok) {
    throw new Error(`Adsterra domains endpoint returned HTTP ${domainsRes.status}.`);
  }

  const domainsJson = await domainsRes.json();
  const domainItems = extractApiItemsArray(domainsJson);

  let placementItems: Array<Record<string, unknown>> = [];
  try {
    const placementsRes = await fetch(`${ADSTERRA_API_BASE}/placements.json`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (placementsRes.ok) {
      const placementsJson = await placementsRes.json();
      placementItems = extractApiItemsArray(placementsJson);
    }
  } catch {
    placementItems = [];
  }

  if (placementItems.length === 0 && domainItems.length > 0) {
    for (const domainItem of domainItems.slice(0, 5)) {
      const domainId = String(domainItem.id ?? '').trim();
      if (!domainId) continue;
      try {
        const domPlacementsRes = await fetch(
          `${ADSTERRA_API_BASE}/domain/${encodeURIComponent(domainId)}/placements.json`,
          {
            method: 'GET',
            headers,
            signal: AbortSignal.timeout(6000),
          }
        );
        if (domPlacementsRes.ok) {
          const domPlacementsJson = await domPlacementsRes.json();
          const items = extractApiItemsArray(domPlacementsJson);
          if (items.length > 0) {
            placementItems.push(...items);
          }
        }
      } catch {
        // Ignore single-domain fallback fetch errors
      }
    }
  }

  const domainsPreview = domainItems.slice(0, 50).map((d) => ({
    id: String(d.id ?? ''),
    title: String(d.title ?? 'Domain').slice(0, 80),
  }));

  const placementsPreview: PlacementPreviewItem[] = placementItems.slice(0, 100).map((p) => {
    const rawCandidate = [
      p.url,
      p.direct_url,
      p.directUrl,
      p.direct_link,
      p.direct_link_url,
      p.directLinkUrl,
      p.smartlink_url,
      p.smartlinkUrl,
      p.smartlink,
      p.smart_link,
      p.link,
      p.link_url,
      p.linkUrl,
      p.target_url,
      p.ad_url,
      p.adUrl,
      p.redirect_url,
      p.redirectUrl,
      p.alias,
    ].find(
      (v) => typeof v === 'string' && /^(https?:)?\/\/[^\s"'<>]+$/i.test(v.trim())
    ) as string | undefined;

    let candidateUrl = rawCandidate
      ? rawCandidate.trim().startsWith('//')
        ? `https:${rawCandidate.trim()}`
        : rawCandidate.trim()
      : undefined;

    if (!candidateUrl) {
      const rawHtml = [p.code, p.snippet, p.html].find((v) => typeof v === 'string') as
        | string
        | undefined;
      if (rawHtml) {
        const hrefMatch = rawHtml.match(/href\s*=\s*["']((?:https?:)?\/\/[^"'\s<>]+)["']/i);
        if (hrefMatch?.[1]) {
          candidateUrl = hrefMatch[1].startsWith('//')
            ? `https:${hrefMatch[1]}`
            : hrefMatch[1];
        }
      }
    }

    return {
      id: String(p.id ?? ''),
      domainId: String(p.domain_id ?? ''),
      title: String(p.title ?? p.alias ?? 'Placement').slice(0, 80),
      ...(typeof p.type === 'string' ? { type: p.type.slice(0, 32) } : {}),
      ...(typeof p.status === 'string' ? { status: p.status.slice(0, 32) } : {}),
      ...(candidateUrl ? { directUrl: candidateUrl.slice(0, 500) } : {}),
    };
  });

  let detailedStats: AdsterraDetailedStats | null = null;
  let statsSummary: StatsSummary | null = null;

  try {
    const finishDate = formatUtcYmd(0);
    const startDate = formatUtcYmd(-29);
    detailedStats = await fetchAdsterraDetailedStats({
      apiKey,
      preset: '30d',
      startDate,
      finishDate,
      domainsPreview,
      placementsPreview,
    });
    const last7 = detailedStats.periods.last7d;
    statsSummary = {
      startDate: formatUtcYmd(-6),
      finishDate,
      impressions: last7.impressions,
      clicks: last7.clicks,
      revenue: Number(last7.revenue.toFixed(4)),
      cpm: last7.cpm,
      ctr: last7.ctr,
    };
  } catch {
    detailedStats = null;
    statsSummary = null;
  }

  return {
    domainsCount: domainItems.length,
    placementsCount: placementItems.length,
    domainsPreview,
    placementsPreview,
    statsSummary,
    detailedStats,
  };
}

function validatePersonalNumber(raw: unknown, channelLabel: string): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (cleaned.length < 6 || cleaned.length > 24 || !/^[0-9+\-\s]{6,24}$/.test(cleaned)) {
    throw new repo.DomainError(
      `${channelLabel} number must be 6 to 24 characters using only digits, spaces, + or -.`
    );
  }
  const digitsOnly = cleaned.replace(/\D/g, '');
  if (digitsOnly.length < 11) {
    throw new repo.DomainError(
      `${channelLabel} number must contain at least 11 digits (e.g. 01XXXXXXXXX).`
    );
  }
  return cleaned;
}

function normalizeAndValidateTxId(raw: unknown): string {
  const normalized = String(raw || '')
    .trim()
    .toUpperCase();
  if (normalized.length < 6 || normalized.length > 40) {
    throw new repo.DomainError('Transaction ID must be between 6 and 40 characters.');
  }
  if (!/^[A-Z0-9_-]+$/.test(normalized)) {
    throw new repo.DomainError(
      'Transaction ID can only contain letters, numbers, hyphens (-), and underscores (_).'
    );
  }
  return normalized;
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  const extraAllowedOrigins = new Set(
    (process.env.ALLOWED_CORS_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    const hostHeader = typeof req.headers.host === 'string' ? req.headers.host : '';
    const isAllowedOrigin =
      Boolean(origin) &&
      (origin === 'https://yafrizvi1234-arch.github.io' ||
        origin === 'https://infinity-rewards-fihc.onrender.com' ||
        (hostHeader &&
          (origin === `https://${hostHeader}` || origin === `http://${hostHeader}`)) ||
        extraAllowedOrigins.has(origin!) ||
        origin!.startsWith('http://localhost:') ||
        origin!.startsWith('http://127.0.0.1:'));

    if (origin && isAllowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,Accept');
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
    }
    next();
  });
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/geo', (req, res) => {
    const rawCountry =
      (req.headers['cf-ipcountry'] as string | undefined) ||
      (req.headers['x-vercel-ip-country'] as string | undefined) ||
      (req.headers['x-country-code'] as string | undefined) ||
      (req.headers['x-country'] as string | undefined) ||
      (req.headers['x-appengine-country'] as string | undefined) ||
      '';
    const normalized = normalizeAdsterraGeoCode(rawCountry);
    const countryCode = normalized && normalized !== 'XX' ? normalized : 'XX';
    const tier1Set = new Set(['US', 'GB', 'AE', 'AU', 'CA', 'UA', 'DE']);
    res.json({
      countryCode,
      isTier1: tier1Set.has(countryCode),
    });
  });

  // ===========================================================================
  // WORKSPACE, PROFILES, FOLLOWS, ACTIVITIES
  // ===========================================================================

  app.post('/api/workspace/bootstrap', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.verifiedUser!;
      const displayName =
        typeof req.body?.displayName === 'string'
          ? req.body.displayName
          : (req.user?.name as string | undefined) ?? null;
      const photoURL =
        typeof req.body?.photoURL === 'string'
          ? req.body.photoURL
          : (req.user?.picture as string | undefined) ?? null;

      const workspace = await repo.bootstrapWorkspace({
        uid: user.uid,
        email: user.email,
        displayName,
        photoURL,
      });
      res.json(workspace);
    } catch (error) {
      handleRouteError(res, error, 'Unable to load workspace.');
    }
  });

  app.get('/api/workspace/profiles', requireAuth, async (_req: AuthRequest, res) => {
    try {
      const profiles = await repo.getPublicProfiles();
      res.json({ profiles });
    } catch (error) {
      handleRouteError(res, error, 'Failed to load public profiles.');
    }
  });

  app.get('/api/workspace/username-check', requireAuth, async (req: AuthRequest, res) => {
    try {
      const rawUsername = typeof req.query.username === 'string' ? req.query.username : '';
      const result = await repo.checkUsernameAvailability(rawUsername, req.verifiedUser!.uid);
      res.json(result);
    } catch (error) {
      handleRouteError(res, error, 'Failed to check username.');
    }
  });

  app.put('/api/workspace/profile', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.verifiedUser!;
      const updated = await repo.updateUserProfile({
        uid: user.uid,
        email: user.email,
        displayName: String(req.body?.displayName || ''),
        username: String(req.body?.username || ''),
        bio: String(req.body?.bio || ''),
        photoURL: String(req.body?.photoURL || ''),
        activeAccent: req.body?.activeAccent,
      });
      res.json(updated);
    } catch (error) {
      handleRouteError(res, error, 'Failed to update profile.');
    }
  });

  app.post('/api/workspace/visit', requireAuth, async (req: AuthRequest, res) => {
    try {
      const result = await repo.recordVerifiedVisit({
        uid: req.verifiedUser!.uid,
        linkId: String(req.body?.linkId || ''),
        title: String(req.body?.title || 'Smartlink'),
        type: String(req.body?.type || 'smartlink'),
        ownerName: String(req.body?.ownerName || 'Member'),
        category: String(req.body?.category || 'Other'),
        points: Number(req.body?.points ?? 10),
      });
      res.json(result);
    } catch (error) {
      handleRouteError(res, error, 'Failed to record visit.');
    }
  });

  app.post('/api/workspace/shop', requireAuth, async (req: AuthRequest, res) => {
    try {
      await repo.unlockShopPerk({
        uid: req.verifiedUser!.uid,
        nextUnlockedIds: req.body?.nextUnlockedIds,
        activeAccent: req.body?.activeAccent,
      });
      res.json({ ok: true });
    } catch (error) {
      handleRouteError(res, error, 'Failed to unlock shop perk.');
    }
  });

  app.post('/api/workspace/follow', requireAuth, async (req: AuthRequest, res) => {
    try {
      await repo.toggleFollow({
        followerUid: req.verifiedUser!.uid,
        followerName: String(req.body?.followerName || 'Member'),
        followerUsername: String(req.body?.followerUsername || '@member'),
        followerAvatar: String(req.body?.followerAvatar || ''),
        targetId: String(req.body?.targetId || ''),
        targetName: String(req.body?.targetName || 'Member'),
        targetUsername: String(req.body?.targetUsername || '@member'),
        targetAvatar: String(req.body?.targetAvatar || ''),
        targetIsRealUser: Boolean(req.body?.targetIsRealUser),
        currentlyFollowing: Boolean(req.body?.currentlyFollowing),
      });
      res.json({ ok: true });
    } catch (error) {
      handleRouteError(res, error, 'Failed to update follow relationship.');
    }
  });

  app.get('/api/workspace/follows', requireAuth, async (req: AuthRequest, res) => {
    try {
      const data = await repo.getUserFollows(req.verifiedUser!.uid);
      res.json(data);
    } catch (error) {
      handleRouteError(res, error, 'Failed to load follow relationships.');
    }
  });

  app.get('/api/workspace/activities', requireAuth, async (req: AuthRequest, res) => {
    try {
      const items = await repo.getUserActivities(req.verifiedUser!.uid);
      res.json({ activities: items });
    } catch (error) {
      handleRouteError(res, error, 'Failed to load activities.');
    }
  });

  // ===========================================================================
  // COMMUNITY LINKS, VISITS & REPORTS
  // ===========================================================================

  app.get('/api/links/approved', requireAuth, async (_req: AuthRequest, res) => {
    try {
      const items = await repo.getApprovedLinks();
      res.json({ links: items });
    } catch (error) {
      handleRouteError(res, error, 'Failed to load community links.');
    }
  });

  app.get('/api/links/mine', requireAuth, async (req: AuthRequest, res) => {
    try {
      const items = await repo.getMyLinks(req.verifiedUser!.uid);
      res.json({ links: items });
    } catch (error) {
      handleRouteError(res, error, 'Failed to load your submitted links.');
    }
  });

  app.get('/api/links/visits', requireAuth, async (req: AuthRequest, res) => {
    try {
      const visits = await repo.getMyLinkVisits(req.verifiedUser!.uid);
      res.json({ visits });
    } catch (error) {
      handleRouteError(res, error, 'Failed to load visit history.');
    }
  });

  app.get('/api/links/check-duplicate', requireAuth, async (req: AuthRequest, res) => {
    try {
      const urlKey = typeof req.query.urlKey === 'string' ? req.query.urlKey.trim() : '';
      if (!urlKey) {
        res.status(400).json({ error: 'urlKey is required.' });
        return;
      }
      const result = await repo.checkDuplicateUrlKey(urlKey);
      res.json(result);
    } catch (error) {
      handleRouteError(res, error, 'Failed to check duplicate link.');
    }
  });

  app.post('/api/links', requireAuth, async (req: AuthRequest, res) => {
    try {
      const result = await repo.submitLink({
        uid: req.verifiedUser!.uid,
        ownerName: String(req.body?.ownerName || 'Member'),
        ownerUsername: String(req.body?.ownerUsername || '@member'),
        ownerAvatar: String(req.body?.ownerAvatar || ''),
        type: req.body?.type === 'website' ? 'website' : 'smartlink',
        title: String(req.body?.title || ''),
        description: String(req.body?.description || ''),
        rawUrl: String(req.body?.rawUrl || ''),
        category: String(req.body?.category || 'Other'),
        cooldownSec:
          typeof req.body?.cooldownSec === 'number' ? req.body.cooldownSec : undefined,
        targetGeos: Array.isArray(req.body?.targetGeos) ? req.body.targetGeos : undefined,
      });
      res.status(201).json(result);
    } catch (error) {
      handleRouteError(res, error, 'Failed to submit link.');
    }
  });

  app.put('/api/links/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      await repo.updateOwnLink({
        uid: req.verifiedUser!.uid,
        linkId: String(req.params.id || ''),
        type: req.body?.type === 'website' ? 'website' : 'smartlink',
        title: String(req.body?.title || ''),
        description: String(req.body?.description || ''),
        rawUrl: String(req.body?.rawUrl || ''),
        category: String(req.body?.category || 'Other'),
        targetGeos: Array.isArray(req.body?.targetGeos) ? req.body.targetGeos : undefined,
      });
      res.json({ ok: true });
    } catch (error) {
      handleRouteError(res, error, 'Failed to update link.');
    }
  });

  app.delete('/api/links/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.verifiedUser!;
      const wantsAdmin = req.query.asAdmin === 'true' || req.body?.asAdmin === true;
      if (wantsAdmin && user.email !== ADMIN_EMAIL) {
        res.status(403).json({ error: 'Unauthorized: Verified admin email required.' });
        return;
      }
      await repo.deleteLink({
        linkId: String(req.params.id || ''),
        actorUid: user.uid,
        actorEmail: user.email,
        asAdmin: wantsAdmin,
        reason: typeof req.body?.reason === 'string' ? req.body.reason : undefined,
      });
      res.json({ ok: true });
    } catch (error) {
      handleRouteError(res, error, 'Failed to delete link.');
    }
  });

  app.post('/api/links/visit-open', requireAuth, async (req: AuthRequest, res) => {
    try {
      const result = await repo.recordExternalLinkOpen({
        uid: req.verifiedUser!.uid,
        linkId: String(req.body?.linkId || ''),
        linkTitle: String(req.body?.linkTitle || 'Smartlink'),
        linkType: String(req.body?.linkType || 'smartlink'),
        category: String(req.body?.category || 'Other'),
        domain: String(req.body?.domain || 'example.com'),
        url: String(req.body?.url || ''),
        durationSec:
          typeof req.body?.durationSec === 'number' ? req.body.durationSec : undefined,
        cooldownSec:
          typeof req.body?.cooldownSec === 'number' ? req.body.cooldownSec : undefined,
      });
      res.json(result);
    } catch (error) {
      handleRouteError(res, error, 'Failed to record link visit.');
    }
  });

  app.post('/api/links/report', requireAuth, async (req: AuthRequest, res) => {
    try {
      await repo.reportLink({
        linkId: String(req.body?.linkId || ''),
        reporterUid: req.verifiedUser!.uid,
        reporterUsername: String(req.body?.reporterUsername || '@member'),
        reason: String(req.body?.reason || ''),
      });
      res.json({ ok: true });
    } catch (error) {
      handleRouteError(res, error, 'Failed to report link.');
    }
  });

  // ===========================================================================
  // ADMIN MODERATION & MULTI (5) PAYMENTS
  // ===========================================================================

  app.get('/api/admin/overview', requireAuth, requireAdmin, async (_req: AuthRequest, res) => {
    try {
      const overview = await repo.getAdminOverview();
      res.json(overview);
    } catch (error) {
      handleRouteError(res, error, 'Failed to load admin overview.');
    }
  });

  app.post(
    '/api/admin/links/:id/moderate',
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res) => {
      try {
        const decision = req.body?.decision === 'rejected' ? 'rejected' : 'approved';
        await repo.moderateLink({
          linkId: String(req.params.id || ''),
          decision,
          note: String(req.body?.note || ''),
          adminUid: req.verifiedUser!.uid,
          adminEmail: req.verifiedUser!.email,
        });
        res.json({ ok: true });
      } catch (error) {
        handleRouteError(res, error, 'Failed to moderate link.');
      }
    }
  );

  app.post(
    '/api/admin/reports/:id/resolve',
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res) => {
      try {
        const action =
          req.body?.action === 'resolve_and_remove' ? 'resolve_and_remove' : 'dismiss';
        await repo.resolveReport({
          reportId: String(req.params.id || ''),
          action,
          adminNote: String(req.body?.adminNote || ''),
          adminUid: req.verifiedUser!.uid,
          adminEmail: req.verifiedUser!.email,
        });
        res.json({ ok: true });
      } catch (error) {
        handleRouteError(res, error, 'Failed to resolve report.');
      }
    }
  );

  app.get('/api/payments/config', requireAuth, async (_req: AuthRequest, res) => {
    try {
      const config = await repo.getPaymentConfig({
        bkashNumber: process.env.VITE_BKASH_PERSONAL_NUMBER?.trim() || '01700-000000',
        nagadNumber: process.env.VITE_NAGAD_PERSONAL_NUMBER?.trim() || '01800-000000',
      });
      res.json({ config });
    } catch (error) {
      handleRouteError(res, error, 'Failed to load payment numbers.');
    }
  });

  app.get('/api/payments/me', requireAuth, async (req: AuthRequest, res) => {
    try {
      const data = await repo.getMyPaymentsAndEntitlement(req.verifiedUser!.uid);
      res.json(data);
    } catch (error) {
      handleRouteError(res, error, 'Failed to load your payment status.');
    }
  });

  app.get('/api/payments/tx-check', requireAuth, async (req: AuthRequest, res) => {
    try {
      const rawTx = typeof req.query.txKey === 'string' ? req.query.txKey : '';
      const txKey = normalizeAndValidateTxId(rawTx);
      const used = await repo.isTransactionIdUsed(txKey);
      res.json({ used, txKey });
    } catch (error) {
      handleRouteError(res, error, 'Failed to verify Transaction ID.');
    }
  });

  app.post('/api/payments/request', requireAuth, async (req: AuthRequest, res) => {
    try {
      const txKey = normalizeAndValidateTxId(req.body?.transactionId);
      const paymentMethod = req.body?.paymentMethod === 'nagad' ? 'nagad' : 'bkash';
      const receiverNumber = validatePersonalNumber(
        req.body?.paymentNumber,
        paymentMethod === 'nagad' ? 'Nagad (Personal)' : 'bKash (Personal)'
      );
      const cleanSender = String(req.body?.senderNumber || '').trim().slice(0, 24);
      if (cleanSender && !/^[0-9+\-\s]{6,24}$/.test(cleanSender)) {
        throw new repo.DomainError(
          'Please enter a valid sender mobile number (or leave it blank).'
        );
      }
      const screenshotUrl = String(req.body?.screenshotUrl || '').trim();
      if (!screenshotUrl) {
        throw new repo.DomainError('Payment screenshot is required.');
      }

      const result = await repo.createPaymentRequest({
        uid: req.verifiedUser!.uid,
        userName: String(req.body?.userName || 'Member'),
        userUsername: String(req.body?.userUsername || '@member'),
        paymentMethod,
        paymentNumber: receiverNumber,
        senderNumber: cleanSender || undefined,
        transactionId: txKey,
        screenshotUrl,
      });
      res.status(201).json(result);
    } catch (error) {
      handleRouteError(res, error, 'Failed to submit payment request.');
    }
  });

  app.put(
    '/api/admin/payments/config',
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res) => {
      try {
        const bkashNumber = validatePersonalNumber(
          req.body?.bkashNumber,
          'bKash (Personal)'
        );
        const nagadNumber = validatePersonalNumber(
          req.body?.nagadNumber,
          'Nagad (Personal)'
        );
        const updated = await repo.updatePaymentConfig({
          bkashNumber,
          nagadNumber,
          adminUid: req.verifiedUser!.uid,
          adminEmail: req.verifiedUser!.email,
        });
        res.json({ config: updated });
      } catch (error) {
        handleRouteError(res, error, 'Failed to update payment configuration.');
      }
    }
  );

  app.post(
    '/api/admin/payments/:id/review',
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res) => {
      try {
        const decision = req.body?.decision === 'rejected' ? 'rejected' : 'approved';
        await repo.reviewPaymentRequest({
          requestId: String(req.params.id || ''),
          decision,
          adminNote: typeof req.body?.adminNote === 'string' ? req.body.adminNote : undefined,
          verifiedProof: Boolean(req.body?.verifiedProof),
          adminUid: req.verifiedUser!.uid,
          adminEmail: req.verifiedUser!.email,
        });
        res.json({ ok: true });
      } catch (error) {
        handleRouteError(res, error, 'Failed to review payment request.');
      }
    }
  );

  app.post(
    '/api/admin/payments/:id/revoke',
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res) => {
      try {
        await repo.revokePaymentAccess({
          requestId: String(req.params.id || ''),
          adminNote: typeof req.body?.adminNote === 'string' ? req.body.adminNote : undefined,
          adminUid: req.verifiedUser!.uid,
          adminEmail: req.verifiedUser!.email,
        });
        res.json({ ok: true });
      } catch (error) {
        handleRouteError(res, error, 'Failed to revoke Multi (5) access.');
      }
    }
  );

  // ===========================================================================
  // ADSTERRA INTEGRATIONS, PERSONAL SMARTLINKS & ENCRYPTED API VAULT (POSTGRES)
  // ===========================================================================

  app.get('/api/adsterra/integration', requireAuth, async (req: AuthRequest, res) => {
    try {
      const integration = await repo.getAdsterraIntegration(req.verifiedUser!.uid);
      res.json({ integration });
    } catch (error) {
      handleRouteError(res, error, 'Failed to load Adsterra integration.');
    }
  });

  app.put('/api/adsterra/integration', requireAuth, async (req: AuthRequest, res) => {
    try {
      await repo.upsertAdsterraIntegration({
        uid: req.verifiedUser!.uid,
        publisherId: String(req.body?.publisherId || ''),
        publisherLabel: String(req.body?.publisherLabel || ''),
        smartlinkTitle: String(req.body?.smartlinkTitle || ''),
        smartlinkUrl: String(req.body?.smartlinkUrl || ''),
        connectionMode:
          req.body?.connectionMode === 'official_api_key'
            ? 'official_api_key'
            : 'manual_smartlink',
        hasApiKey: Boolean(req.body?.hasApiKey),
        apiKeyHint: String(req.body?.apiKeyHint || ''),
        apiVerified: Boolean(req.body?.apiVerified),
        verifiedDomainsCount: Number(req.body?.verifiedDomainsCount ?? 0),
        verifiedPlacementsCount: Number(req.body?.verifiedPlacementsCount ?? 0),
        lastSyncedAtMs:
          typeof req.body?.lastSyncedAtMs === 'number' ? req.body.lastSyncedAtMs : null,
      });
      res.json({ ok: true });
    } catch (error) {
      handleRouteError(res, error, 'Failed to save Adsterra integration.');
    }
  });

  app.delete('/api/adsterra/integration', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.verifiedUser!.uid;
      await Promise.all([
        repo.deleteAdsterraVaultRecord(uid),
        repo.disconnectAdsterraIntegration(uid),
      ]);
      res.json(toSafeStatusPayload(null));
    } catch (error) {
      handleRouteError(res, error, 'Failed to disconnect Adsterra integration.');
    }
  });

  app.get('/api/adsterra/smartlinks', requireAuth, async (req: AuthRequest, res) => {
    try {
      const smartlinks = await repo.getUserSmartlinks(req.verifiedUser!.uid);
      res.json({ smartlinks });
    } catch (error) {
      handleRouteError(res, error, 'Failed to load personal Smartlinks.');
    }
  });

  app.post('/api/adsterra/smartlinks', requireAuth, async (req: AuthRequest, res) => {
    try {
      const result = await repo.createUserSmartlink({
        uid: req.verifiedUser!.uid,
        title: String(req.body?.title || ''),
        rawUrl: String(req.body?.rawUrl || ''),
        category: String(req.body?.category || 'Other'),
      });
      res.status(201).json(result);
    } catch (error) {
      handleRouteError(res, error, 'Failed to create personal Smartlink.');
    }
  });

  app.put('/api/adsterra/smartlinks/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      await repo.updateUserSmartlink({
        uid: req.verifiedUser!.uid,
        id: String(req.params.id || ''),
        title: String(req.body?.title || ''),
        rawUrl: String(req.body?.rawUrl || ''),
        category: String(req.body?.category || 'Other'),
      });
      res.json({ ok: true });
    } catch (error) {
      handleRouteError(res, error, 'Failed to update personal Smartlink.');
    }
  });

  app.delete('/api/adsterra/smartlinks/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      await repo.deleteUserSmartlink({
        uid: req.verifiedUser!.uid,
        id: String(req.params.id || ''),
      });
      res.json({ ok: true });
    } catch (error) {
      handleRouteError(res, error, 'Failed to delete personal Smartlink.');
    }
  });

  app.get('/api/adsterra/status', requireAuth, async (req: AuthRequest, res) => {
    try {
      const record = await repo.getAdsterraVaultRecord(req.verifiedUser!.uid);
      res.json(toSafeStatusPayload(record));
    } catch (error) {
      handleRouteError(res, error, 'Failed to check Adsterra status.');
    }
  });

  app.post('/api/adsterra/connect', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.verifiedUser!.uid;
      const rawKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
      const verifyWithAdsterra = req.body?.verifyWithAdsterra !== false;

      if (rawKey.length < 12 || rawKey.length > 200 || /\s/.test(rawKey)) {
        res.status(400).json({
          error: 'Adsterra API Key must be 12 to 200 non-whitespace characters.',
        });
        return;
      }

      let apiVerified = false;
      let domainsCount = 0;
      let placementsCount = 0;
      let domainsPreview: Array<{ id: string; title: string }> = [];
      let placementsPreview: PlacementPreviewItem[] = [];
      let statsSummary: StatsSummary | null = null;
      let detailedStats: AdsterraDetailedStats | null = null;
      let lastSyncedAtMs: number | null = null;

      if (verifyWithAdsterra) {
        try {
          const snapshot = await fetchAdsterraOfficialSnapshot(rawKey);
          apiVerified = true;
          domainsCount = snapshot.domainsCount;
          placementsCount = snapshot.placementsCount;
          domainsPreview = snapshot.domainsPreview;
          placementsPreview = snapshot.placementsPreview;
          statsSummary = snapshot.statsSummary;
          detailedStats = snapshot.detailedStats;
          lastSyncedAtMs = Date.now();
        } catch (err) {
          res.status(400).json({
            error:
              err instanceof Error
                ? err.message
                : 'Failed to verify API Key with Adsterra Publisher API.',
          });
          return;
        }
      }

      const encrypted = encryptSecret(rawKey);
      const saved = await repo.upsertAdsterraVaultRecord(uid, {
        ...encrypted,
        keyHint: maskKeyHint(rawKey),
        apiVerified,
        verifiedDomainsCount: domainsCount,
        verifiedPlacementsCount: placementsCount,
        domainsPreview,
        placementsPreview,
        statsSummary: statsSummary as unknown as Record<string, unknown> | null,
        detailedStats: detailedStats as unknown as Record<string, unknown> | null,
        lastSyncedAtMs,
        updatedAtMs: Date.now(),
      });

      res.json(toSafeStatusPayload(saved));
    } catch (error) {
      handleRouteError(res, error, 'Failed to connect Adsterra API Key.');
    }
  });

  app.post('/api/adsterra/sync', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.verifiedUser!.uid;
      const record = await repo.getAdsterraVaultRecord(uid);
      if (!record) {
        res.status(404).json({
          error: 'No Adsterra API Key is saved for your account.',
        });
        return;
      }

      let apiKey = '';
      try {
        apiKey = decryptSecret(record);
      } catch {
        res.status(500).json({ error: 'Stored API credential could not be decrypted.' });
        return;
      }

      try {
        const snapshot = await fetchAdsterraOfficialSnapshot(apiKey);
        const latestRecord = await repo.getAdsterraVaultRecord(uid);
        if (!latestRecord) {
          res.status(404).json({
            error: 'Adsterra API Key was disconnected during sync.',
          });
          return;
        }
        const saved = await repo.upsertAdsterraVaultRecord(uid, {
          iv: latestRecord.iv,
          authTag: latestRecord.authTag,
          ciphertext: latestRecord.ciphertext,
          keyHint: latestRecord.keyHint,
          apiVerified: true,
          verifiedDomainsCount: snapshot.domainsCount,
          verifiedPlacementsCount: snapshot.placementsCount,
          domainsPreview: snapshot.domainsPreview,
          placementsPreview: snapshot.placementsPreview,
          statsSummary: snapshot.statsSummary as unknown as Record<string, unknown> | null,
          detailedStats: snapshot.detailedStats as unknown as Record<string, unknown> | null,
          lastSyncedAtMs: Date.now(),
          updatedAtMs: Date.now(),
        });
        res.json(toSafeStatusPayload(saved));
      } catch (err) {
        res.status(502).json({
          error:
            err instanceof Error
              ? err.message
              : 'Adsterra Publisher API sync request failed.',
        });
      }
    } catch (error) {
      handleRouteError(res, error, 'Failed to sync Adsterra stats.');
    }
  });

  app.post('/api/adsterra/stats', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.verifiedUser!.uid;
      const record = await repo.getAdsterraVaultRecord(uid);
      if (!record) {
        res.status(404).json({
          error: 'No Adsterra API Key is saved for your account.',
        });
        return;
      }

      let apiKey = '';
      try {
        apiKey = decryptSecret(record);
      } catch {
        res.status(500).json({ error: 'Stored API credential could not be decrypted.' });
        return;
      }

      const rawPreset = String(req.body?.preset || '30d');
      const preset: AdsterraDatePreset =
        rawPreset === 'today' ||
        rawPreset === 'yesterday' ||
        rawPreset === '7d' ||
        rawPreset === '30d' ||
        rawPreset === 'custom'
          ? rawPreset
          : '30d';

      const todayYmd = formatUtcYmd(0);
      let startDate = formatUtcYmd(-29);
      let finishDate = todayYmd;

      if (preset === 'today') {
        startDate = todayYmd;
        finishDate = todayYmd;
      } else if (preset === 'yesterday') {
        const y = formatUtcYmd(-1);
        startDate = y;
        finishDate = y;
      } else if (preset === '7d') {
        startDate = formatUtcYmd(-6);
        finishDate = todayYmd;
      } else if (preset === '30d') {
        startDate = formatUtcYmd(-29);
        finishDate = todayYmd;
      } else {
        if (!isValidYmd(req.body?.startDate) || !isValidYmd(req.body?.finishDate)) {
          res.status(400).json({ error: 'Custom range requires valid YYYY-MM-DD start and end dates.' });
          return;
        }
        if (req.body.startDate > req.body.finishDate) {
          res.status(400).json({ error: 'Start date cannot be after finish date.' });
          return;
        }
        startDate = req.body.startDate;
        finishDate = req.body.finishDate;
      }

      const domainId = typeof req.body?.domainId === 'string' ? req.body.domainId.trim() : undefined;
      const placementId =
        typeof req.body?.placementId === 'string' ? req.body.placementId.trim() : undefined;
      const country = typeof req.body?.country === 'string' ? req.body.country.trim() : undefined;

      try {
        const prevDetailed = record.detailedStats as AdsterraDetailedStats | null;
        const detailedStats = await fetchAdsterraDetailedStats({
          apiKey,
          preset,
          startDate,
          finishDate,
          domainId,
          placementId,
          country,
          domainsPreview: record.domainsPreview,
          placementsPreview: record.placementsPreview,
          cachedPeriods: prevDetailed?.periods ?? null,
          cachedFetchedAtMs: prevDetailed?.fetchedAtMs ?? null,
        });

        const nextSummary: StatsSummary = {
          startDate: formatUtcYmd(-6),
          finishDate: todayYmd,
          impressions: detailedStats.periods.last7d.impressions,
          clicks: detailedStats.periods.last7d.clicks,
          revenue: Number(detailedStats.periods.last7d.revenue.toFixed(4)),
          cpm: detailedStats.periods.last7d.cpm,
          ctr: detailedStats.periods.last7d.ctr,
        };

        const latestRecord = await repo.getAdsterraVaultRecord(uid);
        if (!latestRecord) {
          res.status(404).json({
            error: 'Adsterra API Key was disconnected while fetching stats.',
          });
          return;
        }

        const saved = await repo.upsertAdsterraVaultRecord(uid, {
          iv: latestRecord.iv,
          authTag: latestRecord.authTag,
          ciphertext: latestRecord.ciphertext,
          keyHint: latestRecord.keyHint,
          apiVerified: latestRecord.apiVerified,
          verifiedDomainsCount: latestRecord.verifiedDomainsCount,
          verifiedPlacementsCount: latestRecord.verifiedPlacementsCount,
          domainsPreview: latestRecord.domainsPreview,
          placementsPreview: latestRecord.placementsPreview,
          statsSummary: nextSummary as unknown as Record<string, unknown>,
          detailedStats: detailedStats as unknown as Record<string, unknown>,
          lastSyncedAtMs: Date.now(),
          updatedAtMs: Date.now(),
        });
        res.json(toSafeStatusPayload(saved));
      } catch (err) {
        res.status(502).json({
          error:
            err instanceof Error
              ? err.message
              : 'Failed to fetch detailed statistics from Adsterra API.',
        });
      }
    } catch (error) {
      handleRouteError(res, error, 'Failed to fetch detailed statistics.');
    }
  });

  app.delete('/api/adsterra/disconnect', requireAuth, async (req: AuthRequest, res) => {
    try {
      await repo.deleteAdsterraVaultRecord(req.verifiedUser!.uid);
      res.json(toSafeStatusPayload(null));
    } catch (error) {
      handleRouteError(res, error, 'Failed to disconnect Adsterra API Key.');
    }
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  app.use('/api', (err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const errObj = err as { type?: string; status?: number; message?: string } | null;
    if (errObj?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
      res.status(400).json({ error: 'Malformed JSON request body.' });
      return;
    }
    if (errObj?.type === 'entity.too.large') {
      res.status(413).json({ error: 'Request payload exceeds the 1MB limit.' });
      return;
    }
    res.status(typeof errObj?.status === 'number' ? errObj.status : 500).json({
      error: errObj?.message || 'Internal server error.',
    });
  });

  return app;
}

async function startServer() {
  const app = createApp();
  const httpServer = http.createServer(app);
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    if (process.env.DISABLE_HMR === undefined) {
      process.env.DISABLE_HMR = 'true';
    }
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: { server: httpServer },
        allowedHosts: true,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(ROOT_DIR, 'dist');
    app.use(
      express.static(distDir, {
        setHeaders(res, filePath) {
          const base = path.basename(filePath);
          if (
            base === 'index.html' ||
            base === 'sw.js' ||
            base === 'registerSW.js' ||
            base === 'manifest.webmanifest'
          ) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          }
        },
      })
    );
    app.use((req, res, next) => {
      if (
        req.method !== 'GET' ||
        req.path.startsWith('/api/') ||
        path.extname(req.path) !== ''
      ) {
        next();
        return;
      }
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`INFINITY REWARDS server listening on http://0.0.0.0:${PORT}`);
  });
}

const isDirectEntry =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(ROOT_DIR, 'server.ts');

if (isDirectEntry) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
