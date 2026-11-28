import { User } from 'firebase/auth';
import { USER_AVATAR } from '../data/demoData';
import { auth } from '../firebase';
import {
  LinkReportRecord,
  LinkVisitRecord,
  ManagedLink,
  ModerationLogRecord,
  PaymentRequestRecord,
  VisitTab,
} from '../types';
import { computeUrlKey, validateAndNormalizeUrl } from '../utils/urlValidator';
import {
  apiRequest,
  createPollingSubscription,
  emitSyncTopics,
} from './apiClient';

export const ADMIN_EMAIL = 'yafrizvi1234@gmail.com';
export const MIN_COOLDOWN_SEC = 12 * 3600;
export const MAX_COOLDOWN_SEC = 24 * 3600;
export const DEFAULT_SPAM_COOLDOWN_SEC = 18 * 3600;

export function getRandomCooldownSec(): number {
  return (
    Math.floor(Math.random() * (MAX_COOLDOWN_SEC - MIN_COOLDOWN_SEC + 1)) +
    MIN_COOLDOWN_SEC
  );
}

export function clampSafeCooldownSec(rawSec?: number | null): number {
  if (
    typeof rawSec === 'number' &&
    Number.isFinite(rawSec) &&
    rawSec >= MIN_COOLDOWN_SEC &&
    rawSec <= MAX_COOLDOWN_SEC
  ) {
    return Math.floor(rawSec);
  }
  return getRandomCooldownSec();
}

export function formatCooldownDuration(totalSec: number): string {
  const sec = Math.max(0, Math.ceil(totalSec));
  if (sec >= 3600) {
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
  }
  if (sec >= 60) {
    const mins = Math.floor(sec / 60);
    const remSec = sec % 60;
    return remSec > 0 ? `${mins}m ${remSec}s` : `${mins}m`;
  }
  return `${sec}s`;
}

export function sanitizeTargetGeos(rawGeos?: unknown): string[] {
  const fallback = ['US', 'UK', 'UAE', 'AU'];
  if (!Array.isArray(rawGeos)) return fallback;
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const item of rawGeos) {
    if (typeof item !== 'string') continue;
    const norm = item.trim().toUpperCase().slice(0, 10);
    if (norm.length < 2 || seen.has(norm)) continue;
    seen.add(norm);
    cleaned.push(norm);
    if (cleaned.length >= 8) break;
  }
  return cleaned.length > 0 ? cleaned : fallback;
}

export function isAdminEmail(
  email: string | null | undefined,
  emailVerified: boolean
): boolean {
  if (!emailVerified || !email) return false;
  return email.trim().toLowerCase() === ADMIN_EMAIL;
}

export async function assertVerifiedAdminSession(): Promise<{ uid: string; email: string }> {
  const current = auth.currentUser;
  if (!current || !(await checkIsAdminUser(current, true))) {
    throw new Error('Unauthorized: Verified admin email required.');
  }
  return {
    uid: current.uid,
    email: current.email!.trim().toLowerCase(),
  };
}

export async function checkIsAdminUser(
  user: User | null,
  forceRefresh = true
): Promise<boolean> {
  if (!user || !isAdminEmail(user.email, user.emailVerified)) {
    return false;
  }
  try {
    const tokenResult = await user.getIdTokenResult(forceRefresh);
    const tokenEmail =
      typeof tokenResult.claims.email === 'string' ? tokenResult.claims.email : null;
    const tokenVerified = tokenResult.claims.email_verified === true;
    return isAdminEmail(tokenEmail, tokenVerified);
  } catch {
    return false;
  }
}

export async function checkDuplicateUrlKey(urlKey: string): Promise<{
  isDuplicate: boolean;
  existingLinkId?: string;
}> {
  return apiRequest<{ isDuplicate: boolean; existingLinkId?: string }>(
    `/api/links/check-duplicate?urlKey=${encodeURIComponent(urlKey)}`,
    { method: 'GET' }
  );
}

