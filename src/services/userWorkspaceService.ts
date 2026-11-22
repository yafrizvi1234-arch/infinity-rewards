import { User, updateProfile } from 'firebase/auth';
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
import { DEFAULT_APP_STATE, USER_AVATAR } from '../data/demoData';
import {
  OperationType,
  auth,
  db,
  handleFirestoreError,
  reportFirestoreListenerError,
} from '../firebase';
import {
  ActivityRecord,
  FollowRelation,
  PublicProfile,
  UserProfileData,
  VisitLinkItem,
} from '../types';

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

function buildFallbackUsername(displayName: string, uid: string): string {
  const base = normalizeUsername(displayName).slice(0, 14) || 'explorer';
  const suffix = uid.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 5) || '001';
  const combined = `${base}_${suffix}`.slice(0, 24);
  return combined.length >= 3 ? combined : `user_${suffix}`;
}

export function sanitizeDisplayName(
  name: string | null | undefined,
  email: string | null | undefined
): string {
  const raw = (name || email?.split('@')[0] || 'Infinity Explorer').trim();
  return raw.slice(0, 50) || 'Infinity Explorer';
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

export async function loadOrCreateUserWorkspace(user: User): Promise<FirestoreUserWorkspace> {
  const docPath = `users/${user.uid}`;
  const userRef = doc(db, 'users', user.uid);

  let snap;
  try {
    snap = await getDoc(userRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, docPath);
  }

  if (snap.exists()) {
    const data = snap.data();
    const rawUsername = normalizeUsername(String(data.username ?? data.handle ?? ''));
    const username =
      validateUsernameFormat(rawUsername) === null
        ? rawUsername
        : buildFallbackUsername(String(data.displayName ?? ''), user.uid);

    return {
      uid: String(data.uid ?? user.uid),
      username,
      displayName: String(
        data.displayName ?? sanitizeDisplayName(user.displayName, user.email)
      ).slice(0, 50),
      bio: String(data.bio ?? '').slice(0, 160),
      photoURL: String(data.photoURL ?? user.photoURL ?? USER_AVATAR),
      activeAccent:
        data.activeAccent === 'purple' ||
        data.activeAccent === 'blue' ||
        data.activeAccent === 'cyan'
          ? data.activeAccent
          : 'cyan',
      totalPoints:
        Number.isInteger(data.totalPoints) && data.totalPoints >= 0 ? data.totalPoints : 0,
      totalVisits:
        Number.isInteger(data.totalVisits) && data.totalVisits >= 0 ? data.totalVisits : 0,
      successfulVisits:
        Number.isInteger(data.successfulVisits) && data.successfulVisits >= 0
          ? data.successfulVisits
          : 0,
      visitedToday:
        Number.isInteger(data.visitedToday) && data.visitedToday >= 0 ? data.visitedToday : 0,
      unlockedShopIds: Array.isArray(data.unlockedShopIds)
        ? data.unlockedShopIds.slice(0, 20).map(String)
        : [],
      createdAtMs: data.createdAt ? timestampToMs(data.createdAt) : null,
    };
  }

  // Brand-new verified user: start with real zeroed stats (no fake/demo numbers)
  const displayName = sanitizeDisplayName(user.displayName, user.email);
  let candidateUsername = buildFallbackUsername(displayName, user.uid);

  // Ensure candidate username isn't taken
  try {
    const existingClaim = await getDoc(doc(db, 'usernames', candidateUsername));
    if (existingClaim.exists() && existingClaim.data()?.uid !== user.uid) {
      const rand = Math.floor(100 + Math.random() * 900);
      candidateUsername = `${candidateUsername.slice(0, 20)}_${rand}`;
    }
  } catch {
    // Proceed with unique uid-suffixed candidate
  }

  const initialPhoto = (user.photoURL || USER_AVATAR).slice(0, 140000);
  const initialBio = 'Exploring INFINITY REWARDS.';

  const batch = writeBatch(db);
  batch.set(doc(db, 'usernames', candidateUsername), {
    uid: user.uid,
    createdAt: serverTimestamp(),
  });

  batch.set(userRef, {
    uid: user.uid,
    username: candidateUsername,
    displayName,
    bio: initialBio,
    photoURL: initialPhoto,
    activeAccent: 'cyan',
    totalPoints: 0,
    totalVisits: 0,
    successfulVisits: 0,
    visitedToday: 0,
    unlockedShopIds: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'publicProfiles', user.uid), {
    uid: user.uid,
    username: candidateUsername,
    displayName,
    bio: initialBio,
    photoURL: initialPhoto,
    specialty: 'Member',
    activeAccent: 'cyan',
    totalPoints: 0,
    totalVisits: 0,
    followersCount: 0,
    followingCount: 0,
    isDiscoverable: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, docPath);
  }

  return {
    uid: user.uid,
    username: candidateUsername,
    displayName,
    bio: initialBio,
    photoURL: initialPhoto,
    activeAccent: 'cyan',
    totalPoints: 0,
    totalVisits: 0,
    successfulVisits: 0,
    visitedToday: 0,
    unlockedShopIds: [],
    createdAtMs: Date.now(),
  };
}

export async function checkUsernameAvailability(
  rawUsername: string,
  currentUid: string
): Promise<{ available: boolean; normalized: string; error?: string }> {
  const normalized = normalizeUsername(rawUsername);
  const formatErr = validateUsernameFormat(normalized);
  if (formatErr) {
    return { available: false, normalized, error: formatErr };
  }

  const path = `usernames/${normalized}`;
  try {
    const snap = await getDoc(doc(db, 'usernames', normalized));
    if (!snap.exists() || snap.data()?.uid === currentUid) {
      return { available: true, normalized };
    }
    return {
      available: false,
      normalized,
      error: `@${normalized} is already claimed by another user.`,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
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
  const uid = params.user.uid;
  const cleanDisplayName = params.displayName.trim().slice(0, 50);
  if (cleanDisplayName.length < 1) {
    throw new Error('Display name cannot be empty.');
  }

  const normalizedNew = normalizeUsername(params.username);
  const formatErr = validateUsernameFormat(normalizedNew);
  if (formatErr) {
    throw new Error(formatErr);
  }

  const cleanBio = params.bio.trim().slice(0, 160);
  const cleanPhoto = params.photoURL.slice(0, 140000);
  const usernameChanged = normalizedNew !== params.currentUsername;

  if (usernameChanged) {
    const check = await checkUsernameAvailability(normalizedNew, uid);
    if (!check.available) {
      throw new Error(check.error || 'Username is already taken.');
    }
  }

  const oldUsernameSnap =
    usernameChanged && params.currentUsername
      ? await getDoc(doc(db, 'usernames', params.currentUsername))
      : null;

  const batch = writeBatch(db);

  if (usernameChanged) {
    batch.set(doc(db, 'usernames', normalizedNew), {
      uid,
      createdAt: serverTimestamp(),
    });
    if (params.currentUsername && oldUsernameSnap?.exists()) {
      batch.delete(doc(db, 'usernames', params.currentUsername));
    }
  }

  batch.update(doc(db, 'users', uid), {
    displayName: cleanDisplayName,
    username: normalizedNew,
    bio: cleanBio,
    photoURL: cleanPhoto,
    activeAccent: params.activeAccent,
    updatedAt: serverTimestamp(),
  });

  batch.update(doc(db, 'publicProfiles', uid), {
    displayName: cleanDisplayName,
    username: normalizedNew,
    bio: cleanBio,
    photoURL: cleanPhoto,
    activeAccent: params.activeAccent,
    updatedAt: serverTimestamp(),
  });

  const activityRef = doc(collection(db, 'activities'));
  batch.set(activityRef, {
    uid,
    type: 'profile_update',
    title: 'Updated Profile Details',
    description: usernameChanged
      ? `Updated profile and claimed @${normalizedNew}`
      : 'Updated display name, bio, or profile picture',
    category: 'Profile',
    pointsDelta: 0,
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
  }

  // Sync Firebase Auth profile display name / URL (when URL fits Auth limits)
  try {
    const authUpdates: { displayName?: string; photoURL?: string } = {
      displayName: cleanDisplayName,
    };
    if (cleanPhoto.startsWith('http') && cleanPhoto.length < 1800) {
      authUpdates.photoURL = cleanPhoto;
    }
    if (auth.currentUser) {
      await updateProfile(auth.currentUser, authUpdates);
    }
  } catch {
    // Non-fatal if Firebase Auth photoURL length differs
  }

  return {
    username: normalizedNew,
    displayName: cleanDisplayName,
    bio: cleanBio,
    photoURL: cleanPhoto,
  };
}

export async function recordVerifiedVisit(params: {
  uid: string;
  link: VisitLinkItem;
  currentTotalPoints: number;
  currentTotalVisits: number;
  currentSuccessfulVisits: number;
  currentVisitedToday: number;
}): Promise<string> {
  const {
    uid,
    link,
    currentTotalPoints,
    currentTotalVisits,
    currentSuccessfulVisits,
    currentVisitedToday,
  } = params;

  const userRef = doc(db, 'users', uid);
  const publicRef = doc(db, 'publicProfiles', uid);
  const [userSnap, publicSnap] = await Promise.all([getDoc(userRef), getDoc(publicRef)]);

  const userData = userSnap.exists() ? userSnap.data() : null;
  const basePoints =
    userData && typeof userData.totalPoints === 'number' && Number.isInteger(userData.totalPoints)
      ? userData.totalPoints
      : currentTotalPoints;
  const baseVisits =
    userData && typeof userData.totalVisits === 'number' && Number.isInteger(userData.totalVisits)
      ? userData.totalVisits
      : currentTotalVisits;
  const baseSuccessful =
    userData &&
    typeof userData.successfulVisits === 'number' &&
    Number.isInteger(userData.successfulVisits)
      ? userData.successfulVisits
      : currentSuccessfulVisits;
  const baseToday =
    userData && typeof userData.visitedToday === 'number' && Number.isInteger(userData.visitedToday)
      ? userData.visitedToday
      : currentVisitedToday;

  const boundedPoints = Math.min(35, Math.max(1, Math.floor(link.demoPoints)));
  const nextPoints = Math.min(1000000, basePoints + boundedPoints);
  const nextVisits = Math.min(1000000, baseVisits + 1);
  const nextSuccessful = Math.min(1000000, baseSuccessful + 1);
  const nextToday = Math.min(10000, baseToday + 1);
  const activityRef = doc(collection(db, 'activities'));

  const batch = writeBatch(db);
  batch.set(activityRef, {
    uid,
    type: 'visit',
    title: (link.title || 'Smartlink').slice(0, 80) || 'Smartlink',
    description: `Visited ${link.type === 'smartlink' ? 'Smartlink' : 'Website'} by ${link.userName || 'Member'}`.slice(0, 180),
    category: (link.category || 'Other').slice(0, 40) || 'Other',
    pointsDelta: nextPoints - basePoints,
    targetId: link.id.slice(0, 128),
    createdAt: serverTimestamp(),
  });

  batch.update(userRef, {
    totalPoints: nextPoints,
    totalVisits: nextVisits,
    successfulVisits: nextSuccessful,
    visitedToday: nextToday,
    lastActivityId: activityRef.id,
    updatedAt: serverTimestamp(),
  });

  if (publicSnap.exists()) {
    const pubData = publicSnap.data();
    const pubPoints = typeof pubData.totalPoints === 'number' ? pubData.totalPoints : basePoints;
    const pubVisits = typeof pubData.totalVisits === 'number' ? pubData.totalVisits : baseVisits;
    const pointsDelta = nextPoints - pubPoints;
    if (pointsDelta > 0 && pointsDelta <= 35 && pubVisits + 1 === nextVisits) {
      batch.update(publicRef, {
        totalPoints: nextPoints,
        totalVisits: nextVisits,
        updatedAt: serverTimestamp(),
      });
    }
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${uid}`);
  }

  return activityRef.id;
}

export async function unlockShopPerkSecure(params: {
  uid: string;
  nextUnlockedIds: string[];
  activeAccent: UserProfileData['activeAccent'];
}): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'users', params.uid), {
    unlockedShopIds: params.nextUnlockedIds.slice(0, 20),
    activeAccent: params.activeAccent,
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'publicProfiles', params.uid), {
    activeAccent: params.activeAccent,
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${params.uid}`);
  }
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

  const followId = `${params.followerUid}_${params.targetId}`;
  const followRef = doc(db, 'follows', followId);
  const followerPublicRef = doc(db, 'publicProfiles', params.followerUid);
  const targetPublicRef = doc(db, 'publicProfiles', params.targetId);

  // Double-check live existence & counter state to stay strictly within Firestore rules
  let existsSnap;
  let followerPublicSnap;
  let targetPublicSnap = null;
  try {
    [existsSnap, followerPublicSnap, targetPublicSnap] = await Promise.all([
      getDoc(followRef),
      getDoc(followerPublicRef),
      params.targetIsRealUser ? getDoc(targetPublicRef) : Promise.resolve(null),
    ]);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `follows/${followId}`);
  }

  const alreadyExists = existsSnap.exists();
  if (!params.currentlyFollowing && alreadyExists) {
    return;
  }
  if (params.currentlyFollowing && !alreadyExists) {
    return;
  }

  const followerData = followerPublicSnap.exists() ? followerPublicSnap.data() : null;
  const liveFollowingCount =
    followerData &&
    typeof followerData.followingCount === 'number' &&
    Number.isInteger(followerData.followingCount) &&
    followerData.followingCount >= 0
      ? followerData.followingCount
      : Math.max(0, Math.floor(params.followerCurrentFollowingCount));

  const targetData = targetPublicSnap && targetPublicSnap.exists() ? targetPublicSnap.data() : null;
  const liveFollowersCount =
    targetData &&
    typeof targetData.followersCount === 'number' &&
    Number.isInteger(targetData.followersCount) &&
    targetData.followersCount >= 0
      ? targetData.followersCount
      : Math.max(0, Math.floor(params.targetCurrentFollowersCount ?? 0));

  const batch = writeBatch(db);
  const activityRef = doc(collection(db, 'activities'));

  if (!params.currentlyFollowing) {
    batch.set(followRef, {
      followerId: params.followerUid,
      followerName: params.followerName.slice(0, 50),
      followerUsername: params.followerUsername.slice(0, 32),
      followerAvatar: params.followerAvatar.slice(0, 140000),
      targetId: params.targetId,
      targetName: params.targetName.slice(0, 50),
      targetUsername: params.targetUsername.slice(0, 32),
      targetAvatar: params.targetAvatar.slice(0, 140000),
      isRealTarget: params.targetIsRealUser,
      createdAt: serverTimestamp(),
    });

    batch.set(activityRef, {
      uid: params.followerUid,
      type: 'follow',
      title: `Followed ${params.targetName}`.slice(0, 80),
      description: `Started following ${params.targetUsername}`,
      category: 'Social',
      pointsDelta: 0,
      targetId: params.targetId.slice(0, 128),
      createdAt: serverTimestamp(),
    });

    if (followerPublicSnap.exists() && liveFollowingCount < 1000000) {
      batch.update(followerPublicRef, {
        followingCount: liveFollowingCount + 1,
        updatedAt: serverTimestamp(),
      });
    }

    if (params.targetIsRealUser && targetPublicSnap?.exists() && liveFollowersCount < 1000000) {
      batch.update(targetPublicRef, {
        followersCount: liveFollowersCount + 1,
        updatedAt: serverTimestamp(),
      });
    }
  } else {
    batch.delete(followRef);

    batch.set(activityRef, {
      uid: params.followerUid,
      type: 'unfollow',
      title: `Unfollowed ${params.targetName}`.slice(0, 80),
      description: `Stopped following ${params.targetUsername}`,
      category: 'Social',
      pointsDelta: 0,
      targetId: params.targetId.slice(0, 128),
      createdAt: serverTimestamp(),
    });

    if (followerPublicSnap.exists() && liveFollowingCount > 0) {
      batch.update(followerPublicRef, {
        followingCount: liveFollowingCount - 1,
        updatedAt: serverTimestamp(),
      });
    }

    if (params.targetIsRealUser && targetPublicSnap?.exists() && liveFollowersCount > 0) {
      batch.update(targetPublicRef, {
        followersCount: liveFollowersCount - 1,
        updatedAt: serverTimestamp(),
      });
    }
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `follows/${followId}`);
  }
}

export function subscribeToPublicProfiles(
  onUpdate: (profiles: PublicProfile[]) => void,
  onError?: (err: Error) => void
): () => void {
  const q = query(
    collection(db, 'publicProfiles'),
    where('isDiscoverable', '==', true),
    limit(30)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const list: PublicProfile[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          uid: String(data.uid ?? d.id),
          username: String(data.username ?? 'user'),
          displayName: String(data.displayName ?? 'Member'),
          bio: String(data.bio ?? ''),
          photoURL: String(data.photoURL ?? USER_AVATAR),
          specialty: String(data.specialty ?? 'Member'),
          activeAccent:
            data.activeAccent === 'purple' || data.activeAccent === 'blue'
              ? data.activeAccent
              : 'cyan',
          totalPoints: Number(data.totalPoints ?? 0),
          totalVisits: Number(data.totalVisits ?? 0),
          followersCount: Number(data.followersCount ?? 0),
          followingCount: Number(data.followingCount ?? 0),
        };
      });
      onUpdate(list);
    },
    (error) => {
      reportFirestoreListenerError(error, OperationType.LIST, 'publicProfiles', onError);
    }
  );
}

