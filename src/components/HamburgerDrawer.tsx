import React from 'react';
import {
  Home,
  Link2,
  LogOut,
  RotateCcw,
  ShieldCheck,
  ShoppingBag,
  Trophy,
  User,
  X,
} from 'lucide-react';
import { MainScreen, UserProfileData } from '../types';
import { Avatar } from './Avatar';

interface HamburgerDrawerProps {
  isOpen: boolean;
  activeScreen: MainScreen;
  profile: UserProfileData;
  demoPoints: number;
  isAdmin: boolean;
  adminPendingCount: number;
  onClose: () => void;
  onSelectScreen: (screen: MainScreen) => void;
  onResetDemo: () => void;
  onLogout: () => void;
}

const MENU_ITEMS: {
  id: MainScreen;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'home', label: 'Home Dashboard', description: 'Stats, users & visit queue', icon: Home },
  {
    id: 'links',
    label: 'My Links & Submit',
    description: 'Submit, manage & track link opens',
    icon: Link2,
  },
  {
    id: 'leaderboard',
    label: 'Leaderboard',
    description: 'Community activity rankings',
    icon: Trophy,
  },
  { id: 'shop', label: 'Shop', description: 'Demo themes & badge perks', icon: ShoppingBag },
  {
    id: 'adsterra',
    label: 'Adsterra',
    description: 'API Key & Smartlink sync',
    icon: ShieldCheck,
  },
  { id: 'profile', label: 'My Profile', description: 'Stats, history & preferences', icon: User },
];

