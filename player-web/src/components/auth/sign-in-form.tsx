'use client';

import { Form } from '@base-ui/react/form';
import { ArrowRight, LockKeyhole, Mail } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/src/auth/auth-context';
import { withDeadline } from '@/src/auth/deadline';
import { buildIntentReturnPath, isPlayerIntent, safeReturnPath } from '@/src/auth/intent';
import { Button } from '@/src/components/ui/button';
import { TextField } from '@/src/components/ui/fields';

export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, error: authError, signIn, resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const returnTo = safeReturnPath(searchParams.get('returnTo'));
  const intentValue = searchParams.get('intent');
  const intent = isPlayerIntent(intentValue) ? intentValue : undefined;

  useEffect(() => {
    if (user) router.replace(buildIntentReturnPath(returnTo, intent));
  }, [intent, returnTo, router, user]);

  const submit = async () => {
    setBusy(true); setMessage('');
    try {
      await withDeadline(signIn(email, password), 'Orbit sign-in took too long. Check your connection and try again.');
      router.replace(buildIntentReturnPath(returnTo, intent));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Orbit sign-in could not be completed.');
    } finally { setBusy(false); }
  };

  const reset = async () => {
    setBusy(true); setMessage('');
    try { setMessage(await withDeadline(resetPassword(email), 'Password reset took too long. Check your connection and try again.')); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Password reset could not be started.'); }
    finally { setBusy(false); }
  };

  return (
    <Form aria-busy={busy} className="auth-form" onFormSubmit={() => void submit()}>
      <div className="auth-form__intro"><span className="auth-icon"><LockKeyhole aria-hidden="true" /></span><p className="eyebrow">Orbit account</p><h1>Sign in</h1></div>
      <div className="auth-form__fields">
        <TextField id="sign-in-email" label="Email address" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        <TextField id="sign-in-password" label="Password or passphrase" type="password" autoComplete="current-password" minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} hint="At least 12 characters" required />
        {message || (!busy && authError) ? <p className="form-message" role="alert">{message || authError}</p> : null}
        <Button type="submit" disabled={busy}><Mail aria-hidden="true" size={18} />{busy ? 'Connecting…' : 'Sign in or create account'}<ArrowRight aria-hidden="true" size={18} /></Button>
        <Button type="button" tone="quiet" disabled={busy || !email} onClick={() => void reset()}>Send password reset</Button>
      </div>
      <p className="auth-form__privacy">The landing page remains public. A verified account is required to browse games, clubs, tournaments, or use My Orbit.</p>
    </Form>
  );
}
