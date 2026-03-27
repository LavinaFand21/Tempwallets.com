'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, RotateCw } from 'lucide-react';
import { BalanceView } from './balance-view';
import { TransactionList } from '../transactions/transaction-list';
import { LightningNodesView } from '../lightning/lightning-nodes-view';
import { useWalletData } from '@/hooks/useWalletData';

type ViewType = 'balance' | 'transactions' | 'lightningNodes';

/**
 * Component with three text buttons: "Balance", "Transactions", and "Lightning Nodes"
 * Renders BalanceView when balance is active, RecentTransactions when transactions is active,
 * and LightningNodesView when lightningNodes is active
 * Default to "Balance" view on mount
 */
interface BalanceTransactionsToggleProps {
  onOpenSend?: (chain: string, tokenSymbol?: string) => void;
  selectedChainId: string;
}

export function BalanceTransactionsToggle({ onOpenSend, selectedChainId }: BalanceTransactionsToggleProps) {
  const [activeView, setActiveView] = useState<ViewType>('balance');
  const { loading, refreshBalances, refreshTransactions } = useWalletData();
  // Lightning Nodes view manages its own loading/refresh state internally
  const isLoading = loading.balances || loading.transactions;

  const isLightning = activeView === 'lightningNodes';

  // Intro video only on first time per page refresh.
  const hasShownIntroRef = useRef(false);
  const [showLightningIntro, setShowLightningIntro] = useState(false);
  const [introVideoEnded, setIntroVideoEnded] = useState(false);
  const [yellowAuthenticated, setYellowAuthenticated] = useState(false);

  useEffect(() => {
    // If user navigates away during intro, hide overlay.
    if (!isLightning) {
      setShowLightningIntro(false);
      setIntroVideoEnded(false);
    }
  }, [isLightning]);

  const containerClasses = useMemo(() => {
    // Smoothly transition container background when toggling.
    return isLightning
      ? 'w-full bg-black text-white rounded-3xl pt-4 border-t border-gray-800 shadow-sm md:max-w-2xl md:mx-auto mt-2 mb-4 flex-1 flex flex-col transition-colors duration-500'
      : 'w-full bg-white text-gray-900 rounded-3xl pt-4 border-t border-gray-200 shadow-sm md:max-w-2xl md:mx-auto mt-2 mb-4 flex-1 flex flex-col transition-colors duration-500';
  }, [isLightning]);

  const handleLightningClick = () => {
    setActiveView('lightningNodes');
    if (!hasShownIntroRef.current) {
      hasShownIntroRef.current = true;
      setYellowAuthenticated(false);
      setIntroVideoEnded(false);
      setShowLightningIntro(true);
    }
  };

  // Only reveal dashboard when both:
  // 1) intro video finished, and
  // 2) Yellow Network auth is authenticated.
  const canRevealLightning = !showLightningIntro || (introVideoEnded && yellowAuthenticated);
  const handleRefresh = () => {
    if (activeView === 'balance') {
      refreshBalances();
    } else if (activeView === 'transactions') {
      refreshTransactions();
    }
    // Lightning Nodes view has its own per-section refresh controls
  };
  return (
    <div className={containerClasses}>
      {/* Top Divider */}
      <div className="flex justify-center mb-2 mx-4 md:mx-6">
        <div className="w-10 h-1 bg-gray-200 rounded-full"></div>
      </div>

      {/* Header with Toggle Buttons and Refresh */}
      <div className="flex items-center justify-between mb-4 mx-4 md:mx-6 relative z-10">
        {/* Toggle Buttons on Left */}
        <div className="flex items-center gap-6">
          <button
            onClick={() => setActiveView('balance')}
            type="button"
            className={`font-rubik-medium transition-all cursor-pointer select-none py-2 px-3 -mx-3 rounded-lg relative z-10 ${
              activeView === 'balance'
                ? 'text-gray-800 font-semibold'
                : isLightning
                  ? 'text-gray-500 hover:text-gray-400'
                  : 'text-gray-300 hover:text-gray-400'
            }`}
            style={{ touchAction: 'manipulation' }}
          >
            Balance
          </button>
          <button
            onClick={() => setActiveView('transactions')}
            type="button"
            className={`font-rubik-medium transition-all cursor-pointer select-none py-2 px-3 -mx-3 rounded-lg relative z-10 ${
              activeView === 'transactions'
                ? 'text-gray-800 font-semibold'
                : isLightning
                  ? 'text-gray-500 hover:text-gray-400'
                  : 'text-gray-300 hover:text-gray-400'
            }`}
            style={{ touchAction: 'manipulation' }}
          >
            Transactions
          </button>
          <button
            onClick={handleLightningClick}
            type="button"
            className={`font-rubik-medium transition-all cursor-pointer select-none py-2 px-2 -mx-2 rounded-lg relative z-10 text-sm sm:text-base ${activeView === 'lightningNodes'
              ? 'text-white font-semibold'
              : 'text-gray-300 hover:text-gray-400'
              }`}
            style={{ touchAction: 'manipulation' }}
          >
            Lightning Nodes
          </button>
        </div>

        {/* Refresh Button on Right */}
        {activeView !== 'lightningNodes' && (
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            type="button"
            className="text-gray-600 hover:text-gray-900 transition-colors disabled:opacity-50 flex items-center justify-center h-9 w-9 rounded-lg border border-gray-200 hover:border-gray-300 bg-white shadow-sm hover:shadow active:scale-[0.98]"
            style={{ touchAction: 'manipulation' }}
            aria-label="Refresh"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCw className="h-4 w-4" />
            )}
          </button>
        )}
      </div>

      {/* Content Area */}
      <div className="mx-4 md:mx-6 mb-4 flex-1">
        {activeView === 'balance' ? (
          <BalanceView onOpenSend={onOpenSend} selectedChainId={selectedChainId} />
        ) : activeView === 'transactions' ? (
          <TransactionList />
        ) : (
          <div className="relative min-h-[500px]">
            {showLightningIntro && (
              <div
                className={`absolute inset-0 z-20 flex items-center justify-center overflow-hidden bg-black transition-opacity duration-500 ${
                  canRevealLightning ? 'opacity-0 pointer-events-none' : 'opacity-100'
                }`}
              >
                <div className="w-full max-w-[520px] aspect-video -translate-y-20 overflow-hidden rounded-md">
                  <video
                    key="yellow-lightning-intro"
                    autoPlay
                    muted
                    playsInline
                    preload="auto"
                    className="h-full w-full object-cover object-top"
                    src="/Yellow Loading Animation.mp4"
                    onEnded={() => setIntroVideoEnded(true)}
                    onError={() => {
                      // If MP4 fails to load, reveal once authenticated.
                      setIntroVideoEnded(true);
                    }}
                  />
                </div>
              </div>
            )}

            <div
              className={`transition-opacity duration-500 ${
                showLightningIntro && !canRevealLightning ? 'opacity-0 pointer-events-none' : 'opacity-100'
              }`}
            >
              <LightningNodesView
                onYellowAuthStateChangeAction={(next) => {
                  setYellowAuthenticated(next.authenticated);
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

