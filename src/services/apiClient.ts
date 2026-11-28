import { auth } from '../firebase';

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

export function resolveApiEndpoint(endpoint: string): string {
  const base = getConfiguredApiBaseUrl();
  if (!base) {
    return endpoint;
  }
  return `${base}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
}

export async function getVerifiedBearerToken(): Promise<string> {
  const current = auth.currentUser;
  if (!current || !current.emailVerified) {
    throw new Error('Verified user session is required.');
  }
  return current.getIdToken();
}

export async function apiRequest<T>(
  endpoint: string,
  options: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: Record<string, unknown> } = {}
): Promise<T> {
  const token = await getVerifiedBearerToken();
  const targetUrl = resolveApiEndpoint(endpoint);
  const method = options.method || 'GET';

  const res = await fetch(targetUrl, {
    method,
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
      'Unable to reach the application server right now. Please refresh or check your connection.'
    );
  }

  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export type SyncTopic =
  | 'profiles'
  | 'follows'
  | 'activities'
  | 'links-approved'
  | 'links-mine'
  | 'links-visits'
  | 'payments-me'
  | 'payments-config'
  | 'admin-overview'
  | 'adsterra-integration'
  | 'adsterra-smartlinks';

export function emitSyncTopics(...topics: SyncTopic[]): void {
  if (typeof window === 'undefined') return;
  for (const topic of topics) {
    window.dispatchEvent(new CustomEvent(`ir:sync:${topic}`));
  }
}

export function createPollingSubscription<T>(
  topic: SyncTopic,
  fetcher: () => Promise<T>,
  onUpdate: (data: T) => void,
  onError?: (err: Error) => void,
  intervalMs = 20000
): () => void {
  let cancelled = false;
  let inFlight = false;

  const runFetch = async () => {
    if (cancelled || inFlight) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    inFlight = true;
    try {
      const data = await fetcher();
      if (!cancelled) {
        onUpdate(data);
      }
    } catch (err) {
      if (!cancelled && onError) {
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      inFlight = false;
    }
  };

  void runFetch();

  const timer = window.setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return;
    }
    void runFetch();
  }, intervalMs);

  const eventName = `ir:sync:${topic}`;
  const onTopicEvent = () => {
    void runFetch();
  };
  const onFocus = () => {
    void runFetch();
  };

  window.addEventListener(eventName, onTopicEvent);
  window.addEventListener('focus', onFocus);

  return () => {
    cancelled = true;
    window.clearInterval(timer);
    window.removeEventListener(eventName, onTopicEvent);
    window.removeEventListener('focus', onFocus);
  };
}
