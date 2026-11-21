import React, { useEffect, useState } from 'react';
import { User } from 'firebase/auth';
import { AlertCircle, CheckCircle2, LogOut, MailCheck, RefreshCw, Send } from 'lucide-react';
import {
  logoutUser,
  mapFirebaseAuthError,
  refreshAuthUser,
  resendVerificationEmail,
} from '../services/authService';

interface VerifyEmailScreenProps {
  user: User;
  onVerified: (refreshedUser: User) => void;
}

export const VerifyEmailScreen: React.FC<VerifyEmailScreenProps> = ({ user, onVerified }) => {
  const [isChecking, setIsChecking] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [cooldownSec, setCooldownSec] = useState(0);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (cooldownSec <= 0) return;
    const timer = window.setInterval(() => {
      setCooldownSec((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownSec]);

  const handleCheckVerification = async () => {
    setErrorMsg(null);
    setStatusMsg(null);
    setIsChecking(true);
    try {
      const updated = await refreshAuthUser(user);
      if (updated.emailVerified) {
        onVerified(updated);
      } else {
        setErrorMsg(
          'Your email is not verified yet. Please click the verification link in your inbox, then tap check again.'
        );
      }
    } catch (err) {
      setErrorMsg(mapFirebaseAuthError(err).message);
    } finally {
      setIsChecking(false);
    }
  };

  const handleResend = async () => {
    if (cooldownSec > 0) return;
    setErrorMsg(null);
    setStatusMsg(null);
    setIsResending(true);
    try {
      await resendVerificationEmail(user);
      setCooldownSec(60);
      setStatusMsg(`Verification link re-sent to ${user.email}. Check inbox & spam.`);
    } catch (err) {
      setErrorMsg(mapFirebaseAuthError(err).message);
    } finally {
      setIsResending(false);
    }
  };

  const handleLogout = async () => {
    await logoutUser();
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[#040713] px-4 py-10 text-slate-100">
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="neon-grid-bg absolute inset-0 opacity-75" />
        <div className="absolute -top-32 -left-24 h-96 w-96 rounded-full bg-[#00F5FF]/20 blur-[130px]" />
        <div className="absolute top-1/3 right-0 h-96 w-96 rounded-full bg-[#B84DFF]/22 blur-[130px]" />
        <div className="absolute -bottom-24 left-1/3 h-80 w-80 rounded-full bg-[#00FF87]/15 blur-[125px]" />
        <div className="absolute bottom-16 right-1/4 h-72 w-72 rounded-full bg-[#FF2E93]/18 blur-[125px]" />
      </div>

      <div className="neon-prism-panel relative z-10 w-full max-w-md rounded-3xl p-6 shadow-2xl sm:p-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#00F5FF]/45 bg-[#00F5FF]/15 text-[#00F5FF] shadow-[0_0_20px_-4px_rgba(0,245,255,0.5)]">
          <MailCheck className="h-6 w-6" />
        </div>

        <h1 className="font-display neon-text-spectrum mt-4 text-2xl font-extrabold">
          Verify Your Email
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          Dashboard access is protected until your email address is verified. We sent a verification
          link to{' '}
          <span className="font-semibold text-[#00F5FF]">{user.email ?? 'your email'}</span>.
        </p>

        {errorMsg && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2.5 rounded-2xl border border-[#FF4D6D]/45 bg-[#FF2E93]/10 p-3.5 text-xs text-rose-200"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#FF4D6D]" />
            <p className="leading-relaxed">{errorMsg}</p>
          </div>
        )}

        {statusMsg && (
          <div
            role="status"
            className="mt-4 flex items-start gap-2.5 rounded-2xl border border-[#00FF87]/45 bg-[#00FF87]/10 p-3.5 text-xs text-emerald-100"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#00FF87]" />
            <p className="leading-relaxed">{statusMsg}</p>
          </div>
        )}

        <div className="mt-6 space-y-3">
          <button
            type="button"
            disabled={isChecking}
            onClick={handleCheckVerification}
            className="neon-btn-primary flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${isChecking ? 'animate-spin' : ''}`} />
            <span>{isChecking ? 'Checking...' : "I've Verified — Continue"}</span>
          </button>

          <button
            type="button"
            disabled={isResending || cooldownSec > 0}
            onClick={handleResend}
            className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-2xl border border-[#00F5FF]/35 bg-[#071029]/80 px-4 py-2.5 text-xs font-semibold text-[#00F5FF] transition-all hover:border-[#00FF87]/55 hover:text-[#00FF87] disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            <span>
              {cooldownSec > 0
                ? `Resend available in ${cooldownSec}s`
                : isResending
                  ? 'Sending...'
                  : 'Resend Verification Email'}
            </span>
          </button>

          <button
            type="button"
            onClick={handleLogout}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl border border-[#FF2E93]/30 bg-[#FF2E93]/10 px-4 py-2 text-xs font-semibold text-[#FF9AD0] transition-colors hover:bg-[#FF2E93]/20"
          >
            <LogOut className="h-4 w-4" />
            <span>Sign Out / Use Different Email</span>
          </button>
        </div>
      </div>
    </div>
  );
};
