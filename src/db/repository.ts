import crypto from 'node:crypto';
import { and, desc, eq, ne, or } from 'drizzle-orm';
import { computeUrlKey, validateAndNormalizeUrl } from '../utils/urlValidator.ts';
import { db } from './index.ts';
import {
  activities,
  adsterraIntegrations,
  adsterraVault,
  follows,
  linkReports,
  links,
  linkVisits,
  moderationLogs,
  multiEntitlements,
  paymentConfig,
  paymentRequests,
  users,
  userSmartlinks,
} from './schema.ts';

export class DomainError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export const MIN_COOLDOWN_SEC = 12 * 3600;
export const MAX_COOLDOWN_SEC = 24 * 3600;
export const DEFAULT_COOLDOWN_SEC = 18 * 3600;
export const MULTI5_PLAN_ID = 'multi_5';
export const MULTI5_PRICE_BDT = 50;
export const MULTI5_CONCURRENT_LINKS = 5;

const DEFAULT_FALLBACK_AVATAR =
  'https://api.dicebear.com/9.x/shapes/svg?seed=infinity-member';

export function getRandomCooldownSec(): number {
  return (
    Math.floor(Math.random() * (MAX_COOLDOWN_SEC - MIN_COOLDOWN_SEC + 1)) +
    MIN_COOLDOWN_SEC
  );
}

export function clampSafeCooldownSec(rawSec?: unknown): number {
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

export function normalizeUsername(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9_]/g, '');
}

export function validateUsernameFormat(username: string): string | null {
  if (username.length < 3) return 'Username must be at least 3 characters.';
  if (username.length > 24) return 'Username cannot exceed 24 characters.';
  if (!/^[a-z0-9_]+$/.test(username)) {
    return 'Use only lowercase letters, numbers, and underscores.';
  }
  return null;
}

function buildFallbackUsername(displayName: string, uid: string): string {
  const base = normalizeUsername(displayName).slice(0, 14) || 'explorer';
  const suffix = uid.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 5) || '001';
  const combined = `${base}_${suffix}`.slice(0, 24);
  return combined.length >= 3 ? combined : `user_${suffix}`;
}

function sanitizeDisplayName(name: string | null | undefined, email: string): string {
  const raw = (name || email.split('@')[0] || 'Infinity Explorer').trim();
  return raw.slice(0, 50) || 'Infinity Explorer';
}

function sanitizeAccent(raw: unknown): 'cyan' | 'purple' | 'blue' {
  return raw === 'purple' || raw === 'blue' || raw === 'cyan' ? raw : 'cyan';
}

function wrapDbError(error: unknown, fallbackMessage: string): never {
  if (error instanceof DomainError) {
    throw error;
  }
  console.error('Database query failed:', error);
  throw new Error(fallbackMessage, { cause: error });
}

function mapUserWorkspace(row: typeof users.$inferSelect) {
  return {
    uid: row.uid,
    username: row.username,
    displayName: row.displayName,
    bio: row.bio,
    photoURL: row.photoUrl || DEFAULT_FALLBACK_AVATAR,
    activeAccent: sanitizeAccent(row.activeAccent),
    totalPoints: row.totalPoints,
    totalVisits: row.totalVisits,
    successfulVisits: row.successfulVisits,
    visitedToday: row.visitedToday,
    unlockedShopIds: Array.isArray(row.unlockedShopIds) ? row.unlockedShopIds : [],
    createdAtMs: row.createdAt ? row.createdAt.getTime() : Date.now(),
  };
}

function mapLinkRow(row: typeof links.$inferSelect) {
  const status =
    row.status === 'approved' || row.status === 'rejected' || row.status === 'pending'
      ? row.status
      : 'pending';
  const type = row.type === 'website' ? 'website' : 'smartlink';
  return {
    id: row.id,
    ownerId: row.ownerId,
    ownerName: row.ownerName,
    ownerUsername: row.ownerUsername,
    ownerAvatar: row.ownerAvatar || DEFAULT_FALLBACK_AVATAR,
    type,
    title: row.title,
    description: row.description,
    url: row.url,
    normalizedUrl: row.normalizedUrl,
    urlKey: row.urlKey,
    domain: row.domain,
    isHttps: row.isHttps,
    category: row.category,
    status,
    cooldownSec: row.cooldownSec,
    targetGeos: Array.isArray(row.targetGeos) ? row.targetGeos : ['US', 'UK', 'UAE', 'AU'],
    reportCount: row.reportCount,
    moderationNote: row.moderationNote ?? undefined,
    moderatedBy: row.moderatedBy ?? undefined,
    moderatedAtMs: row.moderatedAt ? row.moderatedAt.getTime() : undefined,
    createdAtMs: row.createdAt.getTime(),
    updatedAtMs: row.updatedAt.getTime(),
  };
}

export async function bootstrapWorkspace(params: {
  uid: string;
  email: string;
  displayName?: string | null;
  photoURL?: string | null;
}) {
  try {
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.uid, params.uid))
      .limit(1);

    if (existing.length > 0) {
      return mapUserWorkspace(existing[0]);
    }

    const displayName = sanitizeDisplayName(params.displayName, params.email);
    let candidateUsername = buildFallbackUsername(displayName, params.uid);

    const existingUsername = await db
      .select({ uid: users.uid })
      .from(users)
      .where(eq(users.username, candidateUsername))
      .limit(1);

    if (existingUsername.length > 0 && existingUsername[0].uid !== params.uid) {
      const rand = Math.floor(1000 + Math.random() * 9000);
      candidateUsername = `${candidateUsername.slice(0, 19)}_${rand}`;
    }

    const initialPhoto = (params.photoURL || '').trim().slice(0, 140000);
    const now = new Date();

    const inserted = await db
      .insert(users)
      .values({
        uid: params.uid,
        email: params.email,
        username: candidateUsername,
        displayName,
        bio: 'Exploring INFINITY REWARDS.',
        photoUrl: initialPhoto,
        specialty: 'Member',
        activeAccent: 'cyan',
        totalPoints: 0,
        totalVisits: 0,
        successfulVisits: 0,
        visitedToday: 0,
        unlockedShopIds: [],
        followersCount: 0,
        followingCount: 0,
        isDiscoverable: true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email: params.email,
          updatedAt: now,
        },
      })
      .returning();

    return mapUserWorkspace(inserted[0]);
  } catch (error) {
    wrapDbError(error, 'Unable to load your workspace right now. Please try again.');
  }
}

export async function checkUsernameAvailability(rawUsername: string, currentUid: string) {
  try {
    const normalized = normalizeUsername(rawUsername);
    const formatErr = validateUsernameFormat(normalized);
    if (formatErr) {
      return { available: false, normalized, error: formatErr };
    }

    const rows = await db
      .select({ uid: users.uid })
      .from(users)
      .where(eq(users.username, normalized))
      .limit(1);

    if (rows.length === 0 || rows[0].uid === currentUid) {
      return { available: true, normalized };
    }
    return {
      available: false,
      normalized,
      error: `@${normalized} is already claimed by another user.`,
    };
  } catch (error) {
    wrapDbError(error, 'Failed to check username availability.');
  }
}

