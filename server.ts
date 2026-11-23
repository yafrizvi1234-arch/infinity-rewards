import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';

interface FirebaseAppletConfig {
  projectId: string;
}

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

interface StoredSecretRecord {
  iv: string;
  authTag: string;
  ciphertext: string;
  keyHint: string;
  apiVerified: boolean;
  verifiedDomainsCount: number;
  verifiedPlacementsCount: number;
  domainsPreview: Array<{ id: string; title: string }>;
  placementsPreview: PlacementPreviewItem[];
  statsSummary?: StatsSummary | null;
  detailedStats?: AdsterraDetailedStats | null;
  lastSyncedAtMs: number | null;
  updatedAtMs: number;
}

interface VerifiedAuthUser {
  uid: string;
  email: string;
  emailVerified: boolean;
}

interface AuthenticatedRequest extends Request {
  verifiedUser?: VerifiedAuthUser;
}

const ROOT_DIR = process.cwd();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(ROOT_DIR, '.data');
const SECRETS_FILE = path.join(DATA_DIR, 'adsterra-secrets.enc.json');
const MASTER_KEY_FILE = path.join(DATA_DIR, '.master.key');
const ADSTERRA_API_BASE = 'https://api3.adsterratools.com/publisher';
const FIREBASE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

const firebaseConfig = JSON.parse(
  fs.readFileSync(path.join(ROOT_DIR, 'firebase-applet-config.json'), 'utf8')
) as FirebaseAppletConfig;

let cachedCerts: Record<string, string> = {};
let cachedCertsExpiresAt = 0;

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

