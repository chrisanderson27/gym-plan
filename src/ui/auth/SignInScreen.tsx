import type { TargetedSubmitEvent } from 'preact';
import { useState } from 'preact/hooks';
import { auth, type AuthErrorKind, type AuthNotice, type AuthResult } from '../../sync/auth';
import { ArrowRightIcon, ChevronIcon } from '../icons';
import { navigate } from '../router';
import googleG from './google-g.svg';
import { useAuth } from './useAuth';

type Mode = 'log-in' | 'create' | 'forgot' | 'check-signup' | 'check-reset' | 'set-password';
type Busy = 'google' | 'primary' | 'resend';
type FieldError = { field: 'name' | 'email' | 'password'; message: string };

const errors: Record<AuthErrorKind, string> = {
  'invalid-credentials': 'That email and password don’t match.',
  'not-confirmed': 'Confirm your email first — check your inbox for the link.',
  exists: 'You already have an account with this email. Log in instead.',
  offline: 'You’re offline — sign in when you have signal, or continue as guest',
  'rate-limited': 'Too many tries. Wait a minute, then try again.',
  'weak-password': 'Use at least 8 characters.',
  unknown: 'Something went wrong. Try again.',
};

const notices: Record<NonNullable<AuthNotice>, string> = {
  'google-failed': 'Google sign-in didn’t finish. Try again, or use email.',
  'link-expired': 'That link has expired. Ask for a new one below.',
  'confirmed-elsewhere': 'Your email is confirmed. Log in to continue.',
};

const tabs = { 'log-in': 'Log in', create: 'Create account' } as const;
type Tab = keyof typeof tabs;
const spinner = <span class="auth-spinner" aria-hidden="true" />;

