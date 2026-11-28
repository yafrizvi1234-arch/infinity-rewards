import { User, updateProfile } from 'firebase/auth';
import { DEFAULT_APP_STATE, USER_AVATAR } from '../data/demoData';
import { auth } from '../firebase';
import {
  ActivityRecord,
  FollowRelation,
  PublicProfile,
  UserProfileData,
  VisitLinkItem,
} from '../types';
import {
  apiRequest,
  createPollingSubscription,
  emitSyncTopics,
} from './apiClient';

export interface FirestoreUserWorkspace {
  uid: string;
  username: string;
  displayName: string;
  bio: string;
  photoURL: string;
  activeAccent: UserProfileData['activeAccent'];
  totalPoints: number;
  totalVisits: number;
  successfulVisits: number;
  visitedToday: number;
  unlockedShopIds: string[];
  createdAtMs: number | null;
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

export function sanitizeDisplayName(
  name: string | null | undefined,
  email: string | null | undefined
): string {
  const raw = (name || email?.split('@')[0] || 'Infinity Explorer').trim();
  return raw.slice(0, 50) || 'Infinity Explorer';
}

export async function loadOrCreateUserWorkspace(user: User): Promise<FirestoreUserWorkspace> {
  const data = await apiRequest<FirestoreUserWorkspace>('/api/workspace/bootstrap', {
    method: 'POST',
    body: {
      displayName: user.displayName ?? null,
      photoURL: user.photoURL ?? null,
    },
  });

  return {
    ...data,
    photoURL: data.photoURL || user.photoURL || USER_AVATAR,
    unlockedShopIds: Array.isArray(data.unlockedShopIds) ? data.unlockedShopIds : [],
  };
}

export async function checkUsernameAvailability(
  rawUsername: string,
  _currentUid: string
): Promise<{ available: boolean; normalized: string; error?: string }> {
  const normalized = normalizeUsername(rawUsername);
  const formatErr = validateUsernameFormat(normalized);
  if (formatErr) {
    return { available: false, normalized, error: formatErr };
  }

  return apiRequest<{ available: boolean; normalized: string; error?: string }>(
    `/api/workspace/username-check?username=${encodeURIComponent(normalized)}`,
    { method: 'GET' }
  );
}

export async function updateUserProfileSecure(params: {
  user: User;
  currentUsername: string;
  displayName: string;
  username: string;
  bio: string;
  photoURL: string;
  activeAccent: UserProfileData['activeAccent'];
}): Promise<{ username: string; displayName: string; bio: string; photoURL: string }> {
  const cleanDisplayName = params.displayName.trim().slice(0, 50);
  if (cleanDisplayName.length < 1) {
    throw new Error('Display name cannot be empty.');
  }

  const normalizedNew = normalizeUsername(params.username);
  const formatErr = validateUsernameFormat(normalizedNew);
  if (formatErr) {
    throw new Error(formatErr);
  }

  const updated = await apiRequest<{
    username: string;
    displayName: string;
    bio: string;
    photoURL: string;
  }>('/api/workspace/profile', {
    method: 'PUT',
    body: {
      displayName: cleanDisplayName,
      username: normalizedNew,
      bio: params.bio.trim().slice(0, 160),
      photoURL: params.photoURL.slice(0, 140000),
      activeAccent: params.activeAccent,
    },
  });

  try {
    const authUpdates: { displayName?: string; photoURL?: string } = {
      displayName: updated.displayName,
    };
    if (updated.photoURL.startsWith('http') && updated.photoURL.length < 1800) {
      authUpdates.photoURL = updated.photoURL;
    }
    if (auth.currentUser) {
      await updateProfile(auth.currentUser, authUpdates);
    }
  } catch {
    // Non-fatal if Firebase Auth photoURL length differs
  }

  emitSyncTopics('profiles', 'activities');
  return updated;
}

export async function recordVerifiedVisit(params: {
  uid: string;
  link: VisitLinkItem;
  currentTotalPoints: number;
  currentTotalVisits: number;
  currentSuccessfulVisits: number;
  currentVisitedToday: number;
}): Promise<string> {
  const result = await apiRequest<{ activityId: string }>('/api/workspace/visit', {
    method: 'POST',
    body: {
      linkId: params.link.id,
      title: params.link.title,
      type: params.link.type,
      ownerName: params.link.userName,
      category: params.link.category,
      points: params.link.demoPoints,
    },
  });

  emitSyncTopics('activities', 'profiles');
  return result.activityId;
}

export async function unlockShopPerkSecure(params: {
  uid: string;
  nextUnlockedIds: string[];
  activeAccent: UserProfileData['activeAccent'];
}): Promise<void> {
  await apiRequest('/api/workspace/shop', {
    method: 'POST',
    body: {
      nextUnlockedIds: params.nextUnlockedIds.slice(0, 20),
      activeAccent: params.activeAccent,
    },
  });
  emitSyncTopics('profiles');
}

export async function toggleFollowSecure(params: {
  followerUid: string;
  followerName: string;
  followerUsername: string;
  followerAvatar: string;
  followerCurrentFollowingCount: number;
  targetId: string;
  targetName: string;
  targetUsername: string;
  targetAvatar: string;
  targetIsRealUser: boolean;
  targetCurrentFollowersCount?: number;
  currentlyFollowing: boolean;
}): Promise<void> {
  if (params.followerUid === params.targetId) {
    throw new Error('You cannot follow your own account.');
  }

  await apiRequest('/api/workspace/follow', {
    method: 'POST',
    body: {
      followerName: params.followerName,
      followerUsername: params.followerUsername,
      followerAvatar: params.followerAvatar,
      targetId: params.targetId,
      targetName: params.targetName,
      targetUsername: params.targetUsername,
      targetAvatar: params.targetAvatar,
      targetIsRealUser: params.targetIsRealUser,
      currentlyFollowing: params.currentlyFollowing,
    },
  });

  emitSyncTopics('follows', 'profiles', 'activities');
}

export function subscribeToPublicProfiles(
  onUpdate: (profiles: PublicProfile[]) => void,
  onError?: (err: Error) => void
): () => void {
  return createPollingSubscription<PublicProfile[]>(
    'profiles',
    async () => {
      const res = await apiRequest<{ profiles: PublicProfile[] }>('/api/workspace/profiles');
      return (res.profiles || []).map((p) => ({
        ...p,
        photoURL: p.photoURL || USER_AVATAR,
      }));
    },
    onUpdate,
    onError,
    25000
  );
}

export function subscribeToUserFollows(
  _uid: string,
  onFollowing: (edges: FollowRelation[]) => void,
  onFollowers: (edges: FollowRelation[]) => void,
  onError?: (err: Error) => void
): () => void {
  return createPollingSubscription<{
    following: FollowRelation[];
    followers: FollowRelation[];
  }>(
    'follows',
    async () => apiRequest('/api/workspace/follows'),
    (data) => {
      onFollowing(
        (data.following || []).map((e) => ({
          ...e,
          followerAvatar: e.followerAvatar || USER_AVATAR,
          targetAvatar: e.targetAvatar || USER_AVATAR,
        }))
      );
      onFollowers(
        (data.followers || []).map((e) => ({
          ...e,
          followerAvatar: e.followerAvatar || USER_AVATAR,
          targetAvatar: e.targetAvatar || USER_AVATAR,
        }))
      );
    },
    onError,
    25000
  );
}

export function subscribeToUserActivities(
  _uid: string,
  onUpdate: (activities: ActivityRecord[]) => void,
  onError?: (err: Error) => void
): () => void {
  return createPollingSubscription<ActivityRecord[]>(
    'activities',
    async () => {
      const res = await apiRequest<{ activities: ActivityRecord[] }>(
        '/api/workspace/activities'
      );
      return res.activities || [];
    },
    onUpdate,
    onError,
    25000
  );
}

export { DEFAULT_APP_STATE };
