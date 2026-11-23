import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { User, onIdTokenChanged } from 'firebase/auth';
import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { AdminModerationScreen } from './components/AdminModerationScreen';
import { AdsterraScreen } from './components/AdsterraScreen';
import { AuthScreen } from './components/AuthScreen';
import { BottomNav } from './components/BottomNav';
import { AutoVisitQueueItem, BottomVisitDock } from './components/BottomVisitDock';
import { DesktopSidebar } from './components/DesktopSidebar';
import { HamburgerDrawer } from './components/HamburgerDrawer';
import { HomeDashboard } from './components/HomeDashboard';
import { LeaderboardScreen } from './components/LeaderboardScreen';
import { LinkManagerScreen } from './components/LinkManagerScreen';
import { NotificationsDrawer } from './components/NotificationsDrawer';
import { OfflineIndicator } from './components/OfflineIndicator';
import { ProfileScreen } from './components/ProfileScreen';
import { ShopScreen } from './components/ShopScreen';
import { TopNav } from './components/TopNav';
import { VerifyEmailScreen } from './components/VerifyEmailScreen';
import { VisitModal } from './components/VisitModal';
import { DEFAULT_APP_STATE } from './data/demoData';
import { auth } from './firebase';
import { logoutUser } from './services/authService';
import {
  DEFAULT_SPAM_COOLDOWN_SEC,
  checkIsAdminUser,
  deleteLinkSecure,
  moderateLinkSecure,
  recordExternalLinkOpen,
  reportLinkSecure,
  resolveReportSecure,
  submitLinkSecure,
  subscribeAdminAllLinks,
  subscribeAdminModerationLogs,
  subscribeAdminReports,
  subscribeApprovedLinks,
  subscribeMyLinkVisits,
  subscribeMySubmittedLinks,
  updateOwnLinkSecure,
} from './services/linkService';
import {
  DEFAULT_PAYMENT_NUMBERS,
  reviewPaymentRequestSecure,
  submitMulti5PaymentRequest,
  subscribeAdminPaymentRequests,
  subscribeMyMultiEntitlement,
  subscribeMyPaymentRequests,
  subscribePaymentNumbersConfig,
  updatePaymentNumbersConfigSecure,
} from './services/paymentService';
import {
  DEFAULT_BACKEND_STATUS,
  connectAdsterraApiKeySecure,
  createMyPersonalSmartlink,
  deleteMyPersonalSmartlink,
  disconnectMyAdsterraIntegration,
  fetchAdsterraBackendStatus,
  fetchAdsterraDetailedStats,
  saveMyAdsterraIntegration,
  subscribeMyAdsterraIntegration,
  subscribeMyPersonalSmartlinks,
  syncAdsterraOfficialApi,
} from './services/adsterraService';
import {
  loadOrCreateUserWorkspace,
  recordVerifiedVisit,
  sanitizeDisplayName,
  subscribeToPublicProfiles,
  subscribeToUserActivities,
  subscribeToUserFollows,
  toggleFollowSecure,
  unlockShopPerkSecure,
  updateUserProfileSecure,
} from './services/userWorkspaceService';
import {
  ActivityRecord,
  AdsterraBackendStatus,
  AdsterraDatePreset,
  AdsterraIntegrationRecord,
  AppPersistedState,
  FollowRelation,
  LinkReportRecord,
  LinkVisitRecord,
  MainScreen,
  ManagedLink,
  ModerationLogRecord,
  MultiEntitlementRecord,
  PaymentMethod,
  PaymentNumbersConfig,
  PaymentRequestRecord,
  PublicProfile,
  ShopRewardItem,
  SuggestedUser,
  UserPersonalSmartlink,
  UserProfileData,
  VisitMode,
  VisitTab,
} from './types';

const STORAGE_PREFIX = 'infinity_rewards_phase4_v1';
const VALID_SCREENS: MainScreen[] = [
  'home',
  'leaderboard',
  'shop',
  'adsterra',
  'profile',
  'links',
  'admin',
];

interface CachedUiPrefs {
  activeScreen: MainScreen;
  visitTab: VisitTab;
  cooldowns: Record<string, number>;
  notifications: AppPersistedState['notifications'];
  skippedOffsets: Record<VisitTab, number>;
  removedQueueIds: Record<VisitTab, string[]>;
}

function getStorageKey(uid: string): string {
  return `${STORAGE_PREFIX}_${uid}`;
}

function loadUserUiCache(
  uid: string,
  fallbackName: string
): { state: AppPersistedState; removedQueueIds: Record<VisitTab, string[]> } {
  const emptyRemoved: Record<VisitTab, string[]> = { smartlink: [], website: [] };
  try {
    const raw = window.localStorage.getItem(getStorageKey(uid));
    if (!raw) {
      return {
        state: {
          ...DEFAULT_APP_STATE,
          profile: {
            ...DEFAULT_APP_STATE.profile,
            displayName: fallbackName,
          },
        },
        removedQueueIds: emptyRemoved,
      };
    }
    const parsed = JSON.parse(raw) as Partial<CachedUiPrefs>;
    const activeScreen = VALID_SCREENS.includes(parsed.activeScreen as MainScreen)
      ? (parsed.activeScreen as MainScreen)
      : 'home';
    const visitTab: VisitTab =
      parsed.visitTab === 'website' || parsed.visitTab === 'smartlink'
        ? parsed.visitTab
        : 'smartlink';

    return {
      state: {
        ...DEFAULT_APP_STATE,
        activeScreen,
        visitTab,
        cooldowns:
          parsed.cooldowns && typeof parsed.cooldowns === 'object' ? parsed.cooldowns : {},
        notifications: Array.isArray(parsed.notifications)
          ? parsed.notifications
          : DEFAULT_APP_STATE.notifications,
        skippedOffsets: {
          smartlink: parsed.skippedOffsets?.smartlink ?? 0,
          website: parsed.skippedOffsets?.website ?? 0,
        },
        profile: {
          ...DEFAULT_APP_STATE.profile,
          displayName: fallbackName,
        },
      },
      removedQueueIds: {
        smartlink: Array.isArray(parsed.removedQueueIds?.smartlink)
          ? parsed.removedQueueIds!.smartlink.map(String)
          : [],
        website: Array.isArray(parsed.removedQueueIds?.website)
          ? parsed.removedQueueIds!.website.map(String)
          : [],
      },
    };
  } catch {
    return {
      state: {
        ...DEFAULT_APP_STATE,
        profile: {
          ...DEFAULT_APP_STATE.profile,
          displayName: fallbackName,
        },
      },
      removedQueueIds: emptyRemoved,
    };
  }
}