export async function updateUserProfile(params: {
  uid: string;
  email: string;
  displayName: string;
  username: string;
  bio: string;
  photoURL: string;
  activeAccent: unknown;
}) {
  try {
    const cleanDisplayName = String(params.displayName || '').trim().slice(0, 50);
    if (cleanDisplayName.length < 1) {
      throw new DomainError('Display name cannot be empty.');
    }

    const normalizedNew = normalizeUsername(String(params.username || ''));
    const formatErr = validateUsernameFormat(normalizedNew);
    if (formatErr) {
      throw new DomainError(formatErr);
    }

    const cleanBio = String(params.bio || '').trim().slice(0, 160);
    const cleanPhoto = String(params.photoURL || '').slice(0, 140000);
    const accent = sanitizeAccent(params.activeAccent);
    const now = new Date();

    return await db.transaction(async (tx) => {
      const existingRows = await tx
        .select()
        .from(users)
        .where(eq(users.uid, params.uid))
        .limit(1);

      if (existingRows.length === 0) {
        throw new DomainError('User workspace not found.', 404);
      }

      const currentUsername = existingRows[0].username;
      const usernameChanged = normalizedNew !== currentUsername;

      if (usernameChanged) {
        const conflict = await tx
          .select({ uid: users.uid })
          .from(users)
          .where(and(eq(users.username, normalizedNew), ne(users.uid, params.uid)))
          .limit(1);
        if (conflict.length > 0) {
          throw new DomainError(`@${normalizedNew} is already claimed by another user.`, 409);
        }
      }

      await tx
        .update(users)
        .set({
          displayName: cleanDisplayName,
          username: normalizedNew,
          bio: cleanBio,
          photoUrl: cleanPhoto,
          activeAccent: accent,
          updatedAt: now,
        })
        .where(eq(users.uid, params.uid));

      await tx.insert(activities).values({
        id: crypto.randomUUID(),
        uid: params.uid,
        type: 'profile_update',
        title: 'Updated Profile Details',
        description: usernameChanged
          ? `Updated profile and claimed @${normalizedNew}`
          : 'Updated display name, bio, or profile picture',
        category: 'Profile',
        pointsDelta: 0,
        createdAt: now,
      });

      return {
        username: normalizedNew,
        displayName: cleanDisplayName,
        bio: cleanBio,
        photoURL: cleanPhoto,
      };
    });
  } catch (error) {
    wrapDbError(error, 'Failed to update profile details.');
  }
}

export async function recordVerifiedVisit(params: {
  uid: string;
  linkId: string;
  title: string;
  type: string;
  ownerName: string;
  category: string;
  points: number;
}) {
  try {
    const activityId = crypto.randomUUID();
    const boundedPoints = Math.min(35, Math.max(1, Math.floor(params.points || 10)));
    const now = new Date();

    await db.transaction(async (tx) => {
      const userRows = await tx
        .select()
        .from(users)
        .where(eq(users.uid, params.uid))
        .limit(1);

      if (userRows.length === 0) {
        throw new DomainError('User workspace not initialized.', 404);
      }

      const linkRows = await tx
        .select({ ownerId: links.ownerId, type: links.type, title: links.title })
        .from(links)
        .where(eq(links.id, params.linkId))
        .limit(1);

      if (linkRows.length > 0 && linkRows[0].ownerId === params.uid) {
        throw new DomainError('Self-visits are not eligible for points.', 400);
      }

      const u = userRows[0];
      const nextPoints = Math.min(1000000, u.totalPoints + boundedPoints);
      const nextVisits = Math.min(1000000, u.totalVisits + 1);
      const nextSuccessful = Math.min(1000000, u.successfulVisits + 1);
      const nextToday = Math.min(10000, u.visitedToday + 1);

      await tx.insert(activities).values({
        id: activityId,
        uid: params.uid,
        type: 'visit',
        title: (params.title || 'Smartlink').slice(0, 80) || 'Smartlink',
        description: `Visited ${params.type === 'smartlink' ? 'Smartlink' : 'Website'} by ${
          params.ownerName || 'Member'
        }`.slice(0, 180),
        category: (params.category || 'Other').slice(0, 40) || 'Other',
        pointsDelta: nextPoints - u.totalPoints,
        targetId: String(params.linkId || '').slice(0, 128),
        createdAt: now,
      });

      await tx
        .update(users)
        .set({
          totalPoints: nextPoints,
          totalVisits: nextVisits,
          successfulVisits: nextSuccessful,
          visitedToday: nextToday,
          updatedAt: now,
        })
        .where(eq(users.uid, params.uid));
    });

    return { activityId };
  } catch (error) {
    wrapDbError(error, 'Failed to record verified visit.');
  }
}

export async function unlockShopPerk(params: {
  uid: string;
  nextUnlockedIds: unknown;
  activeAccent: unknown;
}) {
  try {
    const cleanIds = Array.isArray(params.nextUnlockedIds)
      ? params.nextUnlockedIds.slice(0, 20).map((v) => String(v).slice(0, 40))
      : [];
    const accent = sanitizeAccent(params.activeAccent);
    await db
      .update(users)
      .set({
        unlockedShopIds: cleanIds,
        activeAccent: accent,
        updatedAt: new Date(),
      })
      .where(eq(users.uid, params.uid));
  } catch (error) {
    wrapDbError(error, 'Failed to unlock shop perk.');
  }
}

