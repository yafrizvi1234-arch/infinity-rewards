import React, { useMemo, useState } from 'react';
import { Award, Search, Trophy, UserCheck, UserPlus } from 'lucide-react';
import { LeaderboardEntry, PublicProfile, UserProfileData } from '../types';
import { Avatar } from './Avatar';

interface LeaderboardScreenProps {
  currentUid: string;
  profile: UserProfileData;
  publicProfiles: PublicProfile[];
  demoPoints: number;
  totalVisits: number;
  visitedToday: number;
  followedUserIds: string[];
  onToggleFollow: (userId: string) => void;
}

type Timeframe = 'today' | 'weekly' | 'all';

export const LeaderboardScreen: React.FC<LeaderboardScreenProps> = ({
  currentUid,
  profile,
  publicProfiles,
  demoPoints,
  totalVisits,
  visitedToday,
  followedUserIds,
  onToggleFollow,
}) => {
  const [timeframe, setTimeframe] = useState<Timeframe>('weekly');
  const [query, setQuery] = useState('');

  const rankedEntries = useMemo(() => {
    const entriesById = new Map<string, Omit<LeaderboardEntry, 'rank'>>();

    for (const p of publicProfiles) {
      if (p.uid === currentUid) continue;
      entriesById.set(p.uid, {
        id: p.uid,
        username: p.displayName,
        handle: `@${p.username}`,
        avatar: p.photoURL,
        specialty: p.specialty || 'Verified Creator',
        demoPointsToday: p.totalVisits,
        demoPointsWeekly: p.totalPoints,
        demoPointsAllTime: p.totalPoints,
        visitsCount: p.totalVisits,
        isCurrentUser: false,
      });
    }

    entriesById.set(currentUid, {
      id: currentUid,
      username: profile.displayName,
      handle: `@${profile.username}`,
      avatar: profile.avatar,
      specialty: 'Verified Member',
      demoPointsToday: visitedToday,
      demoPointsWeekly: demoPoints,
      demoPointsAllTime: demoPoints,
      visitsCount: totalVisits,
      isCurrentUser: true,
    });

    const all = Array.from(entriesById.values());
    const getScore = (item: Omit<LeaderboardEntry, 'rank'>) => {
      if (timeframe === 'today') return item.demoPointsToday;
      if (timeframe === 'weekly') return item.demoPointsWeekly;
      return item.demoPointsAllTime;
    };

    all.sort((a, b) => {
      const diff = getScore(b) - getScore(a);
      if (diff !== 0) return diff;
      return b.visitsCount - a.visitsCount;
    });
    return all.map((entry, index) => ({
      ...entry,
      rank: index + 1,
      activeScore: getScore(entry),
    }));
  }, [currentUid, demoPoints, profile, publicProfiles, timeframe, totalVisits, visitedToday]);

  const filteredEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rankedEntries;
    return rankedEntries.filter(
      (item) =>
        item.username.toLowerCase().includes(q) ||
        item.handle.toLowerCase().includes(q) ||
        item.specialty.toLowerCase().includes(q)
    );
  }, [query, rankedEntries]);

  const myStanding = rankedEntries.find((e) => e.isCurrentUser);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold tracking-wide text-[#FFB800]">
            100% Real Verified Members ({rankedEntries.length}) · Zero Fake Users
          </p>
          <h1 className="font-display neon-text-spectrum mt-0.5 text-2xl font-extrabold tracking-tight sm:text-3xl">
            Leaderboard
          </h1>
        </div>

        {/* Timeframe Segmented Control */}
        <div
          role="tablist"
          aria-label="Leaderboard timeframe"
          className="grid grid-cols-3 gap-1 rounded-xl border border-[#FFB800]/25 bg-[#050816]/85 p-1"
        >
          {(
            [
              { id: 'today', label: 'Today' },
              { id: 'weekly', label: 'Weekly' },
              { id: 'all', label: 'All-Time' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={timeframe === tab.id}
              onClick={() => setTimeframe(tab.id)}
              className={`min-h-[40px] rounded-lg px-3 py-1.5 text-xs font-semibold transition-all whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[#FFB800] ${
                timeframe === tab.id
                  ? 'border border-[#FFB800]/55 bg-gradient-to-r from-[#FFB800]/22 via-[#FF2E93]/18 to-[#B84DFF]/20 text-white shadow-[0_0_16px_-4px_rgba(255,184,0,0.45)]'
                  : 'text-slate-400 hover:text-white border border-transparent'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Current User Highlight Banner */}
      {myStanding && (
        <div className="neon-prism-panel flex flex-wrap items-center justify-between gap-4 rounded-2xl p-4">
          <div className="flex items-center gap-3">
            <div className="font-mono-num flex h-10 w-10 items-center justify-center rounded-xl border border-[#00F5FF]/45 bg-[#00F5FF]/15 text-sm font-bold text-[#00F5FF]">
              #{myStanding.rank}
            </div>
            <Avatar
              src={myStanding.avatar}
              alt={myStanding.username}
              size="md"
              accent={profile.activeAccent}
            />
            <div>
              <p className="text-sm font-bold text-white">Your Real Standing</p>
              <p className="text-xs text-slate-300">
                {myStanding.visitsCount} visits · {myStanding.handle}
              </p>
            </div>
          </div>

          <div className="text-right">
            <p className="font-mono-num text-xl font-extrabold text-[#00FF87]">
              {timeframe === 'today'
                ? `${myStanding.visitsCount} Visits`
                : `${myStanding.activeScore.toLocaleString()} PTS`}
            </p>
            <p className="text-xs text-slate-300">Verified Firestore activity</p>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-[#00F5FF]" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search creators by name or @handle..."
          aria-label="Search leaderboard"
          className="glass-panel min-h-[46px] w-full rounded-2xl py-2.5 pr-4 pl-10 text-sm text-white placeholder:text-slate-400 focus:border-[#00F5FF] focus:outline-none"
        />
      </div>

      {/* Rankings List */}
      <div className="glass-panel overflow-hidden rounded-3xl">
        <div className="divide-y divide-white/10">
          {filteredEntries.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-400">
              No creators matched "{query}".
            </div>
          ) : (
            filteredEntries.map((entry) => {
              const isFollowing = followedUserIds.includes(entry.id);
              const rankColor =
                entry.rank === 1
                  ? 'text-[#FFB800]'
                  : entry.rank === 2
                    ? 'text-[#00F5FF]'
                    : entry.rank === 3
                      ? 'text-[#FF4DA6]'
                      : 'text-slate-400';

              return (
                <div
                  key={entry.id}
                  className={`flex items-center justify-between gap-3 px-4 py-3.5 transition-colors sm:px-5 ${
                    entry.isCurrentUser ? 'bg-[#00F5FF]/10' : 'hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className={`font-mono-num flex w-7 shrink-0 items-center justify-center text-sm font-bold ${rankColor}`}
                    >
                      {entry.rank <= 3 ? (
                        <Trophy className="h-4 w-4" />
                      ) : (
                        <span>{entry.rank}</span>
                      )}
                    </div>

                    <Avatar
                      src={entry.avatar}
                      alt={entry.username}
                      size="md"
                      accent={entry.isCurrentUser ? profile.activeAccent : 'none'}
                    />

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-sm font-semibold text-white">
                          {entry.username}
                        </p>
                        {entry.isCurrentUser && (
                          <span className="text-xs font-semibold text-[#00FF87]">· You</span>
                        )}
                      </div>
                      <p className="truncate text-xs text-slate-400">
                        {entry.handle} · {entry.specialty}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    <div className="text-right">
                      <p className="font-mono-num text-sm font-bold text-[#00F5FF]">
                        {entry.activeScore.toLocaleString()}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {timeframe === 'today'
                          ? entry.activeScore === 1
                            ? 'Visit'
                            : 'Visits'
                          : 'PTS'}
                      </p>
                    </div>

                    {!entry.isCurrentUser ? (
                      <button
                        type="button"
                        onClick={() => onToggleFollow(entry.id)}
                        aria-label={
                          isFollowing ? `Unfollow ${entry.username}` : `Follow ${entry.username}`
                        }
                        className={`flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl px-2.5 text-xs font-semibold transition-all focus-visible:outline-2 focus-visible:outline-[#00F5FF] ${
                          isFollowing
                            ? 'border border-[#00FF87]/45 bg-[#00FF87]/15 text-[#00FF87]'
                            : 'border border-[#B84DFF]/40 bg-[#B84DFF]/15 text-[#E9D5FF] hover:bg-[#B84DFF]/25'
                        }`}
                      >
                        {isFollowing ? (
                          <UserCheck className="h-4 w-4" />
                        ) : (
                          <UserPlus className="h-4 w-4" />
                        )}
                      </button>
                    ) : (
                      <div className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl border border-[#00F5FF]/35 bg-[#00F5FF]/12 text-[#00F5FF]">
                        <Award className="h-4 w-4" />
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
