'use client';

import { ReactNode } from 'react';
import { Toaster } from 'sonner';
import { WalletDataProvider } from '@/contexts/wallet-data-context';
import { useAuth } from '@/hooks/useAuth';
import { MixpanelProvider } from '@/components/analytics/mixpanel-provider';

interface ProvidersProps {
  children: ReactNode;
}

/**
 * Root providers component that wraps the app with all necessary context providers
 * Ensures providers are mounted only once for the entire application
 */
export function Providers({ children }: ProvidersProps) {
  const { userId } = useAuth();

  return (
    <MixpanelProvider>
      <WalletDataProvider userId={userId}>
        {children}
        <Toaster position="top-right" richColors closeButton />
      </WalletDataProvider>
    </MixpanelProvider>
  );
}