export async function toggleFollow(params: {
  followerUid: string;
  followerName: string;
  followerUsername: string;
  followerAvatar: string;
  targetId: string;
  targetName: string;
  targetUsername: string;
  targetAvatar: string;
  targetIsRealUser: boolean;
  currentlyFollowing: boolean;
}) {
  try {
    if (params.followerUid === params.targetId) {
      throw new DomainError('You cannot follow your own account.');
    }

    const followId = `${params.followerUid}_${params.targetId}`;
    const now = new Date();

    await db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: follows.id })
        .from(follows)
        .where(eq(follows.id, followId))
        .limit(1);

      const alreadyExists = existing.length > 0;
      if (!params.currentlyFollowing && alreadyExists) return;
      if (params.currentlyFollowing && !alreadyExists) return;

      const followerRows = await tx
        .select({ followingCount: users.followingCount })
        .from(users)
        .where(eq(users.uid, params.followerUid))
        .limit(1);
      const targetRows = params.targetIsRealUser
        ? await tx
            .select({ followersCount: users.followersCount })
            .from(users)
            .where(eq(users.uid, params.targetId))
            .limit(1)
        : [];

      if (!params.currentlyFollowing) {
        await tx.insert(follows).values({
          id: followId,
          followerId: params.followerUid,
          followerName: params.followerName.slice(0, 50),
          followerUsername: params.followerUsername.slice(0, 32),
          followerAvatar: params.followerAvatar.slice(0, 140000),
          targetId: params.targetId,
          targetName: params.targetName.slice(0, 50),
          targetUsername: params.targetUsername.slice(0, 32),
          targetAvatar: params.targetAvatar.slice(0, 140000),
          isRealTarget: Boolean(params.targetIsRealUser),
          createdAt: now,
        });

        await tx.insert(activities).values({
          id: crypto.randomUUID(),
          uid: params.followerUid,
          type: 'follow',
          title: `Followed ${params.targetName}`.slice(0, 80),
          description: `Started following ${params.targetUsername}`,
          category: 'Social',
          pointsDelta: 0,
          targetId: params.targetId.slice(0, 128),
          createdAt: now,
        });

        if (followerRows.length > 0) {
          await tx
            .update(users)
            .set({
              followingCount: Math.min(1000000, followerRows[0].followingCount + 1),
              updatedAt: now,
            })
            .where(eq(users.uid, params.followerUid));
        }

        if (targetRows.length > 0) {
          await tx
            .update(users)
            .set({
              followersCount: Math.min(1000000, targetRows[0].followersCount + 1),
              updatedAt: now,
            })
            .where(eq(users.uid, params.targetId));
        }
      } else {
        await tx.delete(follows).where(eq(follows.id, followId));

        await tx.insert(activities).values({
          id: crypto.randomUUID(),
          uid: params.followerUid,
          type: 'unfollow',
          title: `Unfollowed ${params.targetName}`.slice(0, 80),
          description: `Stopped following ${params.targetUsername}`,
          category: 'Social',
          pointsDelta: 0,
          targetId: params.targetId.slice(0, 128),
          createdAt: now,
        });

        if (followerRows.length > 0) {
          await tx
            .update(users)
            .set({
              followingCount: Math.max(0, followerRows[0].followingCount - 1),
              updatedAt: now,
            })
            .where(eq(users.uid, params.followerUid));
        }

        if (targetRows.length > 0) {
          await tx
            .update(users)
            .set({
              followersCount: Math.max(0, targetRows[0].followersCount - 1),
              updatedAt: now,
            })
            .where(eq(users.uid, params.targetId));
        }
      }
    });
  } catch (error) {
    wrapDbError(error, 'Failed to update follow status.');
  }
}

export async function getPublicProfiles() {
  try {
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.isDiscoverable, true))
      .orderBy(desc(users.totalPoints))
      .limit(100);

    return rows.map((row) => ({
      uid: row.uid,
      username: row.username,
      displayName: row.displayName,
      bio: row.bio,
      photoURL: row.photoUrl || DEFAULT_FALLBACK_AVATAR,
      specialty: row.specialty,
      activeAccent: sanitizeAccent(row.activeAccent),
      totalPoints: row.totalPoints,
      totalVisits: row.totalVisits,
      followersCount: row.followersCount,
      followingCount: row.followingCount,
    }));
  } catch (error) {
    wrapDbError(error, 'Failed to load public profiles.');
  }
}

export async function getUserFollows(uid: string) {
  try {
    const [followingRows, followerRows] = await Promise.all([
      db
        .select()
        .from(follows)
        .where(eq(follows.followerId, uid))
        .orderBy(desc(follows.createdAt))
        .limit(100),
      db
        .select()
        .from(follows)
        .where(eq(follows.targetId, uid))
        .orderBy(desc(follows.createdAt))
        .limit(100),
    ]);

    const mapEdge = (row: typeof follows.$inferSelect) => ({
      id: row.id,
      followerId: row.followerId,
      followerName: row.followerName,
      followerUsername: row.followerUsername,
      followerAvatar: row.followerAvatar || DEFAULT_FALLBACK_AVATAR,
      targetId: row.targetId,
      targetName: row.targetName,
      targetUsername: row.targetUsername,
      targetAvatar: row.targetAvatar || DEFAULT_FALLBACK_AVATAR,
      isRealTarget: row.isRealTarget,
      createdAtMs: row.createdAt.getTime(),
    });

    return {
      following: followingRows.map(mapEdge),
      followers: followerRows.map(mapEdge),
    };
  } catch (error) {
    wrapDbError(error, 'Failed to load follow relationships.');
  }
}

export async function getUserActivities(uid: string) {
  try {
    const rows = await db
      .select()
      .from(activities)
      .where(eq(activities.uid, uid))
      .orderBy(desc(activities.createdAt))
      .limit(50);

    return rows.map((row) => ({
      id: row.id,
      uid: row.uid,
      type:
        row.type === 'visit' ||
        row.type === 'points' ||
        row.type === 'follow' ||
        row.type === 'unfollow' ||
        row.type === 'profile_update'
          ? row.type
          : 'visit',
      title: row.title,
      description: row.description,
      category: row.category,
      pointsDelta: row.pointsDelta,
      targetId: row.targetId ?? undefined,
      createdAtMs: row.createdAt.getTime(),
    }));
  } catch (error) {
    wrapDbError(error, 'Failed to load activity history.');
  }
}

export async function getApprovedLinks() {
  try {
    const rows = await db
      .select()
      .from(links)
      .where(
        and(
          ne(links.status, 'rejected'),
          or(eq(links.status, 'approved'), eq(links.type, 'smartlink'))
        )
      )
      .orderBy(desc(links.isHttps), desc(links.updatedAt))
      .limit(200);

    return rows.map((r) => ({
      ...mapLinkRow(r),
      status: 'approved' as const,
    }));
  } catch (error) {
    wrapDbError(error, 'Failed to load community links.');
  }
}

export async function getMyLinks(uid: string) {
  try {
    const rows = await db
      .select()
      .from(links)
      .where(eq(links.ownerId, uid))
      .orderBy(desc(links.updatedAt))
      .limit(100);

    return rows.map(mapLinkRow);
  } catch (error) {
    wrapDbError(error, 'Failed to load your submitted links.');
  }
}

export async function getMyLinkVisits(uid: string) {
  try {
    const rows = await db
      .select()
      .from(linkVisits)
      .where(eq(linkVisits.uid, uid))
      .orderBy(desc(linkVisits.createdAt))
      .limit(100);

    return rows.map((row) => ({
      id: row.id,
      uid: row.uid,
      linkId: row.linkId,
      linkTitle: row.linkTitle,
      linkType: row.linkType === 'website' ? ('website' as const) : ('smartlink' as const),
      category: row.category,
      domain: row.domain,
      url: row.url,
      createdAtMs: row.createdAt.getTime(),
    }));
  } catch (error) {
    wrapDbError(error, 'Failed to load visit history.');
  }
}

export async function checkDuplicateUrlKey(urlKey: string) {
  try {
    const rows = await db
      .select({ id: links.id })
      .from(links)
      .where(eq(links.urlKey, urlKey))
      .limit(1);

    if (rows.length === 0) {
      return { isDuplicate: false };
    }
    return {
      isDuplicate: true,
      existingLinkId: rows[0].id,
    };
  } catch (error) {
    wrapDbError(error, 'Failed to check duplicate link.');
  }
}