export async function submitLinkSecure(params: {
  uid: string;
  ownerName: string;
  ownerUsername: string;
  ownerAvatar: string;
  type: VisitTab;
  title: string;
  description: string;
  rawUrl: string;
  category: string;
  cooldownSec?: number;
  targetGeos?: string[];
}): Promise<string> {
  const validation = validateAndNormalizeUrl(params.rawUrl);
  if (!validation.valid || !validation.url || !validation.normalizedUrl || !validation.domain) {
    throw new Error(validation.error || 'Invalid URL.');
  }

  const cleanTitle = params.title.trim().slice(0, 80);
  if (cleanTitle.length < 3) {
    throw new Error('Link title must be at least 3 characters.');
  }

  const cleanDescription = params.description.trim().slice(0, 300);
  if (cleanDescription.length < 10) {
    throw new Error('Description must be at least 10 characters.');
  }

  const urlKey = await computeUrlKey(validation.normalizedUrl);
  const dup = await checkDuplicateUrlKey(urlKey);
  if (dup.isDuplicate) {
    throw new Error('This URL has already been submitted. Duplicate links are not permitted.');
  }

  const res = await apiRequest<{ id: string }>('/api/links', {
    method: 'POST',
    body: {
      ownerName: params.ownerName,
      ownerUsername: params.ownerUsername,
      ownerAvatar: params.ownerAvatar,
      type: params.type,
      title: cleanTitle,
      description: cleanDescription,
      rawUrl: params.rawUrl,
      category: params.category.trim().slice(0, 40) || 'Other',
      cooldownSec: clampSafeCooldownSec(params.cooldownSec),
      targetGeos: sanitizeTargetGeos(params.targetGeos),
    },
  });

  emitSyncTopics('links-approved', 'links-mine', 'admin-overview');
  return res.id;
}

export async function updateOwnLinkSecure(params: {
  uid: string;
  existingLink: ManagedLink;
  type: VisitTab;
  title: string;
  description: string;
  rawUrl: string;
  category: string;
  targetGeos?: string[];
}): Promise<void> {
  if (params.existingLink.ownerId !== params.uid) {
    throw new Error('You can only edit links you submitted.');
  }

  await apiRequest(`/api/links/${encodeURIComponent(params.existingLink.id)}`, {
    method: 'PUT',
    body: {
      type: params.type,
      title: params.title,
      description: params.description,
      rawUrl: params.rawUrl,
      category: params.category,
      targetGeos: sanitizeTargetGeos(params.targetGeos ?? params.existingLink.targetGeos),
    },
  });

  emitSyncTopics('links-approved', 'links-mine', 'admin-overview');
}

export async function deleteLinkSecure(params: {
  link: ManagedLink;
  actorUid: string;
  actorEmail?: string | null;
  asAdmin?: boolean;
  reason?: string;
}): Promise<void> {
  const { link, actorUid, asAdmin, reason } = params;
  if (!asAdmin && link.ownerId !== actorUid) {
    throw new Error('You can only delete your own links.');
  }
  if (asAdmin) {
    await assertVerifiedAdminSession();
  }

  await apiRequest(`/api/links/${encodeURIComponent(link.id)}`, {
    method: 'DELETE',
    body: {
      asAdmin: Boolean(asAdmin),
      reason,
    },
  });

  emitSyncTopics('links-approved', 'links-mine', 'admin-overview');
}

export async function recordExternalLinkOpen(params: {
  uid: string;
  link: ManagedLink;
}): Promise<string> {
  const res = await apiRequest<{ id: string }>('/api/links/visit-open', {
    method: 'POST',
    body: {
      linkId: params.link.id,
      linkTitle: params.link.title,
      linkType: params.link.type,
      category: params.link.category,
      domain: params.link.domain,
      url: params.link.url,
      cooldownSec: clampSafeCooldownSec(params.link.cooldownSec),
    },
  });

  emitSyncTopics('links-visits');
  return res.id;
}

export async function reportLinkSecure(params: {
  link: ManagedLink;
  reporterUid: string;
  reporterUsername: string;
  reason: string;
}): Promise<void> {
  const cleanReason = params.reason.trim().slice(0, 240);
  if (cleanReason.length < 5) {
    throw new Error('Please provide a clear reason (at least 5 characters).');
  }

  await apiRequest('/api/links/report', {
    method: 'POST',
    body: {
      linkId: params.link.id,
      reporterUsername: params.reporterUsername,
      reason: cleanReason,
    },
  });

  emitSyncTopics('links-approved', 'admin-overview');
}

