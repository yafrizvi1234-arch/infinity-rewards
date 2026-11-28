import { auth } from '../firebase';
import {
  AdsterraBackendStatus,
  AdsterraConnectionMode,
  AdsterraDatePreset,
  AdsterraIntegrationRecord,
  UserPersonalSmartlink,
} from '../types';
import { validateAndNormalizeUrl } from '../utils/urlValidator';
import {
  apiRequest,
  createPollingSubscription,
  emitSyncTopics,
  getConfiguredApiBaseUrl,
} from './apiClient';

export { getConfiguredApiBaseUrl };

export const DEFAULT_BACKEND_STATUS: AdsterraBackendStatus = {
  backendReachable: false,
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

export async function fetchAdsterraBackendStatus(): Promise<AdsterraBackendStatus> {
  return apiRequest<AdsterraBackendStatus>('/api/adsterra/status', { method: 'GET' });
}

export async function connectAdsterraApiKeySecure(params: {
  apiKey: string;
  verifyWithAdsterra: boolean;
}): Promise<AdsterraBackendStatus> {
  const trimmed = params.apiKey.trim();
  if (trimmed.length < 12 || trimmed.length > 200 || /\s/.test(trimmed)) {
    throw new Error('Adsterra API Key must be 12 to 200 characters without spaces.');
  }
  return apiRequest<AdsterraBackendStatus>('/api/adsterra/connect', {
    method: 'POST',
    body: {
      apiKey: trimmed,
      verifyWithAdsterra: params.verifyWithAdsterra,
    },
  });
}

export async function syncAdsterraOfficialApi(): Promise<AdsterraBackendStatus> {
  return apiRequest<AdsterraBackendStatus>('/api/adsterra/sync', { method: 'POST' });
}

export async function fetchAdsterraDetailedStats(params: {
  preset: AdsterraDatePreset;
  startDate?: string;
  finishDate?: string;
  domainId?: string;
  placementId?: string;
  country?: string;
}): Promise<AdsterraBackendStatus> {
  return apiRequest<AdsterraBackendStatus>('/api/adsterra/stats', {
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
  return apiRequest<AdsterraBackendStatus>('/api/adsterra/disconnect', {
    method: 'DELETE',
  });
}

export function subscribeMyAdsterraIntegration(
  _uid: string,
  onUpdate: (integration: AdsterraIntegrationRecord | null) => void,
  onError?: (err: Error) => void
): () => void {
  return createPollingSubscription<AdsterraIntegrationRecord | null>(
    'adsterra-integration',
    async () => {
      const res = await apiRequest<{ integration: AdsterraIntegrationRecord | null }>(
        '/api/adsterra/integration'
      );
      return res.integration ?? null;
    },
    onUpdate,
    onError,
    30000
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

  await apiRequest('/api/adsterra/integration', {
    method: 'PUT',
    body: {
      publisherId: params.publisherId,
      publisherLabel: params.publisherLabel,
      smartlinkTitle: params.smartlinkTitle,
      smartlinkUrl: validatedUrl,
      connectionMode: params.connectionMode,
      hasApiKey: params.backendStatus.hasApiKey,
      apiKeyHint: params.backendStatus.apiKeyHint,
      apiVerified: params.backendStatus.apiVerified,
      verifiedDomainsCount: params.backendStatus.verifiedDomainsCount,
      verifiedPlacementsCount: params.backendStatus.verifiedPlacementsCount,
      lastSyncedAtMs: params.backendStatus.lastSyncedAtMs,
    },
  });

  emitSyncTopics('adsterra-integration');
}

export async function disconnectMyAdsterraIntegration(
  uid: string
): Promise<AdsterraBackendStatus> {
  const current = auth.currentUser;
  if (!current || current.uid !== uid || !current.emailVerified) {
    throw new Error('Verified user session required.');
  }

  const nextBackendStatus = await apiRequest<AdsterraBackendStatus>(
    '/api/adsterra/integration',
    { method: 'DELETE' }
  );
  emitSyncTopics('adsterra-integration');
  return nextBackendStatus;
}

export function subscribeMyPersonalSmartlinks(
  _uid: string,
  onUpdate: (links: UserPersonalSmartlink[]) => void,
  onError?: (err: Error) => void
): () => void {
  return createPollingSubscription<UserPersonalSmartlink[]>(
    'adsterra-smartlinks',
    async () => {
      const res = await apiRequest<{ smartlinks: UserPersonalSmartlink[] }>(
        '/api/adsterra/smartlinks'
      );
      return res.smartlinks || [];
    },
    onUpdate,
    onError,
    30000
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

  const res = await apiRequest<{ id: string }>('/api/adsterra/smartlinks', {
    method: 'POST',
    body: {
      title: params.title,
      rawUrl: params.rawUrl,
      category: params.category,
    },
  });

  emitSyncTopics('adsterra-smartlinks');
  return res.id;
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

  await apiRequest(`/api/adsterra/smartlinks/${encodeURIComponent(params.existing.id)}`, {
    method: 'PUT',
    body: {
      title: params.title,
      rawUrl: params.rawUrl,
      category: params.category,
    },
  });

  emitSyncTopics('adsterra-smartlinks');
}

export async function deleteMyPersonalSmartlink(uid: string, linkId: string): Promise<void> {
  const current = auth.currentUser;
  if (!current || current.uid !== uid || !current.emailVerified) {
    throw new Error('Verified user session required.');
  }

  await apiRequest(`/api/adsterra/smartlinks/${encodeURIComponent(linkId)}`, {
    method: 'DELETE',
  });

  emitSyncTopics('adsterra-smartlinks');
}