export async function submitLink(params: {
  uid: string;
  ownerName: string;
  ownerUsername: string;
  ownerAvatar: string;
  type: 'smartlink' | 'website';
  title: string;
  description: string;
  rawUrl: string;
  category: string;
  cooldownSec?: number;
  targetGeos?: string[];
}) {
  try {
    const validation = validateAndNormalizeUrl(params.rawUrl || '');
    if (!validation.valid || !validation.url || !validation.normalizedUrl || !validation.domain) {
      throw new DomainError(validation.error || 'Invalid URL.');
    }

    const cleanTitle = (params.title || '').trim().slice(0, 80);
    if (cleanTitle.length < 3) {
      throw new DomainError('Link title must be at least 3 characters.');
    }

    const cleanDescription = (params.description || '').trim().slice(0, 300);
    if (cleanDescription.length < 10) {
      throw new DomainError('Description must be at least 10 characters.');
    }

    const cleanType = params.type === 'website' ? 'website' : 'smartlink';
    const cleanCategory = (params.category || '').trim().slice(0, 40) || 'Other';
    const safeTargetGeos = sanitizeTargetGeos(params.targetGeos);
    const urlKey = await computeUrlKey(validation.normalizedUrl);
    const cooldownSec = clampSafeCooldownSec(params.cooldownSec);
    const id = crypto.randomUUID();
    const now = new Date();

    const dup = await db
      .select({ id: links.id })
      .from(links)
      .where(eq(links.urlKey, urlKey))
      .limit(1);
    if (dup.length > 0) {
      throw new DomainError(
        'This URL has already been submitted. Duplicate links are not permitted.',
        409
      );
    }

    await db.insert(links).values({
      id,
      ownerId: params.uid,
      ownerName: (params.ownerName || 'Member').trim().slice(0, 50) || 'Member',
      ownerUsername: (params.ownerUsername || '@member').trim().slice(0, 32) || '@member',
      ownerAvatar: (params.ownerAvatar || '').slice(0, 140000),
      type: cleanType,
      title: cleanTitle,
      description: cleanDescription,
      url: validation.url,
      normalizedUrl: validation.normalizedUrl,
      urlKey,
      domain: validation.domain.slice(0, 120),
      isHttps: Boolean(validation.isHttps),
      category: cleanCategory,
      status: cleanType === 'smartlink' ? 'approved' : 'pending',
      cooldownSec,
      targetGeos: safeTargetGeos,
      reportCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    return { id };
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === '23505'
    ) {
      throw new DomainError(
        'This URL has already been submitted. Duplicate links are not permitted.',
        409
      );
    }
    wrapDbError(error, 'Failed to submit link.');
  }
}

export async function updateOwnLink(params: {
  uid: string;
  linkId: string;
  type: 'smartlink' | 'website';
  title: string;
  description: string;
  rawUrl: string;
  category: string;
  targetGeos?: string[];
}) {
  try {
    const validation = validateAndNormalizeUrl(params.rawUrl || '');
    if (!validation.valid || !validation.url || !validation.normalizedUrl || !validation.domain) {
      throw new DomainError(validation.error || 'Invalid URL.');
    }

    const cleanTitle = (params.title || '').trim().slice(0, 80);
    if (cleanTitle.length < 3) {
      throw new DomainError('Link title must be at least 3 characters.');
    }

    const cleanDescription = (params.description || '').trim().slice(0, 300);
    if (cleanDescription.length < 10) {
      throw new DomainError('Description must be at least 10 characters.');
    }

    const cleanType = params.type === 'website' ? 'website' : 'smartlink';
    const cleanCategory = (params.category || '').trim().slice(0, 40);
    const safeCategory = cleanCategory.length >= 2 ? cleanCategory : 'Other';
    const nextUrlKey = await computeUrlKey(validation.normalizedUrl);

    await db.transaction(async (tx) => {
      const existingRows = await tx
        .select()
        .from(links)
        .where(eq(links.id, params.linkId))
        .limit(1);

      if (existingRows.length === 0) {
        throw new DomainError('This link no longer exists.', 404);
      }

      const existing = existingRows[0];
      if (existing.ownerId !== params.uid) {
        throw new DomainError('You can only edit links you submitted.', 403);
      }

      const conflict = await tx
        .select({ id: links.id })
        .from(links)
        .where(and(eq(links.urlKey, nextUrlKey), ne(links.id, params.linkId)))
        .limit(1);
      if (conflict.length > 0) {
        throw new DomainError('Another link already uses this destination URL.', 409);
      }

      const safeTargetGeos = sanitizeTargetGeos(params.targetGeos ?? existing.targetGeos);
      const safeCooldown = clampSafeCooldownSec(existing.cooldownSec);

      await tx
        .update(links)
        .set({
          type: cleanType,
          title: cleanTitle,
          description: cleanDescription,
          url: validation.url!,
          normalizedUrl: validation.normalizedUrl!,
          urlKey: nextUrlKey,
          domain: validation.domain!.slice(0, 120),
          isHttps: Boolean(validation.isHttps),
          category: safeCategory,
          cooldownSec: safeCooldown,
          targetGeos: safeTargetGeos,
          status: cleanType === 'smartlink' ? 'approved' : 'pending',
          updatedAt: new Date(),
        })
        .where(eq(links.id, params.linkId));
    });
  } catch (error) {
    wrapDbError(error, 'Failed to update link.');
  }
}

export async function deleteLink(params: {
  linkId: string;
  actorUid: string;
  actorEmail: string;
  asAdmin: boolean;
  reason?: string;
}) {
  try {
    await db.transaction(async (tx) => {
      const existingRows = await tx
        .select()
        .from(links)
        .where(eq(links.id, params.linkId))
        .limit(1);

      if (existingRows.length === 0) {
        throw new DomainError('This link no longer exists.', 404);
      }

      const existing = existingRows[0];
      if (!params.asAdmin && existing.ownerId !== params.actorUid) {
        throw new DomainError('You can only delete your own links.', 403);
      }

      await tx.delete(links).where(eq(links.id, params.linkId));

      if (params.asAdmin) {
        await tx.insert(moderationLogs).values({
          id: crypto.randomUUID(),
          linkId: existing.id,
          linkTitle: existing.title.slice(0, 80),
          targetOwnerId: existing.ownerId,
          action: 'remove',
          reason: (params.reason || 'Removed by administrator').trim().slice(0, 240),
          adminUid: params.actorUid,
          adminEmail: params.actorEmail.slice(0, 120),
          createdAt: new Date(),
        });
      }
    });
  } catch (error) {
    wrapDbError(error, 'Failed to delete link.');
  }
}

export async function recordExternalLinkOpen(params: {
  uid: string;
  linkId: string;
  linkTitle: string;
  linkType: string;
  category: string;
  domain: string;
  url: string;
  durationSec?: number;
  cooldownSec?: number;
}) {
  try {
    const urlCheck = validateAndNormalizeUrl(params.url || '');
    const safeUrl =
      urlCheck.valid && urlCheck.url
        ? urlCheck.url
        : /^https?:\/\/\S{4,}$/.test((params.url || '').trim())
          ? params.url.trim().slice(0, 500)
          : 'https://example.com';
    const rawDomain = (urlCheck.domain || params.domain || '').trim();
    const safeDomain = rawDomain.length >= 3 ? rawDomain.slice(0, 120) : 'example.com';
    const safeTitle = (params.linkTitle || '').trim().slice(0, 80) || 'Smartlink';
    const safeCategory = (params.category || '').trim().slice(0, 40) || 'Other';
    const safeDuration =
      typeof params.durationSec === 'number' && Number.isFinite(params.durationSec)
        ? Math.max(20, Math.min(35, Math.round(params.durationSec)))
        : 25;
    const safeCooldown = clampSafeCooldownSec(params.cooldownSec);
    const id = crypto.randomUUID();

    await db.insert(linkVisits).values({
      id,
      uid: params.uid,
      linkId: params.linkId,
      linkTitle: safeTitle,
      linkType: params.linkType === 'website' ? 'website' : 'smartlink',
      category: safeCategory,
      domain: safeDomain,
      url: safeUrl,
      durationSec: safeDuration,
      cooldownSec: safeCooldown,
      createdAt: new Date(),
    });

    return { id };
  } catch (error) {
    wrapDbError(error, 'Failed to record link visit.');
  }
}

export async function reportLink(params: {
  linkId: string;
  reporterUid: string;
  reporterUsername: string;
  reason: string;
}) {
  try {
    const cleanReason = (params.reason || '').trim().slice(0, 240);
    if (cleanReason.length < 5) {
      throw new DomainError('Please provide a clear reason (at least 5 characters).');
    }

    const reportId = `${params.reporterUid}_${params.linkId}`;
    const now = new Date();

    await db.transaction(async (tx) => {
      const existingReport = await tx
        .select({ id: linkReports.id })
        .from(linkReports)
        .where(eq(linkReports.id, reportId))
        .limit(1);

      if (existingReport.length > 0) {
        throw new DomainError('You have already submitted a report for this link.', 409);
      }

      const linkRows = await tx
        .select()
        .from(links)
        .where(eq(links.id, params.linkId))
        .limit(1);
      if (linkRows.length === 0) {
        throw new DomainError('This link is no longer available.', 404);
      }

      const targetLink = linkRows[0];

      await tx.insert(linkReports).values({
        id: reportId,
        linkId: targetLink.id,
        linkTitle: targetLink.title.slice(0, 80),
        linkUrl: targetLink.url.slice(0, 500),
        reporterId: params.reporterUid,
        reporterUsername: params.reporterUsername.slice(0, 32),
        reason: cleanReason,
        status: 'open',
        createdAt: now,
        updatedAt: now,
      });

      await tx
        .update(links)
        .set({
          reportCount: Math.min(10000, targetLink.reportCount + 1),
          updatedAt: now,
        })
        .where(eq(links.id, targetLink.id));
    });
  } catch (error) {
    wrapDbError(error, 'Failed to submit link report.');
  }
}

export async function getAdminOverview() {
  try {
    const [allLinkRows, reportRows, logRows, paymentRows] = await Promise.all([
      db.select().from(links).orderBy(desc(links.updatedAt)).limit(200),
      db.select().from(linkReports).orderBy(desc(linkReports.createdAt)).limit(150),
      db.select().from(moderationLogs).orderBy(desc(moderationLogs.createdAt)).limit(150),
      db.select().from(paymentRequests).orderBy(desc(paymentRequests.createdAt)).limit(150),
    ]);

    return {
      links: allLinkRows.map(mapLinkRow),
      reports: reportRows.map((r) => ({
        id: r.id,
        linkId: r.linkId,
        linkTitle: r.linkTitle,
        linkUrl: r.linkUrl,
        reporterId: r.reporterId,
        reporterUsername: r.reporterUsername,
        reason: r.reason,
        status:
          r.status === 'resolved' || r.status === 'dismissed'
            ? (r.status as 'resolved' | 'dismissed')
            : ('open' as const),
        adminNote: r.adminNote ?? undefined,
        createdAtMs: r.createdAt.getTime(),
        updatedAtMs: r.updatedAt.getTime(),
      })),
      logs: logRows.map((l) => ({
        id: l.id,
        linkId: l.linkId,
        linkTitle: l.linkTitle,
        targetOwnerId: l.targetOwnerId,
        action: l.action as
          | 'approve'
          | 'reject'
          | 'remove'
          | 'resolve_report'
          | 'dismiss_report',
        reason: l.reason,
        adminUid: l.adminUid,
        adminEmail: l.adminEmail,
        createdAtMs: l.createdAt.getTime(),
      })),
      paymentRequests: paymentRows
        .map(mapPaymentRow)
        .sort((a, b) => {
          if (a.status === 'pending' && b.status !== 'pending') return -1;
          if (a.status !== 'pending' && b.status === 'pending') return 1;
          return b.createdAtMs - a.createdAtMs;
        }),
    };
  } catch (error) {
    wrapDbError(error, 'Failed to load admin overview.');
  }
}

export async function moderateLink(params: {
  linkId: string;
  decision: 'approved' | 'rejected';
  note: string;
  adminUid: string;
  adminEmail: string;
}) {
  try {
    const cleanNote = (params.note || '').trim().slice(0, 240);
    const now = new Date();

    await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(links)
        .where(eq(links.id, params.linkId))
        .limit(1);
      if (rows.length === 0) {
        throw new DomainError('This link no longer exists.', 404);
      }

      const target = rows[0];
      await tx
        .update(links)
        .set({
          status: params.decision,
          moderationNote: cleanNote,
          moderatedBy: params.adminUid,
          moderatedAt: now,
          updatedAt: now,
        })
        .where(eq(links.id, params.linkId));

      await tx.insert(moderationLogs).values({
        id: crypto.randomUUID(),
        linkId: target.id,
        linkTitle: target.title.slice(0, 80),
        targetOwnerId: target.ownerId,
        action: params.decision === 'approved' ? 'approve' : 'reject',
        reason:
          cleanNote ||
          (params.decision === 'approved'
            ? 'Approved for public directory'
            : 'Rejected by moderator'),
        adminUid: params.adminUid,
        adminEmail: params.adminEmail.slice(0, 120),
        createdAt: now,
      });
    });
  } catch (error) {
    wrapDbError(error, 'Failed to moderate link.');
  }
}