export default function App() {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [isEmailVerified, setIsEmailVerified] = useState<boolean>(false);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [adminCheckResolved, setAdminCheckResolved] = useState<boolean>(false);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [workspaceReady, setWorkspaceReady] = useState<boolean>(false);
  const [accountCreatedAtMs, setAccountCreatedAtMs] = useState<number | null>(null);

  const [state, setState] = useState<AppPersistedState>(DEFAULT_APP_STATE);
  const [removedQueueIds, setRemovedQueueIds] = useState<Record<VisitTab, string[]>>({
    smartlink: [],
    website: [],
  });

  const [publicProfiles, setPublicProfiles] = useState<PublicProfile[]>([]);
  const [followingList, setFollowingList] = useState<FollowRelation[]>([]);
  const [followersList, setFollowersList] = useState<FollowRelation[]>([]);
  const [activities, setActivities] = useState<ActivityRecord[]>([]);

  // Phase 4 Real-Time Link Management States
  const [approvedLinks, setApprovedLinks] = useState<ManagedLink[]>([]);
  const [mySubmittedLinks, setMySubmittedLinks] = useState<ManagedLink[]>([]);
  const [myLinkVisits, setMyLinkVisits] = useState<LinkVisitRecord[]>([]);
  const [adminAllLinks, setAdminAllLinks] = useState<ManagedLink[]>([]);
  const [adminReports, setAdminReports] = useState<LinkReportRecord[]>([]);
  const [adminModerationLogs, setAdminModerationLogs] = useState<ModerationLogRecord[]>([]);
  const [adminPaymentRequests, setAdminPaymentRequests] = useState<PaymentRequestRecord[]>([]);

  // Multi (5) Payment & Entitlement States
  const [visitMode, setVisitMode] = useState<VisitMode>('single');
  const [multiEntitlement, setMultiEntitlement] = useState<MultiEntitlementRecord | null>(null);
  const [myPaymentRequests, setMyPaymentRequests] = useState<PaymentRequestRecord[]>([]);
  const [paymentConfig, setPaymentConfig] = useState<PaymentNumbersConfig>(DEFAULT_PAYMENT_NUMBERS);

  // Per-User Isolated Adsterra Integration & Personal Smartlinks
  const [adsterraIntegration, setAdsterraIntegration] =
    useState<AdsterraIntegrationRecord | null>(null);
  const [adsterraBackendStatus, setAdsterraBackendStatus] =
    useState<AdsterraBackendStatus>(DEFAULT_BACKEND_STATUS);
  const [personalSmartlinks, setPersonalSmartlinks] = useState<UserPersonalSmartlink[]>([]);

  const [previousScreen, setPreviousScreen] = useState<MainScreen>('home');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<ManagedLink | null>(null);
  const [autoVisitSession, setAutoVisitSession] = useState<{
    active: boolean;
    startId?: string | null;
    preferredBatchIds?: string[];
    nonce: number;
  } | null>(null);
  const [isProModalOpen, setIsProModalOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  // Race-condition & token-refresh loop guards for async email-based admin checks
  const adminCheckSeqRef = useRef(0);
  const refreshingAdminKeyRef = useRef<string | null>(null);
  const lastForceCheckedRef = useRef<{ key: string; at: number } | null>(null);
  const lastIdentityKeyRef = useRef<string | null>(null);
  const visitStatsQueueRef = useRef<Promise<void>>(Promise.resolve());
  const autoEnabledMultiRef = useRef(false);
  const latestWorkspaceRef = useRef({
    demoPoints: state.demoPoints,
    totalVisits: state.totalVisits,
    successfulVisits: state.successfulVisits,
    visitedToday: state.visitedToday,
    displayName: state.profile.displayName,
    username: state.profile.username,
    avatar: state.profile.avatar,
  });
  latestWorkspaceRef.current = {
    demoPoints: state.demoPoints,
    totalVisits: state.totalVisits,
    successfulVisits: state.successfulVisits,
    visitedToday: state.visitedToday,
    displayName: state.profile.displayName,
    username: state.profile.username,
    avatar: state.profile.avatar,
  };

  const clearAdminSessionState = useCallback(() => {
    adminCheckSeqRef.current += 1;
    refreshingAdminKeyRef.current = null;
    setIsAdmin(false);
    setAdminCheckResolved(false);
    setAdminAllLinks([]);
    setAdminReports([]);
    setAdminModerationLogs([]);
    setAdminPaymentRequests([]);
  }, []);

  const verifyAdminForUser = useCallback(
    async (user: User, identityKey: string) => {
      if (refreshingAdminKeyRef.current === identityKey) {
        return;
      }
      const recent = lastForceCheckedRef.current;
      if (recent && recent.key === identityKey && Date.now() - recent.at < 3000) {
        setAdminCheckResolved(true);
        return;
      }

      const seq = ++adminCheckSeqRef.current;
      if (lastIdentityKeyRef.current !== identityKey) {
        setIsAdmin(false);
        setAdminCheckResolved(false);
        setAdminAllLinks([]);
        setAdminReports([]);
        setAdminModerationLogs([]);
        setAdminPaymentRequests([]);
      }
      lastIdentityKeyRef.current = identityKey;
      refreshingAdminKeyRef.current = identityKey;

      try {
        const adminStatus = await checkIsAdminUser(user, true);
        lastForceCheckedRef.current = { key: identityKey, at: Date.now() };
        if (adminCheckSeqRef.current !== seq) return;
        const activeUser = auth.currentUser;
        if (!activeUser || activeUser.uid !== user.uid || !activeUser.emailVerified) {
          setIsAdmin(false);
          setAdminCheckResolved(false);
          setAdminAllLinks([]);
          setAdminReports([]);
          setAdminModerationLogs([]);
          setAdminPaymentRequests([]);
          return;
        }
        setIsAdmin(adminStatus);
        setAdminCheckResolved(true);
        if (!adminStatus) {
          setAdminAllLinks([]);
          setAdminReports([]);
          setAdminModerationLogs([]);
          setAdminPaymentRequests([]);
        }
      } finally {
        if (refreshingAdminKeyRef.current === identityKey) {
          refreshingAdminKeyRef.current = null;
        }
      }
    },
    []
  );

  // Real Firebase ID Token listener — re-verifies session & admin claims on auth/token changes
  useEffect(() => {
    const unsubscribe = onIdTokenChanged(auth, (user) => {
      setAuthLoading(false);

      if (!user) {
        lastIdentityKeyRef.current = null;
        lastForceCheckedRef.current = null;
        clearAdminSessionState();
        setAuthUser(null);
        setIsEmailVerified(false);
        setWorkspaceReady(false);
        setPublicProfiles([]);
        setFollowingList([]);
        setFollowersList([]);
        setActivities([]);
        setApprovedLinks([]);
        setMySubmittedLinks([]);
        setMyLinkVisits([]);
        setMultiEntitlement(null);
        setMyPaymentRequests([]);
        setPaymentConfig(DEFAULT_PAYMENT_NUMBERS);
        setAdsterraIntegration(null);
        setAdsterraBackendStatus(DEFAULT_BACKEND_STATUS);
        setPersonalSmartlinks([]);
        setVisitMode('single');
        autoEnabledMultiRef.current = false;
        setIsMenuOpen(false);
        setIsNotificationsOpen(false);
        setReportTarget(null);
        setAutoVisitSession(null);
        setIsProModalOpen(false);
        return;
      }

      const verified = Boolean(user.emailVerified);
      const identityKey = `${user.uid}|${(user.email ?? '').trim().toLowerCase()}|${verified}`;

      setAuthUser((prev) =>
        prev &&
        prev.uid === user.uid &&
        prev.email === user.email &&
        prev.emailVerified === user.emailVerified
          ? prev
          : user
      );
      setIsEmailVerified(verified);

      if (!verified) {
        lastIdentityKeyRef.current = identityKey;
        lastForceCheckedRef.current = null;
        clearAdminSessionState();
        setMultiEntitlement(null);
        setMyPaymentRequests([]);
        setPaymentConfig(DEFAULT_PAYMENT_NUMBERS);
        setAdsterraIntegration(null);
        setAdsterraBackendStatus(DEFAULT_BACKEND_STATUS);
        setPersonalSmartlinks([]);
        setVisitMode('single');
        setWorkspaceReady(false);
        return;
      }

      void verifyAdminForUser(user, identityKey);
    });
    return () => unsubscribe();
  }, [clearAdminSessionState, verifyAdminForUser]);

  // Load verified user's Firestore workspace + real-time subscriptions
  useEffect(() => {
    if (!authUser || !isEmailVerified) {
      clearAdminSessionState();
      setMultiEntitlement(null);
      setMyPaymentRequests([]);
      setPaymentConfig(DEFAULT_PAYMENT_NUMBERS);
      setAdsterraIntegration(null);
      setAdsterraBackendStatus(DEFAULT_BACKEND_STATUS);
      setPersonalSmartlinks([]);
      setVisitMode('single');
      setWorkspaceReady(false);
      return;
    }

    let cancelled = false;
    setWorkspaceError(null);
    setSubscriptionError(null);
    const fallbackName = sanitizeDisplayName(authUser.displayName, authUser.email);
    const localSeed = loadUserUiCache(authUser.uid, fallbackName);
    setState(localSeed.state);
    setRemovedQueueIds(localSeed.removedQueueIds);

    const authCreationMs = authUser.metadata.creationTime
      ? Date.parse(authUser.metadata.creationTime)
      : null;

    const handleListenerError = (err: Error) => {
      if (cancelled) return;
      let readable = err.message;
      try {
        const parsed = JSON.parse(err.message) as { error?: string; path?: string | null };
        if (parsed.error) {
          readable = parsed.path ? `${parsed.path}: ${parsed.error}` : parsed.error;
        }
      } catch {
        // Keep raw message if not JSON
      }
      setSubscriptionError(readable || 'Real-time data sync interrupted.');
    };

    loadOrCreateUserWorkspace(authUser)
      .then((remote) => {
        if (cancelled) return;
        setWorkspaceError(null);
        setAccountCreatedAtMs(
          authCreationMs && !Number.isNaN(authCreationMs) ? authCreationMs : remote.createdAtMs
        );
        setState((prev) => ({
          ...prev,
          demoPoints: remote.totalPoints,
          totalVisits: remote.totalVisits,
          successfulVisits: remote.successfulVisits,
          visitedToday: remote.visitedToday,
          unlockedShopIds: remote.unlockedShopIds,
          profile: {
            ...prev.profile,
            displayName: remote.displayName,
            username: remote.username,
            handle: `@${remote.username}`,
            bio: remote.bio,
            activeAccent: remote.activeAccent,
            avatar: remote.photoURL || authUser.photoURL || prev.profile.avatar,
            email: authUser.email,
          },
        }));
        setWorkspaceReady(true);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Failed to initialize user workspace:', err);
          setWorkspaceError(
            err instanceof Error
              ? err.message
              : 'Unable to load your cloud workspace. Check your connection and retry.'
          );
          setWorkspaceReady(true);
        }
      });

    const unsubProfiles = subscribeToPublicProfiles((list) => {
      if (!cancelled) setPublicProfiles(list);
    }, handleListenerError);

    const unsubFollows = subscribeToUserFollows(
      authUser.uid,
      (following) => {
        if (!cancelled) {
          setFollowingList(following);
          setState((prev) => ({
            ...prev,
            followedUserIds: following.map((edge) => edge.targetId),
          }));
        }
      },
      (followers) => {
        if (!cancelled) setFollowersList(followers);
      },
      handleListenerError
    );

    const unsubActivities = subscribeToUserActivities(
      authUser.uid,
      (list) => {
        if (!cancelled) setActivities(list);
      },
      handleListenerError
    );

    const unsubApprovedLinks = subscribeApprovedLinks((list) => {
      if (!cancelled) setApprovedLinks(list);
    }, handleListenerError);

    const unsubMyLinks = subscribeMySubmittedLinks(
      authUser.uid,
      (list) => {
        if (!cancelled) setMySubmittedLinks(list);
      },
      handleListenerError
    );

    const unsubMyLinkVisits = subscribeMyLinkVisits(
      authUser.uid,
      (visits) => {
        if (!cancelled) setMyLinkVisits(visits);
      },
      handleListenerError
    );

    const unsubMultiEntitlement = subscribeMyMultiEntitlement(
      authUser.uid,
      (entitlement) => {
        if (!cancelled) setMultiEntitlement(entitlement);
      },
      handleListenerError
    );

    const unsubMyPayments = subscribeMyPaymentRequests(
      authUser.uid,
      (requests) => {
        if (!cancelled) setMyPaymentRequests(requests);
      },
      handleListenerError
    );

    const unsubPaymentConfig = subscribePaymentNumbersConfig((cfg) => {
      if (!cancelled) setPaymentConfig(cfg);
    }, handleListenerError);

    const unsubAdsterraIntegration = subscribeMyAdsterraIntegration(
      authUser.uid,
      (record) => {
        if (!cancelled) setAdsterraIntegration(record);
      },
      handleListenerError
    );

    const unsubPersonalSmartlinks = subscribeMyPersonalSmartlinks(
      authUser.uid,
      (links) => {
        if (!cancelled) setPersonalSmartlinks(links);
      },
      handleListenerError
    );

    fetchAdsterraBackendStatus()
      .then((status) => {
        if (!cancelled) setAdsterraBackendStatus(status);
      })
      .catch(() => {
        if (!cancelled) setAdsterraBackendStatus(DEFAULT_BACKEND_STATUS);
      });

    return () => {
      cancelled = true;
      unsubProfiles();
      unsubFollows();
      unsubActivities();
      unsubApprovedLinks();
      unsubMyLinks();
      unsubMyLinkVisits();
      unsubMultiEntitlement();
      unsubMyPayments();
      unsubPaymentConfig();
      unsubAdsterraIntegration();
      unsubPersonalSmartlinks();
      setAdsterraIntegration(null);
      setAdsterraBackendStatus(DEFAULT_BACKEND_STATUS);
      setPersonalSmartlinks([]);
    };
  }, [authUser, isEmailVerified, clearAdminSessionState, retryNonce]);

  const isMulti5Active = isAdmin || Boolean(multiEntitlement?.active);

  // Automatically switch to Multi (5) once entitlement activates; fallback to Single if revoked
  useEffect(() => {
    if (isMulti5Active) {
      if (!autoEnabledMultiRef.current) {
        autoEnabledMultiRef.current = true;
        setVisitMode('multi');
      }
    } else {
      autoEnabledMultiRef.current = false;
      if (visitMode === 'multi') {
        setVisitMode('single');
      }
    }
  }, [isMulti5Active, visitMode]);

  // Admin-only real-time moderation subscriptions
  useEffect(() => {
    if (!authUser || !isEmailVerified || !isAdmin) {
      setAdminAllLinks([]);
      setAdminReports([]);
      setAdminModerationLogs([]);
      setAdminPaymentRequests([]);
      return;
    }

    let cancelled = false;
    const handleAdminListenerError = (err: Error) => {
      if (!cancelled) {
        setSubscriptionError(err.message || 'Admin subscription error.');
      }
    };
    const unsubAll = subscribeAdminAllLinks((links) => {
      if (!cancelled) setAdminAllLinks(links);
    }, handleAdminListenerError);
    const unsubReports = subscribeAdminReports((reports) => {
      if (!cancelled) setAdminReports(reports);
    }, handleAdminListenerError);
    const unsubLogs = subscribeAdminModerationLogs((logs) => {
      if (!cancelled) setAdminModerationLogs(logs);
    }, handleAdminListenerError);
    const unsubPayments = subscribeAdminPaymentRequests((requests) => {
      if (!cancelled) setAdminPaymentRequests(requests);
    }, handleAdminListenerError);

    return () => {
      cancelled = true;
      unsubAll();
      unsubReports();
      unsubLogs();
      unsubPayments();
    };
  }, [authUser, isEmailVerified, isAdmin, retryNonce]);

  // Hydrate active spam-prevention cooldowns from Firestore linkVisits on reload
  useEffect(() => {
    if (myLinkVisits.length === 0) return;
    const current = Date.now();
    const cooldownByLinkId = new Map<string, number>();
    for (const l of approvedLinks) {
      cooldownByLinkId.set(l.id, l.cooldownSec);
    }

    setState((prev) => {
      let changed = false;
      const nextCooldowns = { ...prev.cooldowns };
      for (const visit of myLinkVisits) {
        const sec = cooldownByLinkId.get(visit.linkId) ?? DEFAULT_SPAM_COOLDOWN_SEC;
        const expiresAt = visit.createdAtMs + sec * 1000;
        if (expiresAt > current && expiresAt > (nextCooldowns[visit.linkId] ?? 0)) {
          nextCooldowns[visit.linkId] = expiresAt;
          changed = true;
        }
      }
      return changed ? { ...prev, cooldowns: nextCooldowns } : prev;
    });
  }, [myLinkVisits, approvedLinks]);

  // Guard admin screen access only once async admin verification has completed
  useEffect(() => {
    if (workspaceReady && adminCheckResolved && state.activeScreen === 'admin' && !isAdmin) {
      setState((prev) => ({ ...prev, activeScreen: 'home' }));
    }
  }, [workspaceReady, adminCheckResolved, state.activeScreen, isAdmin]);

  const refreshAdsterraBackendStatus = useCallback(async () => {
    if (!authUser || !isEmailVerified) return;
    try {
      const status = await fetchAdsterraBackendStatus();
      setAdsterraBackendStatus(status);
    } catch {
      setAdsterraBackendStatus(DEFAULT_BACKEND_STATUS);
    }
  }, [authUser, isEmailVerified]);

  // Auto-retry Adsterra backend reachability when opening the Adsterra screen after cold starts
  useEffect(() => {
    if (
      authUser &&
      isEmailVerified &&
      state.activeScreen === 'adsterra' &&
      !adsterraBackendStatus.backendReachable
    ) {
      void refreshAdsterraBackendStatus();
    }
  }, [
    authUser,
    isEmailVerified,
    state.activeScreen,
    adsterraBackendStatus.backendReachable,
    refreshAdsterraBackendStatus,
  ]);

  // Persist lightweight UI preferences per UID
  useEffect(() => {
    if (!authUser || !isEmailVerified || !workspaceReady) return;
    try {
      const uiOnly: CachedUiPrefs = {
        activeScreen: state.activeScreen,
        visitTab: state.visitTab,
        cooldowns: state.cooldowns,
        notifications: state.notifications,
        skippedOffsets: state.skippedOffsets,
        removedQueueIds,
      };
      window.localStorage.setItem(getStorageKey(authUser.uid), JSON.stringify(uiOnly));
    } catch {
      // Ignore quota issues gracefully
    }
  }, [
    authUser,
    isEmailVerified,
    workspaceReady,
    state.activeScreen,
    state.visitTab,
    state.cooldowns,
    state.notifications,
    state.skippedOffsets,
    removedQueueIds,
  ]);

  // Live cooldown countdown ticker
  useEffect(() => {
    const interval = window.setInterval(() => {
      const current = Date.now();
      setNowMs(current);
      setState((prev) => {
        const entries = Object.entries(prev.cooldowns);
        const hasExpired = entries.some(([, expiresAt]) => expiresAt <= current);
        if (!hasExpired) return prev;
        const cleaned: Record<string, number> = {};
        for (const [id, expiresAt] of entries) {
          if (expiresAt > current) cleaned[id] = expiresAt;
        }
        return { ...prev, cooldowns: cleaned };
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  // Auto-dismiss transient toast
  useEffect(() => {
    if (!toastMessage) return;
    const timer = window.setTimeout(() => setToastMessage(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  const navigateTo = (screen: MainScreen) => {
    if (screen === 'admin' && !isAdmin) return;
    setState((prev) => {
      if (prev.activeScreen !== 'profile' && screen === 'profile') {
        setPreviousScreen(prev.activeScreen);
      }
      return { ...prev, activeScreen: screen };
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Unified real Firestore Follow / Unfollow
  const handleToggleFollowTarget = async (target: {
    id: string;
    name: string;
    username: string;
    avatar: string;
    isRealUser: boolean;
    followersCount?: number;
  }) => {
    if (!authUser) return;
    const currentlyFollowing = followingList.some((edge) => edge.targetId === target.id);

    try {
      await toggleFollowSecure({
        followerUid: authUser.uid,
        followerName: state.profile.displayName,
        followerUsername: `@${state.profile.username}`,
        followerAvatar: state.profile.avatar,
        followerCurrentFollowingCount: followingList.length,
        targetId: target.id,
        targetName: target.name,
        targetUsername: target.username,
        targetAvatar: target.avatar,
        targetIsRealUser: target.isRealUser,
        targetCurrentFollowersCount: target.followersCount,
        currentlyFollowing,
      });
      setToastMessage(
        currentlyFollowing ? `Unfollowed ${target.name}` : `Following ${target.name}`
      );
    } catch (err) {
      setToastMessage(err instanceof Error ? err.message : 'Follow action failed.');
    }
  };

  const combinedSuggestedUsers: SuggestedUser[] = useMemo(() => {
    return publicProfiles
      .filter((p) => p.uid !== authUser?.uid)
      .map((p) => ({
        id: p.uid,
        username: p.displayName,
        handle: `@${p.username}`,
        avatar: p.photoURL,
        specialty: p.specialty,
        followers: p.followersCount,
        demoScore: p.totalPoints,
        isRealUser: true,
      }));
  }, [authUser?.uid, publicProfiles]);

  const handleToggleFollowById = (userId: string) => {
    const targetUser = combinedSuggestedUsers.find((u) => u.id === userId);
    if (!targetUser) return;
    handleToggleFollowTarget({
      id: targetUser.id,
      name: targetUser.username,
      username: targetUser.handle,
      avatar: targetUser.avatar,
      isRealUser: Boolean(targetUser.isRealUser),
      followersCount: targetUser.followers,
    });
  };

  // Complete a dwell cycle for an auto-visited link (strictly other members' links; never self-visit)
  const handleCompleteAutoVisit = useCallback(
    async (item: AutoVisitQueueItem) => {
      if (!authUser) return;
      if (!item.managedLink || item.managedLink.ownerId === authUser.uid) {
        return;
      }
      const expiresAt = Date.now() + Math.max(15, item.cooldownSec) * 1000;
      setState((prev) => ({
        ...prev,
        cooldowns: {
          ...prev.cooldowns,
          [item.id]: Math.max(prev.cooldowns[item.id] ?? 0, expiresAt),
        },
      }));

      if (item.isCommunityLink && item.managedLink) {
        try {
          await recordExternalLinkOpen({
            uid: authUser.uid,
            link: item.managedLink,
          });
        } catch (err) {
          console.warn('External link open log skipped:', err);
        }
      }

      let visitError: unknown = null;
      const statTask = visitStatsQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          const snapshot = latestWorkspaceRef.current;
          try {
            await recordVerifiedVisit({
              uid: authUser.uid,
              link: {
                id: item.id,
                type: item.type,
                title: item.title,
                userId: item.managedLink?.ownerId ?? authUser.uid,
                userName: item.managedLink?.ownerName ?? snapshot.displayName,
                userHandle: item.managedLink?.ownerUsername ?? `@${snapshot.username}`,
                userAvatar: item.managedLink?.ownerAvatar ?? snapshot.avatar,
                category: item.category,
                durationSec: 8,
                demoPoints: 10,
                cooldownSec: item.cooldownSec,
                previewSummary: '',
                destinationDomain: item.domain,
              },
              currentTotalPoints: snapshot.demoPoints,
              currentTotalVisits: snapshot.totalVisits,
              currentSuccessfulVisits: snapshot.successfulVisits,
              currentVisitedToday: snapshot.visitedToday,
            });
            latestWorkspaceRef.current = {
              ...snapshot,
              demoPoints: snapshot.demoPoints + 10,
              totalVisits: snapshot.totalVisits + 1,
              successfulVisits: snapshot.successfulVisits + 1,
              visitedToday: snapshot.visitedToday + 1,
            };
            setState((prev) => ({
              ...prev,
              demoPoints: prev.demoPoints + 10,
              totalVisits: prev.totalVisits + 1,
              successfulVisits: prev.successfulVisits + 1,
              visitedToday: prev.visitedToday + 1,
            }));
          } catch (err) {
            visitError = err;
            console.warn('Visit counter update skipped:', err);
          }
        });

      visitStatsQueueRef.current = statTask;
      await statTask;
      if (visitError) {
        setToastMessage('Visit sync delayed — please check your connection');
        throw visitError;
      }
    },
    [authUser]
  );

  const handleReportLink = async (link: ManagedLink, reason: string) => {
    if (!authUser) return;
    await reportLinkSecure({
      link,
      reporterUid: authUser.uid,
      reporterUsername: `@${state.profile.username}`,
      reason,
    });
    setToastMessage('Link report sent to moderators');
  };

  const handleSubmitLink = async (payload: {
    type: VisitTab;
    title: string;
    description: string;
    rawUrl: string;
    category: string;
  }) => {
    if (!authUser) return;
    await submitLinkSecure({
      uid: authUser.uid,
      ownerName: state.profile.displayName,
      ownerUsername: `@${state.profile.username}`,
      ownerAvatar: state.profile.avatar,
      ...payload,
    });
    setToastMessage(
      payload.type === 'smartlink'
        ? 'Smartlink published and live immediately!'
        : 'Website submitted for moderation'
    );
  };

  const handleUpdateLink = async (
    existingLink: ManagedLink,
    payload: {
      type: VisitTab;
      title: string;
      description: string;
      rawUrl: string;
      category: string;
    }
  ) => {
    if (!authUser) return;
    await updateOwnLinkSecure({
      uid: authUser.uid,
      existingLink,
      ...payload,
    });
    setToastMessage(
      payload.type === 'smartlink'
        ? 'Smartlink updated and live immediately!'
        : 'Website updated and resubmitted for review'
    );
  };

  const handleDeleteOwnLink = async (link: ManagedLink) => {
    if (!authUser) return;
    await deleteLinkSecure({
      link,
      actorUid: authUser.uid,
      actorEmail: authUser.email,
      asAdmin: false,
    });
    setToastMessage('Link deleted');
  };

  const handleModerateLink = async (
    link: ManagedLink,
    decision: 'approved' | 'rejected',
    note: string
  ) => {
    if (!authUser) return;
    await moderateLinkSecure({
      link,
      decision,
      note,
      adminUid: authUser.uid,
      adminEmail: authUser.email,
    });
    setToastMessage(decision === 'approved' ? `Approved "${link.title}"` : `Rejected "${link.title}"`);
  };

  const handleAdminRemoveLink = async (link: ManagedLink, reason: string) => {
    if (!authUser) return;
    await deleteLinkSecure({
      link,
      actorUid: authUser.uid,
      actorEmail: authUser.email,
      asAdmin: true,
      reason,
    });
    setToastMessage(`Removed "${link.title}"`);
  };

  const handleResolveReport = async (
    report: LinkReportRecord,
    action: 'resolve_and_remove' | 'dismiss',
    note: string
  ) => {
    if (!authUser) return;
    const linkedItem = adminAllLinks.find((l) => l.id === report.linkId);
    await resolveReportSecure({
      report,
      linkedItem,
      action,
      adminNote: note,
      adminUid: authUser.uid,
      adminEmail: authUser.email,
    });
    setToastMessage(action === 'resolve_and_remove' ? 'Link removed & report resolved' : 'Report dismissed');
  };

  const handleSubmitMultiPayment = async (payload: {
    paymentMethod: PaymentMethod;
    paymentNumber: string;
    senderNumber?: string;
    transactionId: string;
    screenshotFile: File;
  }) => {
    if (!authUser) return;
    await submitMulti5PaymentRequest({
      uid: authUser.uid,
      userName: state.profile.displayName,
      userUsername: `@${state.profile.username}`,
      paymentMethod: payload.paymentMethod,
      paymentNumber: payload.paymentNumber,
      senderNumber: payload.senderNumber,
      transactionId: payload.transactionId,
      screenshotFile: payload.screenshotFile,
    });
    setToastMessage('Multi (5) payment request submitted for admin approval');
  };

  const handleReviewPaymentRequest = async (
    request: PaymentRequestRecord,
    decision: 'approved' | 'rejected',
    adminNote: string,
    verifiedProof?: boolean
  ) => {
    if (!authUser) return;
    await reviewPaymentRequestSecure({
      request,
      decision,
      adminNote,
      verifiedProof,
    });
    setToastMessage(
      decision === 'approved'
        ? `Multi (5) approved & activated for ${request.userName}`
        : `Rejected payment request ${request.transactionId}`
    );
  };

  const handleUpdatePaymentNumbers = async (numbers: {
    bkashNumber: string;
    nagadNumber: string;
  }) => {
    if (!authUser) return;
    const saved = await updatePaymentNumbersConfigSecure(numbers);
    setPaymentConfig(saved);
    setToastMessage('bKash & Nagad payment numbers updated');
  };

  // Per-user isolated Adsterra handlers
  const handleConnectAdsterraApiKey = async (payload: {
    apiKey: string;
    verifyWithAdsterra: boolean;
  }) => {
    if (!authUser) return;
    const nextBackendStatus = await connectAdsterraApiKeySecure(payload);
    setAdsterraBackendStatus(nextBackendStatus);
    await saveMyAdsterraIntegration({
      uid: authUser.uid,
      publisherId: adsterraIntegration?.publisherId ?? '',
      publisherLabel: adsterraIntegration?.publisherLabel ?? '',
      smartlinkTitle: adsterraIntegration?.smartlinkTitle ?? '',
      smartlinkUrl: adsterraIntegration?.smartlinkUrl ?? '',
      connectionMode: 'official_api_key',
      backendStatus: nextBackendStatus,
    });
    setToastMessage(
      nextBackendStatus.apiVerified
        ? 'Adsterra API Key verified and encrypted on backend'
        : 'Adsterra API Key stored in encrypted backend vault'
    );
  };

  const handleSyncAdsterraApi = async () => {
    if (!authUser) return;
    const nextBackendStatus = await syncAdsterraOfficialApi();
    setAdsterraBackendStatus(nextBackendStatus);
    if (adsterraIntegration || nextBackendStatus.hasApiKey) {
      await saveMyAdsterraIntegration({
        uid: authUser.uid,
        publisherId: adsterraIntegration?.publisherId ?? '',
        publisherLabel: adsterraIntegration?.publisherLabel ?? '',
        smartlinkTitle: adsterraIntegration?.smartlinkTitle ?? '',
        smartlinkUrl: adsterraIntegration?.smartlinkUrl ?? '',
        connectionMode: 'official_api_key',
        backendStatus: nextBackendStatus,
      });
    }
    setToastMessage('Synced domains, placements & full Adsterra stats');
  };

  const handleFetchAdsterraStats = useCallback(
    async (params: {
      preset: AdsterraDatePreset;
      startDate?: string;
      finishDate?: string;
      domainId?: string;
      placementId?: string;
      country?: string;
    }) => {
      if (!authUser) return;
      const nextBackendStatus = await fetchAdsterraDetailedStats(params);
      setAdsterraBackendStatus(nextBackendStatus);
    },
    [authUser]
  );

  const handleDisconnectAdsterra = async () => {
    if (!authUser) return;
    const nextBackendStatus = await disconnectMyAdsterraIntegration(authUser.uid);
    setAdsterraBackendStatus(nextBackendStatus);
    setToastMessage('Adsterra account disconnected & encrypted API key purged');
  };

  const handleCreatePersonalSmartlink = async (payload: {
    title: string;
    rawUrl: string;
    category: string;
  }) => {
    if (!authUser) return;
    await createMyPersonalSmartlink({
      uid: authUser.uid,
      title: payload.title,
      rawUrl: payload.rawUrl,
      category: payload.category,
    });
    setToastMessage('Personal Smartlink added to your private workspace');
  };

  const handleDeletePersonalSmartlink = async (linkId: string) => {
    if (!authUser) return;
    await deleteMyPersonalSmartlink(authUser.uid, linkId);
    setToastMessage('Personal Smartlink deleted');
  };

  const handlePublishSmartlinkToCommunity = async (payload: {
    title: string;
    url: string;
    category: string;
  }) => {
    const trimmedTitle = payload.title.trim();
    const safeTitle =
      trimmedTitle.length >= 3
        ? trimmedTitle.slice(0, 80)
        : `${trimmedTitle || 'My'} Smartlink`.slice(0, 80);
    await handleSubmitLink({
      type: 'smartlink',
      title: safeTitle,
      description: 'Adsterra Smartlink shared for mutual real human community visits.',
      rawUrl: payload.url,
      category: payload.category || 'Other',
    });
  };

  const handleUnlockShopItem = async (item: ShopRewardItem) => {
    if (!authUser) return;
    if (state.unlockedShopIds.includes(item.id) || state.demoPoints < item.demoCost) {
      return;
    }
    const prevUnlocked = state.unlockedShopIds;
    const prevAccent = state.profile.activeAccent;
    const nextUnlocked = [...prevUnlocked, item.id].slice(0, 20);
    const nextAccent = item.category === 'Theme' ? item.previewAccent : prevAccent;

    setState((prev) => ({
      ...prev,
      unlockedShopIds: nextUnlocked,
      profile: {
        ...prev.profile,
        activeAccent: nextAccent,
      },
    }));

    try {
      await unlockShopPerkSecure({
        uid: authUser.uid,
        nextUnlockedIds: nextUnlocked,
        activeAccent: nextAccent,
      });
      setToastMessage(`Unlocked "${item.title}"`);
    } catch (err) {
      setState((prev) => ({
        ...prev,
        unlockedShopIds: prevUnlocked,
        profile: {
          ...prev.profile,
          activeAccent: prevAccent,
        },
      }));
      setToastMessage(err instanceof Error ? err.message : 'Failed to unlock item.');
    }
  };

  const handleApplyAccent = async (accent: UserProfileData['activeAccent']) => {
    if (!authUser) return;
    const prevAccent = state.profile.activeAccent;
    setState((prev) => ({
      ...prev,
      profile: { ...prev.profile, activeAccent: accent },
    }));
    try {
      await unlockShopPerkSecure({
        uid: authUser.uid,
        nextUnlockedIds: state.unlockedShopIds,
        activeAccent: accent,
      });
      setToastMessage(`Applied ${accent} profile frame`);
    } catch (err) {
      setState((prev) => ({
        ...prev,
        profile: { ...prev.profile, activeAccent: prevAccent },
      }));
      setToastMessage(err instanceof Error ? err.message : 'Failed to update profile frame.');
    }
  };

  const handleSaveProfile = async (updates: {
    displayName: string;
    username: string;
    bio: string;
    photoURL: string;
  }) => {
    if (!authUser) return;
    const saved = await updateUserProfileSecure({
      user: authUser,
      currentUsername: state.profile.username,
      displayName: updates.displayName,
      username: updates.username,
      bio: updates.bio,
      photoURL: updates.photoURL,
      activeAccent: state.profile.activeAccent,
    });
    setState((prev) => ({
      ...prev,
      profile: {
        ...prev.profile,
        displayName: saved.displayName,
        username: saved.username,
        handle: `@${saved.username}`,
        bio: saved.bio,
        avatar: saved.photoURL,
      },
    }));
    setToastMessage('Profile saved to Firestore');
  };

  const handleResetUiPrefs = () => {
    setRemovedQueueIds({ smartlink: [], website: [] });
    setState((prev) => ({
      ...prev,
      notifications: DEFAULT_APP_STATE.notifications,
      skippedOffsets: { smartlink: 0, website: 0 },
    }));
    setToastMessage('Local queue & UI preferences reset');
  };

  const handleLogout = async () => {
    try {
      await logoutUser();
      setToastMessage('Signed out successfully');
    } catch (err) {
      console.error('Logout error:', err);
      setToastMessage(err instanceof Error ? err.message : 'Failed to sign out.');
    }
  };

  // Deduplicated Approved Links in Active Tab:
  // Strict Mutual Exchange Ring:
  // - NEVER include the current user's own links (A sees B,C,D...; B sees A,C,D...; C sees A,B,D...)
  // - Interleave fairly across distinct owners (one link per member per round) so every new & existing member gets visited.
  const { linksInActiveTab, ownLiveLinksInTab, otherContributorsCount } = useMemo(() => {
    const seenIds = new Set<string>();
    const seenKeys = new Set<string>();
    const currentUid = authUser?.uid;
    const ownLive: ManagedLink[] = [];
    const bucketsByOwner = new Map<string, ManagedLink[]>();

    const visitsByUid = new Map<string, number>();
    for (const profile of publicProfiles) {
      visitsByUid.set(profile.uid, profile.totalVisits ?? 0);
    }

    for (const item of approvedLinks) {
      if (item.type !== state.visitTab) continue;
      if (seenIds.has(item.id) || (item.urlKey && seenKeys.has(item.urlKey))) continue;
      seenIds.add(item.id);
      if (item.urlKey) seenKeys.add(item.urlKey);

      if (currentUid && item.ownerId === currentUid) {
        ownLive.push(item);
      } else {
        const list = bucketsByOwner.get(item.ownerId) ?? [];
        list.push(item);
        bucketsByOwner.set(item.ownerId, list);
      }
    }

    // Order each member's links newest-first, then sort members fairly by reciprocal exchange activity
    const ownerBuckets = Array.from(bucketsByOwner.entries()).map(([ownerId, items]) => {
      items.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
      return {
        ownerId,
        contributorVisits: visitsByUid.get(ownerId) ?? 0,
        latestUpdateMs: items[0]?.updatedAtMs ?? 0,
        items,
      };
    });

    ownerBuckets.sort((a, b) => {
      if (a.contributorVisits !== b.contributorVisits) {
        return b.contributorVisits - a.contributorVisits;
      }
      return b.latestUpdateMs - a.latestUpdateMs;
    });

    // Interleave round-robin: Member1[0], Member2[0], Member3[0] ... then round 2
    const interleaved: ManagedLink[] = [];
    let round = 0;
    let addedInRound = true;
    while (addedInRound) {
      addedInRound = false;
      for (const bucket of ownerBuckets) {
        if (round < bucket.items.length) {
          interleaved.push(bucket.items[round]);
          addedInRound = true;
        }
      }
      round += 1;
    }

    return {
      linksInActiveTab: interleaved,
      ownLiveLinksInTab: ownLive,
      otherContributorsCount: ownerBuckets.length,
    };
  }, [approvedLinks, authUser?.uid, publicProfiles, state.visitTab]);

  // Queue excludes user-removed items
  const removedSet = useMemo(
    () => new Set(removedQueueIds[state.visitTab] || []),
    [removedQueueIds, state.visitTab]
  );

  const queueLinks = useMemo(
    () => linksInActiveTab.filter((item) => !removedSet.has(item.id)),
    [linksInActiveTab, removedSet]
  );

  const availableLinks = useMemo(
    () => queueLinks.filter((item) => (state.cooldowns[item.id] ?? 0) <= nowMs),
    [queueLinks, state.cooldowns, nowMs]
  );

  const activeCooldownCount = useMemo(
    () => Object.values(state.cooldowns).filter((exp) => exp > nowMs).length,
    [state.cooldowns, nowMs]
  );

  const queuePosition = useMemo(() => {
    if (availableLinks.length === 0) return 0;
    const raw = state.skippedOffsets[state.visitTab] ?? 0;
    return ((raw % availableLinks.length) + availableLinks.length) % availableLinks.length;
  }, [availableLinks.length, state.skippedOffsets, state.visitTab]);

  const nextUpLink = useMemo(() => {
    if (availableLinks.length === 0) return null;
    return availableLinks[queuePosition] ?? availableLinks[0];
  }, [availableLinks, queuePosition]);

  const shortestCooldownLink = useMemo(() => {
    const cooling = queueLinks
      .map((link) => ({
        link,
        remainingSec: Math.ceil(((state.cooldowns[link.id] ?? 0) - nowMs) / 1000),
      }))
      .filter((entry) => entry.remainingSec > 0)
      .sort((a, b) => a.remainingSec - b.remainingSec);
    return cooling[0] ?? null;
  }, [queueLinks, state.cooldowns, nowMs]);

  const communityQueueItems: AutoVisitQueueItem[] = useMemo(
    () =>
      queueLinks
        .filter((item) => item.ownerId !== authUser?.uid)
        .map((item) => ({
          id: item.id,
          title: item.title,
          url: item.url,
          domain: item.domain,
          category: item.category,
          type: item.type,
          cooldownSec: item.cooldownSec || DEFAULT_SPAM_COOLDOWN_SEC,
          isCommunityLink: true,
          managedLink: item,
        })),
    [authUser?.uid, queueLinks]
  );

  const activeDockLinks = useMemo(
    () => (autoVisitSession ? communityQueueItems : []),
    [autoVisitSession, communityQueueItems]
  );

  const hasPendingMultiPayment = useMemo(
    () => myPaymentRequests.some((req) => req.status === 'pending'),
    [myPaymentRequests]
  );

  const adminPendingCount = useMemo(
    () =>
      adminAllLinks.filter((l) => l.status === 'pending').length +
      adminPaymentRequests.filter((p) => p.status === 'pending').length,
    [adminAllLinks, adminPaymentRequests]
  );

  const unreadNotificationsCount = state.notifications.filter((n) => !n.read).length;

  // 1. Auth Loading Screen
  if (authLoading) {
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#040713] px-4 text-slate-100">
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0">
          <div className="neon-grid-bg absolute inset-0" />
          <div className="absolute -top-24 -left-24 h-80 w-80 rounded-full bg-[#00F5FF]/20 blur-[120px]" />
          <div className="absolute -right-24 bottom-0 h-80 w-80 rounded-full bg-[#FF2E93]/20 blur-[120px]" />
          <div className="absolute top-1/3 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-[#00FF87]/12 blur-[120px]" />
        </div>
        <div className="neon-prism-panel relative z-10 flex flex-col items-center gap-3 rounded-3xl p-8 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#00F5FF] via-[#B84DFF] to-[#FF2E93] text-xl font-extrabold text-white shadow-[0_0_24px_rgba(0,245,255,0.55)]">
            ∞
          </span>
          <p className="font-display neon-text-spectrum text-base font-extrabold tracking-tight">
            INFINITY REWARDS
          </p>
          <p className="text-xs text-slate-300">Verifying authentication session...</p>
        </div>
      </div>
    );
  }

  // 2. Protected Route Guard: Unauthenticated -> AuthScreen
  if (!authUser) {
    return <AuthScreen />;
  }

  // 3. Protected Route Guard: Unverified Email -> VerifyEmailScreen
  if (!isEmailVerified) {
    return (
      <VerifyEmailScreen
        user={authUser}
        onVerified={async (refreshedUser) => {
          await refreshedUser.getIdToken(true);
          setAuthUser(refreshedUser);
          setIsEmailVerified(Boolean(refreshedUser.emailVerified));
        }}
      />
    );
  }

  // 4. Protected Dashboard
  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#040713] text-slate-100">
      {/* Full-Spectrum Multi-Neon Ambient Lighting & Subtle Grid */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="neon-grid-bg absolute inset-0" />
        <div className="absolute -top-40 -left-24 h-[28rem] w-[28rem] rounded-full bg-[#2D7BFF]/20 blur-[135px]" />
        <div className="absolute top-1/5 -right-28 h-[28rem] w-[28rem] rounded-full bg-[#B84DFF]/22 blur-[140px]" />
        <div className="absolute top-1/2 left-1/4 h-80 w-80 rounded-full bg-[#00FF87]/14 blur-[135px]" />
        <div className="absolute right-1/4 bottom-0 h-80 w-80 rounded-full bg-[#FF2E93]/16 blur-[135px]" />
        <div className="absolute -bottom-24 left-10 h-72 w-72 rounded-full bg-[#00F5FF]/16 blur-[125px]" />
        <div className="absolute top-12 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-[#FFB800]/8 blur-[120px]" />
      </div>

      {/* Top Navigation */}
      <TopNav
        profile={state.profile}
        demoPoints={state.demoPoints}
        unreadCount={unreadNotificationsCount}
        activeScreen={state.activeScreen}
        onOpenMenu={() => setIsMenuOpen(true)}
        onOpenNotifications={() => setIsNotificationsOpen(true)}
        onOpenProfile={() => navigateTo('profile')}
        onNavigateHome={() => navigateTo('home')}
      />

      {/* Responsive Content Shell */}
      <div className="relative z-10 mx-auto flex w-full max-w-7xl gap-6 px-4 pt-6 pb-24 sm:px-6 lg:pb-12">
        <DesktopSidebar
          activeScreen={state.activeScreen}
          profile={state.profile}
          demoPoints={state.demoPoints}
          isAdmin={isAdmin}
          adminPendingCount={adminPendingCount}
          onSelectScreen={navigateTo}
          onLogout={handleLogout}
        />

        <main className="min-w-0 flex-1">
          {(workspaceError || subscriptionError) && (
            <div
              role="alert"
              className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-400/35 bg-rose-950/40 px-4 py-3 text-xs text-rose-100"
            >
              <div className="flex min-w-0 items-start gap-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
                <div className="min-w-0 space-y-0.5">
                  <p className="font-semibold text-white">
                    {workspaceError
                      ? 'Could not load cloud profile workspace'
                      : 'Real-time sync warning'}
                  </p>
                  <p className="break-words text-rose-200/90">
                    {workspaceError || subscriptionError}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setWorkspaceError(null);
                    setSubscriptionError(null);
                    setRetryNonce((n) => n + 1);
                  }}
                  className="flex min-h-[34px] items-center gap-1.5 rounded-xl border border-rose-300/35 bg-rose-500/20 px-3 py-1 font-semibold text-white hover:bg-rose-500/30"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Retry</span>
                </button>
                <button
                  type="button"
                  aria-label="Dismiss error banner"
                  onClick={() => {
                    setWorkspaceError(null);
                    setSubscriptionError(null);
                  }}
                  className="flex min-h-[34px] min-w-[34px] items-center justify-center rounded-xl border border-white/15 bg-white/5 text-slate-300 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}

          <AnimatePresence mode="wait">
            <motion.div
              key={state.activeScreen}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            >
              {state.activeScreen === 'home' && (
                <HomeDashboard
                  currentUid={authUser.uid}
                  demoPoints={state.demoPoints}
                  totalVisits={state.totalVisits}
                  visitedToday={state.visitedToday}
                  activeCooldownCount={activeCooldownCount}
                  activeUsersCount={publicProfiles.length}
                  liveLinksCount={approvedLinks.length}
                  suggestedUsers={combinedSuggestedUsers}
                  followedUserIds={state.followedUserIds}
                  visitTab={state.visitTab}
                  visitMode={visitMode}
                  isMulti5Active={isMulti5Active}
                  hasPendingMultiPayment={hasPendingMultiPayment}
                  queueLinks={queueLinks}
                  availableLinks={availableLinks}
                  totalLinksInTab={linksInActiveTab.length}
                  ownLiveLinksCount={ownLiveLinksInTab.length}
                  otherContributorsCount={otherContributorsCount}
                  removedCountInTab={removedQueueIds[state.visitTab]?.length ?? 0}
                  nextUpLink={nextUpLink}
                  queuePosition={queuePosition}
                  shortestCooldownLink={shortestCooldownLink}
                  myLinkVisits={myLinkVisits}
                  mySubmittedLinks={mySubmittedLinks}
                  nowMs={nowMs}
                  cooldowns={state.cooldowns}
                  isAdmin={isAdmin}
                  adminPendingCount={adminPendingCount}
                  isAdsterraConnected={
                    adsterraBackendStatus.backendReachable
                      ? adsterraBackendStatus.hasApiKey
                      : adsterraIntegration?.status === 'connected'
                  }
                  hasAdsterraApiKey={
                    adsterraBackendStatus.backendReachable
                      ? adsterraBackendStatus.hasApiKey
                      : Boolean(adsterraIntegration?.hasApiKey)
                  }
                  adsterraPlacements={adsterraBackendStatus.placementsPreview}
                  personalSmartlinks={personalSmartlinks}
                  primaryAdsterraSmartlink={
                    adsterraIntegration?.smartlinkUrl
                      ? {
                          title: adsterraIntegration.smartlinkTitle || 'Primary Adsterra Smartlink',
                          url: adsterraIntegration.smartlinkUrl,
                        }
                      : null
                  }
                  onToggleFollow={handleToggleFollowById}
                  onChangeVisitTab={(tab) =>
                    setState((prev) => ({ ...prev, visitTab: tab }))
                  }
                  onChangeVisitMode={(mode) => {
                    if (mode === 'multi' && !isMulti5Active) {
                      setIsProModalOpen(true);
                      return;
                    }
                    setVisitMode(mode);
                  }}
                  onOpenProLocked={() => setIsProModalOpen(true)}
                  onStartAutoVisit={(startId, preferredBatchIds) =>
                    setAutoVisitSession((prev) => ({
                      active: true,
                      startId: startId ?? null,
                      preferredBatchIds,
                      nonce: (prev?.nonce ?? 0) + 1,
                    }))
                  }
                  onReportLink={(link) => setReportTarget(link)}
                  onNextQueue={() =>
                    setState((prev) => ({
                      ...prev,
                      skippedOffsets: {
                        ...prev.skippedOffsets,
                        [prev.visitTab]: prev.skippedOffsets[prev.visitTab] + 1,
                      },
                    }))
                  }
                  onPrevQueue={() =>
                    setState((prev) => ({
                      ...prev,
                      skippedOffsets: {
                        ...prev.skippedOffsets,
                        [prev.visitTab]: prev.skippedOffsets[prev.visitTab] - 1,
                      },
                    }))
                  }
                  onRemoveFromQueue={(linkId) => {
                    setRemovedQueueIds((prev) => {
                      const current = prev[state.visitTab] || [];
                      if (current.includes(linkId)) return prev;
                      return {
                        ...prev,
                        [state.visitTab]: [...current, linkId],
                      };
                    });
                    setToastMessage('Link removed from queue');
                  }}
                  onRestoreQueue={() => {
                    setRemovedQueueIds((prev) => ({
                      ...prev,
                      [state.visitTab]: [],
                    }));
                    setToastMessage('Queue restored');
                  }}
                  onOpenLinkManager={() => navigateTo('links')}
                  onOpenAdsterra={() => navigateTo('adsterra')}
                  onOpenAdminPanel={() => navigateTo('admin')}
                  onPublishToCommunity={handlePublishSmartlinkToCommunity}
                />
              )}

              {state.activeScreen === 'links' && (
                <LinkManagerScreen
                  myLinks={mySubmittedLinks}
                  myLinkVisits={myLinkVisits}
                  cooldowns={state.cooldowns}
                  nowMs={nowMs}
                  onBack={() => navigateTo('home')}
                  onSubmitLink={handleSubmitLink}
                  onUpdateLink={handleUpdateLink}
                  onDeleteLink={handleDeleteOwnLink}
                />
              )}

              {state.activeScreen === 'admin' && isAdmin && (
                <AdminModerationScreen
                  allLinks={adminAllLinks}
                  reports={adminReports}
                  moderationLogs={adminModerationLogs}
                  paymentRequests={adminPaymentRequests}
                  paymentConfig={paymentConfig}
                  onBack={() => navigateTo('home')}
                  onModerateLink={handleModerateLink}
                  onRemoveLink={handleAdminRemoveLink}
                  onResolveReport={handleResolveReport}
                  onReviewPaymentRequest={handleReviewPaymentRequest}
                  onUpdatePaymentNumbers={handleUpdatePaymentNumbers}
                />
              )}

              {state.activeScreen === 'leaderboard' && (
                <LeaderboardScreen
                  currentUid={authUser.uid}
                  profile={state.profile}
                  demoPoints={state.demoPoints}
                  totalVisits={state.totalVisits}
                  visitedToday={state.visitedToday}
                  publicProfiles={publicProfiles}
                  followedUserIds={state.followedUserIds}
                  onToggleFollow={handleToggleFollowById}
                />
              )}

              {state.activeScreen === 'shop' && (
                <ShopScreen
                  demoPoints={state.demoPoints}
                  unlockedShopIds={state.unlockedShopIds}
                  activeAccent={state.profile.activeAccent}
                  isMulti5Active={isMulti5Active}
                  hasPendingMultiPayment={hasPendingMultiPayment}
                  onUnlockShopItem={handleUnlockShopItem}
                  onApplyAccent={handleApplyAccent}
                  onOpenProLocked={() => setIsProModalOpen(true)}
                />
              )}

              {state.activeScreen === 'adsterra' && (
                <AdsterraScreen
                  uid={authUser.uid}
                  userEmail={authUser.email}
                  isAdmin={isAdmin}
                  integration={adsterraIntegration}
                  backendStatus={adsterraBackendStatus}
                  personalSmartlinks={personalSmartlinks}
                  mySubmittedLinks={mySubmittedLinks}
                  isMulti5Active={isMulti5Active}
                  hasPendingMultiPayment={hasPendingMultiPayment}
                  onConnectApiKey={handleConnectAdsterraApiKey}
                  onSyncOfficialApi={handleSyncAdsterraApi}
                  onFetchStats={handleFetchAdsterraStats}
                  onDisconnectAll={handleDisconnectAdsterra}
                  onCreatePersonalSmartlink={handleCreatePersonalSmartlink}
                  onDeletePersonalSmartlink={handleDeletePersonalSmartlink}
                  onPublishToCommunity={handlePublishSmartlinkToCommunity}
                  onRefreshBackendStatus={refreshAdsterraBackendStatus}
                  onOpenProModal={() => setIsProModalOpen(true)}
                />
              )}

              {state.activeScreen === 'profile' && (
                <ProfileScreen
                  uid={authUser.uid}
                  profile={state.profile}
                  totalPoints={state.demoPoints}
                  totalVisits={state.totalVisits}
                  successfulVisits={state.successfulVisits}
                  followersCount={followersList.length}
                  followingCount={followingList.length}
                  followingList={followingList}
                  followersList={followersList}
                  publicProfiles={publicProfiles}
                  activities={activities}
                  unlockedShopIds={state.unlockedShopIds}
                  userEmail={authUser.email}
                  accountCreatedAtMs={accountCreatedAtMs}
                  onBack={() =>
                    navigateTo(previousScreen === 'profile' ? 'home' : previousScreen)
                  }
                  onSaveProfile={handleSaveProfile}
                  onAvatarUploadToast={(msg) => setToastMessage(msg)}
                  onToggleFollowTarget={handleToggleFollowTarget}
                  onLogout={handleLogout}
                />
              )}
            </motion.div>
          </AnimatePresence>

          {/* Quiet Brand Footer */}
          <footer className="mt-10 pt-5 text-center text-xs text-slate-400 sm:text-left">
            <div className="neon-hairline mb-4" />
            <p className="font-display font-semibold tracking-wide">
              <span className="neon-text-spectrum">INFINITY REWARDS</span>
              <span className="text-slate-500"> · Infinity Studio</span>
            </p>
          </footer>
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <BottomNav activeScreen={state.activeScreen} onSelectScreen={navigateTo} />

      {/* Drawers & Interactive Modals */}
      <HamburgerDrawer
        isOpen={isMenuOpen}
        activeScreen={state.activeScreen}
        profile={state.profile}
        demoPoints={state.demoPoints}
        isAdmin={isAdmin}
        adminPendingCount={adminPendingCount}
        onClose={() => setIsMenuOpen(false)}
        onSelectScreen={navigateTo}
        onResetDemo={handleResetUiPrefs}
        onLogout={handleLogout}
      />

      <NotificationsDrawer
        isOpen={isNotificationsOpen}
        notifications={state.notifications}
        onClose={() => setIsNotificationsOpen(false)}
        onMarkAllRead={() =>
          setState((prev) => ({
            ...prev,
            notifications: prev.notifications.map((n) => ({ ...n, read: true })),
          }))
        }
        onClickNotification={(id, targetScreen) => {
          setState((prev) => ({
            ...prev,
            notifications: prev.notifications.map((n) =>
              n.id === id ? { ...n, read: true } : n
            ),
          }));
          setIsNotificationsOpen(false);
          if (targetScreen) navigateTo(targetScreen);
        }}
      />

      <BottomVisitDock
        isOpen={Boolean(autoVisitSession?.active)}
        links={activeDockLinks}
        initialLinkId={autoVisitSession?.startId}
        preferredBatchIds={autoVisitSession?.preferredBatchIds}
        sessionNonce={autoVisitSession?.nonce ?? 0}
        isMulti5Active={isMulti5Active}
        visitMode={visitMode}
        cooldowns={state.cooldowns}
        nowMs={nowMs}
        onChangeVisitMode={(mode) => {
          if (mode === 'multi' && !isMulti5Active) {
            setIsProModalOpen(true);
            return;
          }
          setVisitMode(mode);
        }}
        onCompleteLinkVisit={handleCompleteAutoVisit}
        onOpenProLocked={() => setIsProModalOpen(true)}
        onClose={() => setAutoVisitSession(null)}
      />

      <VisitModal
        reportTarget={reportTarget}
        isProModalOpen={isProModalOpen}
        isAdmin={isAdmin}
        multiEntitlement={multiEntitlement}
        myPaymentRequests={myPaymentRequests}
        paymentConfig={paymentConfig}
        onCloseReport={() => setReportTarget(null)}
        onReportLink={handleReportLink}
        onCloseProModal={() => setIsProModalOpen(false)}
        onSubmitMultiPayment={handleSubmitMultiPayment}
      />

      {/* Non-intrusive Action Feedback Toast */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.16 }}
            role="status"
            aria-live="polite"
            className="neon-prism-panel fixed right-4 bottom-20 left-4 z-50 mx-auto max-w-sm rounded-2xl px-4 py-3 text-center text-xs font-semibold text-white shadow-xl lg:bottom-6"
          >
            {toastMessage}
          </motion.div>
        )}
      </AnimatePresence>
      <OfflineIndicator />
    </div>
  );
}