export const HamburgerDrawer: React.FC<HamburgerDrawerProps> = ({
  isOpen,
  activeScreen,
  profile,
  demoPoints,
  isAdmin,
  adminPendingCount,
  onClose,
  onSelectScreen,
  onResetDemo,
  onLogout,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex"
      role="dialog"
      aria-modal="true"
      aria-label="Navigation menu"
    >
      <div
        className="fixed inset-0 bg-black/65 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      <div className="neon-prism-panel relative z-10 flex h-full w-80 max-w-[85vw] flex-col justify-between border-r border-[#00F5FF]/30 p-5 shadow-2xl">
        <div className="overflow-y-auto">
          <div className="flex items-center justify-between pb-4">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#00F5FF] via-[#B84DFF] to-[#FF2E93] text-sm font-extrabold text-white shadow-[0_0_16px_rgba(0,245,255,0.5)]">
                ∞
              </span>
              <div>
                <p className="font-display neon-text-spectrum text-sm font-extrabold">
                  INFINITY REWARDS
                </p>
                <p className="text-xs text-[#00FF87]">by Infinity Studio</p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close menu"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-300 hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-[#00F5FF]"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="neon-hairline" />

          {/* Profile summary */}
          <button
            type="button"
            onClick={() => {
              onSelectScreen('profile');
              onClose();
            }}
            className="neon-card-purple mt-4 flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-all hover:border-[#00F5FF]/55"
          >
            <Avatar
              src={profile.avatar}
              alt={profile.displayName}
              size="md"
              accent={profile.activeAccent}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">{profile.displayName}</p>
              <p className="truncate text-xs text-slate-300">
                {profile.handle} ·{' '}
                <span className="font-mono-num font-bold text-[#00FF87]">{demoPoints} PTS</span>
              </p>
            </div>
          </button>

          {/* Menu destinations */}
          <nav className="mt-5 space-y-1.5">
            {MENU_ITEMS.map(({ id, label, description, icon: Icon }) => {
              const isActive = activeScreen === id;
              const activeNeonByRoute: Record<string, { box: string; icon: string }> = {
                home: {
                  box: 'border-[#00F5FF]/55 bg-[#00F5FF]/15 text-white shadow-[0_0_16px_-6px_rgba(0,245,255,0.5)]',
                  icon: 'text-[#00F5FF]',
                },
                links: {
                  box: 'border-[#3B82F6]/55 bg-[#3B82F6]/15 text-white shadow-[0_0_16px_-6px_rgba(59,130,246,0.5)]',
                  icon: 'text-[#60A5FA]',
                },
                leaderboard: {
                  box: 'border-[#FFB800]/55 bg-[#FFB800]/15 text-white shadow-[0_0_16px_-6px_rgba(255,184,0,0.5)]',
                  icon: 'text-[#FFB800]',
                },
                shop: {
                  box: 'border-[#FF2E93]/55 bg-[#FF2E93]/15 text-white shadow-[0_0_16px_-6px_rgba(255,46,147,0.5)]',
                  icon: 'text-[#FF2E93]',
                },
                adsterra: {
                  box: 'border-[#00FF87]/55 bg-[#00FF87]/15 text-white shadow-[0_0_16px_-6px_rgba(0,255,135,0.5)]',
                  icon: 'text-[#00FF87]',
                },
                profile: {
                  box: 'border-[#B84DFF]/55 bg-[#B84DFF]/15 text-white shadow-[0_0_16px_-6px_rgba(184,77,255,0.5)]',
                  icon: 'text-[#C084FC]',
                },
              };
              const style = activeNeonByRoute[id] ?? activeNeonByRoute.home;

              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    onSelectScreen(id);
                    onClose();
                  }}
                  className={`flex min-h-[48px] w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-all focus-visible:outline-2 focus-visible:outline-[#00F5FF] ${
                    isActive
                      ? style.box
                      : 'border-transparent text-slate-200 hover:border-white/10 hover:bg-white/5'
                  }`}
                >
                  <Icon
                    className={`h-5 w-5 shrink-0 ${isActive ? style.icon : 'text-slate-400'}`}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{label}</p>
                    <p className="truncate text-xs text-slate-400">{description}</p>
                  </div>
                </button>
              );
            })}

            {isAdmin && (
              <button
                type="button"
                onClick={() => {
                  onSelectScreen('admin');
                  onClose();
                }}
                className={`flex min-h-[48px] w-full items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 text-left transition-all focus-visible:outline-2 focus-visible:outline-[#00F5FF] ${
                  activeScreen === 'admin'
                    ? 'border border-[#FF2E93]/55 bg-gradient-to-r from-[#FF2E93]/20 via-[#B84DFF]/20 to-[#00F5FF]/20 text-white shadow-[0_0_18px_-6px_rgba(255,46,147,0.5)]'
                    : 'border border-[#B84DFF]/30 bg-[#B84DFF]/10 text-purple-100 hover:bg-[#B84DFF]/20'
                }`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <ShieldCheck className="h-5 w-5 shrink-0 text-[#FF2E93]" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Admin Moderation</p>
                    <p className="truncate text-xs text-slate-400">
                      Approve links &amp; review reports
                    </p>
                  </div>
                </div>
                {adminPendingCount > 0 && (
                  <span className="font-mono-num shrink-0 rounded-md border border-[#FFB800]/50 bg-[#FFB800]/20 px-2 py-0.5 text-xs font-bold text-[#FFB800]">
                    {adminPendingCount}
                  </span>
                )}
              </button>
            )}
          </nav>
        </div>

        <div className="mt-4 space-y-2.5 pt-4">
          <div className="neon-hairline mb-3" />
          <button
            type="button"
            onClick={() => {
              onResetDemo();
              onClose();
            }}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-[#00F5FF]/25 bg-[#070E28]/80 px-4 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-[#00F5FF]/50 focus-visible:outline-2 focus-visible:outline-[#00F5FF]"
          >
            <RotateCcw className="h-4 w-4 text-[#00F5FF]" />
            <span>Reset Local Queue &amp; UI</span>
          </button>

          <button
            type="button"
            onClick={() => {
              onClose();
              onLogout();
            }}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-[#FF2E93]/35 bg-[#FF2E93]/10 px-4 py-2 text-xs font-semibold text-[#FF9AD0] transition-colors hover:bg-[#FF2E93]/20 focus-visible:outline-2 focus-visible:outline-[#FF2E93]"
          >
            <LogOut className="h-4 w-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
};