export async function resolveReport(params: {
  reportId: string;
  action: 'resolve_and_remove' | 'dismiss';
  adminNote: string;
  adminUid: string;
  adminEmail: string;
}) {
  try {
    const cleanNote = (params.adminNote || '').trim().slice(0, 240);
    const now = new Date();

    await db.transaction(async (tx) => {
      const reportRows = await tx
        .select()
        .from(linkReports)
        .where(eq(linkReports.id, params.reportId))
        .limit(1);
      if (reportRows.length === 0) {
        throw new DomainError('Report not found.', 404);
      }
      const rep = reportRows[0];

      await tx
        .update(linkReports)
        .set({
          status: params.action === 'resolve_and_remove' ? 'resolved' : 'dismissed',
          adminNote:
            cleanNote ||
            (params.action === 'resolve_and_remove' ? 'Link removed' : 'Report dismissed'),
          updatedAt: now,
        })
        .where(eq(linkReports.id, params.reportId));

      let targetOwnerId = rep.reporterId;
      if (params.action === 'resolve_and_remove' && rep.linkId) {
        const linkRows = await tx
          .select()
          .from(links)
          .where(eq(links.id, rep.linkId))
          .limit(1);
        if (linkRows.length > 0) {
          targetOwnerId = linkRows[0].ownerId;
          await tx.delete(links).where(eq(links.id, rep.linkId));
        }
      }

      await tx.insert(moderationLogs).values({
        id: crypto.randomUUID(),
        linkId: rep.linkId,
        linkTitle: rep.linkTitle.slice(0, 80),
        targetOwnerId,
        action: params.action === 'resolve_and_remove' ? 'resolve_report' : 'dismiss_report',
        reason: (
          cleanNote ||
          (params.action === 'resolve_and_remove'
            ? `Removed reported link: ${rep.reason}`
            : `Dismissed report: ${rep.reason}`)
        ).slice(0, 240),
        adminUid: params.adminUid,
        adminEmail: params.adminEmail.slice(0, 120),
        createdAt: now,
      });
    });
  } catch (error) {
    wrapDbError(error, 'Failed to resolve report.');
  }
}

