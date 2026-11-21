import { User } from 'firebase/auth';
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { USER_AVATAR } from '../data/demoData';
import {
  OperationType,
  auth,
  db,
  handleFirestoreError,
  reportFirestoreListenerError,
} from '../firebase';
import {
  LinkReportRecord,
  LinkStatus,
  LinkVisitRecord,
  ManagedLink,
  ModerationLogRecord,
  VisitTab,
} from '../types';
import { computeUrlKey, validateAndNormalizeUrl } from '../utils/urlValidator';

export const ADMIN_EMAIL = 'yafrizvi1234@gmail.com';
export const DEFAULT_SPAM_COOLDOWN_SEC = 60;

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

function mapManagedLink(id: string, data: Record<string, unknown>): ManagedLink {
  const status: LinkStatus =
    data.status === 'approved' || data.status === 'rejected' || data.status === 'pending'
      ? data.status
      : 'pending';
  const type: VisitTab = data.type === 'website' ? 'website' : 'smartlink';

  return {
    id,
    ownerId: String(data.ownerId ?? ''),
    ownerName: String(data.ownerName ?? 'Member'),
    ownerUsername: String(data.ownerUsername ?? '@member'),
    ownerAvatar: String(data.ownerAvatar ?? USER_AVATAR),
    type,
    title: String(data.title ?? 'Untitled Link'),
    description: String(data.description ?? ''),
    url: String(data.url ?? ''),
    normalizedUrl: String(data.normalizedUrl ?? data.url ?? ''),
    urlKey: String(data.urlKey ?? ''),
    domain: String(data.domain ?? ''),
    isHttps: Boolean(data.isHttps),
    category: String(data.category ?? 'Other'),
    status,
    cooldownSec: Number(data.cooldownSec ?? DEFAULT_SPAM_COOLDOWN_SEC),
    reportCount: Number(data.reportCount ?? 0),
    moderationNote: data.moderationNote ? String(data.moderationNote) : undefined,
    moderatedBy: data.moderatedBy ? String(data.moderatedBy) : undefined,
    moderatedAtMs: data.moderatedAt ? timestampToMs(data.moderatedAt) : undefined,
    createdAtMs: timestampToMs(data.createdAt),
    updatedAtMs: timestampToMs(data.updatedAt),
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
  const path = `linkRegistry/${urlKey}`;
  try {
    const snap = await getDoc(doc(db, 'linkRegistry', urlKey));
    if (!snap.exists()) {
      return { isDuplicate: false };
    }
    return {
      isDuplicate: true,
      existingLinkId: String(snap.data()?.linkId ?? ''),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
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

  const cleanCategory = params.category.trim().slice(0, 40) || 'Other';
  const urlKey = await computeUrlKey(validation.normalizedUrl);

  const dup = await checkDuplicateUrlKey(urlKey);
  if (dup.isDuplicate) {
    throw new Error('This URL has already been submitted. Duplicate links are not permitted.');
  }

  const linkRef = doc(collection(db, 'links'));
  const cooldown = Math.min(300, Math.max(30, Math.floor(params.cooldownSec ?? DEFAULT_SPAM_COOLDOWN_SEC)));

  const batch = writeBatch(db);
  batch.set(doc(db, 'linkRegistry', urlKey), {
    linkId: linkRef.id,
    ownerId: params.uid,
    normalizedUrl: validation.normalizedUrl,
    createdAt: serverTimestamp(),
  });

  batch.set(linkRef, {
    id: linkRef.id,
    ownerId: params.uid,
    ownerName: params.ownerName.trim().slice(0, 50) || 'Member',
    ownerUsername: params.ownerUsername.trim().slice(0, 32) || '@member',
    ownerAvatar: params.ownerAvatar.slice(0, 140000),
    type: params.type,
    title: cleanTitle,
    description: cleanDescription,
    url: validation.url,
    normalizedUrl: validation.normalizedUrl,
    urlKey,
    domain: validation.domain.slice(0, 120),
    isHttps: Boolean(validation.isHttps),
    category: cleanCategory,
    status: params.type === 'smartlink' ? 'approved' : 'pending',
    cooldownSec: cooldown,
    reportCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `links/${linkRef.id}`);
  }

  return linkRef.id;
}

const ALLOWED_LINK_KEYS = new Set([
  'id',
  'ownerId',
  'ownerName',
  'ownerUsername',
  'ownerAvatar',
  'type',
  'title',
  'description',
  'url',
  'normalizedUrl',
  'urlKey',
  'domain',
  'isHttps',
  'category',
  'status',
  'cooldownSec',
  'reportCount',
  'moderationNote',
  'moderatedBy',
  'moderatedAt',
  'createdAt',
  'updatedAt',
]);

function isRawLinkSchemaCompliant(linkId: string, raw: Record<string, unknown>): boolean {
  const keys = Object.keys(raw);
  if (keys.some((k) => !ALLOWED_LINK_KEYS.has(k))) return false;
  if (raw.id !== linkId) return false;
  if (typeof raw.ownerId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(raw.ownerId)) return false;
  if (typeof raw.ownerName !== 'string' || raw.ownerName.length < 1 || raw.ownerName.length > 50) return false;
  if (typeof raw.ownerUsername !== 'string' || raw.ownerUsername.length < 2 || raw.ownerUsername.length > 32) return false;
  if (typeof raw.ownerAvatar !== 'string' || raw.ownerAvatar.length > 140000) return false;
  if (raw.type !== 'smartlink' && raw.type !== 'website') return false;
  if (typeof raw.title !== 'string' || raw.title.length < 3 || raw.title.length > 80) return false;
  if (typeof raw.description !== 'string' || raw.description.length < 10 || raw.description.length > 300) return false;
  if (typeof raw.url !== 'string' || raw.url.length < 10 || raw.url.length > 500 || !/^https?:\/\/\S+$/.test(raw.url)) return false;
  if (typeof raw.normalizedUrl !== 'string' || raw.normalizedUrl.length < 10 || raw.normalizedUrl.length > 500 || !/^https?:\/\/\S+$/.test(raw.normalizedUrl)) return false;
  if (typeof raw.urlKey !== 'string' || !/^[a-zA-Z0-9_-]{8,96}$/.test(raw.urlKey)) return false;
  if (typeof raw.domain !== 'string' || raw.domain.length < 3 || raw.domain.length > 120) return false;
  if (typeof raw.isHttps !== 'boolean') return false;
  if (typeof raw.category !== 'string' || raw.category.length < 2 || raw.category.length > 40) return false;
  if (raw.status !== 'pending' && raw.status !== 'approved' && raw.status !== 'rejected') return false;
  if (typeof raw.cooldownSec !== 'number' || !Number.isInteger(raw.cooldownSec) || raw.cooldownSec < 30 || raw.cooldownSec > 300) return false;
  if (typeof raw.reportCount !== 'number' || !Number.isInteger(raw.reportCount) || raw.reportCount < 0 || raw.reportCount > 10000) return false;
  if ('moderationNote' in raw && (typeof raw.moderationNote !== 'string' || raw.moderationNote.length > 240)) return false;
  if ('moderatedBy' in raw && (typeof raw.moderatedBy !== 'string' || raw.moderatedBy.length > 128)) return false;
  if ('moderatedAt' in raw && !(raw.moderatedAt instanceof Timestamp)) return false;
  if (!(raw.createdAt instanceof Timestamp)) return false;
  if (!(raw.updatedAt instanceof Timestamp)) return false;
  return true;
}

export async function updateOwnLinkSecure(params: {
  uid: string;
  existingLink: ManagedLink;
  type: VisitTab;
  title: string;
  description: string;
  rawUrl: string;
  category: string;
}): Promise<void> {
  if (params.existingLink.ownerId !== params.uid) {
    throw new Error('You can only edit links you submitted.');
  }

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

  const cleanCategory = params.category.trim().slice(0, 40);
  const safeCategory = cleanCategory.length >= 2 ? cleanCategory : 'Other';
  const nextUrlKey = await computeUrlKey(validation.normalizedUrl);
  const urlChanged = nextUrlKey !== params.existingLink.urlKey;
  const oldUrlKey = params.existingLink.urlKey;
  const linkRef = doc(db, 'links', params.existingLink.id);

  const [linkSnap, oldRegSnap, nextRegSnap] = await Promise.all([
    getDoc(linkRef),
    urlChanged && oldUrlKey
      ? getDoc(doc(db, 'linkRegistry', oldUrlKey))
      : Promise.resolve(null),
    getDoc(doc(db, 'linkRegistry', nextUrlKey)),
  ]);

  if (!linkSnap.exists()) {
    throw new Error('This link no longer exists.');
  }

  if (nextRegSnap.exists() && nextRegSnap.data()?.linkId !== params.existingLink.id) {
    throw new Error('Another link already uses this destination URL.');
  }

  const batch = writeBatch(db);
  if (urlChanged && oldRegSnap?.exists()) {
    batch.delete(doc(db, 'linkRegistry', oldUrlKey));
  }
  if (!nextRegSnap.exists()) {
    batch.set(doc(db, 'linkRegistry', nextUrlKey), {
      linkId: params.existingLink.id,
      ownerId: params.uid,
      normalizedUrl: validation.normalizedUrl,
      createdAt: serverTimestamp(),
    });
  }

  const raw = linkSnap.data();
  if (isRawLinkSchemaCompliant(params.existingLink.id, raw)) {
    batch.update(linkRef, {
      type: params.type,
      title: cleanTitle,
      description: cleanDescription,
      url: validation.url,
      normalizedUrl: validation.normalizedUrl,
      urlKey: nextUrlKey,
      domain: validation.domain.slice(0, 120),
      isHttps: Boolean(validation.isHttps),
      category: safeCategory,
      status: params.type === 'smartlink' ? 'approved' : 'pending',
      updatedAt: serverTimestamp(),
    });
  } else {
    const safeOwnerName =
      String(raw.ownerName ?? params.existingLink.ownerName ?? 'Member').trim().slice(0, 50) || 'Member';
    const rawUsername = String(raw.ownerUsername ?? params.existingLink.ownerUsername ?? '@member').trim().slice(0, 32);
    const safeOwnerUsername = rawUsername.length >= 2 ? rawUsername : '@member';
    const safeOwnerAvatar = String(raw.ownerAvatar ?? params.existingLink.ownerAvatar ?? USER_AVATAR).slice(0, 140000);
    const safeCooldown =
      typeof raw.cooldownSec === 'number' && Number.isInteger(raw.cooldownSec)
        ? Math.min(300, Math.max(30, raw.cooldownSec))
        : DEFAULT_SPAM_COOLDOWN_SEC;
    const safeReportCount =
      typeof raw.reportCount === 'number' && Number.isInteger(raw.reportCount) && raw.reportCount >= 0
        ? Math.min(10000, raw.reportCount)
        : 0;

    batch.set(linkRef, {
      id: params.existingLink.id,
      ownerId: String(raw.ownerId ?? params.uid),
      ownerName: safeOwnerName,
      ownerUsername: safeOwnerUsername,
      ownerAvatar: safeOwnerAvatar,
      type: params.type,
      title: cleanTitle,
      description: cleanDescription,
      url: validation.url,
      normalizedUrl: validation.normalizedUrl,
      urlKey: nextUrlKey,
      domain: validation.domain.slice(0, 120),
      isHttps: Boolean(validation.isHttps),
      category: safeCategory,
      status: params.type === 'smartlink' ? 'approved' : 'pending',
      cooldownSec: safeCooldown,
      reportCount: safeReportCount,
      createdAt: raw.createdAt instanceof Timestamp ? raw.createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `links/${params.existingLink.id}`);
  }
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

  let verifiedAdmin: { uid: string; email: string } | null = null;
  if (asAdmin) {
    verifiedAdmin = await assertVerifiedAdminSession();
  }

  const regSnap = link.urlKey ? await getDoc(doc(db, 'linkRegistry', link.urlKey)) : null;

  const batch = writeBatch(db);
  batch.delete(doc(db, 'links', link.id));
  if (link.urlKey && regSnap?.exists()) {
    batch.delete(doc(db, 'linkRegistry', link.urlKey));
  }

  if (verifiedAdmin) {
    const logRef = doc(collection(db, 'moderationLogs'));
    batch.set(logRef, {
      linkId: link.id,
      linkTitle: link.title.slice(0, 80),
      targetOwnerId: link.ownerId,
      action: 'remove',
      reason: (reason || 'Removed by administrator').trim().slice(0, 240),
      adminUid: verifiedAdmin.uid,
      adminEmail: verifiedAdmin.email.slice(0, 120),
      createdAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `links/${link.id}`);
  }
}

/**
 * Records external link opening strictly for user history & spam-prevention cooldown.
 * Intentionally awards ZERO points/rewards and does NOT count as ad impressions.
 */
export async function recordExternalLinkOpen(params: {
  uid: string;
  link: ManagedLink;
}): Promise<string> {
  const visitRef = doc(collection(db, 'linkVisits'));
  const urlCheck = validateAndNormalizeUrl(params.link.url || '');
  const safeUrl =
    urlCheck.valid && urlCheck.url
      ? urlCheck.url
      : /^https?:\/\/\S{4,}$/.test((params.link.url || '').trim())
        ? params.link.url.trim().slice(0, 500)
        : 'https://example.com';
  const rawDomain = (urlCheck.domain || params.link.domain || '').trim();
  const safeDomain = rawDomain.length >= 3 ? rawDomain.slice(0, 120) : 'example.com';
  const safeTitle = (params.link.title || '').trim().slice(0, 80) || 'Smartlink';
  const safeCategory = (params.link.category || '').trim().slice(0, 40) || 'Other';

  const batch = writeBatch(db);
  batch.set(visitRef, {
    uid: params.uid,
    linkId: params.link.id,
    linkTitle: safeTitle,
    linkType: params.link.type,
    category: safeCategory,
    domain: safeDomain,
    url: safeUrl,
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `linkVisits/${visitRef.id}`);
  }

  return visitRef.id;
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

  const reportId = `${params.reporterUid}_${params.link.id}`;
  const reportRef = doc(db, 'linkReports', reportId);

  try {
    const existingSnap = await getDoc(reportRef);
    if (existingSnap.exists()) {
      throw new Error('You have already submitted a report for this link.');
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('already submitted')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.GET, `linkReports/${reportId}`);
  }

  const batch = writeBatch(db);
  batch.set(reportRef, {
    linkId: params.link.id,
    linkTitle: params.link.title.slice(0, 80),
    linkUrl: params.link.url.slice(0, 500),
    reporterId: params.reporterUid,
    reporterUsername: params.reporterUsername.slice(0, 32),
    reason: cleanReason,
    status: 'open',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.update(doc(db, 'links', params.link.id), {
    reportCount: params.link.reportCount + 1,
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `linkReports/${reportId}`);
  }
}

export async function moderateLinkSecure(params: {
  link: ManagedLink;
  decision: 'approved' | 'rejected';
  note: string;
  adminUid: string;
  adminEmail: string | null;
}): Promise<void> {
  const adminSession = await assertVerifiedAdminSession();
  const cleanNote = params.note.trim().slice(0, 240);
  const linkRef = doc(db, 'links', params.link.id);
  const linkSnap = await getDoc(linkRef);
  if (!linkSnap.exists()) {
    throw new Error('This link no longer exists.');
  }

  const raw = linkSnap.data();
  const batch = writeBatch(db);

  if (isRawLinkSchemaCompliant(params.link.id, raw)) {
    batch.update(linkRef, {
      status: params.decision,
      moderationNote: cleanNote,
      moderatedBy: adminSession.uid,
      moderatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } else {
    const rawUrlCandidate = String(raw.url || params.link.url || '').trim();
    const urlCheck = validateAndNormalizeUrl(rawUrlCandidate);
    const safeUrl =
      urlCheck.valid && urlCheck.url
        ? urlCheck.url
        : /^https?:\/\/\S{4,}$/.test(rawUrlCandidate)
          ? rawUrlCandidate.slice(0, 500)
          : 'https://example.com';
    const safeNormalizedUrl =
      urlCheck.valid && urlCheck.normalizedUrl ? urlCheck.normalizedUrl : safeUrl;
    const safeDomain =
      urlCheck.valid && urlCheck.domain && urlCheck.domain.length >= 3
        ? urlCheck.domain.slice(0, 120)
        : String(raw.domain || params.link.domain || 'example.com').trim().slice(0, 120) || 'example.com';
    const safeUrlKey =
      typeof raw.urlKey === 'string' && /^[a-zA-Z0-9_-]{8,96}$/.test(raw.urlKey)
        ? raw.urlKey
        : await computeUrlKey(safeNormalizedUrl);
    const rawTitle = String(raw.title ?? params.link.title ?? 'Community Link').trim().slice(0, 80);
    const safeTitle = rawTitle.length >= 3 ? rawTitle : 'Community Link';
    const rawDesc = String(raw.description ?? params.link.description ?? '').trim().slice(0, 300);
    const safeDescription =
      rawDesc.length >= 10 ? rawDesc : 'Community shared resource verified by moderation.';
    const rawCategory = String(raw.category ?? params.link.category ?? 'Other').trim().slice(0, 40);
    const safeCategory = rawCategory.length >= 2 ? rawCategory : 'Other';
    const safeOwnerName =
      String(raw.ownerName ?? params.link.ownerName ?? 'Member').trim().slice(0, 50) || 'Member';
    const rawUsername = String(raw.ownerUsername ?? params.link.ownerUsername ?? '@member').trim().slice(0, 32);
    const safeOwnerUsername = rawUsername.length >= 2 ? rawUsername : '@member';
    const safeOwnerAvatar = String(raw.ownerAvatar ?? params.link.ownerAvatar ?? USER_AVATAR).slice(0, 140000);
    const safeCooldown =
      typeof raw.cooldownSec === 'number' && Number.isInteger(raw.cooldownSec)
        ? Math.min(300, Math.max(30, raw.cooldownSec))
        : DEFAULT_SPAM_COOLDOWN_SEC;
    const safeReportCount =
      typeof raw.reportCount === 'number' && Number.isInteger(raw.reportCount) && raw.reportCount >= 0
        ? Math.min(10000, raw.reportCount)
        : 0;

    batch.set(linkRef, {
      id: params.link.id,
      ownerId: String(raw.ownerId ?? params.link.ownerId),
      ownerName: safeOwnerName,
      ownerUsername: safeOwnerUsername,
      ownerAvatar: safeOwnerAvatar,
      type: raw.type === 'website' ? 'website' : 'smartlink',
      title: safeTitle,
      description: safeDescription,
      url: safeUrl,
      normalizedUrl: safeNormalizedUrl,
      urlKey: safeUrlKey,
      domain: safeDomain.length >= 3 ? safeDomain : 'example.com',
      isHttps: typeof raw.isHttps === 'boolean' ? raw.isHttps : safeUrl.startsWith('https://'),
      category: safeCategory,
      status: params.decision,
      cooldownSec: safeCooldown,
      reportCount: safeReportCount,
      moderationNote: cleanNote,
      moderatedBy: adminSession.uid,
      moderatedAt: serverTimestamp(),
      createdAt: raw.createdAt instanceof Timestamp ? raw.createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  const safeLogTitle =
    (String(raw.title ?? params.link.title ?? '').trim() || 'Community Link').slice(0, 80);
  const safeTargetOwnerId = String(raw.ownerId ?? params.link.ownerId ?? '').trim() || adminSession.uid;

  const logRef = doc(collection(db, 'moderationLogs'));
  batch.set(logRef, {
    linkId: params.link.id,
    linkTitle: safeLogTitle,
    targetOwnerId: safeTargetOwnerId,
    action: params.decision === 'approved' ? 'approve' : 'reject',
    reason:
      cleanNote ||
      (params.decision === 'approved' ? 'Approved for public directory' : 'Rejected by moderator'),
    adminUid: adminSession.uid,
    adminEmail: adminSession.email.slice(0, 120),
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `links/${params.link.id}`);
  }
}

export async function resolveReportSecure(params: {
  report: LinkReportRecord;
  linkedItem?: ManagedLink;
  action: 'resolve_and_remove' | 'dismiss';
  adminNote: string;
  adminUid: string;
  adminEmail: string | null;
}): Promise<void> {
  const adminSession = await assertVerifiedAdminSession();
  const cleanNote = params.adminNote.trim().slice(0, 240);
  const batch = writeBatch(db);

  batch.update(doc(db, 'linkReports', params.report.id), {
    status: params.action === 'resolve_and_remove' ? 'resolved' : 'dismissed',
    adminNote: cleanNote || (params.action === 'resolve_and_remove' ? 'Link removed' : 'Report dismissed'),
    updatedAt: serverTimestamp(),
  });

  if (params.action === 'resolve_and_remove' && params.linkedItem) {
    const linkRef = doc(db, 'links', params.linkedItem.id);
    const linkSnap = await getDoc(linkRef);
    if (linkSnap.exists()) {
      batch.delete(linkRef);
    }
    if (params.linkedItem.urlKey) {
      const regRef = doc(db, 'linkRegistry', params.linkedItem.urlKey);
      const regSnap = await getDoc(regRef);
      if (regSnap.exists()) {
        batch.delete(regRef);
      }
    }
  }

  const logRef = doc(collection(db, 'moderationLogs'));
  batch.set(logRef, {
    linkId: params.report.linkId,
    linkTitle: params.report.linkTitle.slice(0, 80),
    targetOwnerId: params.linkedItem?.ownerId || params.report.reporterId,
    action: params.action === 'resolve_and_remove' ? 'resolve_report' : 'dismiss_report',
    reason:
      cleanNote ||
      (params.action === 'resolve_and_remove'
        ? `Removed reported link: ${params.report.reason}`
        : `Dismissed report: ${params.report.reason}`
      ).slice(0, 240),
    adminUid: adminSession.uid,
    adminEmail: adminSession.email.slice(0, 120),
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `linkReports/${params.report.id}`);
  }
}

// Subscriptions (single-field equality queries + client sorting to prevent composite index issues)
export function subscribeApprovedLinks(
  onUpdate: (links: ManagedLink[]) => void,
  onError?: (err: Error) => void
): () => void {
  const approvedById = new Map<string, ManagedLink>();
  const smartlinksById = new Map<string, ManagedLink>();

  const emitMerged = () => {
    const merged = new Map<string, ManagedLink>();
    for (const [id, item] of approvedById) {
      merged.set(id, item);
    }
    for (const [id, item] of smartlinksById) {
      if (item.status !== 'rejected') {
        merged.set(id, { ...item, status: 'approved' });
      }
    }
    const items = Array.from(merged.values()).sort((a, b) => {
      if (a.isHttps !== b.isHttps) return a.isHttps ? -1 : 1;
      return b.updatedAtMs - a.updatedAtMs;
    });
    onUpdate(items);
  };

  const approvedQ = query(collection(db, 'links'), where('status', '==', 'approved'), limit(150));
  const smartlinksQ = query(collection(db, 'links'), where('type', '==', 'smartlink'), limit(150));

  const unsubApproved = onSnapshot(
    approvedQ,
    (snap) => {
      approvedById.clear();
      for (const d of snap.docs) {
        const mapped = mapManagedLink(d.id, d.data());
        if (mapped.status !== 'rejected') {
          approvedById.set(d.id, mapped);
        }
      }
      emitMerged();
    },
    (error) => {
      reportFirestoreListenerError(error, OperationType.LIST, 'links', onError);
    }
  );

  const unsubSmartlinks = onSnapshot(
    smartlinksQ,
    (snap) => {
      smartlinksById.clear();
      for (const d of snap.docs) {
        const mapped = mapManagedLink(d.id, d.data());
        if (mapped.status !== 'rejected') {
          smartlinksById.set(d.id, mapped);
        }
      }
      emitMerged();
    },
    (error) => {
      reportFirestoreListenerError(error, OperationType.LIST, 'links', onError);
    }
  );

  return () => {
    unsubApproved();
    unsubSmartlinks();
  };
}

export function subscribeMySubmittedLinks(
  uid: string,
  onUpdate: (links: ManagedLink[]) => void,
  onError?: (err: Error) => void
): () => void {
  const q = query(collection(db, 'links'), where('ownerId', '==', uid), limit(100));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => mapManagedLink(d.id, d.data()))
        .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
      onUpdate(items);
    },
    (error) => {
      reportFirestoreListenerError(error, OperationType.LIST, 'links', onError);
    }
  );
}

export function subscribeMyLinkVisits(
  uid: string,
  onUpdate: (visits: LinkVisitRecord[]) => void,
  onError?: (err: Error) => void
): () => void {
  const q = query(collection(db, 'linkVisits'), where('uid', '==', uid), limit(100));
  return onSnapshot(
    q,
    (snap) => {
      const items: LinkVisitRecord[] = snap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            uid: String(data.uid ?? uid),
            linkId: String(data.linkId ?? ''),
            linkTitle: String(data.linkTitle ?? 'External Link'),
            linkType: (data.linkType === 'website' ? 'website' : 'smartlink') as VisitTab,
            category: String(data.category ?? 'Other'),
            domain: String(data.domain ?? ''),
            url: String(data.url ?? ''),
            createdAtMs: timestampToMs(data.createdAt),
          };
        })
        .sort((a, b) => b.createdAtMs - a.createdAtMs);
      onUpdate(items);
    },
    (error) => {
      reportFirestoreListenerError(error, OperationType.LIST, 'linkVisits', onError);
    }
  );
}

export function subscribeAdminAllLinks(
  onUpdate: (links: ManagedLink[]) => void,
  onError?: (err: Error) => void
): () => void {
  const q = query(collection(db, 'links'), limit(200));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => mapManagedLink(d.id, d.data()))
        .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
      onUpdate(items);
    },
    (error) => {
      reportFirestoreListenerError(error, OperationType.LIST, 'links', onError);
    }
  );
}

export function subscribeAdminReports(
  onUpdate: (reports: LinkReportRecord[]) => void,
  onError?: (err: Error) => void
): () => void {
  const q = query(collection(db, 'linkReports'), limit(150));
  return onSnapshot(
    q,
    (snap) => {
      const items: LinkReportRecord[] = snap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            linkId: String(data.linkId ?? ''),
            linkTitle: String(data.linkTitle ?? 'Link'),
            linkUrl: String(data.linkUrl ?? ''),
            reporterId: String(data.reporterId ?? ''),
            reporterUsername: String(data.reporterUsername ?? '@user'),
            reason: String(data.reason ?? ''),
            status:
              data.status === 'resolved' || data.status === 'dismissed' ? data.status : 'open',
            adminNote: data.adminNote ? String(data.adminNote) : undefined,
            createdAtMs: timestampToMs(data.createdAt),
            updatedAtMs: timestampToMs(data.updatedAt),
          };
        })
        .sort((a, b) => b.createdAtMs - a.createdAtMs);
      onUpdate(items);
    },
    (error) => {
      reportFirestoreListenerError(error, OperationType.LIST, 'linkReports', onError);
    }
  );
}

