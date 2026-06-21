// Server-rendered shell. Wraps the client form in <Suspense> so that
// useSearchParams() (used inside the form) doesn't trip the static-prerender
// bailout.

import { Suspense } from 'react';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
