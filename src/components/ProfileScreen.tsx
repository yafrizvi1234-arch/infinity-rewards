import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  AtSign,
  Award,
  Calendar,
  Camera,
  Check,
  CheckCircle2,
  Coins,
  Edit3,
  Eye,
  History,
  Loader2,
  LogOut,
  Mail,
  ShieldCheck,
  Sparkles,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { uploadProfileAvatar } from '../services/storageService';
import {
  checkUsernameAvailability,
  normalizeUsername,
  validateUsernameFormat,
} from '../services/userWorkspaceService';
import {
  ActivityRecord,
  FollowRelation,
  PublicProfile,
  UserProfileData,
} from '../types';
import { Avatar } from './Avatar';

interface ProfileScreenProps {
  uid: string;
  profile: UserProfileData;
  totalPoints: number;
  totalVisits: number;
  successfulVisits: number;
  followersCount: number;
  followingCount: number;
  followingList: FollowRelation[];
  followersList: FollowRelation[];
  publicProfiles: PublicProfile[];
  activities: ActivityRecord[];
  unlockedShopIds: string[];
  userEmail: string | null;
  accountCreatedAtMs: number | null;
  onBack: () => void;
  onSaveProfile: (updates: {
    displayName: string;
    username: string;
    bio: string;
    photoURL: string;
  }) => Promise<void>;
  onAvatarUploadToast: (msg: string) => void;
  onToggleFollowTarget: (target: {
    id: string;
    name: string;
    username: string;
    avatar: string;
    isRealUser: boolean;
    followersCount?: number;
  }) => Promise<void>;
  onLogout: () => void;
}

type ActivityFilter = 'all' | 'visit' | 'points' | 'follow';
type SocialTab = 'followers' | 'following' | 'discover';

function formatDateTime(ms: number): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(ms));
  } catch {
    return 'Recent';
  }
}

function formatDateOnly(ms: number | null): string {
  if (!ms) return 'Verified Member';
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(ms));
  } catch {
    return 'Verified Member';
  }
}

