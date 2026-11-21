import React from 'react';
import { Bell, CheckCheck, X } from 'lucide-react';
import { MainScreen, NotificationItem } from '../types';

interface NotificationsDrawerProps {
  isOpen: boolean;
  notifications: NotificationItem[];
  onClose: () => void;
  onMarkAllRead: () => void;
  onClickNotification: (id: string, targetScreen?: MainScreen) => void;
}

export const NotificationsDrawer: React.FC<NotificationsDrawerProps> = ({
  isOpen,
  notifications,
  onClose,
  onMarkAllRead,
  onClickNotification,
}) => {
  if (!isOpen) return null;

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Notifications"
    >
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="neon-prism-panel relative z-10 flex h-full w-96 max-w-[92vw] flex-col border-l border-[#FF2E93]/30 p-5 shadow-2xl">
        <div className="flex items-center justify-between pb-4">
          <div className="flex items-center gap-2.5">
            <Bell className="h-5 w-5 text-[#FF2E93]" />
            <h2 className="font-display neon-text-spectrum text-base font-extrabold">
              Notifications
            </h2>
            {unreadCount > 0 && (
              <span className="font-mono-num rounded-md border border-[#FF2E93]/45 bg-[#FF2E93]/15 px-1.5 py-0.5 text-[11px] font-bold text-[#FF9AD0]">
                {unreadCount} unread
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close notifications"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-300 hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-[#00F5FF]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="neon-hairline" />

        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-slate-300">Recent activity &amp; compliance alerts</p>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={onMarkAllRead}
              className="flex min-h-[36px] items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold text-[#00FF87] transition-colors hover:bg-[#00FF87]/10"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              <span>Mark all read</span>
            </button>
          )}
        </div>

        <div className="mt-3 flex-1 space-y-2.5 overflow-y-auto pr-1">
          {notifications.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-[#070B20]/65 p-6 text-center text-sm text-slate-400">
              You are all caught up.
            </div>
          ) : (
            notifications.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onClickNotification(item.id, item.targetScreen)}
                className={`w-full rounded-2xl border p-3.5 text-left transition-all focus-visible:outline-2 focus-visible:outline-[#00F5FF] ${
                  item.read
                    ? 'border-white/10 bg-[#070B20]/65 text-slate-300 hover:border-white/20'
                    : 'neon-card-cyan text-white hover:border-[#00FF87]/55'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-white">{item.title}</p>
                  <span className="shrink-0 text-xs text-slate-400">{item.timeAgo}</span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-300">{item.message}</p>
                {!item.read && (
                  <p className="mt-2 text-[11px] font-semibold text-[#00F5FF]">
                    Unread · Tap to view
                  </p>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
