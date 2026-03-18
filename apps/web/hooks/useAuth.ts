'use client';

import { useState, useEffect, useCallback } from 'react';
import { useBrowserFingerprint } from './useBrowserFingerprint';
import { trackAuth, identifyUser, resetMixpanel } from '@/lib/tempwallets-analytics';
import { walletStorage } from '@/lib/walletStorage';

export interface User {
  id: string;
  email: string | null;
  name: string | null;
  picture: string | null;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { fingerprint } = useBrowserFingerprint();

  useEffect(() => {
    // Load from localStorage on mount
    const storedToken = localStorage.getItem('auth_token');
    const storedUser = localStorage.getItem('auth_user');

    if (storedToken && storedUser) {
      setToken(storedToken);
      try {
        setUser(JSON.parse(storedUser));
      } catch (e) {
        console.error('Failed to parse stored user:', e);
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_user');
      }
    }
    setLoading(false);
  }, []);

  const login = useCallback(() => {
    if (!fingerprint) {
      console.error('Fingerprint not available');
      return;
    }

    // Track sign-in button click
    trackAuth.signinClicked();

    // Simple redirect-based OAuth flow - no popups
    // Store the current page so we can redirect back after auth
    const returnUrl = window.location.pathname + window.location.search;
    sessionStorage.setItem('auth_return_url', returnUrl);

    // Redirect to backend OAuth endpoint with return URL in state
    // The backend will pass it through to the callback
    const state = JSON.stringify({ fingerprint, returnUrl });
    window.location.href = `${API_URL}/auth/google?state=${encodeURIComponent(state)}`;
  }, [fingerprint]);

  const logout = useCallback(async () => {
    // Track logout event
    trackAuth.logout();
    
    // Reset Mixpanel on logout
    resetMixpanel();

    if (token) {
      try {
        await fetch(`${API_URL}/auth/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch (e) {
        console.error('Logout request failed:', e);
      }
    }

    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    setToken(null);
    setUser(null);
  }, [token]);

  // Compute userId directly - use Google user ID when authenticated, otherwise fingerprint
  const userId = user?.id || fingerprint || null;

  return {
    user,
    token,
    loading,
    login,
    logout,
    isAuthenticated: !!user,
    getUserId: () => userId, // Simple getter that returns current userId
    userId, // Also expose userId directly
  };
}

