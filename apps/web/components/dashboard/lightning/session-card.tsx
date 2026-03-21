'use client';

import { Loader2, Copy, X } from 'lucide-react';
import { AppSession } from '@/lib/yellow-api';
import { copyToClipboard, truncate } from './lightning-constants';

interface SessionCardProps {
  session: AppSession;
  walletAddress: string | null;
  onManage: () => void;
  onClose: () => void;
  isClosing: boolean;
  onDismiss?: () => void;
}

export function SessionCard({
  session,
  walletAddress: _walletAddress,
  onManage,
  onClose,
  isClosing,
  onDismiss,
}: SessionCardProps) {
  const total = (session.allocations ?? [])
    .reduce((s, a) => s + parseFloat(a.amount || '0'), 0)
    .toFixed(3);

  const participantEntries = session.participants ?? [];
  const fromAllocations = (session.allocations ?? []).map((a) => a.participant).filter(Boolean);
  const addresses =
    participantEntries.length > 0
      ? participantEntries.map((p) => p.address)
      : fromAllocations;

  return (
    <div className="bg-[#161616] border border-white/10 rounded-xl p-2.5 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <p className="text-[10px] text-gray-400 uppercase tracking-wide">
            Session ID
          </p>
          <button
            type="button"
            onClick={() => copyToClipboard(session.appSessionId, 'Session ID copied!')}
            className="min-w-0 inline-flex items-center gap-1.5 text-left group"
            title="Copy Session ID"
          >
            <span className="text-sm font-rubik-medium text-white truncate">
              {truncate(session.appSessionId, 8)}
            </span>
            <Copy className="h-4 w-4 text-gray-400 group-hover:text-white shrink-0" />
          </button>
        </div>

        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-gray-400 hover:text-white transition-colors shrink-0"
            aria-label="Dismiss session card"
            title="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {addresses.length > 0 && (
        <div className="space-y-0.5">
          <p className="text-[10px] text-gray-400 uppercase tracking-wide">Participants</p>
          <div className="flex flex-wrap gap-0.5">
            {addresses.slice(0, 4).map((addr) => (
              <span
                key={addr}
                className="inline-flex w-fit max-w-full text-[9px] leading-none font-mono text-gray-300 bg-black/30 border border-white/10 rounded-md px-1.5 py-0.5"
              >
                {truncate(addr, 8)}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-1 border-t border-white/10">
        <p className="text-[11px] text-gray-300">
          Balance <span className="font-medium text-white">{total} {session.token?.toUpperCase()}</span>
        </p>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={onManage}
            className="h-7 px-2.5 text-[11px] border border-white/10 text-gray-100 rounded-md bg-[#161616] hover:bg-[#1c1c1c] transition-colors"
          >
            Manage
          </button>
          {session.status === 'open' && (
            <button
              onClick={onClose}
              disabled={isClosing}
              className="h-7 px-2.5 text-[11px] border border-red-400/30 text-red-200 hover:bg-red-500/10 rounded-md bg-[#161616] transition-colors disabled:opacity-50"
            >
              {isClosing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Close'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
