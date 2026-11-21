import React from 'react';
import { BarChart3, Bell, Menu } from 'lucide-react';
import { Avatar } from './Avatar';
import { MainScreen, UserProfileData } from '../types';

interface TopNavProps {
  profile: UserProfileData;
  demoPoints: number;
  unreadCount: number;
  activeScreen: MainScreen;
  onOpenMenu: () => void;
  onOpenNotifications: () => void;
  onOpenProfile: () => void;
  onNavigateHome: () => void;
}

export const TopNav: React.FC<TopNavProps> = ({
  profile,
  demoPoints,
  unreadCount,
  activeScreen,
  onOpenMenu,
  onOpenNotifications,
  onOpenProfile,
  onNavigateHome,
}) => {
  return (
    <header className="glass-bar sticky top-0 z-30 h-14 w-full">
      <div className="mx-auto flex h-full max-w-7xl items-center justify-between gap-4 px-3 sm:px-6">
        {/* Left: Hamburger Menu + Brand */}
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={onOpenMenu}
            aria-label="Open navigation menu"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-200 transition-colors hover:bg-[#00F5FF]/10 hover:text-[#00F5FF] focus-visible:outline-2 focus-visible:outline-[#00F5FF] active:scale-95"
          >
            <Menu className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={onNavigateHome}
            className="flex min-h-[44px] items-center gap-2.5 text-left focus-visible:outline-2 focus-visible:outline-[#00F5FF]"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#00F5FF] via-[#B84DFF] to-[#FF2E93] text-xs font-extrabold text-white shadow-[0_0_16px_rgba(0,245,255,0.5)]">
              ∞
            </span>
            <span className="font-display neon-text-spectrum truncate text-sm font-extrabold tracking-tight sm:text-base whitespace-nowrap shrink-0">
              INFINITY REWARDS
            </span>
          </button>
        </div>

        {/* Right: User Statistics, Notification Icon, User Profile Avatar */}
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
          <button
            type="button"
            onClick={onOpenProfile}
            aria-label={`User statistics: ${demoPoints} demo points`}
            className={`flex min-h-[40px] items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all focus-visible:outline-2 focus-visible:outline-[#00FF87] whitespace-nowrap shrink-0 ${
              activeScreen === 'profile'
                ? 'border-[#00FF87]/65 bg-[#00FF87]/15 text-[#00FF87] shadow-[0_0_16px_rgba(0,255,135,0.28)]'
                : 'border-[#00FF87]/35 bg-[#06181F]/80 text-slate-100 shadow-[0_0_14px_rgba(0,245,255,0.16)] hover:border-[#00F5FF]/60 hover:bg-[#081F2D]/90'
            }`}
          >
            <BarChart3 className="h-4 w-4 text-[#00FF87]" />
            <span className="font-mono-num font-bold text-[#00FF87]">{demoPoints}</span>
            <span className="hidden text-[#00F5FF]/85 sm:inline">PTS</span>
          </button>

          <button
            type="button"
            onClick={onOpenNotifications}
            aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
            className="relative flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-200 transition-colors hover:bg-[#B84DFF]/15 hover:text-[#FF2E93] focus-visible:outline-2 focus-visible:outline-[#B84DFF] active:scale-95"
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="font-mono-num absolute top-1.5 right-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-gradient-to-r from-[#FF2E93] via-[#B84DFF] to-[#00F5FF] px-1 text-[10px] font-bold text-white shadow-[0_0_10px_rgba(255,46,147,0.65)]">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={onOpenProfile}
            aria-label="Open user profile"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full p-0.5 transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-[#00F5FF] active:scale-95"
          >
            <Avatar
              src={profile.avatar}
              alt={profile.displayName}
              size="sm"
              accent={activeScreen === 'profile' ? 'cyan' : profile.activeAccent}
            />
          </button>
        </div>
      </div>
      <div className="neon-hairline w-full" />
    </header>
  );
};
