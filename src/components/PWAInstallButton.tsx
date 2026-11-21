import React, { useState } from 'react';
import { Download, Share2, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => {
          void install();
        }}
        className="flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-xl border border-[#00F5FF]/45 bg-gradient-to-r from-[#00F5FF]/20 via-[#B84DFF]/20 to-[#FF2E93]/20 px-2.5 py-1.5 text-xs font-semibold text-white shadow-[0_0_14px_rgba(0,245,255,0.22)] transition-all hover:border-[#00F5FF]/75 hover:brightness-110 active:scale-95 whitespace-nowrap"
        title="Install Infinity Rewards App"
      >
        <Download className="h-3.5 w-3.5 text-[#00F5FF]" />
        <span className="hidden sm:inline">Install App</span>
        <span className="sm:hidden">Install</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-xl border border-[#00F5FF]/40 bg-[#081F2D]/80 px-2.5 py-1.5 text-xs font-semibold text-[#00F5FF] transition-all hover:border-[#00F5FF]/70 active:scale-95 whitespace-nowrap"
        >
          <Share2 className="h-3.5 w-3.5" />
          <span>Install</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
            <div className="glass-panel w-full max-w-sm rounded-2xl border border-[#00F5FF]/35 p-6 shadow-2xl">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-base font-bold text-white">
                  Install on iPhone / iPad
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Close install instructions"
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <ol className="mt-3 space-y-2 text-sm text-slate-300">
                <li>
                  1. Tap the <strong className="text-white">Share</strong> button in Safari&apos;s
                  toolbar.
                </li>
                <li>
                  2. Scroll down and tap <strong className="text-[#00F5FF]">Add to Home Screen</strong>.
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full rounded-xl bg-gradient-to-r from-[#00F5FF] to-[#B84DFF] py-2.5 text-xs font-bold text-slate-950 transition hover:brightness-110"
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
