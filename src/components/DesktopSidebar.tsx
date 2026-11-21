import React from 'react';
import {
  Home,
  Link2,
  LogOut,
  ShieldCheck,
  ShoppingBag,
  Trophy,
  User,
} from 'lucide-react';
import { MainScreen, UserProfileData } from '../types';
import { Avatar } from './Avatar';

interface DesktopSidebarProps {
  activeScreen: MainScreen;
  profile: UserProfileData;
  demoPoints: number;
  isAdmin: boolean;
  adminPendingCount: number;
  onSelectScreen: (screen: MainScreen) => void;
  onLogout: () => void;
}

const DESKTOP_NAV: {
  id: 'home' | 'links' | 'leaderboard' | 'shop' | 'adsterra';
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  activeClass: string;
  iconActiveClass: string;
}[] = [
  {
    id: 'home',
    label: 'Home',
    icon: Home,
    activeClass:
      'border-[#00F5FF]/55 bg-gradient-to-r from-[#00F5FF]/20 via-[#2D7BFF]/15 to-transparent text-white shadow-[0_0_18px_-4px_rgba(0,245,255,0.45)]',
    iconActiveClass: 'text-[#00F5FF]',
  },
  {
    id: 'links',
    label: 'My Links',
    icon: Link2,
    activeClass:
      'border-[#3B82F6]/60 bg-gradient-to-r from-[#3B82F6]/25 via-[#00F5FF]/12 to-transparent text-white shadow-[0_0_18px_-4px_rgba(59,130,246,0.45)]',
    iconActiveClass: 'text-[#60A5FA]',
  },
  {
    id: 'leaderboard',
    label: 'Leaderboard',
    icon: Trophy,
    activeClass:
      'border-[#FFB800]/55 bg-gradient-to-r from-[#FFB800]/20 via-[#FF2E93]/12 to-transparent text-white shadow-[0_0_18px_-4px_rgba(255,184,0,0.4)]',
    iconActiveClass: 'text-[#FFB800]',
  },
  {
    id: 'shop',
    label: 'Shop',
    icon: ShoppingBag,
    activeClass:
      'border-[#FF2E93]/55 bg-gradient-to-r from-[#FF2E93]/22 via-[#B84DFF]/15 to-transparent text-white shadow-[0_0_18px_-4px_rgba(255,46,147,0.45)]',
    iconActiveClass: 'text-[#FF4DA6]',
  },
  {
    id: 'adsterra',
    label: 'Adsterra',
    icon: ShieldCheck,
    activeClass:
      'border-[#00FF87]/55 bg-gradient-to-r from-[#00FF87]/20 via-[#00F5FF]/12 to-transparent text-white shadow-[0_0_18px_-4px_rgba(0,255,135,0.45)]',
    iconActiveClass: 'text-[#00FF87]',
  },
];

export const DesktopSidebar: React.FC<DesktopSidebarProps> = ({
  activeScreen,
  profile,
  demoPoints,
  isAdmin,
  adminPendingCount,
  onSelectScreen,
  onLogout,
}) => {
  return (
    <aside aria-label="Desktop navigation" className="hidden w-64 shrink-0 lg:block">
      <div className="glass-panel sticky top-20 flex flex-col justify-between rounded-2xl p-4">
        <div className="space-y-1.5">
          <p className="px-3 pb-2 text-xs font-semibold tracking-wide text-[#00F5FF]/80">
            Navigation
          </p>
          {DESKTOP_NAV.map(({ id, label, icon: Icon, activeClass, iconActiveClass }) => {
            const isActive = activeScreen === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSelectScreen(id)}
                aria-current={isActive ? 'page' : undefined}
                className={`flex min-h-[44px] w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm font-medium transition-all focus-visible:outline-2 focus-visible:outline-[#00F5FF] ${
                  isActive
                    ? activeClass
                    : 'border-transparent text-slate-300 hover:border-white/10 hover:bg-white/[0.06] hover:text-white'
                }`}
              >
                <Icon className={`h-4 w-4 ${isActive ? iconActiveClass : 'text-slate-400'}`} />
                <span className="whitespace-nowrap">{label}</span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => onSelectScreen('profile')}
            aria-current={activeScreen === 'profile' ? 'page' : undefined}
            className={`flex min-h-[44px] w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm font-medium transition-all focus-visible:outline-2 focus-visible:outline-[#B84DFF] ${
              activeScreen === 'profile'
                ? 'border-[#B84DFF]/60 bg-gradient-to-r from-[#B84DFF]/25 via-[#FF2E93]/12 to-transparent text-white shadow-[0_0_18px_-4px_rgba(184,77,255,0.45)]'
                : 'border-transparent text-slate-300 hover:border-white/10 hover:bg-white/[0.06] hover:text-white'
            }`}
          >
            <User
              className={`h-4 w-4 ${
                activeScreen === 'profile' ? 'text-[#C084FC]' : 'text-slate-400'
              }`}
            />
            <span className="whitespace-nowrap">Profile</span>
          </button>

          {isAdmin && (
            <button
              type="button"
              onClick={() => onSelectScreen('admin')}
              aria-current={activeScreen === 'admin' ? 'page' : undefined}
              className={`flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-sm font-medium transition-all focus-visible:outline-2 focus-visible:outline-[#FF2E93] ${
                activeScreen === 'admin'
                  ? 'border-[#FF2E93]/60 bg-gradient-to-r from-[#FF2E93]/25 via-[#B84DFF]/20 to-[#00F5FF]/12 text-white shadow-[0_0_20px_-4px_rgba(255,46,147,0.45)]'
                  : 'border-[#B84DFF]/30 bg-[#B84DFF]/10 text-purple-100 hover:border-[#FF2E93]/45 hover:bg-[#B84DFF]/20'
              }`}
            >
              <span className="flex items-center gap-3">
                <ShieldCheck className="h-4 w-4 text-[#FF4DA6]" />
                <span className="whitespace-nowrap">Admin Panel</span>
              </span>
              {adminPendingCount > 0 && (
                <span className="font-mono-num rounded border border-[#FFB800]/50 bg-[#FFB800]/20 px-1.5 py-0.5 text-[11px] font-bold text-[#FFD166]">
                  {adminPendingCount}
                </span>
              )}
            </button>
          )}
        </div>

        <div className="mt-6 pt-4">
          <div className="neon-hairline mb-4" />
          <button
            type="button"
            onClick={() => onSelectScreen('profile')}
            className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-[#00F5FF]"
          >
            <Avatar
              src={profile.avatar}
              alt={profile.displayName}
              size="md"
              accent={profile.activeAccent}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">{profile.displayName}</p>
              <p className="font-mono-num truncate text-xs text-[#00FF87]">
                {demoPoints} PTS · Synced
              </p>
            </div>
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="mt-3 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-[#FF4D6D]/35 bg-[#FF4D6D]/12 px-3 py-2 text-xs font-semibold text-rose-200 transition-all hover:border-[#FF4D6D]/60 hover:bg-[#FF4D6D]/22 focus-visible:outline-2 focus-visible:outline-[#FF4D6D]"
          >
            <LogOut className="h-4 w-4" />
            <span>Sign Out</span>
          </button>

          <p className="mt-3 px-2 text-xs text-slate-400">Infinity Studio</p>
        </div>
      </div>
    </aside>
  );
};
