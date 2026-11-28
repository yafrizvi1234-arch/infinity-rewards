import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  Flag,
  History,
  Save,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import {
  LinkReportRecord,
  ManagedLink,
  ModerationLogRecord,
  PaymentNumbersConfig,
  PaymentRequestRecord,
} from '../types';

interface AdminModerationScreenProps {
  allLinks: ManagedLink[];
  reports: LinkReportRecord[];
  moderationLogs: ModerationLogRecord[];
  paymentRequests: PaymentRequestRecord[];
  paymentConfig: PaymentNumbersConfig;
  onBack: () => void;
  onModerateLink: (
    link: ManagedLink,
    decision: 'approved' | 'rejected',
    note: string
  ) => Promise<void>;
  onRemoveLink: (link: ManagedLink, reason: string) => Promise<void>;
  onResolveReport: (
    report: LinkReportRecord,
    action: 'resolve_and_remove' | 'dismiss',
    note: string
  ) => Promise<void>;
  onReviewPaymentRequest: (
    request: PaymentRequestRecord,
    decision: 'approved' | 'rejected',
    adminNote: string,
    verifiedProof?: boolean
  ) => Promise<void>;
  onRevokeMultiPayment: (request: PaymentRequestRecord, adminNote: string) => Promise<void>;
  onUpdatePaymentNumbers: (numbers: {
    bkashNumber: string;
    nagadNumber: string;
  }) => Promise<void>;
}

type AdminTab = 'pending' | 'payments' | 'all' | 'reports' | 'history';

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

