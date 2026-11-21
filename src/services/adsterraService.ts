import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import {
  OperationType,
  auth,
  db,
  handleFirestoreError,
  reportFirestoreListenerError,
} from '../firebase';
import {
  AdsterraBackendStatus,
  AdsterraConnectionMode,
  AdsterraDatePreset,
  AdsterraIntegrationRecord,
  UserPersonalSmartlink,
} from '../types';
import { validateAndNormalizeUrl } from '../utils/urlValidator';

export const DEFAULT_BACKEND_STATUS: AdsterraBackendStatus = {
  hasApiKey: false,
  apiKeyHint: '',
  apiVerified: false,
  verifiedDomainsCount: 0,
  verifiedPlacementsCount: 0,
  domainsPreview: [],
  placementsPreview: [],
  statsSummary: null,
  detailedStats: null,
  lastSyncedAtMs: null,
};

function timestampToMs(val: unknown): number {
  if (val instanceof Timestamp) return val.toMillis();
  if (typeof val === 'object' && val !== null && 'toMillis' in val) {
    try {
      return Number((val as { toMillis: () => number }).toMillis());
    } catch {
      return Date.now();
    }
  }
  return Date.now();
}

const STORAGE_API_BASE_KEY = 'infinity_rewards_api_base_url';

export function getConfiguredApiBaseUrl(): string {
  const envBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || '';
  if (envBase) {
    return envBase.replace(/\/+$/, '');
  }
  try {
    const saved = window.localStorage.getItem(STORAGE_API_BASE_KEY)?.trim() || '';
    return saved.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function setConfiguredApiBaseUrl(rawUrl: string): string {
  const cleaned = rawUrl.trim().replace(/\/+$/, '');
  try {
    if (!cleaned) {
      window.localStorage.removeItem(STORAGE_API_BASE_KEY);
      return '';
    }
    const parsed = new URL(cleaned.startsWith('http') ? cleaned : `https://${cleaned}`);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('Backend URL must start with https:// or http://');
    }
    const normalized = parsed.origin;
    window.localStorage.setItem(STORAGE_API_BASE_KEY, normalized);
    return normalized;
  } catch (err) {
    if (err instanceof Error && err.message.includes('Backend URL')) {
      throw err;
    }
    throw new Error('Please enter a valid backend server URL (e.g. https://infinity-rewards.onrender.com).');
  }
}

function resolveApiEndpoint(endpoint: string, overrideBase?: string): string {
  const base = (overrideBase ?? getConfiguredApiBaseUrl()).replace(/\/+$/, '');
  if (!base) {
    return endpoint;
  }
  return `${base}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
}

export async function checkBackendHealth(overrideBase?: string): Promise<boolean> {
  try {
    const targetUrl = resolveApiEndpoint('/api/health', overrideBase);
    const res = await fetch(targetUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || !contentType.includes('application/json')) {
      return false;
    }
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean };
    return Boolean(data.ok);
  } catch {
    return false;
  }
}

async function getVerifiedBearerToken(): Promise<string> {
  const current = auth.currentUser;
  if (!current || !current.emailVerified) {
    throw new Error('Verified user session is required.');
  }
  return current.getIdToken();
}

async function authedApiRequest<T>(
  endpoint: string,
  options: { method: 'GET' | 'POST' | 'DELETE'; body?: Record<string, unknown> }
): Promise<T> {
  const token = await getVerifiedBearerToken();
  const targetUrl = resolveApiEndpoint(endpoint);
  const res = await fetch(targetUrl, {
    method: options.method,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(
      'Backend API server is unavailable on static hosting. Deploy on Render/Cloud Run or open the Shared App URL for Adsterra API sync.'
    );
  }

  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) {
    throw new Error(data.error || `Request failed with HTTP ${res.status}`);
  }
  return data;
}

export async function fetchAdsterraBackendStatus(): Promise<AdsterraBackendStatus> {
  return authedApiRequest<AdsterraBackendStatus>('/api/adsterra/status', { method: 'GET' });
}

export async function connectAdsterraApiKeySecure(params: {
  apiKey: string;
  verifyWithAdsterra: boolean;
}): Promise<AdsterraBackendStatus> {
  const trimmed = params.apiKey.trim();
  if (trimmed.length < 12 || trimmed.length > 200 || /\s/.test(trimmed)) {
    throw new Error('Adsterra API Key must be 12 to 200 characters without spaces.');
  }
  return authedApiRequest<AdsterraBackendStatus>('/api/adsterra/connect', {
    method: 'POST',
    body: {
      apiKey: trimmed,
      verifyWithAdsterra: params.verifyWithAdsterra,
    },
  });
}

export async function syncAdsterraOfficialApi(): Promise<AdsterraBackendStatus> {
  return authedApiRequest<AdsterraBackendStatus>('/api/adsterra/sync', { method: 'POST' });
}

export async function fetchAdsterraDetailedStats(params: {
  preset: AdsterraDatePreset;
  startDate?: string;
  finishDate?: string;
  domainId?: string;
  placementId?: string;
  country?: string;
}): Promise<AdsterraBackendStatus> {
  return authedApiRequest<AdsterraBackendStatus>('/api/adsterra/stats', {
    method: 'POST',
    body: {
      preset: params.preset,
      ...(params.startDate ? { startDate: params.startDate } : {}),
      ...(params.finishDate ? { finishDate: params.finishDate } : {}),
      ...(params.domainId ? { domainId: params.domainId } : {}),
      ...(params.placementId ? { placementId: params.placementId } : {}),
      ...(params.country ? { country: params.country } : {}),
    },
  });
}

export async function disconnectAdsterraApiKeySecure(): Promise<AdsterraBackendStatus> {
  return authedApiRequest<AdsterraBackendStatus>('/api/adsterra/disconnect', {
    method: 'DELETE',
  });
}

export function subscribeMyAdsterraIntegration(
  uid: string,
  onUpdate: (integration: AdsterraIntegrationRecord | null) => void,
  onError?: (err: Error) => void
): () => void {
  const docPath = `adsterraIntegrations/${uid}`;
  return onSnapshot(
    doc(db, 'adsterraIntegrations', uid),
    (snap) => {
      if (!snap.exists()) {
        onUpdate(null);
        return;
      }
      const data = snap.data();
      const connectionMode: AdsterraConnectionMode =
        data.connectionMode === 'official_api_key' ? 'official_api_key' : 'manual_smartlink';
      onUpdate({
        uid: String(data.uid ?? uid),
        ownerUserId: String(data.ownerUserId ?? uid),
        connectionMode,
        status: data.status === 'connected' ? 'connected' : 'disconnected',
        publisherId: String(data.publisherId ?? ''),
        publisherLabel: String(data.publisherLabel ?? ''),
        smartlinkUrl: String(data.smartlinkUrl ?? ''),
        smartlinkTitle: String(data.smartlinkTitle ?? ''),
        hasApiKey: Boolean(data.hasApiKey),
        apiKeyHint: String(data.apiKeyHint ?? ''),
        apiVerified: Boolean(data.apiVerified),
        verifiedDomainsCount: Number(data.verifiedDomainsCount ?? 0),
        verifiedPlacementsCount: Number(data.verifiedPlacementsCount ?? 0),
        lastSyncedAtMs: data.lastSyncedAt ? timestampToMs(data.lastSyncedAt) : undefined,
        createdAtMs: timestampToMs(data.createdAt),
        updatedAtMs: timestampToMs(data.updatedAt),
      });
    },
    (error) => {
      reportFirestoreListenerError(error, OperationType.GET, docPath, onError);
    }
  );
}

export async function saveMyAdsterraIntegration(params: {
  uid: string;
  publisherId: string;
  publisherLabel: string;
  smartlinkTitle: string;
  smartlinkUrl: string;
  connectionMode: AdsterraConnectionMode;
  backendStatus: AdsterraBackendStatus;
}): Promise<void> {
  const current = auth.currentUser;
  if (!current || current.uid !== params.uid || !current.emailVerified) {
    throw new Error('Verified user session required.');
  }

  const cleanPublisherId = params.publisherId.trim().slice(0, 64);
  const cleanLabel = params.publisherLabel.trim().slice(0, 60);
  const cleanTitle = params.smartlinkTitle.trim().slice(0, 80);

  let validatedUrl = '';
  if (params.smartlinkUrl.trim()) {
    const urlResult = validateAndNormalizeUrl(params.smartlinkUrl);
    if (!urlResult.valid || (!urlResult.url && !urlResult.normalizedUrl)) {
      throw new Error(urlResult.error || 'Please enter a valid Smartlink URL (https://...)');
    }
    validatedUrl = urlResult.url || urlResult.normalizedUrl || '';
  }

  if (!validatedUrl && !params.backendStatus.hasApiKey) {
    throw new Error(
      'Provide your personal Smartlink URL (or verify an Adsterra Publisher API Key) to connect.'
    );
  }

  const docRef = doc(db, 'adsterraIntegrations', params.uid);
  const docPath = `adsterraIntegrations/${params.uid}`;

  try {
    const existingSnap = await getDoc(docRef);
    const payload: Record<string, unknown> = {
      uid: params.uid,
      ownerUserId: params.uid,
      connectionMode: params.connectionMode,
      status: 'connected',
      publisherId: cleanPublisherId,
      publisherLabel: cleanLabel,
      smartlinkUrl: validatedUrl,
      smartlinkTitle: cleanTitle || (validatedUrl ? 'Primary Adsterra Smartlink' : ''),
      hasApiKey: Boolean(params.backendStatus.hasApiKey),
      apiKeyHint: params.backendStatus.apiKeyHint.slice(0, 16),
      apiVerified: Boolean(params.backendStatus.apiVerified),
      verifiedDomainsCount: Math.max(0, Math.min(1000, params.backendStatus.verifiedDomainsCount)),
      verifiedPlacementsCount: Math.max(
        0,
        Math.min(5000, params.backendStatus.verifiedPlacementsCount)
      ),
      updatedAt: serverTimestamp(),
      createdAt: existingSnap.exists() ? existingSnap.data().createdAt : serverTimestamp(),
    };

    if (params.backendStatus.lastSyncedAtMs) {
      payload.lastSyncedAt = Timestamp.fromMillis(params.backendStatus.lastSyncedAtMs);
    }

    await setDoc(docRef, payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, docPath);
  }
}

export async function disconnectMyAdsterraIntegration(uid: string): Promise<AdsterraBackendStatus> {
  const current = auth.currentUser;
  if (!current || current.uid !== uid || !current.emailVerified) {
    throw new Error('Verified user session required.');
  }

  const nextBackendStatus = await disconnectAdsterraApiKeySecure();
  const docRef = doc(db, 'adsterraIntegrations', uid);
  const docPath = `adsterraIntegrations/${uid}`;

  try {
    const existingSnap = await getDoc(docRef);
    if (existingSnap.exists()) {
      await setDoc(docRef, {
        uid,
        ownerUserId: uid,
        connectionMode: 'manual_smartlink',
        status: 'disconnected',
        publisherId: '',
        publisherLabel: '',
        smartlinkUrl: '',
        smartlinkTitle: '',
        hasApiKey: false,
        apiKeyHint: '',
        apiVerified: false,
        verifiedDomainsCount: 0,
        verifiedPlacementsCount: 0,
        createdAt: existingSnap.data().createdAt,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, docPath);
  }

  return nextBackendStatus;
}

export function subscribeMyPersonalSmartlinks(
  uid: string,
  onUpdate: (links: UserPersonalSmartlink[]) => void,
  onError?: (err: Error) => void
): () => void {
  const q = query(
    collection(db, 'userSmartlinks'),
    where('ownerUserId', '==', uid),
    limit(100)
  );

  return onSnapshot(
    q,
    (snap) => {
      const list: UserPersonalSmartlink[] = snap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: String(data.id ?? d.id),
            ownerUserId: String(data.ownerUserId ?? uid),
            title: String(data.title ?? 'Smartlink'),
            url: String(data.url ?? ''),
            domain: String(data.domain ?? ''),
            category: String(data.category ?? 'Other'),
            isHttps: Boolean(data.isHttps),
            createdAtMs: timestampToMs(data.createdAt),
            updatedAtMs: timestampToMs(data.updatedAt),
          };
        })
        .sort((a, b) => b.createdAtMs - a.createdAtMs);
      onUpdate(list);
    },
    (error) => {
      reportFirestoreListenerError(error, OperationType.LIST, 'userSmartlinks', onError);
    }
  );
}

export async function createMyPersonalSmartlink(params: {
  uid: string;
  title: string;
  rawUrl: string;
  category: string;
}): Promise<string> {
  const current = auth.currentUser;
  if (!current || current.uid !== params.uid || !current.emailVerified) {
    throw new Error('Verified user session required.');
  }

  const cleanTitle = params.title.trim().slice(0, 80);
  if (cleanTitle.length < 2) {
    throw new Error('Smartlink title must be at least 2 characters.');
  }

  const urlCheck = validateAndNormalizeUrl(params.rawUrl);
  const resolvedUrl = urlCheck.url || urlCheck.normalizedUrl;
  if (!urlCheck.valid || !resolvedUrl || !urlCheck.domain) {
    throw new Error(urlCheck.error || 'Please enter a valid Smartlink URL.');
  }

  const cleanCategory = params.category.trim().slice(0, 40) || 'Other';
  const linkRef = doc(collection(db, 'userSmartlinks'));

  try {
    await setDoc(linkRef, {
      id: linkRef.id,
      ownerUserId: params.uid,
      title: cleanTitle,
      url: resolvedUrl,
      domain: urlCheck.domain.slice(0, 120),
      category: cleanCategory,
      isHttps: Boolean(urlCheck.isHttps),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `userSmartlinks/${linkRef.id}`);
  }

  return linkRef.id;
}

export async function updateMyPersonalSmartlink(params: {
  uid: string;
  existing: UserPersonalSmartlink;
  title: string;
  rawUrl: string;
  category: string;
}): Promise<void> {
  const current = auth.currentUser;
  if (!current || current.uid !== params.uid || params.existing.ownerUserId !== params.uid) {
    throw new Error('You can only edit your own personal Smartlinks.');
  }

  const cleanTitle = params.title.trim().slice(0, 80);
  if (cleanTitle.length < 2) {
    throw new Error('Smartlink title must be at least 2 characters.');
  }

  const urlCheck = validateAndNormalizeUrl(params.rawUrl);
  const resolvedUrl = urlCheck.url || urlCheck.normalizedUrl;
  if (!urlCheck.valid || !resolvedUrl || !urlCheck.domain) {
    throw new Error(urlCheck.error || 'Please enter a valid Smartlink URL.');
  }

  const cleanCategory = params.category.trim().slice(0, 40) || 'Other';
  const docPath = `userSmartlinks/${params.existing.id}`;

  try {
    await setDoc(doc(db, 'userSmartlinks', params.existing.id), {
      id: params.existing.id,
      ownerUserId: params.uid,
      title: cleanTitle,
      url: resolvedUrl,
      domain: urlCheck.domain.slice(0, 120),
      category: cleanCategory,
      isHttps: Boolean(urlCheck.isHttps),
      createdAt: Timestamp.fromMillis(params.existing.createdAtMs),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, docPath);
  }
}

export async function deleteMyPersonalSmartlink(uid: string, linkId: string): Promise<void> {
  const current = auth.currentUser;
  if (!current || current.uid !== uid || !current.emailVerified) {
    throw new Error('Verified user session required.');
  }
  const docPath = `userSmartlinks/${linkId}`;
  try {
    await deleteDoc(doc(db, 'userSmartlinks', linkId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, docPath);
  }
}
