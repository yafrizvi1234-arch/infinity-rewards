import {
  AppPersistedState,
  NotificationItem,
  ShopRewardItem,
} from '../types';

export const USER_AVATAR = '/src/assets/images/avatar_user_main_1794883898012.jpg';

export const INITIAL_NOTIFICATIONS: NotificationItem[] = [
  {
    id: 'n-1',
    title: 'Connect Your Adsterra Account',
    message:
      'Add your Adsterra Publisher API Token or Personal Smartlink URL in the Adsterra tab to sync domains, stats, and private links.',
    timeAgo: 'Just now',
    read: false,
    targetScreen: 'adsterra',
  },
  {
    id: 'n-2',
    title: 'Mutual Smartlink Exchange Active',
    message:
      'Publish your Adsterra Smartlink to the Community Exchange so other real verified users can visit it, and visit other creators’ Smartlinks fairly.',
    timeAgo: 'Just now',
    read: false,
    targetScreen: 'home',
  },
];

export const SHOP_ITEMS: ShopRewardItem[] = [
  {
    id: 'shop-cyan-aura',
    title: 'Cyan Pulse Avatar Frame',
    subtitle: 'Applies a crisp cyan accent ring to your profile avatar across the dashboard.',
    category: 'Theme',
    demoCost: 120,
    previewAccent: 'cyan',
  },
  {
    id: 'shop-purple-aura',
    title: 'Violet Nebula Profile Frame',
    subtitle: 'Switches your profile accent highlight to deep purple-indigo.',
    category: 'Theme',
    demoCost: 150,
    previewAccent: 'purple',
  },
  {
    id: 'shop-blue-badge',
    title: 'Early Explorer Crest',
    subtitle: 'Displays a Phase 1 Explorer badge inside your Profile screen.',
    category: 'Badge',
    demoCost: 100,
    previewAccent: 'blue',
  },
  {
    id: 'shop-multi-pro',
    title: 'Multi Visit PRO Preview',
    subtitle: 'Batch queue visits and priority cooldown reductions — planned for a future phase.',
    category: 'Perks',
    demoCost: 0,
    previewAccent: 'purple',
    isProPreview: true,
  },
];

export const DEFAULT_APP_STATE: AppPersistedState = {
  activeScreen: 'home',
  visitTab: 'smartlink',
  followedUserIds: [],
  cooldowns: {},
  demoPoints: 0,
  totalVisits: 0,
  successfulVisits: 0,
  visitedToday: 0,
  visitHistory: [],
  notifications: INITIAL_NOTIFICATIONS,
  unlockedShopIds: [],
  profile: {
    displayName: 'Infinity Explorer',
    username: 'explorer',
    handle: '@explorer',
    bio: 'Exploring INFINITY REWARDS.',
    avatar: USER_AVATAR,
    activeAccent: 'cyan',
  },
  skippedOffsets: {
    smartlink: 0,
    website: 0,
  },
};