export const AdminModerationScreen: React.FC<AdminModerationScreenProps> = ({
  allLinks,
  reports,
  moderationLogs,
  paymentRequests,
  paymentConfig,
  onBack,
  onModerateLink,
  onRemoveLink,
  onResolveReport,
  onReviewPaymentRequest,
  onRevokeMultiPayment,
  onUpdatePaymentNumbers,
}) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('pending');
  const [hasPickedTabManually, setHasPickedTabManually] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const [verifiedChecksById, setVerifiedChecksById] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [previewScreenshotUrl, setPreviewScreenshotUrl] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [bkashInput, setBkashInput] = useState(paymentConfig.bkashNumber);
  const [nagadInput, setNagadInput] = useState(paymentConfig.nagadNumber);
  const [savingNumbers, setSavingNumbers] = useState(false);
  const [numbersFeedback, setNumbersFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  useEffect(() => {
    setBkashInput(paymentConfig.bkashNumber);
    setNagadInput(paymentConfig.nagadNumber);
  }, [paymentConfig.bkashNumber, paymentConfig.nagadNumber]);

  const pendingLinks = useMemo(
    () => allLinks.filter((l) => l.status === 'pending'),
    [allLinks]
  );

  const pendingPayments = useMemo(
    () => paymentRequests.filter((p) => p.status === 'pending'),
    [paymentRequests]
  );

  const openReports = useMemo(
    () => reports.filter((r) => r.status === 'open'),
    [reports]
  );

  useEffect(() => {
    if (!hasPickedTabManually && pendingLinks.length === 0 && pendingPayments.length > 0) {
      setActiveTab('payments');
    }
  }, [hasPickedTabManually, pendingLinks.length, pendingPayments.length]);

  const filteredLinks = useMemo(() => {
    const base = activeTab === 'pending' ? pendingLinks : allLinks;
    const q = searchTerm.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (l) =>
        l.title.toLowerCase().includes(q) ||
        l.domain.toLowerCase().includes(q) ||
        l.ownerUsername.toLowerCase().includes(q) ||
        l.category.toLowerCase().includes(q)
    );
  }, [activeTab, allLinks, pendingLinks, searchTerm]);

  const handleModerate = async (link: ManagedLink, decision: 'approved' | 'rejected') => {
    if (busyId) return;
    setActionError(null);
    setBusyId(link.id);
    try {
      await onModerateLink(link, decision, notesById[link.id] || '');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Moderation failed.');
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = async (link: ManagedLink) => {
    if (busyId) return;
    setActionError(null);
    setBusyId(link.id);
    try {
      await onRemoveLink(link, notesById[link.id] || 'Removed by administrator');
      setConfirmRemoveId(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to remove link.');
    } finally {
      setBusyId(null);
    }
  };

  const handleReportAction = async (
    report: LinkReportRecord,
    action: 'resolve_and_remove' | 'dismiss'
  ) => {
    if (busyId) return;
    setActionError(null);
    setBusyId(report.id);
    try {
      await onResolveReport(report, action, notesById[report.id] || '');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to handle report.');
    } finally {
      setBusyId(null);
    }
  };

  const handlePaymentDecision = async (
    request: PaymentRequestRecord,
    decision: 'approved' | 'rejected'
  ) => {
    if (busyId) return;
    setActionError(null);
    const isVerified = Boolean(verifiedChecksById[request.id]);
    if (decision === 'approved' && !isVerified) {
      setActionError(
        'Please check the verification confirmation box after inspecting Transaction ID & Screenshot before approving.'
      );
      return;
    }
    setBusyId(request.id);
    try {
      await onReviewPaymentRequest(request, decision, notesById[request.id] || '', isVerified);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Payment review failed.');
    } finally {
      setBusyId(null);
    }
  };

  const handleRevokePayment = async (request: PaymentRequestRecord) => {
    if (busyId) return;
    setActionError(null);
    setBusyId(request.id);
    try {
      await onRevokeMultiPayment(request, notesById[request.id] || '');
      setConfirmRevokeId(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to revoke Multi (5) access.');
    } finally {
      setBusyId(null);
    }
  };

  const handleSavePaymentNumbers = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingNumbers) return;
    setNumbersFeedback(null);
    setSavingNumbers(true);
    try {
      await onUpdatePaymentNumbers({
        bkashNumber: bkashInput,
        nagadNumber: nagadInput,
      });
      setNumbersFeedback({
        type: 'success',
        message: 'bKash & Nagad Personal payment numbers updated.',
      });
    } catch (err) {
      setNumbersFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to update payment numbers.',
      });
    } finally {
      setSavingNumbers(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex min-h-[44px] items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10"
          >
            <ArrowLeft className="h-4 w-4 text-cyan-300" />
            <span>Back</span>
          </button>
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-[#FF2E93]" />
              <h1 className="font-display neon-text-spectrum text-xl font-extrabold sm:text-2xl">
                Admin Moderation
              </h1>
            </div>
            <p className="text-xs text-slate-300">
              Review pending submissions, manage reported links, and audit moderation logs
            </p>
          </div>
        </div>
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="neon-card-amber rounded-2xl p-4">
          <p className="text-xs text-slate-300">Pending Links</p>
          <p className="font-mono-num mt-1 text-2xl font-bold text-[#FFB800]">
            {pendingLinks.length}
          </p>
        </div>
        <div className="neon-card-purple rounded-2xl p-4">
          <p className="text-xs text-slate-300">Pending Payments</p>
          <p className="font-mono-num mt-1 text-2xl font-bold text-[#C084FC]">
            {pendingPayments.length}
          </p>
        </div>
        <div className="neon-card-blue rounded-2xl p-4">
          <p className="text-xs text-slate-300">Total Submitted</p>
          <p className="font-mono-num mt-1 text-2xl font-bold text-[#60A5FA]">{allLinks.length}</p>
        </div>
        <div className="neon-card-pink rounded-2xl p-4">
          <p className="text-xs text-slate-300">Open Reports</p>
          <p className="font-mono-num mt-1 text-2xl font-bold text-[#FF2E93]">
            {openReports.length}
          </p>
        </div>
        <div className="neon-card-green col-span-2 rounded-2xl p-4 sm:col-span-1">
          <p className="text-xs text-slate-300">Moderation Actions</p>
          <p className="font-mono-num mt-1 text-2xl font-bold text-[#00FF87]">
            {moderationLogs.length}
          </p>
        </div>
      </div>

      {actionError && (
        <div
          role="alert"
          className="rounded-xl border border-rose-400/35 bg-rose-950/35 px-4 py-3 text-xs text-rose-200"
        >
          {actionError}
        </div>
      )}

      {/* Main Panel */}
      <section className="neon-prism-panel rounded-3xl p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-[#B84DFF]/25 bg-[#050817]/80 p-1 sm:grid-cols-5">
            {(
              [
                { id: 'pending', label: `Pending (${pendingLinks.length})` },
                { id: 'payments', label: `Payments (${pendingPayments.length})` },
                { id: 'all', label: `All Links (${allLinks.length})` },
                { id: 'reports', label: `Reports (${openReports.length})` },
                { id: 'history', label: 'History' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setHasPickedTabManually(true);
                  setActiveTab(tab.id);
                }}
                className={`min-h-[38px] rounded-lg px-3 py-1.5 text-xs font-semibold transition-all whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'border border-[#00F5FF]/55 bg-gradient-to-r from-[#00F5FF]/20 via-[#B84DFF]/20 to-[#FF2E93]/20 text-white shadow-[0_0_12px_-4px_rgba(0,245,255,0.45)]'
                    : 'border border-transparent text-slate-400 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {(activeTab === 'pending' || activeTab === 'all') && (
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search title, domain, user..."
                className="min-h-[40px] w-full rounded-xl border border-white/15 bg-slate-950/70 py-1.5 pr-3 pl-9 text-xs text-white placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
              />
            </div>
          )}
        </div>

        {/* Pending & All Links View */}
        {(activeTab === 'pending' || activeTab === 'all') && (
          <div className="mt-4 space-y-3">
            {filteredLinks.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-6 text-center text-xs text-slate-400">
                {activeTab === 'pending'
                  ? 'No links awaiting moderation.'
                  : 'No submitted links match your search.'}
              </div>
            ) : (
              filteredLinks.map((link) => {
                const statusBadge =
                  link.status === 'approved'
                    ? 'border-emerald-400/30 bg-emerald-500/15 text-emerald-200'
                    : link.status === 'rejected'
                      ? 'border-rose-400/30 bg-rose-500/15 text-rose-200'
                      : 'border-amber-400/30 bg-amber-500/15 text-amber-200';

                return (
                  <div
                    key={link.id}
                    className="rounded-2xl border border-white/10 bg-slate-900/55 p-4 space-y-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold capitalize ${statusBadge}`}
                          >
                            {link.status}
                          </span>
                          <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-slate-300">
                            {link.type === 'smartlink' ? 'Smartlink' : 'Website'} · {link.category}
                          </span>
                          <span
                            className={`text-[11px] font-medium ${
                              link.isHttps ? 'text-cyan-300' : 'text-amber-300'
                            }`}
                          >
                            {link.isHttps ? 'HTTPS' : 'HTTP'}
                          </span>
                          {link.reportCount > 0 && (
                            <span className="rounded-md border border-rose-400/30 bg-rose-500/15 px-2 py-0.5 text-[11px] text-rose-200">
                              {link.reportCount} report{link.reportCount === 1 ? '' : 's'}
                            </span>
                          )}
                        </div>

                        <h3 className="font-display mt-2 text-base font-bold text-white">
                          {link.title}
                        </h3>
                        <p className="mt-1 text-xs text-slate-300">{link.description}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                          <a
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-cyan-300 hover:underline"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            <span className="break-all">{link.url}</span>
                          </a>
                          <span>
                            Submitted by {link.ownerName} ({link.ownerUsername}) ·{' '}
                            {formatDateTime(link.createdAtMs)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 border-t border-white/10 pt-3 sm:flex-row sm:items-center">
                      <input
                        type="text"
                        maxLength={240}
                        value={notesById[link.id] ?? ''}
                        onChange={(e) =>
                          setNotesById((prev) => ({ ...prev, [link.id]: e.target.value }))
                        }
                        placeholder="Optional moderation note / reason..."
                        className="min-h-[40px] flex-1 rounded-xl border border-white/15 bg-slate-950/70 px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
                      />

                      <div className="flex flex-wrap items-center gap-2">
                        {link.status !== 'approved' && (
                          <button
                            type="button"
                            disabled={busyId === link.id}
                            onClick={() => handleModerate(link, 'approved')}
                            className="flex min-h-[40px] items-center gap-1.5 rounded-xl border border-emerald-400/35 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-50"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>Approve</span>
                          </button>
                        )}
                        {link.status !== 'rejected' && (
                          <button
                            type="button"
                            disabled={busyId === link.id}
                            onClick={() => handleModerate(link, 'rejected')}
                            className="flex min-h-[40px] items-center gap-1.5 rounded-xl border border-amber-400/35 bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/25 disabled:opacity-50"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            <span>Reject</span>
                          </button>
                        )}
                        {confirmRemoveId === link.id ? (
                          <>
                            <button
                              type="button"
                              disabled={busyId === link.id}
                              onClick={() => handleRemove(link)}
                              className="min-h-[40px] rounded-xl border border-rose-400/45 bg-rose-500/25 px-3 py-1.5 text-xs font-semibold text-rose-100"
                            >
                              Confirm Delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmRemoveId(null)}
                              className="min-h-[40px] rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-300"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            disabled={busyId === link.id}
                            onClick={() => setConfirmRemoveId(link.id)}
                            className="flex min-h-[40px] items-center gap-1.5 rounded-xl border border-rose-400/25 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/20"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>Remove</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Reported Links View */}
        {activeTab === 'reports' && (
          <div className="mt-4 space-y-3">
            {reports.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-6 text-center text-xs text-slate-400">
                No link reports submitted yet.
              </div>
            ) : (
              reports.map((report) => (
                <div
                  key={report.id}
                  className="rounded-2xl border border-white/10 bg-slate-900/55 p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Flag className="h-3.5 w-3.5 text-rose-300" />
                        <span
                          className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold capitalize ${
                            report.status === 'open'
                              ? 'border-rose-400/30 bg-rose-500/15 text-rose-200'
                              : 'border-white/10 bg-white/5 text-slate-300'
                          }`}
                        >
                          {report.status}
                        </span>
                        <span className="text-xs text-slate-400">
                          Reported by {report.reporterUsername} · {formatDateTime(report.createdAtMs)}
                        </span>
                      </div>
                      <h3 className="font-display mt-2 text-sm font-bold text-white">
                        {report.linkTitle}
                      </h3>
                      <p className="mt-0.5 break-all text-xs text-cyan-300">{report.linkUrl}</p>
                      <p className="mt-2 rounded-xl border border-white/10 bg-slate-950/60 p-2.5 text-xs text-slate-200">
                        Reason: {report.reason}
                      </p>
                    </div>
                  </div>

                  {report.status === 'open' ? (
                    <div className="flex flex-col gap-2 border-t border-white/10 pt-3 sm:flex-row sm:items-center">
                      <input
                        type="text"
                        maxLength={240}
                        value={notesById[report.id] ?? ''}
                        onChange={(e) =>
                          setNotesById((prev) => ({ ...prev, [report.id]: e.target.value }))
                        }
                        placeholder="Resolution note..."
                        className="min-h-[40px] flex-1 rounded-xl border border-white/15 bg-slate-950/70 px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busyId === report.id}
                          onClick={() => handleReportAction(report, 'resolve_and_remove')}
                          className="flex min-h-[40px] items-center gap-1.5 rounded-xl border border-rose-400/35 bg-rose-500/15 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/25 disabled:opacity-50"
                        >
                          <ShieldAlert className="h-3.5 w-3.5" />
                          <span>Remove Link</span>
                        </button>
                        <button
                          type="button"
                          disabled={busyId === report.id}
                          onClick={() => handleReportAction(report, 'dismiss')}
                          className="flex min-h-[40px] items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-50"
                        >
                          <span>Dismiss Report</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    report.adminNote && (
                      <p className="text-xs text-slate-400">Admin note: {report.adminNote}</p>
                    )
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Multi (5) Payment Requests & Payment Number Config View */}
        {activeTab === 'payments' && (
          <div className="mt-4 space-y-4">
            {/* Admin Payment Number Settings */}
            <form
              onSubmit={handleSavePaymentNumbers}
              className="neon-card-cyan rounded-2xl p-4 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-display text-sm font-bold text-white">
                    bKash &amp; Nagad Payment Numbers (Multi 5 · 50 BDT)
                  </h3>
                  <p className="text-xs text-slate-300">
                    Update the Personal numbers shown to users during 50 BDT Multi (5) checkout
                  </p>
                </div>
                {paymentConfig.updatedAtMs && (
                  <span className="text-[11px] text-[#00F5FF]">
                    Updated: {formatDateTime(paymentConfig.updatedAtMs)}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#FF9AD0]">
                    bKash (Personal) Number
                  </label>
                  <input
                    type="tel"
                    required
                    minLength={6}
                    maxLength={24}
                    value={bkashInput}
                    onChange={(e) => setBkashInput(e.target.value)}
                    placeholder="017XXXXXXXX"
                    className="font-mono-num min-h-[42px] w-full rounded-xl border border-white/15 bg-[#050817]/85 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-[#FF2E93] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#FFD56A]">
                    Nagad (Personal) Number
                  </label>
                  <input
                    type="tel"
                    required
                    minLength={6}
                    maxLength={24}
                    value={nagadInput}
                    onChange={(e) => setNagadInput(e.target.value)}
                    placeholder="018XXXXXXXX"
                    className="font-mono-num min-h-[42px] w-full rounded-xl border border-white/15 bg-[#050817]/85 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-[#FFB800] focus:outline-none"
                  />
                </div>
              </div>

              {numbersFeedback && (
                <p
                  role="status"
                  className={`rounded-xl border px-3 py-2 text-xs ${
                    numbersFeedback.type === 'success'
                      ? 'border-[#00FF87]/45 bg-[#00FF87]/10 text-[#00FF87]'
                      : 'border-[#FF4D6D]/45 bg-[#FF2E93]/10 text-rose-200'
                  }`}
                >
                  {numbersFeedback.message}
                </p>
              )}

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={savingNumbers}
                  className="neon-btn-emerald flex min-h-[40px] items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold disabled:opacity-60"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>{savingNumbers ? 'Saving Numbers...' : 'Save Payment Numbers'}</span>
                </button>
              </div>
            </form>

            {/* Admin Scope & Payment Approval History Summary */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-slate-900/50 px-4 py-3 text-xs">
              <span className="text-slate-300">
                Admin payment scope: Multi (5) verification &amp; approval history only (other
                users&apos; Adsterra API keys &amp; personal Smartlinks remain strictly private).
              </span>
              <span className="font-mono-num font-semibold text-cyan-300">
                Pending: {pendingPayments.length} · Approval History:{' '}
                {paymentRequests.length - pendingPayments.length}
              </span>
            </div>

            {paymentRequests.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-6 text-center text-xs text-slate-400">
                No Multi (5) payment verification requests submitted yet.
              </div>
            ) : (
              paymentRequests.map((req) => {
                const badgeClass =
                  req.status === 'approved'
                    ? 'border-emerald-400/30 bg-emerald-500/15 text-emerald-200'
                    : req.status === 'rejected'
                      ? 'border-rose-400/30 bg-rose-500/15 text-rose-200'
                      : 'border-amber-400/30 bg-amber-500/15 text-amber-200';
                const isVerifiedChecked = Boolean(verifiedChecksById[req.id]);

                return (
                  <div
                    key={req.id}
                    className="rounded-2xl border border-white/10 bg-slate-900/55 p-4 space-y-3"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold capitalize ${badgeClass}`}
                          >
                            {req.status}
                          </span>
                          <span className="flex items-center gap-1 rounded-md border border-cyan-400/25 bg-cyan-500/10 px-2 py-0.5 text-[11px] font-semibold uppercase text-cyan-200">
                            <CreditCard className="h-3 w-3" />
                            <span>
                              {req.paymentMethod} · {req.amountBdt} BDT (Multi 5)
                            </span>
                          </span>
                          <span className="font-mono-num rounded-md border border-purple-400/30 bg-purple-500/15 px-2 py-0.5 text-[11px] font-bold text-purple-200">
                            TxID: {req.transactionId}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 gap-2 text-xs text-slate-300 sm:grid-cols-2">
                          <p>
                            <span className="text-slate-400">Applicant:</span>{' '}
                            <span className="font-semibold text-white">{req.userName}</span> (
                            {req.userUsername})
                          </p>
                          <p className="truncate">
                            <span className="text-slate-400">Applicant UID:</span>{' '}
                            <span className="font-mono-num text-slate-200">{req.uid}</span>
                          </p>
                          <p>
                            <span className="text-slate-400">Receiver Number:</span>{' '}
                            <span className="font-mono-num text-slate-200">{req.paymentNumber}</span>
                          </p>
                          <p>
                            <span className="text-slate-400">Sender Number:</span>{' '}
                            <span className="font-mono-num text-slate-200">
                              {req.senderNumber || 'Not provided'}
                            </span>
                          </p>
                          <p>
                            <span className="text-slate-400">Submitted:</span>{' '}
                            {formatDateTime(req.createdAtMs)}
                          </p>
                          {req.reviewedAtMs && (
                            <p>
                              <span className="text-slate-400">Reviewed:</span>{' '}
                              {formatDateTime(req.reviewedAtMs)} ({req.reviewedByEmail})
                            </p>
                          )}
                        </div>
                      </div>

                      {req.screenshotUrl && (
                        <button
                          type="button"
                          onClick={() => setPreviewScreenshotUrl(req.screenshotUrl)}
                          className="group relative shrink-0 overflow-hidden rounded-xl border border-white/15 bg-slate-950 p-1 text-left hover:border-cyan-400/50"
                        >
                          <img
                            src={req.screenshotUrl}
                            alt={`Payment screenshot for ${req.transactionId}`}
                            className="h-28 w-44 rounded-lg object-cover"
                          />
                          <span className="mt-1 block text-center text-[10px] font-semibold text-cyan-300 group-hover:underline">
                            Click to Enlarge Screenshot
                          </span>
                        </button>
                      )}
                    </div>

                    {req.status === 'pending' ? (
                      <div className="space-y-2.5 border-t border-white/10 pt-3">
                        <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-200">
                          <input
                            type="checkbox"
                            checked={isVerifiedChecked}
                            onChange={(e) =>
                              setVerifiedChecksById((prev) => ({
                                ...prev,
                                [req.id]: e.target.checked,
                              }))
                            }
                            className="h-4 w-4 rounded border-white/25 bg-slate-950 accent-cyan-400"
                          />
                          <span>
                            I verified Transaction ID (<span className="font-mono-num text-cyan-300">{req.transactionId}</span>) &amp; Screenshot (50 BDT received)
                          </span>
                        </label>

                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <input
                            type="text"
                            maxLength={240}
                            value={notesById[req.id] ?? ''}
                            onChange={(e) =>
                              setNotesById((prev) => ({ ...prev, [req.id]: e.target.value }))
                            }
                            placeholder="Verification note / rejection reason..."
                            className="min-h-[40px] flex-1 rounded-xl border border-white/15 bg-slate-950/70 px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
                          />
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={busyId === req.id}
                              onClick={() => handlePaymentDecision(req, 'approved')}
                              className={`neon-btn-emerald flex min-h-[40px] items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50 ${
                                !isVerifiedChecked ? 'opacity-80' : ''
                              }`}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              <span>
                                {busyId === req.id ? 'Activating...' : 'Approve & Activate Multi (5)'}
                              </span>
                            </button>
                            <button
                              type="button"
                              disabled={busyId === req.id}
                              onClick={() => handlePaymentDecision(req, 'rejected')}
                              className="flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[#FF2E93]/45 bg-[#FF2E93]/15 px-3 py-1.5 text-xs font-semibold text-[#FF9AD0] hover:bg-[#FF2E93]/25 disabled:opacity-50"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              <span>Reject</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2.5 border-t border-white/10 pt-2.5">
                        {req.adminNote && (
                          <p className="text-xs text-slate-400">Admin Note: {req.adminNote}</p>
                        )}
                        {req.status === 'approved' && (
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <input
                              type="text"
                              maxLength={240}
                              value={notesById[req.id] ?? ''}
                              onChange={(e) =>
                                setNotesById((prev) => ({ ...prev, [req.id]: e.target.value }))
                              }
                              placeholder="Optional revoke reason..."
                              className="min-h-[38px] flex-1 rounded-xl border border-white/15 bg-slate-950/70 px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-rose-400 focus:outline-none"
                            />
                            <div className="flex flex-wrap items-center gap-2">
                              {confirmRevokeId === req.id ? (
                                <>
                                  <button
                                    type="button"
                                    disabled={busyId === req.id}
                                    onClick={() => handleRevokePayment(req)}
                                    className="min-h-[38px] rounded-xl border border-rose-400/55 bg-rose-500/25 px-3 py-1.5 text-xs font-bold text-rose-100 hover:bg-rose-500/35 disabled:opacity-50"
                                  >
                                    {busyId === req.id ? 'Revoking...' : 'Confirm Revoke'}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busyId === req.id}
                                    onClick={() => setConfirmRevokeId(null)}
                                    className="min-h-[38px] rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10"
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  disabled={busyId === req.id}
                                  onClick={() => setConfirmRevokeId(req.id)}
                                  className="flex min-h-[38px] items-center gap-1.5 rounded-xl border border-rose-400/35 bg-rose-500/15 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/25 disabled:opacity-50"
                                >
                                  <XCircle className="h-3.5 w-3.5" />
                                  <span>Revoke Multi (5)</span>
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Moderation History View */}
        {activeTab === 'history' && (
          <div className="mt-4 space-y-2.5">
            {moderationLogs.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-6 text-center text-xs text-slate-400">
                No moderation actions recorded yet.
              </div>
            ) : (
              moderationLogs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-start justify-between gap-3 rounded-2xl border border-white/10 bg-slate-900/55 p-3.5"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-slate-950/70 text-cyan-300">
                      <History className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">
                        <span className="uppercase text-cyan-300">{log.action.replace('_', ' ')}</span>{' '}
                        · {log.linkTitle}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-300">{log.reason}</p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        By {log.adminEmail} · {formatDateTime(log.createdAtMs)}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </section>

      {/* Enlarged Payment Screenshot Preview Lightbox */}
      {previewScreenshotUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Payment Screenshot Preview"
        >
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => setPreviewScreenshotUrl(null)}
          />
          <div className="glass-panel relative z-10 max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-3xl p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <p className="font-display text-sm font-bold text-white">
                Payment Screenshot Verification
              </p>
              <button
                type="button"
                onClick={() => setPreviewScreenshotUrl(null)}
                aria-label="Close screenshot preview"
                className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl text-slate-300 hover:bg-white/10 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <img
              src={previewScreenshotUrl}
              alt="Full-size payment proof"
              className="max-h-[75vh] w-full rounded-2xl bg-slate-950 object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
};
