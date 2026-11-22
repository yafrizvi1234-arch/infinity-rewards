import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Edit3,
  ExternalLink,
  Globe,
  History,
  Link2,
  Loader2,
  PlusCircle,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react';
import { checkDuplicateUrlKey } from '../services/linkService';
import {
  LINK_CATEGORIES,
  LinkStatus,
  LinkVisitRecord,
  ManagedLink,
  VisitTab,
} from '../types';
import { computeUrlKey, validateAndNormalizeUrl } from '../utils/urlValidator';

interface LinkManagerScreenProps {
  myLinks: ManagedLink[];
  myLinkVisits: LinkVisitRecord[];
  cooldowns: Record<string, number>;
  nowMs: number;
  onBack: () => void;
  onSubmitLink: (payload: {
    type: VisitTab;
    title: string;
    description: string;
    rawUrl: string;
    category: string;
  }) => Promise<void>;
  onUpdateLink: (
    existingLink: ManagedLink,
    payload: {
      type: VisitTab;
      title: string;
      description: string;
      rawUrl: string;
      category: string;
    }
  ) => Promise<void>;
  onDeleteLink: (link: ManagedLink) => Promise<void>;
}

type ManagerViewTab = 'submitted' | 'history';
type StatusFilter = 'all' | LinkStatus;

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