function mapPaymentRow(row: typeof paymentRequests.$inferSelect) {
  return {
    id: row.id,
    uid: row.uid,
    userName: row.userName,
    userUsername: row.userUsername,
    planId: MULTI5_PLAN_ID as 'multi_5',
    amountBdt: row.amountBdt,
    paymentMethod: row.paymentMethod === 'nagad' ? ('nagad' as const) : ('bkash' as const),
    paymentNumber: row.paymentNumber,
    senderNumber: row.senderNumber ?? undefined,
    transactionId: row.transactionId,
    screenshotUrl: row.screenshotUrl,
    status:
      row.status === 'approved' || row.status === 'rejected'
        ? (row.status as 'approved' | 'rejected')
        : ('pending' as const),
    adminNote: row.adminNote ?? undefined,
    reviewedBy: row.reviewedBy ?? undefined,
    reviewedByEmail: row.reviewedByEmail ?? undefined,
    reviewedAtMs: row.reviewedAt ? row.reviewedAt.getTime() : undefined,
    createdAtMs: row.createdAt.getTime(),
    updatedAtMs: row.updatedAt.getTime(),
  };
}

export async function getPaymentConfig(defaults: {
  bkashNumber: string;
  nagadNumber: string;
}) {
  try {
    const rows = await db
      .select()
      .from(paymentConfig)
      .where(eq(paymentConfig.id, MULTI5_PLAN_ID))
      .limit(1);

    if (rows.length === 0) {
      return {
        id: MULTI5_PLAN_ID as 'multi_5',
        bkashNumber: defaults.bkashNumber,
        nagadNumber: defaults.nagadNumber,
      };
    }

    const row = rows[0];
    return {
      id: MULTI5_PLAN_ID as 'multi_5',
      bkashNumber: row.bkashNumber,
      nagadNumber: row.nagadNumber,
      updatedBy: row.updatedBy ?? undefined,
      updatedByEmail: row.updatedByEmail ?? undefined,
      updatedAtMs: row.updatedAt.getTime(),
    };
  } catch (error) {
    wrapDbError(error, 'Failed to load payment numbers configuration.');
  }
}

export async function updatePaymentConfig(params: {
  bkashNumber: string;
  nagadNumber: string;
  adminUid: string;
  adminEmail: string;
}) {
  try {
    const now = new Date();
    await db
      .insert(paymentConfig)
      .values({
        id: MULTI5_PLAN_ID,
        bkashNumber: params.bkashNumber,
        nagadNumber: params.nagadNumber,
        updatedBy: params.adminUid,
        updatedByEmail: params.adminEmail.slice(0, 120),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: paymentConfig.id,
        set: {
          bkashNumber: params.bkashNumber,
          nagadNumber: params.nagadNumber,
          updatedBy: params.adminUid,
          updatedByEmail: params.adminEmail.slice(0, 120),
          updatedAt: now,
        },
      });

    return {
      id: MULTI5_PLAN_ID as 'multi_5',
      bkashNumber: params.bkashNumber,
      nagadNumber: params.nagadNumber,
      updatedBy: params.adminUid,
      updatedByEmail: params.adminEmail,
      updatedAtMs: now.getTime(),
    };
  } catch (error) {
    wrapDbError(error, 'Failed to update payment configuration.');
  }
}

export async function isTransactionIdUsed(txKey: string) {
  try {
    const rows = await db
      .select({ id: paymentRequests.id })
      .from(paymentRequests)
      .where(eq(paymentRequests.transactionId, txKey))
      .limit(1);
    return rows.length > 0;
  } catch (error) {
    wrapDbError(error, 'Failed to verify Transaction ID uniqueness.');
  }
}

export async function getMyPaymentsAndEntitlement(uid: string) {
  try {
    const [reqRows, entRows] = await Promise.all([
      db
        .select()
        .from(paymentRequests)
        .where(eq(paymentRequests.uid, uid))
        .orderBy(desc(paymentRequests.createdAt))
        .limit(25),
      db
        .select()
        .from(multiEntitlements)
        .where(eq(multiEntitlements.uid, uid))
        .limit(1),
    ]);

    const ent = entRows[0];
    return {
      requests: reqRows.map(mapPaymentRow),
      entitlement: ent
        ? {
            uid: ent.uid,
            planId: MULTI5_PLAN_ID as 'multi_5',
            active: ent.active,
            maxConcurrentLinks: ent.maxConcurrentLinks,
            amountBdt: ent.amountBdt,
            sourceRequestId: ent.sourceRequestId,
            transactionId: ent.transactionId,
            approvedBy: ent.approvedBy,
            approvedByEmail: ent.approvedByEmail,
            activatedAtMs: ent.activatedAt.getTime(),
            updatedAtMs: ent.updatedAt.getTime(),
          }
        : null,
    };
  } catch (error) {
    wrapDbError(error, 'Failed to load payment status.');
  }
}

export async function createPaymentRequest(params: {
  uid: string;
  userName: string;
  userUsername: string;
  paymentMethod: 'bkash' | 'nagad';
  paymentNumber: string;
  senderNumber?: string;
  transactionId: string;
  screenshotUrl: string;
}) {
  try {
    const id = crypto.randomUUID();
    const now = new Date();

    await db.insert(paymentRequests).values({
      id,
      uid: params.uid,
      userName: params.userName.trim().slice(0, 50) || 'Member',
      userUsername: params.userUsername.trim().slice(0, 32) || '@member',
      planId: MULTI5_PLAN_ID,
      amountBdt: MULTI5_PRICE_BDT,
      paymentMethod: params.paymentMethod === 'nagad' ? 'nagad' : 'bkash',
      paymentNumber: params.paymentNumber.slice(0, 24),
      senderNumber: params.senderNumber ? params.senderNumber.slice(0, 24) : null,
      transactionId: params.transactionId,
      screenshotUrl: params.screenshotUrl.slice(0, 260000),
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    });

    return { id };
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === '23505'
    ) {
      throw new DomainError(
        'This Transaction ID has already been submitted. Duplicate Transaction IDs are not permitted.',
        409
      );
    }
    wrapDbError(error, 'Failed to submit payment request.');
  }
}