export function SignInScreen({ route, initialMode = 'log-in' }: { route: string; initialMode?: Mode }) {
  const { recovery, notice } = useAuth();
  const [view, setView] = useState<Mode>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [error, setError] = useState<AuthErrorKind | null>(null);
  const [fieldError, setFieldError] = useState<FieldError | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showNotice, setShowNotice] = useState(true);
  const mode = recovery ? 'set-password' : view;
  const create = mode === 'create';
  const logIn = mode === 'log-in';
  const hasTabs = create || logIn;
  const setPasswordMode = mode === 'set-password';
  const checkEmail = mode === 'check-signup' || mode === 'check-reset';
  const disabled = busy !== null;

  function clearFeedback() {
    setError(null);
    setFieldError(null);
    setInfo(null);
    setShowNotice(false);
  }

  function switchMode(next: Mode) {
    clearFeedback();
    setView(next);
    setPassword('');
    setShow(false);
  }

  async function request(button: Busy, action: () => Promise<AuthResult>, onSuccess?: () => void) {
    if (busy) return;
    clearFeedback();
    setBusy(button);
    try {
      const result = await action();
      if (result.ok) onSuccess?.();
      else {
        if (result.error === 'exists') switchMode('log-in');
        setError(result.error);
      }
    } finally {
      setBusy(null);
    }
  }

  function submit(event: TargetedSubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    clearFeedback();
    const fields = event.currentTarget.elements;
    const address = email.trim();
    let invalid: FieldError | undefined;
    if (create && !name.trim()) invalid = { field: 'name', message: 'Enter your name.' };
    else if (!setPasswordMode && (!address || (fields.namedItem('email') as HTMLInputElement).validity.typeMismatch)) {
      invalid = { field: 'email', message: address ? 'Enter a valid email address.' : 'Enter your email address.' };
    } else if (logIn && !password) invalid = { field: 'password', message: 'Enter your password.' };

    if (invalid) {
      setFieldError(invalid);
      (fields.namedItem(invalid.field) as HTMLInputElement).focus();
      return;
    }

    switch (mode) {
      case 'log-in':
        void request('primary', () => auth.signIn({ email: address, password }));
        break;
      case 'create':
        void request('primary', () => auth.signUp({ name, email: address, password }), () => switchMode('check-signup'));
        break;
      case 'forgot':
        void request('primary', () => auth.resetPassword(address), () => switchMode('check-reset'));
        break;
      case 'set-password':
        void request('primary', () => auth.updatePassword(password), () => navigate('/'));
        break;
    }
  }

  function resend() {
    const address = email.trim();
    void request('resend', () => mode === 'check-reset' ? auth.resetPassword(address) : auth.resend(address), () => {
      if (logIn) setError('not-confirmed');
      setInfo('Email sent. Check your inbox for the link.');
    });
  }

  function guest() {
    auth.chooseGuest();
    if (route === '/sign-in') navigate('/');
  }

  function fieldFeedback(field: FieldError['field']) {
    return fieldError?.field === field ? { 'aria-invalid': true, 'aria-describedby': 'auth-field-error' } : {};
  }

  const primary = hasTabs ? tabs[mode as Tab] : setPasswordMode ? 'Save and continue' : 'Send reset link';

  return (
    <main class="shell-screen auth">
      <header class="auth-top">
        <div class="pref-brand">
          <span class="pref-mark" aria-hidden="true"><svg width="16" height="19" viewBox="0 0 16 19" focusable="false"><path fill="currentColor" d="M9 0 0 11.4H7L6 19 16 7.6H9Z" /></svg></span>
          <p class="wordmark">Gym Plan.</p>
        </div>
        {!recovery && <button type="button" class="auth-link" disabled={disabled} onClick={guest}>Explore the app<ArrowRightIcon /></button>}
      </header>
      <p class="pref-eyebrow">
        <svg class="pref-dot" width="6" height="6" viewBox="0 0 6 6" aria-hidden="true" focusable="false"><circle cx="3" cy="3" r="3" fill="currentColor" /></svg>
        {create ? 'Your first step starts here' : 'Good to have you here'}
      </p>
      <h1>{create ? 'Find your rhythm.' : 'Welcome back.'}</h1>
      <p class="pref-lead">{create ? 'A plan for your week. A class that’s yours.' : 'Your next good session starts here.'}</p>

      {hasTabs && (
        <div class="auth-seg" role="tablist" aria-label="Account options">
          {(['log-in', 'create'] as const).map((tab) => (
            <button type="button" role="tab" id={`auth-tab-${tab}`} aria-controls="auth-panel" aria-selected={mode === tab}
              tabIndex={mode === tab ? 0 : -1} disabled={disabled} key={tab} onClick={() => switchMode(tab)}
              onKeyDown={(event) => {
                let next: Tab;
                if (event.key === 'Home') next = 'log-in';
                else if (event.key === 'End') next = 'create';
                else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') next = tab === 'create' ? 'log-in' : 'create';
                else return;
                event.preventDefault();
                switchMode(next);
                document.getElementById(`auth-tab-${next}`)?.focus();
              }}>
              {tabs[tab]}
            </button>
          ))}
        </div>
      )}

      <div id="auth-panel" role={hasTabs ? 'tabpanel' : undefined} aria-labelledby={hasTabs ? `auth-tab-${mode}` : undefined}>
        {hasTabs && <>
          <button type="button" class="auth-google" disabled={disabled} aria-busy={busy === 'google'}
            onClick={() => void request('google', auth.signInWithGoogle)}>
            {busy === 'google' ? spinner : <img src={googleG} alt="" width="20" height="20" />}Continue with Google
          </button>
          <p class="auth-rule">or use email</p>
        </>}

        {checkEmail ? (
          <section class="auth-check">
            <h2>Check your email</h2>
            <p>We sent a link to <b>{email.trim()}</b>.</p>
            <button type="button" class="auth-link" disabled={disabled} aria-busy={busy === 'resend'} onClick={resend}>
              Resend{busy === 'resend' && spinner}
            </button>
            <button type="button" class="auth-link" disabled={disabled} onClick={() => switchMode('log-in')}>Back to log in</button>
          </section>
        ) : (
          <form noValidate onSubmit={submit}>
            {create && <label class="auth-field">Your name
              <input name="name" autocomplete="name" placeholder="Alex Morgan" required
                value={name} onInput={(event) => setName(event.currentTarget.value)} disabled={disabled} {...fieldFeedback('name')} />
            </label>}
            {!setPasswordMode && <label class="auth-field">Email address
              <input name="email" type="email" autocomplete="email" placeholder="alex@example.com" required
                value={email} onInput={(event) => setEmail(event.currentTarget.value)} disabled={disabled} {...fieldFeedback('email')} />
            </label>}
            {mode !== 'forgot' && (
              <div class="auth-field">
                <div class="auth-label-row">
                  <label for="auth-password">{setPasswordMode ? 'New password' : 'Password'}</label>
                  {logIn && <button type="button" class="auth-link" disabled={disabled} onClick={() => switchMode('forgot')}>Forgot password?</button>}
                </div>
                <div class="auth-pass">
                  <input id="auth-password" name="password" type={show ? 'text' : 'password'}
                    autocomplete={logIn ? 'current-password' : 'new-password'}
                    placeholder={logIn ? 'Your password' : 'At least 8 characters'} minLength={logIn ? undefined : 8} required
                    value={password} onInput={(event) => setPassword(event.currentTarget.value)} disabled={disabled}
                    {...fieldFeedback('password')} />
                  <button type="button" class="auth-link" aria-pressed={show} aria-label="Show password"
                    disabled={disabled} onClick={() => setShow(!show)}>Show</button>
                </div>
              </div>
            )}
            <button type="submit" class="auth-primary" disabled={disabled} aria-busy={busy === 'primary'}>
              {primary}{busy === 'primary' ? spinner : <ArrowRightIcon />}
            </button>
          </form>
        )}

        {fieldError && <p id="auth-field-error" class="auth-error" role="alert">{fieldError.message}</p>}
        {error && <p class="auth-error" role="alert" data-testid="auth-error">{errors[error]}</p>}
        {logIn && (error === 'not-confirmed' || busy === 'resend') && (
          <button type="button" class="auth-link" disabled={disabled} aria-busy={busy === 'resend'} onClick={resend}>
            Resend email{busy === 'resend' && spinner}
          </button>
        )}
        {info && <p class="auth-info" role="status">{info}</p>}
        {showNotice && notice && !error && <p class="auth-info" role="status">{notices[notice]}</p>}
        {mode === 'forgot' && <button type="button" class="auth-link" disabled={disabled} onClick={() => switchMode('log-in')}>Back to log in</button>}
      </div>

      {!recovery && <>
        <p class="auth-rule auth-rule-guest">Just looking around?</p>
        <button type="button" class="auth-guest" disabled={disabled} onClick={guest}>Continue as guest<ChevronIcon /></button>
      </>}
      <footer class="auth-foot"><span>Show up. We’ll take it from here.</span><span>Gym Plan / 01</span></footer>
    </main>
  );
}
