'use client';

import React, { createContext, useContext, useMemo } from 'react';
import { useLightningNodes as useLightningNodesImpl } from './useLightningNodes';

type LightningNodesContextValue = ReturnType<typeof useLightningNodesImpl>;

const LightningNodesContext = createContext<LightningNodesContextValue | null>(null);

export function LightningNodesProvider({ children }: { children: React.ReactNode }) {
  const value = useLightningNodesImpl();
  // Stable identity to avoid needless rerenders
  const memoValue = useMemo(() => value, [
    value.nodes,
    value.loading,
    value.error,
    value.lastFetched,
    value.authenticated,
    value.authenticating,
    value.walletAddress,
    value.allSessions,
    value.activeSessions,
    value.invitations,
  ]);

  return (
    <LightningNodesContext.Provider value={memoValue}>
      {children}
    </LightningNodesContext.Provider>
  );
}

export function useLightningNodes() {
  const ctx = useContext(LightningNodesContext);
  if (!ctx) {
    throw new Error('useLightningNodes must be used within a LightningNodesProvider');
  }
  return ctx;
}