export async function reviewPaymentRequest(params: {
  requestId: string;
  decision: 'approved' | 'rejected';
  adminNote?: string;
  verifiedProof?: boolean;
  adminUid: string;
  adminEmail: string;
}) {
  try {
    const cleanNote = (params.adminNote ?? '').trim().slice(0, 240);
    const now = new Date();

    await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(paymentRequests)
        .where(eq(paymentRequests.id, params.requestId))
        .limit(1);

      if (rows.length === 0) {
        throw new DomainError('Payment request not found.', 404);
      }

      const paymentReq = rows[0];
      if (paymentReq.status !== 'pending') {
        throw new DomainError('Only pending payment requests can be reviewed.');
      }

      if (params.decision === 'approved') {
        if (!params.verifiedProof) {
          throw new DomainError(
            'Please verify the Transaction ID and Payment Screenshot before approving Multi (5).'
          );
        }
        if (
          !paymentReq.transactionId ||
          !paymentReq.screenshotUrl ||
          paymentReq.amountBdt !== MULTI5_PRICE_BDT
        ) {
          throw new DomainError(
            'Incomplete payment proof: cannot approve without valid 50 BDT proof.'
          );
        }

        const existingEnt = await tx
          .select({ uid: multiEntitlements.uid })
          .from(multiEntitlements)
          .where(eq(multiEntitlements.uid, paymentReq.uid))
          .limit(1);

        if (existingEnt.length > 0) {
          throw new DomainError(
            'Multi (5) is already active for this applicant. Please reject duplicate requests instead.',
            409
          );
        }
      }

      await tx
        .update(paymentRequests)
        .set({
          status: params.decision,
          adminNote:
            cleanNote ||
            (params.decision === 'approved'
              ? 'Payment verified — Multi (5) activated for applicant account.'
              : 'Payment proof could not be verified.'),
          reviewedBy: params.adminUid,
          reviewedByEmail: params.adminEmail.slice(0, 120),
          reviewedAt: now,
          updatedAt: now,
        })
        .where(eq(paymentRequests.id, paymentReq.id));

      if (params.decision === 'approved') {
        await tx.insert(multiEntitlements).values({
          uid: paymentReq.uid,
          planId: MULTI5_PLAN_ID,
          active: true,
          maxConcurrentLinks: MULTI5_CONCURRENT_LINKS,
          amountBdt: MULTI5_PRICE_BDT,
          sourceRequestId: paymentReq.id,
          transactionId: paymentReq.transactionId,
          approvedBy: params.adminUid,
          approvedByEmail: params.adminEmail.slice(0, 120),
          activatedAt: now,
          updatedAt: now,
        });
      }
    });
  } catch (error) {
    wrapDbError(error, 'Failed to review payment request.');
  }
}

export async function revokePaymentAccess(params: {
  requestId: string;
  adminNote?: string;
  adminUid: string;
  adminEmail: string;
}) {
  try {
    const cleanNote = (params.adminNote ?? '').trim().slice(0, 240);
    const now = new Date();

    await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(paymentRequests)
        .where(eq(paymentRequests.id, params.requestId))
        .limit(1);

      if (rows.length === 0) {
        throw new DomainError('Payment request not found.', 404);
      }
      const paymentReq = rows[0];
      if (paymentReq.status !== 'approved') {
        throw new DomainError('Only approved Multi (5) requests can be revoked.');
      }

      await tx
        .update(paymentRequests)
        .set({
          status: 'rejected',
          adminNote: cleanNote || 'Multi (5) access revoked by administrator.',
          reviewedBy: params.adminUid,
          reviewedByEmail: params.adminEmail.slice(0, 120),
          reviewedAt: now,
          updatedAt: now,
        })
        .where(eq(paymentRequests.id, paymentReq.id));

      await tx.delete(multiEntitlements).where(eq(multiEntitlements.uid, paymentReq.uid));
    });
  } catch (error) {
    wrapDbError(error, 'Failed to revoke Multi (5) access.');
  }
}

export async function getAdsterraVaultRecord(uid: string) {
  try {
    const rows = await db
      .select()
      .from(adsterraVault)
      .where(eq(adsterraVault.uid, uid))
      .limit(1);
    return rows[0] ?? null;
  } catch (error) {
    wrapDbError(error, 'Failed to read Adsterra vault record.');
  }
}

export async function upsertAdsterraVaultRecord(
  uid: string,
  payload: Omit<typeof adsterraVault.$inferInsert, 'uid'>
) {
  try {
    const [saved] = await db
      .insert(adsterraVault)
      .values({ uid, ...payload })
      .onConflictDoUpdate({
        target: adsterraVault.uid,
        set: payload,
      })
      .returning();
    return saved;
  } catch (error) {
    wrapDbError(error, 'Failed to save Adsterra vault record.');
  }
}

export async function deleteAdsterraVaultRecord(uid: string) {
  try {
    await db.delete(adsterraVault).where(eq(adsterraVault.uid, uid));
  } catch (error) {
    wrapDbError(error, 'Failed to remove Adsterra vault record.');
  }
}

export async function getAdsterraIntegration(uid: string) {
  try {
    const rows = await db
      .select()
      .from(adsterraIntegrations)
      .where(eq(adsterraIntegrations.uid, uid))
      .limit(1);

    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      uid: row.uid,
      ownerUserId: row.ownerUserId,
      connectionMode:
        row.connectionMode === 'official_api_key'
          ? ('official_api_key' as const)
          : ('manual_smartlink' as const),
      status: row.status === 'connected' ? ('connected' as const) : ('disconnected' as const),
      publisherId: row.publisherId,
      publisherLabel: row.publisherLabel,
      smartlinkUrl: row.smartlinkUrl,
      smartlinkTitle: row.smartlinkTitle,
      hasApiKey: row.hasApiKey,
      apiKeyHint: row.apiKeyHint,
      apiVerified: row.apiVerified,
      verifiedDomainsCount: row.verifiedDomainsCount,
      verifiedPlacementsCount: row.verifiedPlacementsCount,
      lastSyncedAtMs: row.lastSyncedAt ? row.lastSyncedAt.getTime() : undefined,
      createdAtMs: row.createdAt.getTime(),
      updatedAtMs: row.updatedAt.getTime(),
    };
  } catch (error) {
    wrapDbError(error, 'Failed to load Adsterra integration.');
  }
}

