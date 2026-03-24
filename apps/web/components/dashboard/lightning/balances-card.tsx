'use client';

import { Loader2, RefreshCw } from 'lucide-react';
import { DEFAULT_ASSET } from './lightning-constants';

interface BalancesCardProps {
  unified: { asset: string; amount: string; locked: string; available: string }[];
  custodyAvailable: string | null;
  walletUsdcBalance: string | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onAddFunds: () => void;
}

export function BalancesCard({
  unified,
  custodyAvailable,
  loading,
  error,
  onRefresh,
  onAddFunds,
}: BalancesCardProps) {
  const mainUnified = unified.find((b) => b.asset === DEFAULT_ASSET);

  const lightningAmountNum = mainUnified ? Number(mainUnified.available) : 0;
  const onChainAmountNum = custodyAvailable ? Number(custodyAvailable) : 0;
  const totalNum = lightningAmountNum + onChainAmountNum;

  const lightningPct = totalNum > 0 ? Math.min(1, Math.max(0, lightningAmountNum / totalNum)) : 0;

  const ringSize = 120;
  const cx = ringSize / 2;
  const cy = ringSize / 2;
  const r = 46;
  const strokeWidth = 12;
  const circumference = 2 * Math.PI * r;
  const lightningArc = circumference * lightningPct;
  const glowColor = '#EAB308';

  return (
    <div className="h-full bg-[#161616] border border-white/10 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-rubik-medium text-white">Balances</span>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="text-gray-300 hover:text-white disabled:opacity-40"
          title="Refresh balances"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading balances…
        </div>
      ) : error ? (
        <p className="text-xs text-red-400">{error}</p>
      ) : (
        <div className="space-y-3">
          {/* Ring */}
          <div className="relative w-[168px] h-[168px] mx-auto">
            <svg
              width={168}
              height={168}
              viewBox={`0 0 ${ringSize} ${ringSize}`}
              className="absolute inset-0 animate-ring-glow"
            >
              <defs>
                <filter id="yellowGlow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              <g transform={`rotate(-90 ${cx} ${cy})`}>
                {/* Track */}
                <circle
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke="rgba(107,114,128,0.55)"
                  strokeWidth={strokeWidth}
                  strokeLinecap="round"
                  strokeDasharray={`${circumference} 0`}
                />

                {/* Lightning segment */}
                {lightningArc > 0 && lightningArc < circumference && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r}
                    fill="none"
                    stroke={glowColor}
                    strokeWidth={strokeWidth}
                    strokeLinecap="round"
                    filter="url(#yellowGlow)"
                    strokeDasharray={`${lightningArc} ${circumference - lightningArc}`}
                  />
                )}

                {/* Full circle lightning */}
                {lightningArc >= circumference - 0.0001 && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r}
                    fill="none"
                    stroke={glowColor}
                    strokeWidth={strokeWidth}
                    strokeLinecap="round"
                    filter="url(#yellowGlow)"
                    strokeDasharray={`${circumference} 0`}
                  />
                )}
              </g>
            </svg>

            <div className="absolute inset-0 flex items-center justify-center flex-col">
              <div className="text-[30px] font-rubik-medium text-white leading-none">
                {totalNum > 0 ? totalNum.toFixed(4) : '0.0000'}
              </div>
              <div className="text-[11px] text-gray-200 mt-0.5">USDC Total</div>
            </div>
          </div>

          {/* Legend amounts */}
          <div className="flex items-center justify-between text-xs text-gray-300">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-yellow-400 shadow-[0_0_14px_rgba(234,179,8,0.35)]" />
              <div>
                <div className="text-gray-300">Lightning</div>
                <div className="text-[11px] text-gray-400">
                  {lightningAmountNum > 0 ? lightningAmountNum.toFixed(4) : '0.0000'} USDC
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-gray-500" />
              <div className="text-right">
                <div className="text-gray-300">On-chain</div>
                <div className="text-[11px] text-gray-400">
                  {onChainAmountNum > 0 ? onChainAmountNum.toFixed(4) : '0.0000'} USDC
                </div>
              </div>
            </div>
          </div>

          {/* Progress bar split */}
          <div className="h-2 rounded-full bg-[#3A3D45] overflow-hidden">
            <div
              className="h-full bg-yellow-400 rounded-full transition-[width] duration-300"
              style={{ width: `${(lightningPct * 100).toFixed(2)}%` }}
            />
          </div>

          {/* Cards */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-yellow-300/35 bg-[#161616] p-3">
              <p className="text-[10px] text-gray-400">Lightning Ledger</p>
              <p className="text-lg font-rubik-medium text-white leading-none mt-1">
                {lightningAmountNum > 0 ? lightningAmountNum.toFixed(4) : '0.0000'} USDC
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#161616] p-3">
              <p className="text-[10px] text-gray-400">On-chain Custody</p>
              <p className="text-lg font-rubik-medium text-white leading-none mt-1">
                {onChainAmountNum > 0 ? onChainAmountNum.toFixed(4) : '0.0000'} USDC
              </p>
            </div>
          </div>

          {/* Add Funds */}
          <div className="flex items-center justify-end">
            <button
              onClick={onAddFunds}
              className="h-9 px-4 rounded-xl bg-yellow-400 text-black font-rubik-medium hover:bg-yellow-500 transition-colors"
            >
              Add Funds
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