export async function moderateLinkSecure(params: {
  link: ManagedLink;
  decision: 'approved' | 'rejected';
  note: string;
  adminUid: string;
  adminEmail: string | null;
}): Promise<void> {
  await assertVerifiedAdminSession();

  await apiRequest(`/api/admin/links/${encodeURIComponent(params.link.id)}/moderate`, {
    method: 'POST',
    body: {
      decision: params.decision,
      note: params.note,
    },
  });

  emitSyncTopics('links-approved', 'links-mine', 'admin-overview');
}

export async function resolveReportSecure(params: {
  report: LinkReportRecord;
  linkedItem?: ManagedLink;
  action: 'resolve_and_remove' | 'dismiss';
  adminNote: string;
  adminUid: string;
  adminEmail: string | null;
}): Promise<void> {
  await assertVerifiedAdminSession();

  await apiRequest(`/api/admin/reports/${encodeURIComponent(params.report.id)}/resolve`, {
    method: 'POST',
    body: {
      action: params.action,
      adminNote: params.adminNote,
    },
  });

  emitSyncTopics('links-approved', 'links-mine', 'admin-overview');
}

function hydrateLinkAvatar(link: ManagedLink): ManagedLink {
  return {
    ...link,
    ownerAvatar: link.ownerAvatar || USER_AVATAR,
  };
}

export function subscribeApprovedLinks(
  onUpdate: (links: ManagedLink[]) => void,
  onError?: (err: Error) => void
): () => void {
  return createPollingSubscription<ManagedLink[]>(
    'links-approved',
    async () => {
      const res = await apiRequest<{ links: ManagedLink[] }>('/api/links/approved');
      return (res.links || []).map(hydrateLinkAvatar);
    },
    onUpdate,
    onError,
    20000
  );
}

export function subscribeMySubmittedLinks(
  _uid: string,
  onUpdate: (links: ManagedLink[]) => void,
  onError?: (err: Error) => void
): () => void {
  return createPollingSubscription<ManagedLink[]>(
    'links-mine',
    async () => {
      const res = await apiRequest<{ links: ManagedLink[] }>('/api/links/mine');
      return (res.links || []).map(hydrateLinkAvatar);
    },
    onUpdate,
    onError,
    20000
  );
}

export function subscribeMyLinkVisits(
  _uid: string,
  onUpdate: (visits: LinkVisitRecord[]) => void,
  onError?: (err: Error) => void
): () => void {
  return createPollingSubscription<LinkVisitRecord[]>(
    'links-visits',
    async () => {
      const res = await apiRequest<{ visits: LinkVisitRecord[] }>('/api/links/visits');
      return res.visits || [];
    },
    onUpdate,
    onError,
    25000
  );
}

interface AdminOverviewResponse {
  links: ManagedLink[];
  reports: LinkReportRecord[];
  logs: ModerationLogRecord[];
  paymentRequests: PaymentRequestRecord[];
}

export function subscribeAdminAllLinks(
  onUpdate: (links: ManagedLink[]) => void,
  onError?: (err: Error) => void
): () => void {
  return createPollingSubscription<ManagedLink[]>(
    'admin-overview',
    async () => {
      const res = await apiRequest<AdminOverviewResponse>('/api/admin/overview');
      return (res.links || []).map(hydrateLinkAvatar);
    },
    onUpdate,
    onError,
    20000
  );
}

export function subscribeAdminReports(
  onUpdate: (reports: LinkReportRecord[]) => void,
  onError?: (err: Error) => void
): () => void {
  return createPollingSubscription<LinkReportRecord[]>(
    'admin-overview',
    async () => {
      const res = await apiRequest<AdminOverviewResponse>('/api/admin/overview');
      return res.reports || [];
    },
    onUpdate,
    onError,
    20000
  );
}

export function subscribeAdminModerationLogs(
  onUpdate: (logs: ModerationLogRecord[]) => void,
  onError?: (err: Error) => void
): () => void {
  return createPollingSubscription<ModerationLogRecord[]>(
    'admin-overview',
    async () => {
      const res = await apiRequest<AdminOverviewResponse>('/api/admin/overview');
      return res.logs || [];
    },
    onUpdate,
    onError,
    20000
  );
}