export function subscribeToUserFollows(
  uid: string,
  onFollowing: (edges: FollowRelation[]) => void,
  onFollowers: (edges: FollowRelation[]) => void,
  onError?: (err: Error) => void
): () => void {
  const followingQ = query(
    collection(db, 'follows'),
    where('followerId', '==', uid),
    limit(100)
  );
  const followersQ = query(
    collection(db, 'follows'),
    where('targetId', '==', uid),
    limit(100)
  );

  const mapEdge = (d: { id: string; data: () => Record<string, unknown> }): FollowRelation => {
    const data = d.data();
    return {
      id: d.id,
      followerId: String(data.followerId ?? ''),
      followerName: String(data.followerName ?? 'User'),
      followerUsername: String(data.followerUsername ?? '@user'),
      followerAvatar: String(data.followerAvatar ?? USER_AVATAR),
      targetId: String(data.targetId ?? ''),
      targetName: String(data.targetName ?? 'User'),
      targetUsername: String(data.targetUsername ?? '@user'),
      targetAvatar: String(data.targetAvatar ?? USER_AVATAR),
      isRealTarget: Boolean(data.isRealTarget),
      createdAtMs: timestampToMs(data.createdAt),
    };
  };

  const unsubFollowing = onSnapshot(
    followingQ,
    (snap) => {
      const items = snap.docs.map(mapEdge).sort((a, b) => b.createdAtMs - a.createdAtMs);
      onFollowing(items);
    },
    (error) => {
      reportFirestoreListenerError(error, OperationType.LIST, 'follows', onError);
    }
  );

  const unsubFollowers = onSnapshot(
    followersQ,
    (snap) => {
      const items = snap.docs.map(mapEdge).sort((a, b) => b.createdAtMs - a.createdAtMs);
      onFollowers(items);
    },
    (error) => {
      reportFirestoreListenerError(error, OperationType.LIST, 'follows', onError);
    }
  );

  return () => {
    unsubFollowing();
    unsubFollowers();
  };
}

export function subscribeToUserActivities(
  uid: string,
  onUpdate: (activities: ActivityRecord[]) => void,
  onError?: (err: Error) => void
): () => void {
  const q = query(collection(db, 'activities'), where('uid', '==', uid), limit(50));
  return onSnapshot(
    q,
    (snap) => {
      const items: ActivityRecord[] = snap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            uid: String(data.uid ?? uid),
            type:
              data.type === 'visit' ||
              data.type === 'points' ||
              data.type === 'follow' ||
              data.type === 'unfollow' ||
              data.type === 'profile_update'
                ? data.type
                : 'visit',
            title: String(data.title ?? 'Activity'),
            description: String(data.description ?? ''),
            category: String(data.category ?? 'General'),
            pointsDelta: Number(data.pointsDelta ?? 0),
            targetId: data.targetId ? String(data.targetId) : undefined,
            createdAtMs: timestampToMs(data.createdAt),
          };
        })
        .sort((a, b) => b.createdAtMs - a.createdAtMs);
      onUpdate(items);
    },
    (error) => {
      reportFirestoreListenerError(error, OperationType.LIST, 'activities', onError);
    }
  );
}

export { DEFAULT_APP_STATE };
