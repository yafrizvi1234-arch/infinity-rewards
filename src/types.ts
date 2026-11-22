export type MainScreen =
  | 'home'
  | 'leaderboard'
  | 'shop'
  | 'adsterra'
  | 'profile'
  | 'links'
  | 'admin';

export type VisitTab = 'smartlink' | 'website';
export type VisitMode = 'single' | 'multi';

export type ActivityType = 'visit' | 'points' | 'follow' | 'unfollow' | 'profile_update';

export type LinkStatus = 'pending' | 'approved' | 'rejected';

export type PaymentMethod = 'bkash' | 'nagad';
export type PaymentStatus = 'pending' | 'approved' | 'rejected';

export interface PaymentRequestRecord {
  id: string;
  uid: string;
  userName: string;
  userUsername: string;
  planId: 'multi_5';
  amountBdt: number;
  paymentMethod: PaymentMethod;
  paymentNumber: string;
  senderNumber?: string;
  transactionId: string;
  screenshotUrl: string;
  status: PaymentStatus;
  adminNote?: string;
  reviewedBy?: string;
  reviewedByEmail?: string;
  reviewedAtMs?: number;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface MultiEntitlementRecord {
  uid: string;
  planId: 'multi_5';
  active: boolean;
  maxConcurrentLinks: number;
  amountBdt: number;
  sourceRequestId: string;
  transactionId: string;
  approvedBy: string;
  approvedByEmail: string;
  activatedAtMs: number;
  updatedAtMs: number;
}

export interface PaymentNumbersConfig {
  id: 'multi_5';
  bkashNumber: string;
  nagadNumber: string;
  updatedBy?: string;
  updatedByEmail?: string;
  updatedAtMs?: number;
}

export type AdsterraConnectionMode = 'manual_smartlink' | 'official_api_key';
export type AdsterraConnectionStatus = 'disconnected' | 'connected';

export interface AdsterraIntegrationRecord {
  uid: string;
  ownerUserId: string;
  connectionMode: AdsterraConnectionMode;
  status: AdsterraConnectionStatus;
  publisherId: string;
  publisherLabel: string;
  smartlinkUrl: string;
  smartlinkTitle: string;
  hasApiKey: boolean;
  apiKeyHint: string;
  apiVerified: boolean;
  verifiedDomainsCount: number;
  verifiedPlacementsCount: number;
  lastSyncedAtMs?: number;
  createdAtMs: number;
  updatedAtMs: number;
}

export type AdsterraDatePreset = 'today' | 'yesterday' | '7d' | '30d' | 'custom';

export interface AdsterraMetricTotals {
  impressions: number;
  clicks: number;
  ctr: number;
  cpm: number;
  revenue: number;
  rpc: number;
}

export interface AdsterraStatRow extends AdsterraMetricTotals {
  key: string;
  label: string;
  sublabel?: string;
}

export interface AdsterraDetailedStats {
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

export interface AdsterraBackendStatus {
  backendReachable?: boolean;
  hasApiKey: boolean;
  apiKeyHint: string;
  apiVerified: boolean;
  verifiedDomainsCount: number;
  verifiedPlacementsCount: number;
  domainsPreview: Array<{ id: string; title: string }>;
  placementsPreview: Array<{
    id: string;
    domainId: string;
    title: string;
    type?: string;
    status?: string;
    directUrl?: string;
  }>;
  statsSummary?: {
    startDate: string;
    finishDate: string;
    impressions: number;
    clicks: number;
    revenue: number;
    cpm?: number;
    ctr?: number;
  } | null;
  detailedStats?: AdsterraDetailedStats | null;
  lastSyncedAtMs: number | null;
}

export interface UserPersonalSmartlink {
  id: string;
  ownerUserId: string;
  title: string;
  url: string;
  domain: string;
  category: string;
  isHttps: boolean;
  createdAtMs: number;
  updatedAtMs: number;
}

export const LINK_CATEGORIES = [
  'Tools',
  'Design',
  'Development',
  'Education',
  'Community',
  'Content',
  'Documentation',
  'Other',
] as const;

export interface ManagedLink {
  id: string;
  ownerId: string;
  ownerName: string;
  ownerUsername: string;
  ownerAvatar: string;
  type: VisitTab;
  title: string;
  description: string;
  url: string;
  normalizedUrl: string;
  urlKey: string;
  domain: string;
  isHttps: boolean;
  category: string;
  status: LinkStatus;
  cooldownSec: number;
  reportCount: number;
  moderationNote?: string;
  moderatedBy?: string;
  moderatedAtMs?: number;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface LinkVisitRecord {
  id: string;
  uid: string;
  linkId: string;
  linkTitle: string;
  linkType: VisitTab;
  category: string;
  domain: string;
  url: string;
  createdAtMs: number;
}

export interface LinkReportRecord {
  id: string;
  linkId: string;
  linkTitle: string;
  linkUrl: string;
  reporterId: string;
  reporterUsername: string;
  reason: string;
  status: 'open' | 'resolved' | 'dismissed';
  adminNote?: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface ModerationLogRecord {
  id: string;
  linkId: string;
  linkTitle: string;
  targetOwnerId: string;
  action: 'approve' | 'reject' | 'remove' | 'resolve_report' | 'dismiss_report';
  reason: string;
  adminUid: string;
  adminEmail: string;
  createdAtMs: number;
}

export interface SuggestedUser {
  id: string;
  username: string;
  handle: string;
  avatar: string;
  specialty: string;
  followers: number;
  demoScore: number;
  isRealUser?: boolean;
}

export interface VisitLinkItem {
  id: string;
  type: VisitTab;
  title: string;
  userId: string;
  userName: string;
  userHandle: string;
  userAvatar: string;
  category: string;
  durationSec: number;
  demoPoints: number;
  cooldownSec: number;
  previewSummary: string;
  destinationDomain: string;
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  timeAgo: string;
  read: boolean;
  targetScreen?: MainScreen;
}

export interface VisitHistoryEntry {
  id: string;
  linkId: string;
  title: string;
  type: VisitTab;
  userName: string;
  category: string;
  demoPoints: number;
  timestamp: number;
}

export interface ActivityRecord {
  id: string;
  uid: string;
  type: ActivityType;
  title: string;
  description: string;
  category: string;
  pointsDelta: number;
  targetId?: string;
  createdAtMs: number;
}

export interface PublicProfile {
  uid: string;
  username: string;
  displayName: string;
  bio: string;
  photoURL: string;
  specialty: string;
  activeAccent: 'cyan' | 'purple' | 'blue';
  totalPoints: number;
  totalVisits: number;
  followersCount: number;
  followingCount: number;
}

export interface FollowRelation {
  id: string;
  followerId: string;
  followerName: string;
  followerUsername: string;
  followerAvatar: string;
  targetId: string;
  targetName: string;
  targetUsername: string;
  targetAvatar: string;
  isRealTarget: boolean;
  createdAtMs: number;
}

export interface ShopRewardItem {
  id: string;
  title: string;
  subtitle: string;
  category: 'Theme' | 'Badge' | 'Perks';
  demoCost: number;
  previewAccent: 'cyan' | 'purple' | 'blue';
  isProPreview?: boolean;
}

export interface LeaderboardEntry {
  id: string;
  rank: number;
  username: string;
  handle: string;
  avatar: string;
  specialty: string;
  demoPointsToday: number;
  demoPointsWeekly: number;
  demoPointsAllTime: number;
  visitsCount: number;
  isCurrentUser?: boolean;
}

export interface UserProfileData {
  displayName: string;
  username: string;
  handle: string;
  bio: string;
  avatar: string;
  activeAccent: 'cyan' | 'purple' | 'blue';
  email?: string | null;
  createdAtText?: string;
}

export interface AppPersistedState {
  activeScreen: MainScreen;
  visitTab: VisitTab;
  followedUserIds: string[];
  cooldowns: Record<string, number>; // linkId -> epoch ms when cooldown ends
  demoPoints: number;
  totalVisits: number;
  successfulVisits: number;
  visitedToday: number;
  visitHistory: VisitHistoryEntry[];
  notifications: NotificationItem[];
  unlockedShopIds: string[];
  profile: UserProfileData;
  skippedOffsets: Record<VisitTab, number>;
}
