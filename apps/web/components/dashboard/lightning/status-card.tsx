'use client';

import { CheckCircle2, AlertCircle, Loader2, Copy, RefreshCw } from 'lucide-react';
import { copyToClipboard, formatExpiry, truncate } from './lightning-constants';

interface StatusCardProps {
  authenticated: boolean;
  authenticating: boolean;
  sessionId: string | null;
  expiresAt: string | null;
  walletAddress: string | null;
  authError: string | null;
  onReauth: () => void;
}

export function StatusCard({
  authenticated,
  authenticating,
  sessionId,
  expiresAt,
  walletAddress,
  authError,
  onReauth,
}: StatusCardProps) {
  const statusLabel = authenticated ? 'Authenticated' : authenticating ? 'Authenticating…' : 'Not Authenticated';

  return (
    <div className="h-full bg-[#161616] border border-white/10 rounded-xl p-5 flex flex-col justify-center">
      <div className="mx-auto w-full max-w-[360px]">
        <div className="flex justify-center">
          <span
            className={`inline-flex items-center gap-2 text-sm font-rubik-medium px-4 py-2 rounded-full border ${
              authenticated
                ? 'text-black bg-yellow-400 border-yellow-300'
                : authenticating
                  ? 'text-yellow-100 bg-yellow-400/15 border-yellow-400/25'
                  : 'text-red-300 bg-red-500/10 border-red-500/20'
            }`}
          >
            {authenticating ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : authenticated ? (
              <CheckCircle2 className="h-5 w-5" />
            ) : (
              <AlertCircle className="h-5 w-5" />
            )}
            {statusLabel}
          </span>
        </div>

        {authenticated && (
          <div className="mt-6 space-y-2 text-sm">
            {walletAddress && (
              <div className="grid grid-cols-[110px_1fr] items-center border-b border-white/10 pb-2">
                <span className="text-gray-300">Wallet:</span>
                <div className="flex items-center gap-2 justify-end">
                  <span className="font-mono text-gray-100">{truncate(walletAddress, 6)}</span>
                  <button
                    onClick={() => copyToClipboard(walletAddress, 'Address copied!')}
                    className="text-gray-400 hover:text-white"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
            {sessionId && (
              <div className="grid grid-cols-[110px_1fr] items-center border-b border-white/10 pb-2">
                <span className="text-gray-300">Session ID:</span>
                <span className="font-mono text-gray-100 justify-self-end">{truncate(sessionId, 5)}</span>
              </div>
            )}
            {expiresAt && (
              <div className="grid grid-cols-[110px_1fr] items-center">
                <span className="text-gray-300">Expires:</span>
                <span className="text-gray-100 justify-self-end">{formatExpiry(expiresAt)}</span>
              </div>
            )}
          </div>
        )}

        {!authenticating && (
          <div className="mt-6 flex justify-center">
            <button
              onClick={onReauth}
              className="inline-flex items-center gap-1 text-sm text-black border border-yellow-300 rounded-full px-5 py-2 bg-yellow-400 hover:bg-yellow-300 transition-colors"
            >
              <RefreshCw className="h-4.5 w-4.5" />
              {authenticated ? 'Re-auth' : 'Authenticate'}
            </button>
          </div>
        )}

        {authError && !authenticated && (
          <p className="mt-3 text-center text-xs text-red-300">{authError}</p>
        )}
      </div>
    </div>
  );
}
