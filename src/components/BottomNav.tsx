import React from 'react';
import { Home, ShieldCheck, ShoppingBag, Trophy } from 'lucide-react';
import { MainScreen } from '../types';

interface BottomNavProps {
  activeScreen: MainScreen;
  onSelectScreen: (screen: 'home' | 'leaderboard' | 'shop' | 'adsterra') => void;
}

const NAV_ITEMS: {
  id: 'home' | 'leaderboard' | 'shop' | 'adsterra';
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  activeText: string;
  activeBox: string;
}[] = [
  {
    id: 'home',
    label: 'Home',
    icon: Home,
    activeText: 'text-[#00F5FF]',
    activeBox:
      'border border-[#00F5FF]/50 bg-[#00F5FF]/18 text-[#00F5FF] shadow-[0_0_14px_rgba(0,245,255,0.4)]',
  },
  {
    id: 'leaderboard',
    label: 'Leaderboard',
    icon: Trophy,
    activeText: 'text-[#FFB800]',
    activeBox:
      'border border-[#FFB800]/50 bg-[#FFB800]/18 text-[#FFB800] shadow-[0_0_14px_rgba(255,184,0,0.4)]',
  },
  {
    id: 'shop',
    label: 'Shop',
    icon: ShoppingBag,
    activeText: 'text-[#FF4DA6]',
    activeBox:
      'border border-[#FF2E93]/50 bg-[#FF2E93]/18 text-[#FF4DA6] shadow-[0_0_14px_rgba(255,46,147,0.4)]',
  },
  {
    id: 'adsterra',
    label: 'Adsterra',
    icon: ShieldCheck,
    activeText: 'text-[#00FF87]',
    activeBox:
      'border border-[#00FF87]/50 bg-[#00FF87]/18 text-[#00FF87] shadow-[0_0_14px_rgba(0,255,135,0.4)]',
  },
];

export const BottomNav: React.FC<BottomNavProps> = ({ activeScreen, onSelectScreen }) => {
  return (
    <nav
      aria-label="Primary bottom navigation"
      className="glass-bar pb-safe fixed right-0 bottom-0 left-0 z-40 lg:hidden"
    >
      <div className="neon-hairline w-full" />
      <div className="mx-auto grid h-16 max-w-lg grid-cols-4 items-center px-2">
        {NAV_ITEMS.map(({ id, label, icon: Icon, activeText, activeBox }) => {
          const isActive = activeScreen === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelectScreen(id)}
              aria-current={isActive ? 'page' : undefined}
              className={`flex min-h-[44px] flex-col items-center justify-center rounded-xl px-1 py-1 transition-colors focus-visible:outline-2 focus-visible:outline-[#00F5FF] active:scale-95 ${
                isActive ? activeText : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <div
                className={`flex h-7 w-11 items-center justify-center rounded-lg transition-all ${
                  isActive ? activeBox : ''
                }`}
              >
                <Icon className="h-5 w-5" />
              </div>
              <span className="mt-0.5 text-[11px] font-semibold tracking-tight whitespace-nowrap">
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
