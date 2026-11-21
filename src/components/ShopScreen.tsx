import React, { useState } from 'react';
import { Check, Lock, Palette, ShieldCheck, ShoppingBag, Sparkles } from 'lucide-react';
import { SHOP_ITEMS } from '../data/demoData';
import { ShopRewardItem, UserProfileData } from '../types';

interface ShopScreenProps {
  demoPoints: number;
  unlockedShopIds: string[];
  activeAccent: UserProfileData['activeAccent'];
  isMulti5Active: boolean;
  hasPendingMultiPayment: boolean;
  onUnlockShopItem: (item: ShopRewardItem) => Promise<void> | void;
  onApplyAccent: (accent: UserProfileData['activeAccent']) => Promise<void> | void;
  onOpenProLocked: () => void;
}

type ShopCategory = 'All' | 'Theme' | 'Badge' | 'Perks';

export const ShopScreen: React.FC<ShopScreenProps> = ({
  demoPoints,
  unlockedShopIds,
  activeAccent,
  isMulti5Active,
  hasPendingMultiPayment,
  onUnlockShopItem,
  onApplyAccent,
  onOpenProLocked,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<ShopCategory>('All');
  const [busyItemId, setBusyItemId] = useState<string | null>(null);

  const handleUnlockClick = async (item: ShopRewardItem) => {
    if (busyItemId) return;
    setBusyItemId(item.id);
    try {
      await onUnlockShopItem(item);
    } finally {
      setBusyItemId(null);
    }
  };

  const handleApplyClick = async (itemId: string, accent: UserProfileData['activeAccent']) => {
    if (busyItemId) return;
    setBusyItemId(itemId);
    try {
      await onApplyAccent(accent);
    } finally {
      setBusyItemId(null);
    }
  };

  const visibleItems =
    selectedCategory === 'All'
      ? SHOP_ITEMS
      : SHOP_ITEMS.filter((item) => item.category === selectedCategory);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold tracking-wide text-[#FF4DA6]">Virtual Demo Customization</p>
          <h1 className="font-display neon-text-spectrum mt-0.5 text-2xl font-extrabold tracking-tight sm:text-3xl">
            Reward Shop
          </h1>
        </div>

        <div className="neon-card-green flex items-center gap-2.5 self-start rounded-2xl px-4 py-2.5 sm:self-auto">
          <ShoppingBag className="h-4 w-4 text-[#00FF87]" />
          <span className="text-xs text-slate-300">Your Points:</span>
          <span className="font-mono-num text-sm font-extrabold text-[#00FF87]">{demoPoints} PTS</span>
        </div>
      </div>

      {/* Concise Note */}
      <div className="glass-subtle flex items-center gap-2.5 rounded-2xl px-4 py-3 text-xs text-slate-200">
        <ShieldCheck className="h-4 w-4 shrink-0 text-[#00F5FF]" />
        <p>Themes &amp; Badges unlock with PTS · Multi (5) unlocks via verified 50 BDT payment.</p>
      </div>

      {/* Category Filter */}
      <div className="flex flex-wrap gap-2">
        {(['All', 'Theme', 'Badge', 'Perks'] as const).map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setSelectedCategory(cat)}
            className={`min-h-[40px] rounded-xl px-4 py-2 text-xs font-semibold transition-all whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[#FF2E93] ${
              selectedCategory === cat
                ? 'border border-[#FF2E93]/55 bg-gradient-to-r from-[#FF2E93]/25 via-[#B84DFF]/25 to-[#00F5FF]/20 text-white shadow-[0_0_16px_-4px_rgba(255,46,147,0.45)]'
                : 'glass-subtle text-slate-300 hover:text-white'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Shop Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {visibleItems.map((item) => {
          const isUnlocked = unlockedShopIds.includes(item.id);
          const isApplied = item.category === 'Theme' && activeAccent === item.previewAccent && isUnlocked;
          const canAfford = demoPoints >= item.demoCost;

          const cardAura = item.isProPreview
            ? 'neon-prism-panel'
            : item.previewAccent === 'cyan'
              ? 'neon-card-cyan'
              : item.previewAccent === 'purple'
                ? 'neon-card-purple'
                : 'neon-card-blue';

          const accentIconColor =
            item.previewAccent === 'cyan'
              ? 'text-[#00F5FF] border-[#00F5FF]/45 bg-[#00F5FF]/15'
              : item.previewAccent === 'purple'
                ? 'text-[#C084FC] border-[#B84DFF]/45 bg-[#B84DFF]/15'
                : 'text-[#60A5FA] border-[#3B82F6]/45 bg-[#3B82F6]/15';

          return (
            <div
              key={item.id}
              className={`${cardAura} flex flex-col justify-between rounded-3xl p-5 transition-transform hover:-translate-y-0.5`}
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div
                    className={`flex h-11 w-11 items-center justify-center rounded-2xl border ${accentIconColor}`}
                  >
                    {item.category === 'Theme' ? (
                      <Palette className="h-5 w-5" />
                    ) : item.isProPreview ? (
                      isMulti5Active ? (
                        <Sparkles className="h-5 w-5 text-[#00FF87]" />
                      ) : (
                        <Lock className="h-5 w-5 text-[#FF4DA6]" />
                      )
                    ) : (
                      <Sparkles className="h-5 w-5" />
                    )}
                  </div>
                  <span className="font-mono-num text-xs font-semibold text-slate-300">
                    {item.category} ·{' '}
                    {item.isProPreview
                      ? isMulti5Active
                        ? 'Multi (5) Active'
                        : '50 BDT (PRO)'
                      : `${item.demoCost} PTS`}
                  </span>
                </div>

                <h2 className="font-display mt-4 text-base font-bold text-white">
                  {item.isProPreview ? 'Multi (5) PRO Access' : item.title}
                </h2>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-300">
                  {item.isProPreview
                    ? 'Unlock 5-link batch mode in Visit Hub via verified 50 BDT bKash/Nagad payment & admin approval.'
                    : item.subtitle}
                </p>
              </div>

              <div className="mt-5">
                {item.isProPreview ? (
                  <button
                    type="button"
                    onClick={onOpenProLocked}
                    className={`flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
                      isMulti5Active
                        ? 'border border-[#00FF87]/55 bg-[#00FF87]/15 text-[#00FF87] hover:bg-[#00FF87]/25'
                        : hasPendingMultiPayment
                          ? 'border border-[#FFB800]/50 bg-[#FFB800]/15 text-[#FFD166] hover:bg-[#FFB800]/25'
                          : 'neon-btn-primary'
                    }`}
                  >
                    {isMulti5Active ? (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        <span>Multi (5) Active · View Receipt</span>
                      </>
                    ) : hasPendingMultiPayment ? (
                      <>
                        <Lock className="h-3.5 w-3.5" />
                        <span>Payment Pending Verification</span>
                      </>
                    ) : (
                      <>
                        <Lock className="h-3.5 w-3.5" />
                        <span>Buy Multi (5) — 50 BDT</span>
                      </>
                    )}
                  </button>
                ) : isUnlocked ? (
                  item.category === 'Theme' ? (
                    <button
                      type="button"
                      disabled={busyItemId !== null}
                      onClick={() => void handleApplyClick(item.id, item.previewAccent)}
                      className={`flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-colors disabled:opacity-60 ${
                        isApplied
                          ? 'border border-[#00FF87]/55 bg-[#00FF87]/15 text-[#00FF87]'
                          : 'bg-white/10 text-white hover:bg-white/15'
                      }`}
                    >
                      <Check className="h-3.5 w-3.5" />
                      <span>
                        {busyItemId === item.id
                          ? 'Applying...'
                          : isApplied
                            ? 'Active Profile Frame'
                            : 'Apply Frame'}
                      </span>
                    </button>
                  ) : (
                    <div className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-[#00F5FF]/45 bg-[#00F5FF]/12 text-xs font-semibold text-[#67E8F9]">
                      <Check className="h-3.5 w-3.5" />
                      <span>Unlocked in Profile</span>
                    </div>
                  )
                ) : (
                  <button
                    type="button"
                    disabled={!canAfford || busyItemId !== null}
                    onClick={() => void handleUnlockClick(item)}
                    className={`flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
                      canAfford
                        ? 'neon-btn-primary disabled:opacity-60'
                        : 'cursor-not-allowed border border-white/10 bg-[#050816]/80 text-slate-400'
                    }`}
                  >
                    <span>
                      {busyItemId === item.id
                        ? 'Unlocking...'
                        : canAfford
                          ? `Unlock Milestone (${item.demoCost} PTS)`
                          : `Earn ${item.demoCost - demoPoints} more PTS to unlock`}
                    </span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
