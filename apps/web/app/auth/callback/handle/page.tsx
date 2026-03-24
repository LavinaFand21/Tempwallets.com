'use client';

import { useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { trackAuth, identifyUser } from '@/lib/tempwallets-analytics';

function AuthCallbackHandleContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const token = searchParams.get('token');
    const user = searchParams.get('user');
    const returnUrl = searchParams.get('returnUrl');

    if (token && user) {
      try {
        // Parse user data
        const userData = typeof user === 'string' ? JSON.parse(decodeURIComponent(user)) : user;

        // Store auth data
        localStorage.setItem('auth_token', token);
        localStorage.setItem('auth_user', decodeURIComponent(user));

        // Track successful login
        trackAuth.signinSuccess(userData.id, 'google');

        // Identify user in Mixpanel (handles anonymous → authenticated transition)
        // Note: aliasUser() is deprecated in Simplified ID Merge — identify() does everything
        identifyUser(userData.id, {
          email: userData.email,
          name: userData.name,
          picture: userData.picture,
        });

        // Get return URL from query param, sessionStorage, or default to dashboard
        const finalReturnUrl = returnUrl || sessionStorage.getItem('auth_return_url') || '/dashboard';
        sessionStorage.removeItem('auth_return_url');

        // Redirect to the return URL or dashboard
        router.push(finalReturnUrl);
      } catch (e) {
        console.error('Failed to process auth callback:', e);
        router.push('/dashboard?error=auth_failed');
      }
    } else {
      router.push('/dashboard?error=auth_failed');
    }
  }, [searchParams, router]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-black">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
        <p className="text-white">Completing authentication...</p>
      </div>
    </div>
  );
}

export default function AuthCallbackHandlePage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen bg-black">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
            <p className="text-white">Loading...</p>
          </div>
        </div>
      }
    >
      <AuthCallbackHandleContent />
    </Suspense>
  );
}