export function subscribeAdminModerationLogs(
  onUpdate: (logs: ModerationLogRecord[]) => void,
  onError?: (err: Error) => void
): () => void {
  const q = query(collection(db, 'moderationLogs'), limit(150));
  return onSnapshot(
    q,
    (snap) => {
      const items: ModerationLogRecord[] = snap.docs
        .map((d) => {
          const data = d.data();
          const action: ModerationLogRecord['action'] =
            data.action === 'approve' ||
            data.action === 'reject' ||
            data.action === 'remove' ||
            data.action === 'resolve_report' ||
            data.action === 'dismiss_report'
              ? data.action
              : 'approve';
          return {
            id: d.id,
            linkId: String(data.linkId ?? ''),
            linkTitle: String(data.linkTitle ?? 'Link'),
            targetOwnerId: String(data.targetOwnerId ?? ''),
            action,
            reason: String(data.reason ?? ''),
            adminUid: String(data.adminUid ?? ''),
            adminEmail: String(data.adminEmail ?? ''),
            createdAtMs: timestampToMs(data.createdAt),
          };
        })
        .sort((a, b) => b.createdAtMs - a.createdAtMs);
      onUpdate(items);
    },
    (error) => {
      reportFirestoreListenerError(error, OperationType.LIST, 'moderationLogs', onError);
    }
  );
}