export const LinkManagerScreen: React.FC<LinkManagerScreenProps> = ({
  myLinks,
  myLinkVisits,
  cooldowns,
  nowMs,
  onBack,
  onSubmitLink,
  onUpdateLink,
  onDeleteLink,
}) => {
  const [viewTab, setViewTab] = useState<ManagerViewTab>('submitted');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const [editingLink, setEditingLink] = useState<ManagedLink | null>(null);
  const [linkType, setLinkType] = useState<VisitTab>('smartlink');
  const [title, setTitle] = useState('');
  const [rawUrl, setRawUrl] = useState('');
  const [category, setCategory] = useState<string>(LINK_CATEGORIES[0]);
  const [description, setDescription] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [dupState, setDupState] = useState<{
    checking: boolean;
    isDuplicate: boolean;
  }>({ checking: false, isDuplicate: false });

  const urlValidation = useMemo(() => {
    if (!rawUrl.trim()) return null;
    return validateAndNormalizeUrl(rawUrl);
  }, [rawUrl]);

  // Live duplicate detection via canonical urlKey lookup
  useEffect(() => {
    if (!urlValidation?.valid || !urlValidation.normalizedUrl) {
      setDupState({ checking: false, isDuplicate: false });
      return;
    }

    let cancelled = false;
    setDupState({ checking: true, isDuplicate: false });

    const timer = window.setTimeout(() => {
      computeUrlKey(urlValidation.normalizedUrl!)
        .then((key) => checkDuplicateUrlKey(key))
        .then((res) => {
          if (cancelled) return;
          const isSameAsEditing =
            editingLink && res.existingLinkId && res.existingLinkId === editingLink.id;
          setDupState({
            checking: false,
            isDuplicate: Boolean(res.isDuplicate && !isSameAsEditing),
          });
        })
        .catch(() => {
          if (!cancelled) setDupState({ checking: false, isDuplicate: false });
        });
    }, 320);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [editingLink, urlValidation]);

  const resetForm = () => {
    setEditingLink(null);
    setLinkType('smartlink');
    setTitle('');
    setRawUrl('');
    setCategory(LINK_CATEGORIES[0]);
    setDescription('');
    setFormError(null);
  };

  const startEditing = (link: ManagedLink) => {
    setEditingLink(link);
    setLinkType(link.type);
    setTitle(link.title);
    setRawUrl(link.url);
    setCategory(link.category);
    setDescription(link.description);
    setFormError(null);
    setFormSuccess(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleUpgradeHttps = () => {
    const trimmed = rawUrl.trim();
    if (trimmed.toLowerCase().startsWith('http://')) {
      setRawUrl(`https://${trimmed.slice(7)}`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    const check = validateAndNormalizeUrl(rawUrl);
    if (!check.valid) {
      setFormError(check.error || 'Please enter a valid URL.');
      return;
    }
    if (dupState.isDuplicate) {
      setFormError('Duplicate URL detected. This destination link already exists.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (editingLink) {
        await onUpdateLink(editingLink, {
          type: linkType,
          title,
          description,
          rawUrl,
          category,
        });
        setFormSuccess(
          linkType === 'smartlink'
            ? 'Smartlink updated and live immediately!'
            : 'Website updated and queued for admin moderation review.'
        );
      } else {
        await onSubmitLink({
          type: linkType,
          title,
          description,
          rawUrl,
          category,
        });
        setFormSuccess(
          linkType === 'smartlink'
            ? 'Smartlink published! It is live immediately without admin approval.'
            : 'Website submitted! Status is Pending until approved by an admin.'
        );
      }
      resetForm();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save link.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmDelete = async (link: ManagedLink) => {
    if (deletingId) return;
    setFormError(null);
    setDeletingId(link.id);
    try {
      await onDeleteLink(link);
      if (editingLink?.id === link.id) resetForm();
      setConfirmDeleteId(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to delete link.');
    } finally {
      setDeletingId(null);
    }
  };

  const counts = useMemo(() => {
    return {
      all: myLinks.length,
      pending: myLinks.filter((l) => l.status === 'pending').length,
      approved: myLinks.filter((l) => l.status === 'approved').length,
      rejected: myLinks.filter((l) => l.status === 'rejected').length,
    };
  }, [myLinks]);

  const filteredLinks = useMemo(() => {
    if (statusFilter === 'all') return myLinks;
    return myLinks.filter((l) => l.status === statusFilter);
  }, [myLinks, statusFilter]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex min-h-[44px] items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-xs font-semibold text-slate-200 transition-colors hover:bg-white/10"
          >
            <ArrowLeft className="h-4 w-4 text-cyan-300" />
            <span>Back</span>
          </button>
          <div>
            <h1 className="font-display neon-text-spectrum text-xl font-extrabold sm:text-2xl">
              Link Management
            </h1>
            <p className="text-xs text-slate-300">
              Smartlinks publish live immediately · Websites require moderation review
            </p>
          </div>
        </div>
      </div>

      {/* Submit / Edit Form */}
      <section aria-label="Submit or edit link" className="neon-prism-panel rounded-3xl p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <PlusCircle className="h-5 w-5 text-[#00F5FF]" />
            <h2 className="font-display text-lg font-bold text-white">
              {editingLink ? 'Edit Submitted Link' : 'Submit New Link'}
            </h2>
          </div>
          {editingLink && (
            <button
              type="button"
              onClick={resetForm}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/10"
            >
              Cancel Edit
            </button>
          )}
        </div>

        {editingLink && linkType === 'website' && (
          <div className="mt-3 rounded-xl border border-amber-400/25 bg-amber-950/25 px-3.5 py-2.5 text-xs text-amber-200">
            Saving edits to a website resets its status to Pending for safety verification before
            appearing publicly.
          </div>
        )}

        {formError && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-xl border border-rose-400/35 bg-rose-950/35 px-3.5 py-2.5 text-xs text-rose-200"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
            <span>{formError}</span>
          </div>
        )}

        {formSuccess && (
          <div
            role="status"
            className="mt-4 flex items-start gap-2 rounded-xl border border-cyan-400/35 bg-cyan-950/35 px-3.5 py-2.5 text-xs text-cyan-200"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
            <span>{formSuccess}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* Type Switch */}
          <div className="grid grid-cols-2 gap-2 rounded-2xl border border-[#3B82F6]/30 bg-[#050817]/80 p-1.5">
            <button
              type="button"
              onClick={() => setLinkType('smartlink')}
              className={`flex min-h-[44px] items-center justify-center gap-2 rounded-xl text-xs font-semibold transition-all ${
                linkType === 'smartlink'
                  ? 'border border-[#00F5FF]/55 bg-gradient-to-r from-[#00F5FF]/25 to-[#3B82F6]/25 text-white shadow-[0_0_14px_-4px_rgba(0,245,255,0.45)]'
                  : 'border border-transparent text-slate-400 hover:text-white'
              }`}
            >
              <Link2 className="h-4 w-4 text-[#00F5FF]" />
              <span>Smartlink</span>
            </button>
            <button
              type="button"
              onClick={() => setLinkType('website')}
              className={`flex min-h-[44px] items-center justify-center gap-2 rounded-xl text-xs font-semibold transition-all ${
                linkType === 'website'
                  ? 'border border-[#B84DFF]/55 bg-gradient-to-r from-[#B84DFF]/25 to-[#FF2E93]/25 text-white shadow-[0_0_14px_-4px_rgba(184,77,255,0.45)]'
                  : 'border border-transparent text-slate-400 hover:text-white'
              }`}
            >
              <Globe className="h-4 w-4 text-[#C084FC]" />
              <span>Website</span>
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-slate-300" htmlFor="link-title">
                Link Title
              </label>
              <input
                id="link-title"
                type="text"
                required
                minLength={3}
                maxLength={80}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Modern UI Component Library"
                className="mt-1 min-h-[44px] w-full rounded-xl border border-white/15 bg-slate-950/70 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-slate-300" htmlFor="link-category">
                Category
              </label>
              <select
                id="link-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-xl border border-white/15 bg-slate-950/70 px-3 py-2 text-sm text-white focus:border-cyan-400 focus:outline-none"
              >
                {category && !(LINK_CATEGORIES as readonly string[]).includes(category) && (
                  <option value={category} className="bg-slate-900 text-white">
                    {category}
                  </option>
                )}
                {LINK_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat} className="bg-slate-900 text-white">
                    {cat}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-300" htmlFor="link-url">
              Destination URL (HTTPS Prioritized)
            </label>
            <input
              id="link-url"
              type="text"
              required
              maxLength={500}
              value={rawUrl}
              onChange={(e) => setRawUrl(e.target.value)}
              placeholder="https://example.com/resource"
              className="mt-1 min-h-[44px] w-full rounded-xl border border-white/15 bg-slate-950/70 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
            />

            {urlValidation && (
              <div className="mt-2 space-y-1.5 text-xs">
                {!urlValidation.valid ? (
                  <p className="flex items-center gap-1.5 text-rose-300">
                    <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                    <span>{urlValidation.error}</span>
                  </p>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span
                      className={`flex items-center gap-1.5 ${
                        urlValidation.isHttps ? 'text-cyan-300' : 'text-amber-300'
                      }`}
                    >
                      <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                      <span>
                        {urlValidation.isHttps
                          ? `Verified HTTPS · ${urlValidation.domain}`
                          : `HTTP detected (${urlValidation.domain}) · HTTPS recommended`}
                      </span>
                    </span>

                    {!urlValidation.isHttps && (
                      <button
                        type="button"
                        onClick={handleUpgradeHttps}
                        className="rounded-lg border border-cyan-400/35 bg-cyan-500/15 px-2.5 py-1 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-500/25"
                      >
                        Upgrade to HTTPS
                      </button>
                    )}
                  </div>
                )}

                {urlValidation.valid && dupState.checking && (
                  <p className="text-slate-400">Checking for duplicate link...</p>
                )}
                {urlValidation.valid && !dupState.checking && dupState.isDuplicate && (
                  <p className="flex items-center gap-1.5 text-rose-300">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    <span>Duplicate link detected: this URL is already registered.</span>
                  </p>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-medium text-slate-300" htmlFor="link-desc">
              Description (10–300 characters)
            </label>
            <textarea
              id="link-desc"
              required
              minLength={10}
              maxLength={300}
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Briefly describe what visitors will find on this page..."
              className="mt-1 w-full rounded-xl border border-white/15 bg-slate-950/70 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <p className="text-[11px] text-slate-400">
              {linkType === 'smartlink'
                ? 'Smartlinks go live immediately (no admin approval required). Duplicate or unsafe URLs are blocked.'
                : 'Websites require Admin Approval. Malicious, duplicate, or deceptive URLs are blocked.'}
            </p>
            <button
              type="submit"
              disabled={
                isSubmitting ||
                dupState.checking ||
                dupState.isDuplicate ||
                (urlValidation !== null && !urlValidation.valid)
              }
              className="neon-btn-primary flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-5 py-2 text-xs font-bold disabled:opacity-50"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              <span>
                {isSubmitting
                  ? 'Saving...'
                  : editingLink
                    ? linkType === 'smartlink'
                      ? 'Save Smartlink'
                      : 'Save & Resubmit'
                    : linkType === 'smartlink'
                      ? 'Publish Smartlink'
                      : 'Submit for Review'}
              </span>
            </button>
          </div>
        </form>
      </section>

      {/* Submitted Links vs Opening History Switch */}
      <section className="glass-panel rounded-3xl p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-[#3B82F6]/25 bg-[#050817]/80 p-1">
            <button
              type="button"
              onClick={() => setViewTab('submitted')}
              className={`min-h-[40px] rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                viewTab === 'submitted'
                  ? 'border border-[#00F5FF]/50 bg-[#00F5FF]/15 text-[#00F5FF]'
                  : 'border border-transparent text-slate-400 hover:text-white'
              }`}
            >
              My Submitted Links ({myLinks.length})
            </button>
            <button
              type="button"
              onClick={() => setViewTab('history')}
              className={`flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                viewTab === 'history'
                  ? 'border border-[#B84DFF]/50 bg-[#B84DFF]/15 text-[#E8C5FF]'
                  : 'border border-transparent text-slate-400 hover:text-white'
              }`}
            >
              <History className="h-3.5 w-3.5" />
              <span>Opening History ({myLinkVisits.length})</span>
            </button>
          </div>

          {viewTab === 'submitted' && (
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { id: 'all', label: `All (${counts.all})` },
                  { id: 'pending', label: `Pending (${counts.pending})` },
                  { id: 'approved', label: `Approved (${counts.approved})` },
                  { id: 'rejected', label: `Rejected (${counts.rejected})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`min-h-[34px] rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                    statusFilter === tab.id
                      ? 'border border-[#FF2E93]/50 bg-[#FF2E93]/15 text-[#FF9AD0]'
                      : 'border border-white/10 bg-white/5 text-slate-400 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {viewTab === 'submitted' ? (
          <div className="mt-4 space-y-3">
            {filteredLinks.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-[#070B20]/65 p-6 text-center text-xs text-slate-400">
                No submitted links in this filter yet. Use the form above to submit a Smartlink or
                Website link.
              </div>
            ) : (
              filteredLinks.map((link) => {
                return (
                  <div
                    key={link.id}
                    className="rounded-2xl border border-white/12 bg-[#070B20]/75 p-4 transition-colors hover:border-[#00F5FF]/40"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-slate-400">
                          <span
                            className={`font-bold capitalize ${
                              link.status === 'rejected'
                                ? 'text-[#FF4D6D]'
                                : link.status === 'approved' || link.type === 'smartlink'
                                  ? 'text-[#00FF87]'
                                  : 'text-[#FFB800]'
                            }`}
                          >
                            {link.type === 'smartlink' && link.status !== 'rejected'
                              ? 'live'
                              : link.status}
                          </span>
                          {' · '}
                          {link.type === 'smartlink' ? 'Smartlink' : 'Website'}
                          {' · '}
                          <span className="text-[#00F5FF]">{link.category}</span>
                          {link.isHttps ? ' · HTTPS' : ''}
                        </p>

                        <h3 className="font-display mt-2 text-base font-bold text-white">
                          {link.title}
                        </h3>
                        <p className="mt-1 text-xs leading-relaxed text-slate-300">
                          {link.description}
                        </p>
                        <p className="mt-1.5 flex items-center gap-1.5 truncate text-xs text-slate-400">
                          <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[#00F5FF]" />
                          <span className="truncate">{link.url}</span>
                        </p>
                        <p className="mt-1 text-[11px] text-slate-500">
                          Updated {formatDateTime(link.updatedAtMs)}
                        </p>

                        {link.moderationNote && (
                          <div className="mt-2.5 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-xs text-slate-300">
                            <span className="font-semibold text-slate-200">Moderator note: </span>
                            {link.moderationNote}
                          </div>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => startEditing(link)}
                          className="flex min-h-[40px] items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10"
                        >
                          <Edit3 className="h-3.5 w-3.5 text-cyan-300" />
                          <span>Edit</span>
                        </button>

                        {confirmDeleteId === link.id ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={deletingId === link.id}
                              onClick={() => handleConfirmDelete(link)}
                              className="min-h-[40px] rounded-xl border border-rose-400/40 bg-rose-500/20 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/30"
                            >
                              {deletingId === link.id ? 'Deleting...' : 'Confirm'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="min-h-[40px] rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-300"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(link.id)}
                            className="flex min-h-[40px] items-center gap-1.5 rounded-xl border border-rose-400/25 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-200 hover:bg-rose-500/20"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>Delete</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <div className="mt-4 space-y-2.5">
            {myLinkVisits.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-6 text-center text-xs text-slate-400">
                You haven&apos;t opened any approved external links yet.
              </div>
            ) : (
              myLinkVisits.map((visit) => {
                const cdEnds = cooldowns[visit.linkId] ?? 0;
                const remaining = Math.max(0, Math.ceil((cdEnds - nowMs) / 1000));
                return (
                  <div
                    key={visit.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-900/55 p-3.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">{visit.linkTitle}</p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {visit.linkType === 'smartlink' ? 'Smartlink' : 'Website'} · {visit.category}{' '}
                        · {visit.domain}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        Opened: {formatDateTime(visit.createdAtMs)}
                      </p>
                    </div>

                    {remaining > 0 ? (
                      <span className="font-mono-num flex items-center gap-1.5 rounded-lg border border-purple-400/30 bg-purple-500/15 px-2.5 py-1 text-xs font-medium text-purple-200">
                        <Clock className="h-3.5 w-3.5" />
                        <span>Cooldown {remaining}s</span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-slate-400">
                        <XCircle className="h-3.5 w-3.5 opacity-0" aria-hidden="true" />
                        <span>Ready</span>
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </section>
    </div>
  );
};
