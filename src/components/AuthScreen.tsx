import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  ShieldCheck,
  User as UserIcon,
} from 'lucide-react';
import { FIREBASE_PROJECT_ID } from '../firebase';
import {
  MappedAuthError,
  mapFirebaseAuthError,
  requestPasswordReset,
  signInWithEmail,
  signInWithGooglePopup,
  signUpWithEmail,
} from '../services/authService';

type AuthMode = 'login' | 'signup' | 'forgot';

export const AuthScreen: React.FC = () => {
  const [mode, setMode] = useState<AuthMode>('login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [authError, setAuthError] = useState<MappedAuthError | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setAuthError(null);
    setInfoMessage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setInfoMessage(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setAuthError({ message: 'Please enter a valid email address.' });
      return;
    }

    if (mode === 'forgot') {
      setIsSubmitting(true);
      try {
        await requestPasswordReset(trimmedEmail);
        setInfoMessage(
          `Password reset link sent to ${trimmedEmail}. Check your inbox and spam folder.`
        );
      } catch (err) {
        setAuthError(mapFirebaseAuthError(err));
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (password.length < 6) {
      setAuthError({ message: 'Password must be at least 6 characters long.' });
      return;
    }

    if (mode === 'signup') {
      if (displayName.trim().length < 2) {
        setAuthError({ message: 'Display name must be at least 2 characters.' });
        return;
      }
      if (password !== confirmPassword) {
        setAuthError({ message: 'Passwords do not match. Please re-enter carefully.' });
        return;
      }
    }

    setIsSubmitting(true);
    try {
      if (mode === 'signup') {
        await signUpWithEmail(displayName, trimmedEmail, password);
      } else {
        await signInWithEmail(trimmedEmail, password);
      }
    } catch (err) {
      setAuthError(mapFirebaseAuthError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    setInfoMessage(null);
    setIsSubmitting(true);
    try {
      await signInWithGooglePopup();
    } catch (err) {
      setAuthError(mapFirebaseAuthError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col justify-center overflow-x-clip bg-[#040713] px-4 py-10 text-slate-100 sm:px-6">
      {/* Full-Spectrum Neon Ambient Lighting & Grid */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="neon-grid-bg absolute inset-0 opacity-75" />
        <div className="absolute -top-32 -left-24 h-96 w-96 rounded-full bg-[#3B82F6]/25 blur-[130px]" />
        <div className="absolute top-1/4 -right-24 h-96 w-96 rounded-full bg-[#B84DFF]/25 blur-[135px]" />
        <div className="absolute -bottom-24 left-1/4 h-80 w-80 rounded-full bg-[#00FF87]/18 blur-[125px]" />
        <div className="absolute bottom-12 right-1/4 h-72 w-72 rounded-full bg-[#FF2E93]/18 blur-[125px]" />
        <div className="absolute top-1/2 left-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#00F5FF]/14 blur-[110px]" />
      </div>

      <div className="relative z-10 mx-auto grid w-full max-w-5xl grid-cols-1 items-center gap-8 lg:grid-cols-12">
        {/* Left Brand Intro */}
        <div className="space-y-5 text-center lg:col-span-6 lg:text-left">
          <div className="inline-flex items-center gap-3.5">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#00F5FF] via-[#B84DFF] to-[#FF2E93] text-xl font-extrabold text-white shadow-[0_0_24px_rgba(0,245,255,0.55),0_0_28px_rgba(255,46,147,0.4)]">
              ∞
            </span>
            <div className="text-left">
              <p className="font-display neon-text-spectrum text-xl font-extrabold tracking-tight">
                INFINITY REWARDS
              </p>
              <p className="text-xs font-medium text-[#00FF87]">Infinity Studio</p>
            </div>
          </div>

          <h1 className="font-display text-3xl font-bold tracking-tight text-white text-balance sm:text-4xl">
            Protected Creator &amp; Rewards Workspace
          </h1>

          <p className="mx-auto max-w-md text-sm leading-relaxed text-slate-300 lg:mx-0">
            Sign in or create a verified account to access your INFINITY REWARDS dashboard, follow
            creators, and track your account activity securely.
          </p>

          <div className="neon-card-cyan mx-auto max-w-md rounded-2xl p-4 text-left text-xs text-slate-200 lg:mx-0">
            <div className="flex items-center gap-2 font-semibold text-[#00F5FF]">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              <span>Firebase Authentication Active</span>
            </div>
            <p className="mt-1.5 leading-relaxed text-slate-300">
              Protected routes require a verified session. Email signups automatically trigger a
              real Firebase verification email before unlocking dashboard access.
            </p>
          </div>
        </div>

        {/* Right Auth Card */}
        <div className="lg:col-span-6">
          <div className="neon-prism-panel mx-auto w-full max-w-md rounded-3xl p-6 shadow-2xl sm:p-8">
            {/* Mode Switcher Tabs (Login / Sign Up) */}
            {mode !== 'forgot' ? (
              <div
                role="tablist"
                aria-label="Authentication mode"
                className="grid grid-cols-2 gap-1.5 rounded-2xl border border-[#B84DFF]/25 bg-[#050817]/80 p-1.5"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'login'}
                  onClick={() => switchMode('login')}
                  className={`min-h-[44px] rounded-xl text-sm font-semibold transition-all whitespace-nowrap ${
                    mode === 'login'
                      ? 'border border-[#00F5FF]/55 bg-gradient-to-r from-[#00F5FF]/25 via-[#3B82F6]/25 to-[#B84DFF]/25 text-white shadow-[0_0_16px_-4px_rgba(0,245,255,0.45)]'
                      : 'border border-transparent text-slate-400 hover:text-white'
                  }`}
                >
                  Log In
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'signup'}
                  onClick={() => switchMode('signup')}
                  className={`min-h-[44px] rounded-xl text-sm font-semibold transition-all whitespace-nowrap ${
                    mode === 'signup'
                      ? 'border border-[#FF2E93]/55 bg-gradient-to-r from-[#B84DFF]/25 to-[#FF2E93]/25 text-white shadow-[0_0_16px_-4px_rgba(255,46,147,0.45)]'
                      : 'border border-transparent text-slate-400 hover:text-white'
                  }`}
                >
                  Sign Up
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-5 w-5 text-[#00F5FF]" />
                  <h2 className="font-display text-lg font-bold text-white">Reset Password</h2>
                </div>
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="text-xs font-semibold text-[#00F5FF] hover:text-[#00FF87]"
                >
                  Back to Login
                </button>
              </div>
            )}

            {/* Error Alert */}
            {authError && (
              <div
                role="alert"
                className="mt-4 rounded-2xl border border-rose-400/35 bg-rose-950/35 p-3.5 text-xs text-rose-200"
              >
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
                  <div className="space-y-1.5">
                    <p className="font-medium leading-relaxed">{authError.message}</p>
                    {authError.isProviderDisabled && (
                      <p className="text-[11px] leading-relaxed text-rose-200/80">
                        Project ID: <span className="font-mono-num">{FIREBASE_PROJECT_ID}</span> — Go
                        to Firebase Console &rarr; Authentication &rarr; Sign-in method &rarr; Enable{' '}
                        <strong>Email/Password</strong>.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Success Info Alert */}
            {infoMessage && (
              <div
                role="status"
                className="mt-4 flex items-start gap-2.5 rounded-2xl border border-cyan-400/35 bg-cyan-950/35 p-3.5 text-xs text-cyan-100"
              >
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
                <p className="leading-relaxed">{infoMessage}</p>
              </div>
            )}

            {/* Auth Form */}
            <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
              {mode === 'signup' && (
                <div>
                  <label htmlFor="auth-name" className="block text-xs font-medium text-slate-300">
                    Full Name
                  </label>
                  <div className="relative mt-1.5">
                    <UserIcon className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      id="auth-name"
                      type="text"
                      autoComplete="name"
                      required
                      maxLength={50}
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Your display name"
                      className="min-h-[46px] w-full rounded-xl border border-white/15 bg-[#050817]/85 py-2.5 pr-4 pl-10 text-sm text-white placeholder:text-slate-500 focus:border-[#00F5FF] focus:outline-none"
                    />
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="auth-email" className="block text-xs font-medium text-slate-300">
                  Email Address
                </label>
                <div className="relative mt-1.5">
                  <Mail className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-[#00F5FF]/70" />
                  <input
                    id="auth-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="min-h-[46px] w-full rounded-xl border border-white/15 bg-[#050817]/85 py-2.5 pr-4 pl-10 text-sm text-white placeholder:text-slate-500 focus:border-[#00F5FF] focus:outline-none"
                  />
                </div>
              </div>

              {mode !== 'forgot' && (
                <div>
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="auth-password"
                      className="block text-xs font-medium text-slate-300"
                    >
                      Password
                    </label>
                    {mode === 'login' && (
                      <button
                        type="button"
                        onClick={() => switchMode('forgot')}
                        className="text-xs font-medium text-[#C084FC] hover:text-[#00F5FF]"
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <div className="relative mt-1.5">
                    <Lock className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-[#C084FC]/70" />
                    <input
                      id="auth-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Minimum 6 characters"
                      className="min-h-[46px] w-full rounded-xl border border-white/15 bg-[#050817]/85 py-2.5 pr-11 pl-10 text-sm text-white placeholder:text-slate-500 focus:border-[#B84DFF] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute top-1/2 right-1.5 flex min-h-[36px] min-w-[36px] -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 hover:text-white"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              )}

              {mode === 'signup' && (
                <div>
                  <label
                    htmlFor="auth-confirm-password"
                    className="block text-xs font-medium text-slate-300"
                  >
                    Confirm Password
                  </label>
                  <div className="relative mt-1.5">
                    <Lock className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-[#FF2E93]/70" />
                    <input
                      id="auth-confirm-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter password"
                      className="min-h-[46px] w-full rounded-xl border border-white/15 bg-[#050817]/85 py-2.5 pr-4 pl-10 text-sm text-white placeholder:text-slate-500 focus:border-[#FF2E93] focus:outline-none"
                    />
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="neon-btn-primary flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold disabled:opacity-60"
              >
                <span>
                  {isSubmitting
                    ? 'Please wait...'
                    : mode === 'login'
                      ? 'Log In'
                      : mode === 'signup'
                        ? 'Create Account'
                        : 'Send Reset Link'}
                </span>
                {!isSubmitting && <ArrowRight className="h-4 w-4" />}
              </button>
            </form>

            {/* Google Sign-In Divider */}
            {mode !== 'forgot' && (
              <>
                <div className="my-5 flex items-center gap-3">
                  <div className="neon-hairline flex-1" />
                  <span className="text-xs text-slate-400">or</span>
                  <div className="neon-hairline flex-1" />
                </div>

                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleGoogleSignIn}
                  className="flex min-h-[46px] w-full items-center justify-center gap-2.5 rounded-2xl border border-[#00F5FF]/30 bg-[#080E27]/85 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:border-[#00FF87]/55 hover:shadow-[0_0_20px_-6px_rgba(0,245,255,0.45)] disabled:opacity-60"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="#EA4335"
                      d="M12 10.2v3.9h5.5c-.2 1.3-1.5 3.9-5.5 3.9-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.5 14.6 2.5 12 2.5 6.8 2.5 2.5 6.8 2.5 12s4.3 9.5 9.5 9.5c5.5 0 9.1-3.8 9.1-9.2 0-.6-.1-1.1-.2-1.6H12z"
                    />
                  </svg>
                  <span>Continue with Google</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