export async function upsertAdsterraIntegration(params: {
  uid: string;
  publisherId: string;
  publisherLabel: string;
  smartlinkTitle: string;
  smartlinkUrl: string;
  connectionMode: 'manual_smartlink' | 'official_api_key';
  hasApiKey: boolean;
  apiKeyHint: string;
  apiVerified: boolean;
  verifiedDomainsCount: number;
  verifiedPlacementsCount: number;
  lastSyncedAtMs?: number | null;
}) {
  try {
    let validatedUrl = '';
    if (params.smartlinkUrl.trim()) {
      const urlResult = validateAndNormalizeUrl(params.smartlinkUrl);
      if (!urlResult.valid || (!urlResult.url && !urlResult.normalizedUrl)) {
        throw new DomainError(
          urlResult.error || 'Please enter a valid Smartlink URL (https://...)'
        );
      }
      validatedUrl = urlResult.url || urlResult.normalizedUrl || '';
    }

    if (!validatedUrl && !params.hasApiKey) {
      throw new DomainError(
        'Provide your personal Smartlink URL (or verify an Adsterra Publisher API Key) to connect.'
      );
    }

    const now = new Date();
    const lastSyncedAt =
      typeof params.lastSyncedAtMs === 'number' && params.lastSyncedAtMs > 0
        ? new Date(params.lastSyncedAtMs)
        : null;

    await db
      .insert(adsterraIntegrations)
      .values({
        uid: params.uid,
        ownerUserId: params.uid,
        connectionMode:
          params.connectionMode === 'official_api_key' ? 'official_api_key' : 'manual_smartlink',
        status: 'connected',
        publisherId: params.publisherId.trim().slice(0, 64),
        publisherLabel: params.publisherLabel.trim().slice(0, 60),
        smartlinkUrl: validatedUrl,
        smartlinkTitle:
          params.smartlinkTitle.trim().slice(0, 80) ||
          (validatedUrl ? 'Primary Adsterra Smartlink' : ''),
        hasApiKey: Boolean(params.hasApiKey),
        apiKeyHint: (params.apiKeyHint || '').slice(0, 16),
        apiVerified: Boolean(params.apiVerified),
        verifiedDomainsCount: Math.max(0, Math.min(1000, params.verifiedDomainsCount || 0)),
        verifiedPlacementsCount: Math.max(0, Math.min(5000, params.verifiedPlacementsCount || 0)),
        lastSyncedAt,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: adsterraIntegrations.uid,
        set: {
          connectionMode:
            params.connectionMode === 'official_api_key'
              ? 'official_api_key'
              : 'manual_smartlink',
          status: 'connected',
          publisherId: params.publisherId.trim().slice(0, 64),
          publisherLabel: params.publisherLabel.trim().slice(0, 60),
          smartlinkUrl: validatedUrl,
          smartlinkTitle:
            params.smartlinkTitle.trim().slice(0, 80) ||
            (validatedUrl ? 'Primary Adsterra Smartlink' : ''),
          hasApiKey: Boolean(params.hasApiKey),
          apiKeyHint: (params.apiKeyHint || '').slice(0, 16),
          apiVerified: Boolean(params.apiVerified),
          verifiedDomainsCount: Math.max(0, Math.min(1000, params.verifiedDomainsCount || 0)),
          verifiedPlacementsCount: Math.max(
            0,
            Math.min(5000, params.verifiedPlacementsCount || 0)
          ),
          lastSyncedAt,
          updatedAt: now,
        },
      });
  } catch (error) {
    wrapDbError(error, 'Failed to save Adsterra integration.');
  }
}

export async function disconnectAdsterraIntegration(uid: string) {
  try {
    const now = new Date();
    await db
      .update(adsterraIntegrations)
      .set({
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
        updatedAt: now,
      })
      .where(eq(adsterraIntegrations.uid, uid));
  } catch (error) {
    wrapDbError(error, 'Failed to disconnect Adsterra integration.');
  }
}

export async function getUserSmartlinks(uid: string) {
  try {
    const rows = await db
      .select()
      .from(userSmartlinks)
      .where(eq(userSmartlinks.ownerUserId, uid))
      .orderBy(desc(userSmartlinks.createdAt))
      .limit(100);

    return rows.map((row) => ({
      id: row.id,
      ownerUserId: row.ownerUserId,
      title: row.title,
      url: row.url,
      domain: row.domain,
      category: row.category,
      isHttps: row.isHttps,
      createdAtMs: row.createdAt.getTime(),
      updatedAtMs: row.updatedAt.getTime(),
    }));
  } catch (error) {
    wrapDbError(error, 'Failed to load personal Smartlinks.');
  }
}

export async function createUserSmartlink(params: {
  uid: string;
  title: string;
  rawUrl: string;
  category: string;
}) {
  try {
    const cleanTitle = (params.title || '').trim().slice(0, 80);
    if (cleanTitle.length < 2) {
      throw new DomainError('Smartlink title must be at least 2 characters.');
    }

    const urlCheck = validateAndNormalizeUrl(params.rawUrl || '');
    const resolvedUrl = urlCheck.url || urlCheck.normalizedUrl;
    if (!urlCheck.valid || !resolvedUrl || !urlCheck.domain) {
      throw new DomainError(urlCheck.error || 'Please enter a valid Smartlink URL.');
    }

    const id = crypto.randomUUID();
    const now = new Date();

    await db.insert(userSmartlinks).values({
      id,
      ownerUserId: params.uid,
      title: cleanTitle,
      url: resolvedUrl,
      domain: urlCheck.domain.slice(0, 120),
      category: (params.category || '').trim().slice(0, 40) || 'Other',
      isHttps: Boolean(urlCheck.isHttps),
      createdAt: now,
      updatedAt: now,
    });

    return { id };
  } catch (error) {
    wrapDbError(error, 'Failed to save personal Smartlink.');
  }
}

export async function updateUserSmartlink(params: {
  uid: string;
  id: string;
  title: string;
  rawUrl: string;
  category: string;
}) {
  try {
    const cleanTitle = (params.title || '').trim().slice(0, 80);
    if (cleanTitle.length < 2) {
      throw new DomainError('Smartlink title must be at least 2 characters.');
    }

    const urlCheck = validateAndNormalizeUrl(params.rawUrl || '');
    const resolvedUrl = urlCheck.url || urlCheck.normalizedUrl;
    if (!urlCheck.valid || !resolvedUrl || !urlCheck.domain) {
      throw new DomainError(urlCheck.error || 'Please enter a valid Smartlink URL.');
    }

    const existing = await db
      .select()
      .from(userSmartlinks)
      .where(eq(userSmartlinks.id, params.id))
      .limit(1);

    if (existing.length === 0) {
      throw new DomainError('Personal Smartlink not found.', 404);
    }
    if (existing[0].ownerUserId !== params.uid) {
      throw new DomainError('You can only edit your own personal Smartlinks.', 403);
    }

    await db
      .update(userSmartlinks)
      .set({
        title: cleanTitle,
        url: resolvedUrl,
        domain: urlCheck.domain.slice(0, 120),
        category: (params.category || '').trim().slice(0, 40) || 'Other',
        isHttps: Boolean(urlCheck.isHttps),
        updatedAt: new Date(),
      })
      .where(eq(userSmartlinks.id, params.id));
  } catch (error) {
    wrapDbError(error, 'Failed to update personal Smartlink.');
  }
}

export async function deleteUserSmartlink(params: { uid: string; id: string }) {
  try {
    const existing = await db
      .select()
      .from(userSmartlinks)
      .where(eq(userSmartlinks.id, params.id))
      .limit(1);

    if (existing.length === 0) {
      return;
    }
    if (existing[0].ownerUserId !== params.uid) {
      throw new DomainError('You can only delete your own personal Smartlinks.', 403);
    }

    await db.delete(userSmartlinks).where(eq(userSmartlinks.id, params.id));
  } catch (error) {
    wrapDbError(error, 'Failed to delete personal Smartlink.');
  }
}