export const ProfileScreen: React.FC<ProfileScreenProps> = ({
  uid,
  profile,
  totalPoints,
  totalVisits,
  successfulVisits,
  followersCount,
  followingCount,
  followingList,
  followersList,
  publicProfiles,
  activities,
  unlockedShopIds,
  userEmail,
  accountCreatedAtMs,
  onBack,
  onSaveProfile,
  onAvatarUploadToast,
  onToggleFollowTarget,
  onLogout,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState(profile.displayName);
  const [draftUsername, setDraftUsername] = useState(profile.username);
  const [draftBio, setDraftBio] = useState(profile.bio);
  const [draftPhotoUrl, setDraftPhotoUrl] = useState(profile.avatar);

  const [usernameStatus, setUsernameStatus] = useState<{
    checking: boolean;
    available: boolean;
    message: string;
  }>({ checking: false, available: true, message: '' });

  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [socialTab, setSocialTab] = useState<SocialTab>('following');
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all');
  const [pendingFollowId, setPendingFollowId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isEditing) {
      setDraftName(profile.displayName);
      setDraftUsername(profile.username);
      setDraftBio(profile.bio);
      setDraftPhotoUrl(profile.avatar);
      setProfileError(null);
      setUsernameStatus({ checking: false, available: true, message: '' });
    }
  }, [isEditing, profile]);

  // Live username availability validation while editing
  useEffect(() => {
    if (!isEditing) return;
    const normalized = normalizeUsername(draftUsername);
    if (normalized === profile.username) {
      setUsernameStatus({
        checking: false,
        available: true,
        message: 'Current username',
      });
      return;
    }

    const formatErr = validateUsernameFormat(normalized);
    if (formatErr) {
      setUsernameStatus({ checking: false, available: false, message: formatErr });
      return;
    }

    let cancelled = false;
    setUsernameStatus({ checking: true, available: false, message: 'Checking availability...' });
    const timer = window.setTimeout(() => {
      checkUsernameAvailability(normalized, uid)
        .then((res) => {
          if (cancelled) return;
          setUsernameStatus({
            checking: false,
            available: res.available,
            message: res.available
              ? `@${res.normalized} is available`
              : res.error || 'Username unavailable',
          });
        })
        .catch(() => {
          if (!cancelled) {
            setUsernameStatus({
              checking: false,
              available: false,
              message: 'Could not verify username right now.',
            });
          }
        });
    }, 320);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [draftUsername, isEditing, profile.username, uid]);

  const handleAvatarSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setProfileError(null);
    setIsUploadingAvatar(true);
    try {
      const res = await uploadProfileAvatar(uid, file);
      setDraftPhotoUrl(res.photoURL);
      if (!isEditing) {
        await onSaveProfile({
          displayName: profile.displayName,
          username: profile.username,
          bio: profile.bio,
          photoURL: res.photoURL,
        });
      }
      onAvatarUploadToast(res.note);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Avatar upload failed.');
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError(null);

    const cleanName = draftName.trim();
    const normalizedUser = normalizeUsername(draftUsername);
    const formatErr = validateUsernameFormat(normalizedUser);
    if (cleanName.length < 1) {
      setProfileError('Display name is required.');
      return;
    }
    if (formatErr) {
      setProfileError(formatErr);
      return;
    }
    if (!usernameStatus.available || usernameStatus.checking) {
      setProfileError('Please choose an available unique username.');
      return;
    }

    setIsSavingProfile(true);
    try {
      await onSaveProfile({
        displayName: cleanName,
        username: normalizedUser,
        bio: draftBio.trim(),
        photoURL: draftPhotoUrl,
      });
      setIsEditing(false);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Failed to update profile.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const followingIds = useMemo(
    () => new Set(followingList.map((edge) => edge.targetId)),
    [followingList]
  );

  // Real verified community profiles only (zero fake users)
  const discoverUsers = useMemo(() => {
    return publicProfiles
      .filter((p) => p.uid !== uid)
      .map((p) => ({
        id: p.uid,
        name: p.displayName,
        username: `@${p.username}`,
        avatar: p.photoURL,
        subtitle: `${p.specialty} · Verified Member`,
        followersCount: p.followersCount,
        isRealUser: true,
      }));
  }, [publicProfiles, uid]);

  const filteredActivities = useMemo(() => {
    if (activityFilter === 'all') return activities;
    if (activityFilter === 'visit') return activities.filter((a) => a.type === 'visit');
    if (activityFilter === 'points') {
      return activities.filter((a) => a.pointsDelta !== 0 || a.type === 'points');
    }
    return activities.filter((a) => a.type === 'follow' || a.type === 'unfollow');
  }, [activities, activityFilter]);

  const statsCards = [
    {
      label: 'Total Points',
      value: totalPoints.toLocaleString(),
      icon: Coins,
      accent: 'text-[#00F5FF]',
      cardClass: 'neon-card-cyan',
    },
    {
      label: 'Total Visits',
      value: totalVisits.toLocaleString(),
      icon: Eye,
      accent: 'text-[#3B82F6]',
      cardClass: 'neon-card-blue',
    },
    {
      label: 'Successful Visits',
      value: successfulVisits.toLocaleString(),
      icon: CheckCircle2,
      accent: 'text-[#00FF87]',
      cardClass: 'neon-card-green',
    },
    {
      label: 'Total Followers',
      value: followersCount.toLocaleString(),
      icon: Users,
      accent: 'text-[#C084FC]',
      cardClass: 'neon-card-purple',
    },
    {
      label: 'Following Count',
      value: followingCount.toLocaleString(),
      icon: UserCheck,
      accent: 'text-[#FF2E93]',
      cardClass: 'neon-card-pink',
    },
  ];

  const handleFollowClick = async (target: {
    id: string;
    name: string;
    username: string;
    avatar: string;
    isRealUser: boolean;
    followersCount?: number;
  }) => {
    if (pendingFollowId) return;
    setPendingFollowId(target.id);
    try {
      await onToggleFollowTarget(target);
    } finally {
      setPendingFollowId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Action Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex min-h-[44px] items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-xs font-semibold text-slate-200 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-cyan-400"
        >
          <ArrowLeft className="h-4 w-4 text-cyan-300" />
          <span>Back to Dashboard</span>
        </button>

        <button
          type="button"
          onClick={() => setIsEditing((prev) => !prev)}
          className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[#B84DFF]/45 bg-[#B84DFF]/15 px-4 py-2 text-xs font-semibold text-[#E8C5FF] shadow-[0_0_16px_-6px_rgba(184,77,255,0.45)] transition-colors hover:bg-[#B84DFF]/25 focus-visible:outline-2 focus-visible:outline-[#00F5FF]"
        >
          <Edit3 className="h-3.5 w-3.5" />
          <span>{isEditing ? 'Cancel Edit' : 'Edit Profile'}</span>
        </button>
      </div>

      {/* 1. User Profile Card */}
      <section aria-label="User profile" className="neon-prism-panel rounded-3xl p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          {/* Avatar + Upload Button */}
          <div className="flex flex-col items-center gap-2.5 self-center sm:self-start">
            <div className="relative">
              <Avatar
                src={isEditing ? draftPhotoUrl : profile.avatar}
                alt={profile.displayName}
                size="xl"
                accent={profile.activeAccent}
              />
              <button
                type="button"
                disabled={isUploadingAvatar}
                onClick={() => fileInputRef.current?.click()}
                aria-label="Upload profile picture"
                className="absolute -right-1 -bottom-1 flex h-9 w-9 items-center justify-center rounded-full border border-[#00F5FF]/55 bg-[#060B22] text-[#00F5FF] shadow-[0_0_16px_-4px_rgba(0,245,255,0.6)] transition-colors hover:bg-[#00F5FF]/20 focus-visible:outline-2 focus-visible:outline-[#00F5FF] disabled:opacity-60"
              >
                {isUploadingAvatar ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Camera className="h-4 w-4" />
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleAvatarSelected}
                className="hidden"
              />
            </div>
            <button
              type="button"
              disabled={isUploadingAvatar}
              onClick={() => fileInputRef.current?.click()}
              className="text-[11px] font-semibold text-[#00F5FF] hover:text-[#00FF87]"
            >
              {isUploadingAvatar ? 'Uploading...' : 'Change Photo'}
            </button>
          </div>

          <div className="min-w-0 flex-1">
            {profileError && (
              <div
                role="alert"
                className="mb-3 rounded-xl border border-rose-400/35 bg-rose-950/35 px-3.5 py-2.5 text-xs text-rose-200"
              >
                {profileError}
              </div>
            )}

            {isEditing ? (
              <form onSubmit={handleSave} className="space-y-3.5">
                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  <div>
                    <label className="text-xs font-medium text-slate-300" htmlFor="profile-name">
                      Display Name
                    </label>
                    <input
                      id="profile-name"
                      type="text"
                      maxLength={50}
                      required
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      className="mt-1 min-h-[44px] w-full rounded-xl border border-white/15 bg-slate-950/70 px-3 py-2 text-sm text-white focus:border-cyan-400 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-medium text-slate-300" htmlFor="profile-username">
                      Unique Username
                    </label>
                    <div className="relative mt-1">
                      <AtSign className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        id="profile-username"
                        type="text"
                        maxLength={24}
                        required
                        value={draftUsername}
                        onChange={(e) => setDraftUsername(normalizeUsername(e.target.value))}
                        className="min-h-[44px] w-full rounded-xl border border-white/15 bg-slate-950/70 py-2 pr-3 pl-9 text-sm text-white focus:border-cyan-400 focus:outline-none"
                      />
                    </div>
                    {usernameStatus.message && (
                      <p
                        className={`mt-1 text-[11px] ${
                          usernameStatus.checking
                            ? 'text-slate-400'
                            : usernameStatus.available
                              ? 'text-cyan-300'
                              : 'text-rose-300'
                        }`}
                      >
                        {usernameStatus.message}
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-300" htmlFor="profile-bio">
                    Bio
                  </label>
                  <textarea
                    id="profile-bio"
                    rows={2}
                    maxLength={160}
                    value={draftBio}
                    onChange={(e) => setDraftBio(e.target.value)}
                    placeholder="Tell the community about your interests..."
                    className="mt-1 w-full rounded-xl border border-white/15 bg-slate-950/70 px-3 py-2 text-sm text-white focus:border-cyan-400 focus:outline-none"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="submit"
                    disabled={isSavingProfile || usernameStatus.checking || !usernameStatus.available}
                    className="neon-btn-primary flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-5 py-2 text-xs font-bold disabled:opacity-50"
                  >
                    {isSavingProfile ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                    <span>{isSavingProfile ? 'Saving...' : 'Save Profile'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsEditing(false)}
                    className="min-h-[44px] rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-white/10"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-display neon-text-spectrum text-2xl font-extrabold">
                    {profile.displayName}
                  </h1>
                  {unlockedShopIds.includes('shop-blue-badge') && (
                    <span className="flex items-center gap-1 rounded-md border border-[#00F5FF]/45 bg-[#00F5FF]/15 px-2 py-0.5 text-xs font-semibold text-[#00F5FF]">
                      <Award className="h-3.5 w-3.5" />
                      <span>Early Explorer</span>
                    </span>
                  )}
                </div>

                <p className="mt-0.5 text-sm font-semibold text-[#00F5FF]">@{profile.username}</p>

                <p className="mt-2.5 text-sm leading-relaxed text-slate-300">
                  {profile.bio || 'No bio added yet.'}
                </p>

                {/* Read-Only Account Metadata */}
                <div className="mt-4 grid grid-cols-1 gap-2.5 border-t border-white/10 pt-3.5 text-xs sm:grid-cols-2">
                  <div className="neon-card-cyan flex items-center gap-2.5 rounded-xl px-3 py-2.5">
                    <Mail className="h-4 w-4 shrink-0 text-[#00F5FF]" />
                    <div className="min-w-0">
                      <p className="text-[11px] text-slate-400">Email Address (Read Only)</p>
                      <p className="truncate font-medium text-white">{userEmail || 'Unavailable'}</p>
                    </div>
                  </div>

                  <div className="neon-card-purple flex items-center gap-2.5 rounded-xl px-3 py-2.5">
                    <Calendar className="h-4 w-4 shrink-0 text-[#C084FC]" />
                    <div className="min-w-0">
                      <p className="text-[11px] text-slate-400">Account Created</p>
                      <p className="truncate font-medium text-white">
                        {formatDateOnly(accountCreatedAtMs)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 2. User Statistics (Real Firestore Data) */}
      <section aria-label="User statistics">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-white">Account Statistics</h2>
          <span className="flex items-center gap-1.5 text-xs font-semibold text-[#00FF87]">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Synced from Firestore</span>
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {statsCards.map((stat, idx) => {
            const Icon = stat.icon;
            return (
              <div
                key={stat.label}
                className={`${stat.cardClass} rounded-2xl p-4 transition-transform hover:-translate-y-0.5 ${
                  idx === 4 ? 'col-span-2 sm:col-span-1' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-300">{stat.label}</span>
                  <Icon className={`h-4 w-4 ${stat.accent}`} />
                </div>
                <p className="font-mono-num mt-2 text-2xl font-bold text-white">{stat.value}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* 3. Follow System & 4. Activity History */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Follow System: Followers / Following / Discover Users */}
        <section
          aria-label="Follow connections"
          className="glass-panel rounded-3xl p-5 xl:col-span-5"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-[#C084FC]" />
              <h2 className="font-display text-base font-bold text-white">Connections</h2>
            </div>
          </div>

          <div
            role="tablist"
            aria-label="Connection lists"
            className="mt-3 grid grid-cols-3 gap-1 rounded-xl border border-[#B84DFF]/25 bg-[#050817]/80 p-1"
          >
            {(
              [
                { id: 'following', label: `Following (${followingList.length})` },
                { id: 'followers', label: `Followers (${followersList.length})` },
                { id: 'discover', label: 'Discover' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={socialTab === tab.id}
                onClick={() => setSocialTab(tab.id)}
                className={`min-h-[38px] rounded-lg px-2 py-1.5 text-xs font-semibold transition-all whitespace-nowrap ${
                  socialTab === tab.id
                    ? 'border border-[#B84DFF]/55 bg-gradient-to-r from-[#B84DFF]/25 to-[#FF2E93]/25 text-white shadow-[0_0_12px_-4px_rgba(184,77,255,0.45)]'
                    : 'border border-transparent text-slate-400 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="mt-4 max-h-96 space-y-2.5 overflow-y-auto pr-1">
            {socialTab === 'following' &&
              (followingList.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-5 text-center text-xs text-slate-400">
                  Not following anyone yet. Open the Discover tab to follow users.
                </div>
              ) : (
                followingList.map((edge) => (
                  <div
                    key={edge.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-900/50 p-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar src={edge.targetAvatar} alt={edge.targetName} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">
                          {edge.targetName}
                        </p>
                        <p className="truncate text-xs text-slate-400">{edge.targetUsername}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={pendingFollowId === edge.targetId}
                      onClick={() =>
                        handleFollowClick({
                          id: edge.targetId,
                          name: edge.targetName,
                          username: edge.targetUsername,
                          avatar: edge.targetAvatar,
                          isRealUser: edge.isRealTarget,
                        })
                      }
                      className="min-h-[38px] shrink-0 rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10 disabled:opacity-50"
                    >
                      Unfollow
                    </button>
                  </div>
                ))
              ))}

            {socialTab === 'followers' &&
              (followersList.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-5 text-center text-xs text-slate-400">
                  No followers yet. Share your unique @{profile.username} handle with others.
                </div>
              ) : (
                followersList.map((edge) => {
                  const amFollowingBack = followingIds.has(edge.followerId);
                  return (
                    <div
                      key={edge.id}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-900/50 p-3"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar src={edge.followerAvatar} alt={edge.followerName} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-white">
                            {edge.followerName}
                          </p>
                          <p className="truncate text-xs text-slate-400">{edge.followerUsername}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={pendingFollowId === edge.followerId}
                        onClick={() =>
                          handleFollowClick({
                            id: edge.followerId,
                            name: edge.followerName,
                            username: edge.followerUsername,
                            avatar: edge.followerAvatar,
                            isRealUser: true,
                          })
                        }
                        className={`min-h-[38px] shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold ${
                          amFollowingBack
                            ? 'border border-[#00FF87]/45 bg-[#00FF87]/15 text-[#00FF87]'
                            : 'neon-btn-primary'
                        }`}
                      >
                        {amFollowingBack ? 'Following' : 'Follow Back'}
                      </button>
                    </div>
                  );
                })
              ))}

            {socialTab === 'discover' &&
              discoverUsers.map((person) => {
                const isFollowing = followingIds.has(person.id);
                return (
                  <div
                    key={person.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#070B20]/75 p-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar
                        src={person.avatar}
                        alt={person.name}
                        size="sm"
                        accent={isFollowing ? 'cyan' : 'none'}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{person.name}</p>
                        <p className="truncate text-xs text-slate-400">
                          {person.username} · {person.subtitle}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={pendingFollowId === person.id}
                      onClick={() => handleFollowClick(person)}
                      className={`flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
                        isFollowing
                          ? 'border border-[#00FF87]/45 bg-[#00FF87]/15 text-[#00FF87] hover:bg-[#00FF87]/25'
                          : 'neon-btn-primary'
                      }`}
                    >
                      {isFollowing ? (
                        <>
                          <UserCheck className="h-3.5 w-3.5" />
                          <span>Following</span>
                        </>
                      ) : (
                        <>
                          <UserPlus className="h-3.5 w-3.5" />
                          <span>Follow</span>
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
          </div>
        </section>

        {/* Activity History System */}
        <section
          aria-label="Activity history"
          className="glass-panel rounded-3xl p-5 xl:col-span-7"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-[#00F5FF]" />
              <h2 className="font-display text-base font-bold text-white">Activity History</h2>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { id: 'all', label: 'Recent' },
                  { id: 'visit', label: 'Visits' },
                  { id: 'points', label: 'Points' },
                  { id: 'follow', label: 'Follows' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActivityFilter(tab.id)}
                  className={`min-h-[34px] rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
                    activityFilter === tab.id
                      ? 'border border-[#00F5FF]/55 bg-[#00F5FF]/15 text-[#00F5FF]'
                      : 'border border-white/10 bg-white/5 text-slate-400 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 max-h-96 space-y-2.5 overflow-y-auto pr-1">
            {filteredActivities.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-[#070B20]/65 p-6 text-center text-xs text-slate-400">
                No activity recorded in this category yet. Complete a visit or follow a creator to
                see real-time Firestore logs here.
              </div>
            ) : (
              filteredActivities.map((item) => {
                const Icon =
                  item.type === 'visit'
                    ? Eye
                    : item.type === 'follow' || item.type === 'unfollow'
                      ? Users
                      : item.type === 'profile_update'
                        ? Sparkles
                        : Activity;

                return (
                  <div
                    key={item.id}
                    className="flex items-start justify-between gap-3 rounded-2xl border border-white/10 bg-[#070B20]/75 p-3.5 transition-colors hover:border-[#00F5FF]/35"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#B84DFF]/30 bg-[#050817] text-[#C084FC]">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{item.title}</p>
                        <p className="mt-0.5 text-xs text-slate-300">{item.description}</p>
                        <p className="mt-1 text-[11px] text-slate-400">
                          {item.category} · {formatDateTime(item.createdAtMs)}
                        </p>
                      </div>
                    </div>

                    {item.pointsDelta !== 0 && (
                      <span className="font-mono-num shrink-0 text-xs font-bold text-[#00FF87]">
                        {item.pointsDelta > 0 ? `+${item.pointsDelta}` : item.pointsDelta} PTS
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      {/* Sign Out Action */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onLogout}
          className="flex min-h-[44px] items-center gap-2 rounded-xl border border-[#FF2E93]/35 bg-[#FF2E93]/10 px-4 py-2 text-xs font-semibold text-[#FF9AD0] transition-colors hover:bg-[#FF2E93]/20"
        >
          <LogOut className="h-4 w-4" />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );
};