function readSecretsVault(): Record<string, StoredSecretRecord> {
  ensureDataDir();
  if (!fs.existsSync(SECRETS_FILE)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(SECRETS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, StoredSecretRecord>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeSecretsVault(vault: Record<string, StoredSecretRecord>): void {
  ensureDataDir();
  const tempFile = `${SECRETS_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(vault, null, 2), { mode: 0o600 });
  fs.renameSync(tempFile, SECRETS_FILE);
}

function maskKeyHint(apiKey: string): string {
  const trimmed = apiKey.trim();
  const tail = trimmed.slice(-4);
  return `••••${tail}`;
}

function toSafeStatusPayload(record: StoredSecretRecord | undefined) {
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
    statsSummary: record.statsSummary ?? null,
    detailedStats: record.detailedStats ?? null,
    lastSyncedAtMs: record.lastSyncedAtMs,
  };
}

function decodeJwtPart(segment: string): Record<string, unknown> {
  if (!segment) {
    throw new Error('Malformed Firebase ID token.');
  }
  try {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padLength = (4 - (base64.length % 4)) % 4;
    const padded = base64 + '='.repeat(padLength);
    const json = Buffer.from(padded, 'base64').toString('utf8');
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Malformed Firebase ID token.');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error('Malformed Firebase ID token.');
  }
}

async function getFirebasePublicCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (now < cachedCertsExpiresAt && Object.keys(cachedCerts).length > 0) {
    return cachedCerts;
  }
  const resp = await fetch(FIREBASE_CERTS_URL, {
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) {
    throw new Error('Unable to fetch Firebase public verification certificates.');
  }
  const certs = (await resp.json()) as Record<string, string>;
  const cacheControl = resp.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSec = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;
  cachedCerts = certs;
  cachedCertsExpiresAt = now + Math.max(60, maxAgeSec) * 1000;
  return certs;
}

export async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedAuthUser> {
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed Firebase ID token.');
  }
  const [headerB64, payloadB64, sigB64] = parts;
  const header = decodeJwtPart(headerB64);
  const payload = decodeJwtPart(payloadB64);

  if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
    throw new Error('Invalid ID token algorithm or key identifier.');
  }

  const certs = await getFirebasePublicCerts();
  let certPem = certs[header.kid];
  if (!certPem) {
    cachedCertsExpiresAt = 0;
    const refreshed = await getFirebasePublicCerts();
    certPem = refreshed[header.kid];
  }
  if (!certPem) {
    throw new Error('Unknown Firebase signing certificate.');
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();

  const signature = Buffer.from(sigB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const isValidSig = verifier.verify(certPem, signature);
  if (!isValidSig) {
    throw new Error('Firebase ID token signature verification failed.');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const expectedIssuer = `https://securetoken.google.com/${firebaseConfig.projectId}`;
  if (payload.aud !== firebaseConfig.projectId || payload.iss !== expectedIssuer) {
    throw new Error('Firebase ID token project mismatch.');
  }
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    throw new Error('Firebase session token has expired.');
  }
  if (typeof payload.iat !== 'number' || payload.iat > nowSec + 300) {
    throw new Error('Firebase ID token issued-at timestamp is invalid.');
  }
  if (
    typeof payload.sub !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(payload.sub)
  ) {
    throw new Error('Firebase ID token subject UID is invalid.');
  }
  if (payload.email_verified !== true || typeof payload.email !== 'string') {
    throw new Error('Verified email address is required.');
  }

  return {
    uid: payload.sub,
    email: payload.email.toLowerCase(),
    emailVerified: true,
  };
}

async function requireVerifiedFirebaseUser(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required (Bearer token missing).' });
    return;
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    res.status(401).json({ error: 'Authentication required (empty token).' });
    return;
  }
  try {
    req.verifiedUser = await verifyFirebaseIdToken(token);
    next();
  } catch (err) {
    res.status(401).json({
      error: err instanceof Error ? err.message : 'Invalid or expired authentication token.',
    });
  }
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
  if (params.country && /^[a-zA-Z]{2}$/.test(params.country.trim())) {
    qs.set('country', params.country.trim().toUpperCase());
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
        row.placement_title ?? row.title ?? matched?.title ?? (pid ? `Placement #${pid}` : `Placement #${idx + 1}`)
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

  // Compute Today / Yesterday / Last 7d / Last 30d rollups
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

  const domainsPreview = domainItems.slice(0, 50).map((d) => ({
    id: String(d.id ?? ''),
    title: String(d.title ?? 'Domain').slice(0, 80),
  }));

  const placementsPreview: PlacementPreviewItem[] = placementItems.slice(0, 100).map((p) => {
    const candidateUrl = [
      p.url,
      p.direct_url,
      p.directUrl,
      p.direct_link,
      p.smartlink_url,
      p.smartlink,
      p.smart_link,
      p.link,
      p.target_url,
    ].find((v) => typeof v === 'string' && /^https?:\/\//i.test(v.trim())) as string | undefined;
    return {
      id: String(p.id ?? ''),
      domainId: String(p.domain_id ?? ''),
      title: String(p.title ?? p.alias ?? 'Placement').slice(0, 80),
      ...(typeof p.type === 'string' ? { type: p.type.slice(0, 32) } : {}),
      ...(typeof p.status === 'string' ? { status: p.status.slice(0, 32) } : {}),
      ...(candidateUrl ? { directUrl: candidateUrl.trim().slice(0, 500) } : {}),
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
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,Accept');
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
    }
    next();
  });
  app.use(express.json({ limit: '64kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/adsterra/status', requireVerifiedFirebaseUser, (req: AuthenticatedRequest, res) => {
    const uid = req.verifiedUser!.uid;
    const vault = readSecretsVault();
    res.json(toSafeStatusPayload(vault[uid]));
  });

  app.post(
    '/api/adsterra/connect',
    requireVerifiedFirebaseUser,
    async (req: AuthenticatedRequest, res) => {
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
      const vault = readSecretsVault();
      vault[uid] = {
        ...encrypted,
        keyHint: maskKeyHint(rawKey),
        apiVerified,
        verifiedDomainsCount: domainsCount,
        verifiedPlacementsCount: placementsCount,
        domainsPreview,
        placementsPreview,
        statsSummary,
        detailedStats,
        lastSyncedAtMs,
        updatedAtMs: Date.now(),
      };
      writeSecretsVault(vault);

      res.json(toSafeStatusPayload(vault[uid]));
    }
  );

  app.post(
    '/api/adsterra/sync',
    requireVerifiedFirebaseUser,
    async (req: AuthenticatedRequest, res) => {
      const uid = req.verifiedUser!.uid;
      const vault = readSecretsVault();
      const record = vault[uid];
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
        const latestVault = readSecretsVault();
        const latestRecord = latestVault[uid];
        if (!latestRecord) {
          res.status(404).json({
            error: 'Adsterra API Key was disconnected during sync.',
          });
          return;
        }
        latestVault[uid] = {
          ...latestRecord,
          apiVerified: true,
          verifiedDomainsCount: snapshot.domainsCount,
          verifiedPlacementsCount: snapshot.placementsCount,
          domainsPreview: snapshot.domainsPreview,
          placementsPreview: snapshot.placementsPreview,
          statsSummary: snapshot.statsSummary,
          detailedStats: snapshot.detailedStats,
          lastSyncedAtMs: Date.now(),
          updatedAtMs: Date.now(),
        };
        writeSecretsVault(latestVault);
        res.json(toSafeStatusPayload(latestVault[uid]));
      } catch (err) {
        res.status(502).json({
          error:
            err instanceof Error
              ? err.message
              : 'Adsterra Publisher API sync request failed.',
        });
      }
    }
  );

  app.post(
    '/api/adsterra/stats',
    requireVerifiedFirebaseUser,
    async (req: AuthenticatedRequest, res) => {
      const uid = req.verifiedUser!.uid;
      const vault = readSecretsVault();
      const record = vault[uid];
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
          cachedPeriods: record.detailedStats?.periods ?? null,
          cachedFetchedAtMs: record.detailedStats?.fetchedAtMs ?? null,
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

        const latestVault = readSecretsVault();
        const latestRecord = latestVault[uid];
        if (!latestRecord) {
          res.status(404).json({
            error: 'Adsterra API Key was disconnected while fetching stats.',
          });
          return;
        }
        latestVault[uid] = {
          ...latestRecord,
          statsSummary: nextSummary,
          detailedStats,
          lastSyncedAtMs: Date.now(),
          updatedAtMs: Date.now(),
        };
        writeSecretsVault(latestVault);
        res.json(toSafeStatusPayload(latestVault[uid]));
      } catch (err) {
        res.status(502).json({
          error:
            err instanceof Error
              ? err.message
              : 'Failed to fetch detailed statistics from Adsterra API.',
        });
      }
    }
  );

  app.delete(
    '/api/adsterra/disconnect',
    requireVerifiedFirebaseUser,
    (req: AuthenticatedRequest, res) => {
      const uid = req.verifiedUser!.uid;
      const vault = readSecretsVault();
      if (vault[uid]) {
        delete vault[uid];
        writeSecretsVault(vault);
      }
      res.json(toSafeStatusPayload(undefined));
    }
  );

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
      res.status(413).json({ error: 'Request payload exceeds the 64KB limit.' });
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
