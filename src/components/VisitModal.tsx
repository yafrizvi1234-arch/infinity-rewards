import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  ImagePlus,
  Lock,
  ShieldAlert,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import {
  MULTI5_PRICE_BDT,
  PAYMENT_CHANNELS,
  normalizeAndValidateTransactionId,
} from '../services/paymentService';
import { isSupportedImageFile } from '../services/storageService';
import {
  ManagedLink,
  MultiEntitlementRecord,
  PaymentMethod,
  PaymentNumbersConfig,
  PaymentRequestRecord,
} from '../types';

interface VisitModalProps {
  reportTarget: ManagedLink | null;
  isProModalOpen: boolean;
  isAdmin?: boolean;
  multiEntitlement: MultiEntitlementRecord | null;
  myPaymentRequests: PaymentRequestRecord[];
  paymentConfig: PaymentNumbersConfig;
  onCloseReport: () => void;
  onReportLink: (link: ManagedLink, reason: string) => Promise<void>;
  onCloseProModal: () => void;
  onSubmitMultiPayment: (payload: {
    paymentMethod: PaymentMethod;
    paymentNumber: string;
    senderNumber?: string;
    transactionId: string;
    screenshotFile: File;
  }) => Promise<void>;
}

function formatPaymentTime(ms: number): string {
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

export const VisitModal: React.FC<VisitModalProps> = ({
  reportTarget,
  isProModalOpen,
  isAdmin = false,
  multiEntitlement,
  myPaymentRequests,
  paymentConfig,
  onCloseReport,
  onReportLink,
  onCloseProModal,
  onSubmitMultiPayment,
}) => {
  const [reportReason, setReportReason] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportFeedback, setReportFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Multi (5) Payment Form States
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('bkash');
  const [senderNumber, setSenderNumber] = useState('');
  const [transactionId, setTransactionId] = useState('');
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);
  const [screenshotPreviewUrl, setScreenshotPreviewUrl] = useState<string | null>(null);
  const [copiedNumber, setCopiedNumber] = useState(false);
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState<string | null>(null);
  const screenshotInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setReportReason('');
    setReportFeedback(null);
  }, [reportTarget?.id]);

  useEffect(() => {
    if (!isProModalOpen) {
      setPaymentError(null);
      setPaymentSuccess(null);
      setCopiedNumber(false);
    }
  }, [isProModalOpen]);

  useEffect(() => {
    return () => {
      if (screenshotPreviewUrl) {
        URL.revokeObjectURL(screenshotPreviewUrl);
      }
    };
  }, [screenshotPreviewUrl]);

  const latestPaymentRequest = myPaymentRequests[0] ?? null;
  const pendingRequest = myPaymentRequests.find((r) => r.status === 'pending') ?? null;
  const isMultiActive = isAdmin || Boolean(multiEntitlement?.active);
  const selectedChannel = PAYMENT_CHANNELS[paymentMethod];
  const activePaymentNumber =
    paymentMethod === 'nagad' ? paymentConfig.nagadNumber : paymentConfig.bkashNumber;

  const handleCopyNumber = async () => {
    try {
      await navigator.clipboard.writeText(activePaymentNumber);
      setCopiedNumber(true);
      window.setTimeout(() => setCopiedNumber(false), 2000);
    } catch {
      setCopiedNumber(false);
    }
  };

  const handleScreenshotSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    setPaymentError(null);
    if (!file) return;

    if (!isSupportedImageFile(file)) {
      setPaymentError('Please upload a JPG, PNG, or WebP payment screenshot.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setPaymentError('Screenshot size must be under 5MB.');
      return;
    }

    if (screenshotPreviewUrl) {
      URL.revokeObjectURL(screenshotPreviewUrl);
    }
    setScreenshotFile(file);
    setScreenshotPreviewUrl(URL.createObjectURL(file));
  };

  const handleSubmitMultiPaymentForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (paymentSubmitting) return;
    setPaymentError(null);
    setPaymentSuccess(null);

    let normalizedTx = '';
    try {
      normalizedTx = normalizeAndValidateTransactionId(transactionId);
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : 'Invalid Transaction ID.');
      return;
    }

    if (!screenshotFile) {
      setPaymentError('Please upload your payment screenshot before submitting.');
      return;
    }

    setPaymentSubmitting(true);
    try {
      await onSubmitMultiPayment({
        paymentMethod,
        paymentNumber: activePaymentNumber,
        senderNumber: senderNumber.trim() || undefined,
        transactionId: normalizedTx,
        screenshotFile,
      });
      setTransactionId('');
      setSenderNumber('');
      setScreenshotFile(null);
      if (screenshotPreviewUrl) {
        URL.revokeObjectURL(screenshotPreviewUrl);
        setScreenshotPreviewUrl(null);
      }
      setPaymentSuccess(
        'Payment request submitted (Pending). An admin will verify your Transaction ID & Screenshot shortly.'
      );
    } catch (err) {
      setPaymentError(
        err instanceof Error ? err.message : 'Failed to submit payment verification request.'
      );
    } finally {
      setPaymentSubmitting(false);
    }
  };

  if (isProModalOpen) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Multi (5) PRO Unlock and Payment"
      >
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm" onClick={onCloseProModal} />
        <div className="neon-prism-panel relative z-10 max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl p-6 shadow-2xl sm:rounded-3xl">
          <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-slate-700 sm:hidden" />

          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className={`flex h-11 w-11 items-center justify-center rounded-2xl border ${
                  isMultiActive
                    ? 'border-[#00FF87]/50 bg-[#00FF87]/15 text-[#00FF87]'
                    : 'border-[#B84DFF]/50 bg-[#B84DFF]/15 text-[#C084FC]'
                }`}
              >
                {isMultiActive ? <Sparkles className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-display neon-text-spectrum text-lg font-extrabold">
                    Multi Visit (5)
                  </h3>
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${
                      isMultiActive
                        ? 'border-[#00FF87]/50 bg-[#00FF87]/15 text-[#00FF87]'
                        : 'border-[#FF2E93]/50 bg-[#FF2E93]/15 text-[#FF9AD0]'
                    }`}
                  >
                    {isMultiActive ? 'ACTIVE' : `${MULTI5_PRICE_BDT} BDT`}
                  </span>
                </div>
                <p className="text-xs text-slate-300">
                  {isMultiActive
                    ? 'Verified PRO entitlement active on your account'
                    : pendingRequest
                      ? 'Payment submitted · Awaiting admin approval'
                      : 'Unlock 5-link batch queue · ৫০ টাকা (One-time)'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onCloseProModal}
              aria-label="Close modal"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-400 hover:bg-white/5 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* STATE 1: Multi (5) Already Approved & Active */}
          {isMultiActive && (
            <div className="mt-5 space-y-4">
              <div className="neon-card-green rounded-2xl p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#00FF87]">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>
                    {multiEntitlement
                      ? 'Multi (5) Active on Your Account'
                      : 'Admin Multi (5) PRO Access Active'}
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-200">
                  You can now run up to 5 links simultaneously in the compact bottom auto-visit dock
                  and cycle through every member link automatically.
                </p>
                {multiEntitlement ? (
                  <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/10 pt-3 text-xs">
                    <div>
                      <p className="text-slate-400">Verified TxID</p>
                      <p className="font-mono-num mt-0.5 font-semibold text-white">
                        {multiEntitlement.transactionId}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-400">Activated On</p>
                      <p className="mt-0.5 font-medium text-slate-200">
                        {formatPaymentTime(multiEntitlement.activatedAtMs)}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/10 pt-3 text-xs">
                    <div>
                      <p className="text-slate-400">Access Tier</p>
                      <p className="font-mono-num mt-0.5 font-semibold text-white">Verified Admin</p>
                    </div>
                    <div>
                      <p className="text-slate-400">Concurrent Slots</p>
                      <p className="font-mono-num mt-0.5 font-medium text-slate-200">5 Links</p>
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={onCloseProModal}
                className="neon-btn-primary flex min-h-[48px] w-full items-center justify-center rounded-xl px-4 py-2.5 text-sm font-bold"
              >
                Use Multi (5) in Visit Hub
              </button>
            </div>
          )}

          {/* STATE 2: Pending Payment Verification */}
          {!isMultiActive && pendingRequest && (
            <div className="mt-5 space-y-4">
              <div className="rounded-2xl border border-amber-400/35 bg-amber-950/25 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-200">
                  <Clock className="h-4 w-4 text-amber-300" />
                  <span>Payment Verification Pending</span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-300">
                  আপনার ৫০ টাকা পেমেন্ট রিকোয়েস্ট অ্যাডমিন যাচাইয়ের জন্য Pending অবস্থায় আছে।
                  Approve হওয়ার সাথে সাথে আপনার অ্যাকাউন্টে Multi (5) স্বয়ংক্রিয়ভাবে Active হবে।
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/10 pt-3 text-xs">
                  <div>
                    <p className="text-slate-400">Method & Amount</p>
                    <p className="mt-0.5 font-semibold uppercase text-white">
                      {pendingRequest.paymentMethod} · {pendingRequest.amountBdt} BDT
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-400">Transaction ID</p>
                    <p className="font-mono-num mt-0.5 font-semibold text-cyan-300">
                      {pendingRequest.transactionId}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-400">Sent To</p>
                    <p className="font-mono-num mt-0.5 text-slate-200">
                      {pendingRequest.paymentNumber}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-400">Submitted</p>
                    <p className="mt-0.5 text-slate-200">
                      {formatPaymentTime(pendingRequest.createdAtMs)}
                    </p>
                  </div>
                </div>
                {pendingRequest.screenshotUrl && (
                  <div className="mt-3 border-t border-white/10 pt-3">
                    <p className="mb-1.5 text-[11px] text-slate-400">Submitted Payment Screenshot</p>
                    <img
                      src={pendingRequest.screenshotUrl}
                      alt="Submitted payment screenshot"
                      className="max-h-44 w-full rounded-xl border border-white/10 bg-slate-950 object-contain"
                    />
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={onCloseProModal}
                className="flex min-h-[46px] w-full items-center justify-center rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/10"
              >
                Close & Continue with Single Visit
              </button>
            </div>
          )}

          {/* STATE 3: Payment Instructions + Transaction ID & Screenshot Form */}
          {!isMultiActive && !pendingRequest && (
            <form onSubmit={handleSubmitMultiPaymentForm} className="mt-4 space-y-4">
              {latestPaymentRequest?.status === 'rejected' && (
                <div className="rounded-2xl border border-rose-400/35 bg-rose-950/30 p-3.5 text-xs">
                  <p className="font-semibold text-rose-200">
                    Previous Request Rejected ({latestPaymentRequest.transactionId})
                  </p>
                  <p className="mt-1 text-rose-100/90">
                    {latestPaymentRequest.adminNote ||
                      'Please check your payment details and submit a valid Transaction ID and clear screenshot.'}
                  </p>
                </div>
              )}

              {/* Plan Summary */}
              <div className="neon-card-purple flex items-center justify-between rounded-2xl px-4 py-3">
                <div>
                  <p className="text-xs font-semibold text-[#E8C5FF]">Multi (5) Batch Visit Plan</p>
                  <p className="text-[11px] text-slate-300">
                    Visit 5 smartlinks simultaneously in the compact auto-visit dock
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono-num text-lg font-extrabold text-[#00FF87]">৫০ টাকা</p>
                  <p className="text-[10px] font-semibold text-[#00F5FF]">50 BDT · One-time</p>
                </div>
              </div>

              {/* Payment Method Tabs */}
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-200">
                  1. Select Payment Method
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['bkash', 'nagad'] as const).map((methodKey) => {
                    const ch = PAYMENT_CHANNELS[methodKey];
                    const active = paymentMethod === methodKey;
                    const activeClass =
                      methodKey === 'bkash'
                        ? 'border-[#FF2E93]/65 bg-[#FF2E93]/20 text-white shadow-[0_0_16px_-4px_rgba(255,46,147,0.5)]'
                        : 'border-[#FFB800]/65 bg-[#FFB800]/20 text-white shadow-[0_0_16px_-4px_rgba(255,184,0,0.45)]';
                    return (
                      <button
                        key={methodKey}
                        type="button"
                        onClick={() => {
                          setPaymentMethod(methodKey);
                          setCopiedNumber(false);
                        }}
                        className={`flex min-h-[46px] items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition-all ${
                          active
                            ? activeClass
                            : 'border-white/10 bg-[#070B20]/75 text-slate-400 hover:text-white'
                        }`}
                      >
                        <CreditCard
                          className={`h-4 w-4 ${
                            methodKey === 'bkash' ? 'text-[#FF2E93]' : 'text-[#FFB800]'
                          }`}
                        />
                        <span>{ch.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Personal Payment Number + Send Money Instructions */}
              <div className="rounded-2xl border border-[#00F5FF]/25 bg-[#070B20]/80 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-medium text-slate-400">
                      {selectedChannel.label} · {selectedChannel.accountType} Number
                    </p>
                    <p className="font-mono-num mt-0.5 text-lg font-extrabold tracking-wide text-[#00F5FF]">
                      {activePaymentNumber}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyNumber}
                    className="flex min-h-[38px] items-center gap-1.5 rounded-xl border border-[#00F5FF]/45 bg-[#00F5FF]/15 px-3 py-1.5 text-xs font-semibold text-[#00F5FF] hover:bg-[#00F5FF]/25"
                  >
                    {copiedNumber ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-[#00FF87]" />
                        <span className="text-[#00FF87]">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span>Copy Number</span>
                      </>
                    )}
                  </button>
                </div>

                <ul className="space-y-1.5 border-t border-white/10 pt-2.5 text-xs text-slate-300">
                  {selectedChannel.instructions.map((step, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="font-mono-num mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-bold text-cyan-300">
                        {idx + 1}
                      </span>
                      <span className="leading-relaxed">{step}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Sender Number (Optional) & Transaction ID */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-200">
                    Sender Number <span className="font-normal text-slate-400">(Optional)</span>
                  </label>
                  <input
                    type="tel"
                    maxLength={24}
                    value={senderNumber}
                    onChange={(e) => setSenderNumber(e.target.value)}
                    placeholder="01XXXXXXXXX"
                    className="min-h-[44px] w-full rounded-xl border border-white/15 bg-slate-950/75 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-200">
                    Transaction ID (TrxID) <span className="text-rose-300">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    minLength={6}
                    maxLength={40}
                    value={transactionId}
                    onChange={(e) => setTransactionId(e.target.value.toUpperCase())}
                    placeholder="e.g. BKA8X92M1Q"
                    className="font-mono-num min-h-[44px] w-full rounded-xl border border-white/15 bg-slate-950/75 px-3 py-2 text-xs uppercase text-white placeholder:normal-case placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
                  />
                </div>
              </div>

              {/* Payment Screenshot Upload */}
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-200">
                  Payment Screenshot <span className="text-rose-300">*</span>
                </label>
                <input
                  ref={screenshotInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                  onChange={handleScreenshotSelected}
                  className="hidden"
                />

                {screenshotPreviewUrl ? (
                  <div className="rounded-2xl border border-cyan-400/30 bg-slate-950/70 p-3 space-y-2.5">
                    <img
                      src={screenshotPreviewUrl}
                      alt="Selected payment screenshot preview"
                      className="max-h-44 w-full rounded-xl object-contain"
                    />
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate text-slate-300">{screenshotFile?.name}</span>
                      <button
                        type="button"
                        onClick={() => screenshotInputRef.current?.click()}
                        className="shrink-0 font-semibold text-cyan-300 hover:underline"
                      >
                        Change Image
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => screenshotInputRef.current?.click()}
                    className="flex min-h-[88px] w-full flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-white/20 bg-slate-950/50 px-4 py-4 text-xs text-slate-300 transition-colors hover:border-cyan-400/45 hover:bg-slate-900/70"
                  >
                    <ImagePlus className="h-5 w-5 text-cyan-300" />
                    <span className="font-semibold text-white">Upload Payment Screenshot</span>
                    <span className="text-[11px] text-slate-400">
                      JPG, PNG or WebP · Max 5MB (auto-compressed securely)
                    </span>
                  </button>
                )}
              </div>

              {paymentError && (
                <div
                  role="alert"
                  className="rounded-xl border border-rose-400/35 bg-rose-950/35 px-3.5 py-2.5 text-xs text-rose-200"
                >
                  {paymentError}
                </div>
              )}

              {paymentSuccess && (
                <div
                  role="status"
                  className="rounded-xl border border-cyan-400/35 bg-cyan-950/35 px-3.5 py-2.5 text-xs text-cyan-200"
                >
                  {paymentSuccess}
                </div>
              )}

              <div className="flex items-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={onCloseProModal}
                  className="flex min-h-[46px] flex-1 items-center justify-center rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={paymentSubmitting}
                  className="neon-btn-primary flex min-h-[46px] flex-[1.8] items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold disabled:opacity-60"
                >
                  <Upload className="h-4 w-4" />
                  <span>
                    {paymentSubmitting ? 'Submitting Proof...' : 'Submit Payment (50 BDT)'}
                  </span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    );
  }

  if (!reportTarget) return null;

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    setReportFeedback(null);
    setReportSubmitting(true);
    try {
      await onReportLink(reportTarget, reportReason);
      setReportFeedback({
        type: 'success',
        message: 'Report submitted to moderators.',
      });
      setReportReason('');
    } catch (err) {
      setReportFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to submit report.',
      });
    } finally {
      setReportSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Report ${reportTarget.title}`}
    >
      <div className="fixed inset-0 bg-black/75 backdrop-blur-sm" onClick={onCloseReport} />
      <div className="neon-prism-panel relative z-10 w-full max-w-md rounded-t-3xl p-6 shadow-2xl sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display flex items-center gap-2 text-base font-bold text-white">
              <ShieldAlert className="h-4 w-4 text-[#FF2E93]" />
              <span>Report Link</span>
            </h3>
            <p className="mt-0.5 truncate text-xs text-slate-400">{reportTarget.title}</p>
          </div>
          <button
            type="button"
            onClick={onCloseReport}
            aria-label="Close report dialog"
            className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl text-slate-400 hover:bg-white/5 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {reportFeedback && (
          <div
            role="status"
            className={`mt-3 rounded-xl border px-3.5 py-2.5 text-xs ${
              reportFeedback.type === 'success'
                ? 'border-cyan-400/30 bg-cyan-950/30 text-cyan-200'
                : 'border-rose-400/30 bg-rose-950/30 text-rose-200'
            }`}
          >
            {reportFeedback.message}
          </div>
        )}

        <form onSubmit={handleSubmitReport} className="mt-4 space-y-3">
          <textarea
            required
            minLength={5}
            maxLength={240}
            rows={3}
            value={reportReason}
            onChange={(e) => setReportReason(e.target.value)}
            placeholder="Describe why this link is broken or unsafe..."
            className="w-full rounded-xl border border-white/15 bg-slate-950/70 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-rose-400 focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCloseReport}
              className="min-h-[42px] flex-1 rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10"
            >
              Close
            </button>
            <button
              type="submit"
              disabled={reportSubmitting}
              className="min-h-[42px] flex-[1.5] rounded-xl border border-rose-400/35 bg-rose-500/20 px-4 py-2 text-xs font-semibold text-rose-100 hover:bg-rose-500/30 disabled:opacity-50"
            >
              {reportSubmitting ? 'Submitting...' : 'Submit Report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
