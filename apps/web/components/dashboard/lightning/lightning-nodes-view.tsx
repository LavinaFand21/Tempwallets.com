'use client';

/**
 * Lightning Node View — Yellow Network
 *
 * Single self-contained view wired to the Yellow Network backend API.
 * Call order: Authenticate → Balances → Discover Sessions → Create/Manage.
 *
 * Sections:
 *  1. Auth card — status, session ID, expiry, re-auth button
 *  2. Balances card — unified (off-chain) + custody (on-chain) + wallet
 *  3. Custody actions — deposit / withdraw (costs gas, on-chain)
 *  4. Withdraw to Wallet guide — close sessions → move unified to custody → custody withdraw
 *  5. App sessions — discover, create, manage (OPERATE / DEPOSIT / WITHDRAW / CLOSE)
 */

import { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  Copy,
  RefreshCw,
  Zap,
  X,
  Plus,
  Info,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@repo/ui/components/ui/dialog';
import { Button } from '@repo/ui/components/ui/button';
import { Input } from '@repo/ui/components/ui/input';
import { Label } from '@repo/ui/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import {
  useYellowAuth,
  useYellowBalances,
  useCustodyActions,
  useChannelActions,
  useAppSessions,
} from '@/hooks/useYellowNetwork';
import { yellowApi, AppSession, SessionAllocation } from '@/lib/yellow-api';

// ── Constants ─────────────────────────────────────────────────────────────

const CHAINS = [
  { id: 'base', label: 'Base' },
  { id: 'arbitrum', label: 'Arbitrum' },
];

const ASSETS = [
  { id: 'usdc', label: 'USDC' },
  { id: 'usdt', label: 'USDT' },
];

const DEFAULT_CHAIN = 'base';
const DEFAULT_ASSET = 'usdc';

const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

// ── Small utilities ───────────────────────────────────────────────────────

function copyToClipboard(text: string, label = 'Copied!') {
  navigator.clipboard.writeText(text).catch(() => {});
  toast.success(label);
}

function formatExpiry(iso: string | null): string {
  if (!iso) return 'Unknown';
  const d = new Date(iso);
  const diff = d.getTime() - Date.now();
  if (diff <= 0) return 'Expired';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function truncate(s: string, chars = 8): string {
  if (s.length <= chars * 2 + 3) return s;
  return `${s.slice(0, chars)}…${s.slice(-chars)}`;
}

function FieldError({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <p className="text-xs text-red-500 mt-1">{msg}</p>;
}

// ── Auth Card ─────────────────────────────────────────────────────────────

function LightningAuthCard({
  authenticated,
  authenticating,
  sessionId,
  expiresAt,
  walletAddress,
  authError,
  onReauth,
}: {
  authenticated: boolean;
  authenticating: boolean;
  sessionId: string | null;
  expiresAt: string | null;
  walletAddress: string | null;
  authError: string | null;
  onReauth: () => void;
}) {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {authenticating ? (
            <Loader2 className="h-4 w-4 animate-spin text-gray-500" />
          ) : authenticated ? (
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          ) : (
            <AlertCircle className="h-4 w-4 text-red-500" />
          )}
          <span className="text-sm font-rubik-medium text-gray-900">
            {authenticating
              ? 'Authenticating…'
              : authenticated
                ? 'Authenticated'
                : 'Not Authenticated'}
          </span>
        </div>

        {!authenticating && (
          <button
            onClick={onReauth}
            className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg px-2 py-1 bg-white hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className="h-3 w-3" />
            {authenticated ? 'Re-auth' : 'Authenticate'}
          </button>
        )}
      </div>

      {authenticated && (
        <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
          {walletAddress && (
            <div className="col-span-2 flex items-center gap-1">
              <span className="text-gray-500">Wallet:</span>
              <span className="font-mono">{truncate(walletAddress, 6)}</span>
              <button
                onClick={() => copyToClipboard(walletAddress, 'Address copied!')}
                className="text-gray-400 hover:text-gray-700"
              >
                <Copy className="h-3 w-3" />
              </button>
            </div>
          )}
          {sessionId && (
            <div className="flex items-center gap-1">
              <span className="text-gray-500">Session:</span>
              <span className="font-mono">{truncate(sessionId, 5)}</span>
            </div>
          )}
          {expiresAt && (
            <div className="flex items-center gap-1">
              <span className="text-gray-500">Expires:</span>
              <span>{formatExpiry(expiresAt)}</span>
            </div>
          )}
        </div>
      )}

      {authError && !authenticated && (
        <p className="text-xs text-red-500">{authError}</p>
      )}
    </div>
  );
}

// ── Balances Card ─────────────────────────────────────────────────────────

function LightningBalancesCard({
  unified,
  custodyAvailable,
  walletUsdcBalance,
  loading,
  error,
  onRefresh,
}: {
  unified: { asset: string; amount: string; locked: string; available: string }[];
  custodyAvailable: string | null;
  walletUsdcBalance: string | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const mainUnified = unified.find((b) => b.asset === DEFAULT_ASSET);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-rubik-medium text-gray-900">Balances</span>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="text-gray-400 hover:text-gray-700 disabled:opacity-40"
          title="Refresh balances"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading balances…
        </div>
      ) : error ? (
        <p className="text-xs text-red-500">{error}</p>
      ) : (
        <div className="space-y-1.5">
          {/* Unified (Yellow off-chain ledger) */}
          <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
            <div>
              <p className="text-xs text-gray-500">Unified Balance</p>
              <p className="text-[10px] text-gray-400">Yellow off-chain ledger</p>
            </div>
            <p className="text-sm font-rubik-medium text-gray-900">
              {mainUnified
                ? `${parseFloat(mainUnified.available).toFixed(4)} USDC`
                : '—'}
            </p>
          </div>

          {/* Custody available (on-chain contract) */}
          <div className="flex items-center justify-between bg-green-50 border border-green-100 rounded-lg px-3 py-2">
            <div>
              <p className="text-xs text-gray-700 font-rubik-medium">Custody Available</p>
              <p className="text-[10px] text-gray-400">On-chain · withdraw-ready</p>
            </div>
            <p className="text-sm font-rubik-medium text-gray-900">
              {custodyAvailable != null
                ? `${parseFloat(custodyAvailable).toFixed(4)} USDC`
                : '—'}
            </p>
          </div>

          {/* Wallet on-chain */}
          {walletUsdcBalance !== null && (
            <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
              <div>
                <p className="text-xs text-gray-500">Wallet Balance</p>
                <p className="text-[10px] text-gray-400">On-chain wallet</p>
              </div>
              <p className="text-sm font-rubik-medium text-gray-900">
                {parseFloat(walletUsdcBalance).toFixed(4)} USDC
              </p>
            </div>
          )}

          {/* All unified assets (if more than one) */}
          {unified.length > 1 && (
            <div className="pt-1 space-y-1">
              {unified
                .filter((b) => b.asset !== DEFAULT_ASSET)
                .map((b) => (
                  <div
                    key={b.asset}
                    className="flex items-center justify-between text-xs text-gray-600 px-3"
                  >
                    <span className="uppercase text-gray-500">{b.asset}</span>
                    <span>{parseFloat(b.available).toFixed(4)}</span>
                  </div>
                ))}
            </div>
          )}

          {/* Flow hint */}
          <div className="flex items-start gap-1.5 px-3 pt-1">
            <Info className="h-3 w-3 text-gray-300 mt-0.5 shrink-0" />
            <p className="text-[9px] text-gray-400 leading-tight">
              <strong className="text-gray-500">Flow:</strong> Wallet → Deposit → Custody Available → Fund Channel → Unified Balance → Close Channel → Custody Available → Withdraw → Wallet.
              {' '}After closing a channel, <strong className="text-gray-500">Custody Available</strong> updates immediately; Unified Balance may take 10–15 s to reflect the settlement.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Custody Actions Card ──────────────────────────────────────────────────

type CustodyTab = 'deposit' | 'withdraw' | 'move';

function CustodyActionsCard({
  depositing,
  withdrawing,
  custodyAvailable,
  unified,
  channels,
  channelsLoading,
  closingChannelId,
  storedChannelId,
  onDeposit,
  onWithdraw,
  onCloseChannel,
  onDismissStoredChannel,
  onFetchChannels,
}: {
  depositing: boolean;
  withdrawing: boolean;
  custodyAvailable: string | null;
  unified: { asset: string; amount: string; locked: string; available: string }[];
  channels: { channelId: string; status: string; asset?: string; balance?: string; amount?: string }[];
  channelsLoading: boolean;
  closingChannelId: string | null;
  storedChannelId: string | null;
  onDeposit: (chain: string, asset: string, amount: string) => Promise<boolean>;
  onWithdraw: (chain: string, asset: string, amount: string) => Promise<boolean>;
  onCloseChannel: (channelId: string) => Promise<boolean>;
  onDismissStoredChannel: () => void;
  onFetchChannels: () => void;
}) {
  const [tab, setTab] = useState<CustodyTab>('deposit');
  const [depositAmt, setDepositAmt] = useState('');
  const [withdrawAmt, setWithdrawAmt] = useState('');
  const [asset, setAsset] = useState(DEFAULT_ASSET);
  const [chain, setChain] = useState(DEFAULT_CHAIN);
  const [amountError, setAmountError] = useState<string | null>(null);

  const amount = tab === 'deposit' ? depositAmt : withdrawAmt;
  const setAmount = tab === 'deposit' ? setDepositAmt : setWithdrawAmt;

  const mainUnified = unified.find((b) => b.asset === DEFAULT_ASSET);
  const unifiedAvail = parseFloat(mainUnified?.available ?? '0');

  const validateAmount = (v: string): string | null => {
    if (!v) return 'Amount is required';
    if (isNaN(Number(v)) || Number(v) <= 0) return 'Amount must be a positive number';
    if (tab === 'withdraw' && custodyAvailable != null) {
      const avail = parseFloat(custodyAvailable);
      if (Number(v) > avail) {
        return `Cannot exceed available custody balance (${avail.toFixed(4)})`;
      }
    }
    return null;
  };

  const handleSubmit = async () => {
    const err = validateAmount(amount);
    setAmountError(err);
    if (err) return;

    const success =
      tab === 'deposit'
        ? await onDeposit(chain, asset, amount)
        : await onWithdraw(chain, asset, amount);

    if (success) {
      setAmount('');
      setAmountError(null);
    }
  };

  const busy = depositing || withdrawing;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3">
      <p className="text-sm font-rubik-medium text-gray-900 mb-2">Custody</p>

      <Tabs value={tab} onValueChange={(v) => { setTab(v as CustodyTab); if (v === 'move') onFetchChannels(); }}>
        <TabsList className="grid grid-cols-3 h-8 mb-3 bg-gray-100 text-gray-600">
          <TabsTrigger value="deposit" className="text-xs text-gray-600 data-[state=active]:bg-white data-[state=active]:text-gray-900">
            Deposit
          </TabsTrigger>
          <TabsTrigger value="withdraw" className="text-xs text-gray-600 data-[state=active]:bg-white data-[state=active]:text-gray-900">
            Withdraw
          </TabsTrigger>
          <TabsTrigger value="move" className="text-xs text-gray-600 data-[state=active]:bg-white data-[state=active]:text-gray-900">
            Move Balance
          </TabsTrigger>
        </TabsList>

        <TabsContent value="deposit" className="space-y-2 mt-0">
          <p className="text-[10px] text-gray-500">
            Move on-chain wallet funds into custody contract (costs gas).
          </p>

          <div>
            <Label className="text-xs text-gray-700">Amount</Label>
            <Input
              type="number"
              min="0"
              step="any"
              placeholder="0.00"
              value={depositAmt}
              onChange={(e) => { setDepositAmt(e.target.value); setAmountError(null); }}
              onBlur={() => setAmountError(validateAmount(depositAmt))}
              className="h-8 text-sm mt-1 bg-white border-gray-300 text-gray-900 placeholder:text-gray-400"
            />
            <FieldError msg={tab === 'deposit' ? amountError : null} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-gray-700">Asset</Label>
              <Select value={asset} onValueChange={setAsset}>
                <SelectTrigger className="h-8 text-xs mt-1 bg-white border-gray-300 text-gray-900">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSETS.map((a) => (
                    <SelectItem key={a.id} value={a.id} className="text-xs">
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-gray-700">Chain</Label>
              <Select value={chain} onValueChange={setChain}>
                <SelectTrigger className="h-8 text-xs mt-1 bg-white border-gray-300 text-gray-900">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHAINS.map((c) => (
                    <SelectItem key={c.id} value={c.id} className="text-xs">
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            onClick={handleSubmit}
            disabled={busy}
            className="w-full h-8 text-xs bg-black hover:bg-gray-800 text-white"
          >
            {depositing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Deposit to Custody'}
          </Button>
        </TabsContent>

        <TabsContent value="withdraw" className="space-y-2 mt-0">
          <p className="text-[10px] text-gray-500">
            Move custody funds back to your wallet (costs gas).
          </p>

          {custodyAvailable != null && (
            <div className="bg-gray-50 rounded-lg px-3 py-1.5 flex justify-between text-xs">
              <span className="text-gray-500">Available to withdraw</span>
              <span className="font-medium text-gray-900">
                {parseFloat(custodyAvailable).toFixed(4)} {asset.toUpperCase()}
              </span>
            </div>
          )}

          {custodyAvailable != null && parseFloat(custodyAvailable) <= 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-[10px] text-amber-800">
              No funds available in custody. Deposit USDC first, or check your on-chain balance.
            </div>
          )}

          <div>
            <Label className="text-xs text-gray-700">Amount</Label>
            <Input
              type="number"
              min="0"
              step="any"
              placeholder="0.00"
              value={withdrawAmt}
              onChange={(e) => { setWithdrawAmt(e.target.value); setAmountError(null); }}
              onBlur={() => setAmountError(validateAmount(withdrawAmt))}
              className="h-8 text-sm mt-1 bg-white border-gray-300 text-gray-900 placeholder:text-gray-400"
            />
            <FieldError msg={tab === 'withdraw' ? amountError : null} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-gray-700">Asset</Label>
              <Select value={asset} onValueChange={setAsset}>
                <SelectTrigger className="h-8 text-xs mt-1 bg-white border-gray-300 text-gray-900">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSETS.map((a) => (
                    <SelectItem key={a.id} value={a.id} className="text-xs">
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-gray-700">Chain</Label>
              <Select value={chain} onValueChange={setChain}>
                <SelectTrigger className="h-8 text-xs mt-1 bg-white border-gray-300 text-gray-900">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHAINS.map((c) => (
                    <SelectItem key={c.id} value={c.id} className="text-xs">
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            onClick={handleSubmit}
            disabled={busy || (custodyAvailable != null && parseFloat(custodyAvailable) <= 0)}
            className="w-full h-8 text-xs bg-black hover:bg-gray-800 text-white"
          >
            {withdrawing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Withdraw from Custody'}
          </Button>
        </TabsContent>

        <TabsContent value="move" className="space-y-2 mt-0">
          <p className="text-[10px] text-gray-500">
            Close your payment channel to release locked funds back to custody.
            Then use the <strong>Withdraw</strong> tab to send funds to your wallet.
          </p>

          {/* Balances summary */}
          <div className="grid grid-cols-2 gap-1.5">
            <div className="bg-gray-50 rounded-lg px-2.5 py-1.5">
              <p className="text-[10px] text-gray-400">Unified</p>
              <p className="text-xs font-medium text-gray-900">{unifiedAvail.toFixed(4)} USDC</p>
            </div>
            <div className="bg-gray-50 rounded-lg px-2.5 py-1.5">
              <p className="text-[10px] text-gray-400">Custody available</p>
              <p className="text-xs font-medium text-gray-900">
                {custodyAvailable != null ? `${parseFloat(custodyAvailable).toFixed(4)} USDC` : '—'}
              </p>
            </div>
          </div>

          {/* Active Channel from localStorage (always shown if present) */}
          {storedChannelId && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-2.5 py-2">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] text-blue-600 font-medium">Active Channel</p>
                <button
                  onClick={onDismissStoredChannel}
                  className="text-blue-300 hover:text-blue-600"
                  title="Dismiss"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-mono text-xs text-blue-900">{truncate(storedChannelId, 8)}</p>
                  <button
                    onClick={() => copyToClipboard(storedChannelId, 'Channel ID copied!')}
                    className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-700 mt-0.5"
                  >
                    <Copy className="h-2.5 w-2.5" />
                    Copy full ID
                  </button>
                </div>
                <Button
                  onClick={() => onCloseChannel(storedChannelId)}
                  disabled={closingChannelId === storedChannelId}
                  variant="outline"
                  className="h-7 text-[10px] px-2.5 border-blue-300 text-blue-700 hover:bg-blue-100 bg-white"
                >
                  {closingChannelId === storedChannelId ? (
                    <><Loader2 className="h-3 w-3 animate-spin mr-1" />Closing…</>
                  ) : (
                    'Close Channel'
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Channel list from API */}
          {channelsLoading ? (
            <div className="flex items-center gap-1.5 text-xs text-gray-500 py-2 justify-center">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading channels…
            </div>
          ) : channels.length === 0 && !storedChannelId ? (
            <div className="bg-gray-50 rounded-lg p-2 text-[10px] text-gray-500 text-center">
              No open payment channels. Deposit to custody to get started.
            </div>
          ) : channels.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-[10px] text-gray-500 font-medium">Open channels:</p>
              {channels.map((ch) => {
                // Don't duplicate if already shown in the Active Channel badge
                const isStored = ch.channelId === storedChannelId;
                return (
                  <div
                    key={ch.channelId}
                    className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs ${
                      isStored ? 'bg-blue-50' : 'bg-gray-50'
                    }`}
                  >
                    <div>
                      <p className="font-mono text-gray-700">{truncate(ch.channelId, 5)}</p>
                      <p className="text-[10px] text-gray-400">{ch.status}</p>
                    </div>
                    <Button
                      onClick={() => onCloseChannel(ch.channelId)}
                      disabled={closingChannelId === ch.channelId}
                      variant="outline"
                      className="h-6 text-[10px] px-2 border-gray-300 text-gray-700"
                    >
                      {closingChannelId === ch.channelId ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        'Close'
                      )}
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className="flex items-start gap-1.5 pt-1">
            <Info className="h-3 w-3 text-gray-300 mt-0.5 shrink-0" />
            <p className="text-[9px] text-gray-400 leading-tight">
              Closing the channel releases locked funds to your custody balance.
              Then use the <strong>Withdraw</strong> tab to move funds to your wallet.
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── App Sessions List ─────────────────────────────────────────────────────

function SessionCard({
  session,
  walletAddress,
  onManage,
  onClose,
  isClosing,
}: {
  session: AppSession;
  walletAddress: string | null;
  onManage: () => void;
  onClose: () => void;
  isClosing: boolean;
}) {
  const total = (session.allocations ?? [])
    .reduce((s, a) => s + parseFloat(a.amount || '0'), 0)
    .toFixed(4);

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-gray-600" />
          <div>
            <p className="text-xs font-rubik-medium text-gray-900">
              {session.token?.toUpperCase()} · {session.chain}
            </p>
            <p className="text-[10px] font-mono text-gray-500">
              {truncate(session.appSessionId, 6)}
            </p>
          </div>
        </div>
        <span
          className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
            session.status === 'open'
              ? 'bg-green-100 text-green-700'
              : 'bg-gray-200 text-gray-600'
          }`}
        >
          {session.status}
        </span>
      </div>

      {/* Participants with join status (from backend join state) */}
      {(() => {
        const participantEntries = session.participants ?? [];
        const fromAllocations = (session.allocations ?? []).map((a) => a.participant).filter(Boolean);
        const joinedByAddress = new Map(
          participantEntries.map((p) => [p.address.toLowerCase(), p.joined]),
        );
        const addresses =
          participantEntries.length > 0
            ? participantEntries.map((p) => p.address)
            : fromAllocations;
        if (addresses.length === 0) return null;
        return (
          <div className="space-y-1">
            {addresses.map((addr) => {
              const hasJoined = joinedByAddress.get(addr.toLowerCase()) ?? false;
              const isMe = addr.toLowerCase() === walletAddress?.toLowerCase();
              return (
                <div key={addr} className="flex items-center justify-between text-xs">
                  <span className="font-mono text-gray-600">{truncate(addr, 6)}</span>
                  <div className="flex items-center gap-1">
                    {isMe && (
                      <span className="text-[9px] bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">
                        You
                      </span>
                    )}
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                        hasJoined ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'
                      }`}
                    >
                      {hasJoined ? 'Joined' : 'Pending'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      <div className="flex items-center justify-between text-xs text-gray-600">
        <span>Total</span>
        <span className="font-medium">
          {total} {session.token?.toUpperCase()}
        </span>
      </div>

      <div className="flex gap-2">
        <button
          onClick={onManage}
          className="flex-1 h-7 text-xs border border-gray-300 text-gray-800 rounded-md bg-white hover:bg-gray-50 transition-colors"
        >
          Manage
        </button>
        {session.status === 'open' && (
          <button
            onClick={onClose}
            disabled={isClosing}
            className="h-7 px-3 text-xs border border-red-200 text-red-600 hover:bg-red-50 rounded-md bg-white transition-colors disabled:opacity-50"
          >
            {isClosing ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Close'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Create Session Dialog ─────────────────────────────────────────────────

interface CreateSessionFormProps {
  walletAddress: string | null;
  userId: string;
  chain: string;
  onCreated: (sessionId: string) => void;
  creating: boolean;
  onCreate: (params: {
    participants: string[];
    token: string;
    initialAllocations: { participant: string; amount: string }[];
  }) => Promise<string | null>;
}

function CreateSessionForm({
  walletAddress,
  userId,
  chain,
  onCreated,
  creating,
  onCreate,
}: CreateSessionFormProps) {
  const [token, setToken] = useState(DEFAULT_ASSET);
  const [extraParticipants, setExtraParticipants] = useState<string[]>(['']);
  const [allocations, setAllocations] = useState<{ address: string; amount: string }[]>([
    { address: walletAddress ?? '', amount: '' },
  ]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Keep first allocation address synced with walletAddress
  useEffect(() => {
    if (walletAddress) {
      setAllocations((prev) => {
        const next = [...prev];
        next[0] = { address: walletAddress, amount: next[0]?.amount ?? '' };
        return next;
      });
    }
  }, [walletAddress]);

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    allocations.forEach((a, i) => {
      if (!a.amount || Number(a.amount) < 0) {
        errs[`alloc_${i}`] = 'Amount must be ≥ 0';
      }
    });
    extraParticipants.forEach((addr, i) => {
      if (addr && !EVM_ADDRESS_REGEX.test(addr.trim())) {
        errs[`addr_${i}`] = 'Invalid EVM address (0x + 40 hex chars)';
      }
    });
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleAddParticipant = () => {
    setExtraParticipants((prev) => [...prev, '']);
    setAllocations((prev) => [...prev, { address: '', amount: '' }]);
  };

  const handleRemoveParticipant = (idx: number) => {
    setExtraParticipants((prev) => prev.filter((_, i) => i !== idx));
    // idx + 1 because allocations[0] is always the creator
    setAllocations((prev) => prev.filter((_, i) => i !== idx + 1));
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    const allParticipants = [
      walletAddress ?? '',
      ...extraParticipants.map((a) => a.trim()).filter(Boolean),
    ];

    const initialAllocations = allocations
      .filter((a) => a.address)
      .map((a) => ({ participant: a.address, amount: a.amount || '0' }));

    const id = await onCreate({
      participants: allParticipants,
      token,
      initialAllocations,
    });

    if (id) onCreated(id);
  };

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5 text-[11px] text-blue-800">
        <p className="font-medium mb-0.5">How sessions work</p>
        <p>
          Create a session to enable instant off-chain transfers. Funds come from your
          unified balance. Sessions use Judge governance (creator controls signing).
        </p>
      </div>

      {/* Token */}
      <div>
        <Label className="text-xs text-gray-700">
          Token <span className="text-red-500">*</span>
        </Label>
        <Select value={token} onValueChange={setToken}>
          <SelectTrigger className="h-8 text-sm mt-1 bg-white border-gray-300 text-gray-900">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ASSETS.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Participants + Allocations */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <Label className="text-xs text-gray-700">Participants &amp; Allocations</Label>
          <button
            onClick={handleAddParticipant}
            className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900"
          >
            <Plus className="h-3 w-3" />
            Add
          </button>
        </div>

        <div className="space-y-2">
          {/* Creator (always first) */}
          <div className="bg-gray-50 rounded-lg p-2 space-y-1.5">
            <p className="text-[10px] text-gray-500 font-medium">You (creator)</p>
            <div className="flex items-center gap-2">
              <Input
                value={walletAddress ?? ''}
                disabled
                className="h-7 text-xs bg-gray-100 font-mono flex-1"
              />
              <Input
                type="number"
                min="0"
                step="any"
                placeholder="0.00"
                value={allocations[0]?.amount ?? ''}
                onChange={(e) => {
                  setAllocations((prev) => {
                    const next = [...prev];
                    next[0] = { address: next[0]?.address ?? '', amount: e.target.value };
                    return next;
                  });
                }}
                className="h-7 text-xs bg-white border-gray-300 w-24"
              />
            </div>
            <FieldError msg={errors['alloc_0'] ?? null} />
          </div>

          {/* Extra participants */}
          {extraParticipants.map((addr, i) => (
            <div key={i} className="bg-gray-50 rounded-lg p-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-gray-500 font-medium">
                  Participant {i + 2}
                </p>
                <button
                  onClick={() => handleRemoveParticipant(i)}
                  className="text-gray-400 hover:text-red-500"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <Input
                placeholder="0x..."
                value={addr}
                onChange={(e) => {
                  setExtraParticipants((prev) => {
                    const next = [...prev];
                    next[i] = e.target.value;
                    return next;
                  });
                  setAllocations((prev) => {
                    const next = [...prev];
                    next[i + 1] = { address: e.target.value, amount: next[i + 1]?.amount ?? '' };
                    return next;
                  });
                }}
                className="h-7 text-xs font-mono bg-white border-gray-300"
              />
              <FieldError msg={errors[`addr_${i}`] ?? null} />
              <div className="flex items-center gap-2">
                <Label className="text-[10px] text-gray-500 whitespace-nowrap">
                  Allocation:
                </Label>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="0.00"
                  value={allocations[i + 1]?.amount ?? ''}
                  onChange={(e) => {
                    setAllocations((prev) => {
                      const next = [...prev];
                      next[i + 1] = { address: next[i + 1]?.address ?? '', amount: e.target.value };
                      return next;
                    });
                  }}
                  className="h-7 text-xs bg-white border-gray-300 w-24"
                />
              </div>
              <FieldError msg={errors[`alloc_${i + 1}`] ?? null} />
            </div>
          ))}
        </div>
      </div>

      <Button
        onClick={handleSubmit}
        disabled={creating}
        className="w-full bg-black hover:bg-gray-800 text-white"
      >
        {creating ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Creating…
          </>
        ) : (
          <>
            <Zap className="h-4 w-4 mr-2" />
            Create Session
          </>
        )}
      </Button>
    </div>
  );
}

// ── Join Session Form ─────────────────────────────────────────────────────

function JoinSessionForm({
  userId,
  chain,
  onFound,
}: {
  userId: string;
  chain: string;
  onFound: (session: AppSession) => void;
}) {
  const [sessionId, setSessionId] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async () => {
    if (!sessionId.trim()) {
      setError('Session ID is required');
      return;
    }
    setError(null);
    setSearching(true);
    try {
      const res = await yellowApi.getSession(sessionId.trim(), userId, chain);
      const session = res.data ?? res.session;
      if (res.ok && session) {
        toast.success('Session found!');
        onFound(session);
      } else {
        setError(res.message || 'Session not found or you are not a participant');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to find session');
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-[11px] text-amber-800">
        <p className="font-medium mb-0.5">How joining works</p>
        <p>
          Enter a session ID to look up a session you were invited to. You must have
          been included as a participant when the session was created.
        </p>
      </div>

      <div>
        <Label className="text-xs text-gray-700">Session ID</Label>
        <Input
          placeholder="Paste session ID here..."
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          onBlur={() => setError(!sessionId.trim() ? 'Session ID is required' : null)}
          className="h-9 text-sm mt-1 font-mono bg-white border-gray-300"
        />
        <FieldError msg={error} />
      </div>

      <Button
        onClick={handleSearch}
        disabled={searching}
        className="w-full bg-black hover:bg-gray-800 text-white"
      >
        {searching ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Searching…
          </>
        ) : (
          'Find Session'
        )}
      </Button>
    </div>
  );
}

// ── Session Detail / Manage View ──────────────────────────────────────────

type ManageTab = 'info' | 'transfer' | 'deposit' | 'withdraw';

function SessionManageView({
  session,
  balances,
  walletAddress,
  operating,
  onPatch,
  onClose,
}: {
  session: AppSession;
  balances: { asset: string; amount: string }[];
  walletAddress: string | null;
  operating: boolean;
  onPatch: (intent: 'OPERATE' | 'DEPOSIT' | 'WITHDRAW', allocs: SessionAllocation[]) => Promise<boolean>;
  onClose: () => Promise<boolean>;
}) {
  const [tab, setTab] = useState<ManageTab>('info');
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [allocErrors, setAllocErrors] = useState<string | null>(null);
  const [allocs, setAllocs] = useState<SessionAllocation[]>(session.allocations ?? []);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    setAllocs(session.allocations ?? []);
    setAllocErrors(null);
  }, [session.appSessionId, session.allocations]);

  // Source of truth: allocations (balances are per-account and differ per user).
  const sessionTotalNum = (session.allocations ?? []).reduce(
    (s, a) => s + parseFloat(a.amount || '0'),
    0,
  );
  const sessionTotal = sessionTotalNum.toFixed(6);

  const allocTotal = allocs
    .reduce((s, a) => s + parseFloat(a.amount || '0'), 0)
    .toFixed(6);

  const participantAddresses = (
    session.participants?.map((p) => p.address).filter(Boolean) ??
    allocs.map((a) => a.participant).filter(Boolean)
  ) as string[];

  // Derived: find current user's allocation index
  const userAllocIdx = walletAddress
    ? allocs.findIndex((a) => a.participant.toLowerCase() === walletAddress.toLowerCase())
    : 0;
  const userAllocIdxSafe = userAllocIdx >= 0 ? userAllocIdx : 0;
  const otherAllocIdx = allocs.length === 2 ? (userAllocIdxSafe === 0 ? 1 : 0) : -1;
  const myCurrentAlloc = parseFloat(allocs[userAllocIdxSafe]?.amount ?? '0');
  // Both participants are registered in the session definition from creation —
  // Yellow Network doesn't require allocation entries to enable transfers.
  const canTransfer =
    (session.status ?? '').toLowerCase() === 'open' &&
    (session.participants?.length ?? 0) >= 2;
  // Slider value derived from allocs (0 = all to counterparty, 100 = all to user)
  const sliderValue = sessionTotalNum > 0 ? (myCurrentAlloc / sessionTotalNum) * 100 : 50;

  function getSessionAllocMap(): Map<string, string> {
    const map = new Map<string, string>();
    for (const alloc of session.allocations ?? []) {
      if (!alloc.participant) continue;
      map.set(alloc.participant.toLowerCase(), alloc.amount ?? '0');
    }
    return map;
  }

  function buildDepositWithdrawPayload(
    participant: string,
    amount: string,
  ): SessionAllocation[] {
    return [
      {
        participant,
        amount,
        asset: session.token ?? DEFAULT_ASSET,
      },
    ];
  }

  function validateOperate(): boolean {
    const diff = Math.abs(parseFloat(allocTotal) - parseFloat(sessionTotal));
    if (diff > 0.000001) {
      setAllocErrors(
        `Allocations must sum to exactly ${sessionTotal} (current total). Got ${allocTotal}.`,
      );
      return false;
    }
    setAllocErrors(null);
    return true;
  }

  async function handleOperate() {
    if (!validateOperate()) return;

    const payload = allocs.map((a) => ({
      participant: a.participant,
      amount: a.amount,
      asset: session.token ?? DEFAULT_ASSET,
    }));
    await onPatch('OPERATE', payload);
  }

  const handleDeposit = async () => {
    const depositAmt = parseFloat(depositAmount);
    if (!depositAmount || depositAmt <= 0) return;
    const participant = walletAddress ?? participantAddresses[0] ?? '';
    if (!participant) return;
    const sessionAllocMap = getSessionAllocMap();
    const currentAlloc = parseFloat(
      sessionAllocMap.get(participant.toLowerCase()) ?? myCurrentAlloc.toFixed(6),
    );
    // DEPOSIT: allocations = final desired state (current + delta)
    const newAlloc = (currentAlloc + depositAmt).toFixed(6);
    const ok = await onPatch(
      'DEPOSIT',
      buildDepositWithdrawPayload(participant, newAlloc),
    );
    if (ok) setDepositAmount('');
  };

  const handleWithdraw = async () => {
    const withdrawAmt = parseFloat(withdrawAmount);
    if (!withdrawAmount || withdrawAmt <= 0) return;
    const participant = walletAddress ?? participantAddresses[0] ?? '';
    if (!participant) return;
    const sessionAllocMap = getSessionAllocMap();
    const currentAlloc = parseFloat(
      sessionAllocMap.get(participant.toLowerCase()) ?? myCurrentAlloc.toFixed(6),
    );
    // WITHDRAW: allocations = remaining amount after withdrawal (current - delta)
    const remaining = Math.max(0, currentAlloc - withdrawAmt).toFixed(6);
    const ok = await onPatch(
      'WITHDRAW',
      buildDepositWithdrawPayload(participant, remaining),
    );
    if (ok) setWithdrawAmount('');
  };

  const handleClose = async () => {
    setClosing(true);
    await onClose();
    setClosing(false);
  };

  return (
    <div className="space-y-4">
      {/* Session summary */}
      <div className="bg-gray-50 rounded-xl p-3 space-y-1.5 text-xs">
        <div className="flex justify-between">
          <span className="text-gray-500">Session ID</span>
          <button
            onClick={() => copyToClipboard(session.appSessionId, 'Session ID copied!')}
            className="font-mono text-gray-700 flex items-center gap-1 hover:text-gray-900"
          >
            {truncate(session.appSessionId, 6)}
            <Copy className="h-3 w-3" />
          </button>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Status</span>
          <span
            className={
              session.status === 'open' ? 'text-green-600 font-medium' : 'text-gray-500'
            }
          >
            {session.status}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Chain · Token</span>
          <span>
            {session.chain} · {session.token?.toUpperCase()}
          </span>
        </div>
        <div className="flex justify-between font-medium">
          <span className="text-gray-500">Session Total</span>
          <span>
            {sessionTotal} {session.token?.toUpperCase()}
          </span>
        </div>
      </div>

      {session.status === 'open' ? (
        <Tabs value={tab} onValueChange={(v) => setTab(v as ManageTab)}>
          <TabsList className="grid grid-cols-4 h-8 bg-gray-100 text-gray-600">
            {(['info', 'transfer', 'deposit', 'withdraw'] as const).map((t) => (
              <TabsTrigger key={t} value={t} className="text-[10px] text-gray-600 data-[state=active]:bg-white data-[state=active]:text-gray-900 capitalize">
                {t}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Info tab */}
          <TabsContent value="info" className="space-y-2 mt-2">
            <p className="text-xs font-medium text-gray-700">Participants</p>
            {(() => {
              const participantEntries = session.participants ?? [];
              const fromA = (session.allocations ?? []).map((a) => a.participant).filter(Boolean);
              const joinedByAddress = new Map(
                participantEntries.map((p) => [p.address.toLowerCase(), p.joined]),
              );
              const addresses =
                participantEntries.length > 0
                  ? participantEntries.map((p) => p.address)
                  : fromA;
              return addresses.map((addr) => {
                const alloc = (session.allocations ?? []).find(
                  (a) => a.participant?.toLowerCase() === addr.toLowerCase(),
                );
                const hasJoined = joinedByAddress.get(addr.toLowerCase()) ?? false;
                const isMe = addr.toLowerCase() === walletAddress?.toLowerCase();
                return (
                  <div
                    key={addr}
                    className="bg-gray-50 rounded-lg px-2 py-1.5 flex items-center justify-between text-xs"
                  >
                    <span className="font-mono text-gray-700">{truncate(addr, 8)}</span>
                    <div className="flex items-center gap-1">
                      {isMe && (
                        <span className="text-[10px] bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">
                          You
                        </span>
                      )}
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                          hasJoined ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'
                        }`}
                      >
                        {hasJoined ? 'Joined' : 'Pending'}
                      </span>
                      {alloc && (
                        <span className="text-[10px] font-medium text-gray-700">
                          {parseFloat(alloc.amount || '0').toFixed(4)} {alloc.asset?.toUpperCase()}
                        </span>
                      )}
                    </div>
                  </div>
                );
              });
            })()}

            {balances.length > 0 && (
              <>
                <p className="text-xs font-medium text-gray-700 mt-2">Session Balances</p>
                {balances.map((b) => (
                  <div
                    key={b.asset}
                    className="flex justify-between text-xs bg-gray-50 rounded-lg px-2 py-1.5"
                  >
                    <span className="text-gray-500 uppercase">{b.asset}</span>
                    <span className="font-medium">{b.amount}</span>
                  </div>
                ))}
              </>
            )}
          </TabsContent>

          {/* Transfer (OPERATE) tab */}
          <TabsContent value="transfer" className="space-y-4 mt-3">
            {!canTransfer && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-[10px] text-amber-800">
                Counterparty has not joined yet. Transfers are disabled until both participants are present.
              </div>
            )}
            {allocs.length === 2 && sessionTotalNum > 0 ? (
              /* ── 2-party slider UI ── */
              <div className="space-y-4">
                {/* Participant balance cards */}
                <div className="grid grid-cols-2 gap-2">
                  {/* Counterparty */}
                  <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-1">
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide">Counterparty</p>
                    <p className="font-mono text-[10px] text-gray-500 truncate">
                      {truncate(allocs[otherAllocIdx]?.participant ?? '', 6)}
                    </p>
                    <p className="text-lg font-rubik-medium text-gray-900 leading-none mt-1">
                      {parseFloat(allocs[otherAllocIdx]?.amount ?? '0').toFixed(4)}
                    </p>
                    <p className="text-[10px] text-gray-400">{session.token?.toUpperCase()}</p>
                  </div>

                  {/* You */}
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 space-y-1">
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide">You</p>
                    <p className="font-mono text-[10px] text-gray-500 truncate">
                      {truncate(allocs[userAllocIdxSafe]?.participant ?? '', 6)}
                    </p>
                    <p className="text-lg font-rubik-medium text-white leading-none mt-1">
                      {parseFloat(allocs[userAllocIdxSafe]?.amount ?? '0').toFixed(4)}
                    </p>
                    <p className="text-[10px] text-gray-400">{session.token?.toUpperCase()}</p>
                  </div>
                </div>

                {/* Slider */}
                <div className="space-y-2">
                  {/* Visual split bar */}
                  <div className="relative h-2 rounded-full bg-gray-200 overflow-hidden">
                    <div
                      className="absolute inset-y-0 right-0 bg-gray-900 rounded-full transition-all"
                      style={{ width: `${sliderValue}%` }}
                    />
                  </div>

                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={0.01}
                    value={sliderValue}
                    onChange={(e) => {
                      const pct = parseFloat(e.target.value);
                      const userNew = (pct / 100) * sessionTotalNum;
                      const otherNew = sessionTotalNum - userNew;
                      setAllocs((prev) => {
                        const next = [...prev];
                        next[userAllocIdxSafe] = {
                          participant: next[userAllocIdxSafe]?.participant ?? '',
                          amount: userNew.toFixed(6),
                          asset: next[userAllocIdxSafe]?.asset ?? (session.token ?? DEFAULT_ASSET),
                        };
                        next[otherAllocIdx] = {
                          participant: next[otherAllocIdx]?.participant ?? '',
                          amount: otherNew.toFixed(6),
                          asset: next[otherAllocIdx]?.asset ?? (session.token ?? DEFAULT_ASSET),
                        };
                        return next;
                      });
                      setAllocErrors(null);
                    }}
                    className="w-full appearance-none bg-transparent cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gray-900 [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-runnable-track]:h-0 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-gray-900 [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:border-none"
                  />

                  <div className="flex justify-between text-[10px] text-gray-400">
                    <span>All to counterparty</span>
                    <span>All to you</span>
                  </div>
                </div>

                {/* Total row */}
                <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-xs">
                  <span className="text-gray-500">Session total</span>
                  <span className="font-rubik-medium text-gray-900">
                    {sessionTotalNum.toFixed(4)} {session.token?.toUpperCase()}
                  </span>
                </div>

                <FieldError msg={allocErrors} />

                <Button
                  onClick={handleOperate}
                  disabled={operating || !canTransfer}
                  className="w-full h-9 text-sm bg-gray-900 hover:bg-gray-700 text-white"
                >
                  {operating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    'Confirm Transfer'
                  )}
                </Button>
              </div>
            ) : null}
          </TabsContent>

          {/* Deposit to session tab */}
          <TabsContent value="deposit" className="space-y-3 mt-2">
            <p className="text-[11px] text-gray-500">
              Add funds from your unified balance into this session.
            </p>
            <div className="bg-gray-50 rounded-lg px-3 py-2 flex justify-between text-xs">
              <span className="text-gray-500">Your current allocation</span>
              <span className="font-medium text-gray-900">
                {myCurrentAlloc.toFixed(4)} {session.token?.toUpperCase()}
              </span>
            </div>
            <div>
              <Label className="text-xs text-gray-700">Amount to deposit</Label>
              <Input
                type="number"
                min="0"
                step="any"
                placeholder="0.00"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                className="h-8 text-sm mt-1 bg-white border-gray-300"
              />
            </div>
            {depositAmount && Number(depositAmount) > 0 && (
              <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 flex justify-between text-xs">
                <span className="text-gray-500">New allocation</span>
                <span className="font-medium text-green-700">
                  {(myCurrentAlloc + Number(depositAmount)).toFixed(4)} {session.token?.toUpperCase()}
                </span>
              </div>
            )}
            <Button
              onClick={handleDeposit}
              disabled={operating || !depositAmount || Number(depositAmount) <= 0}
              className="w-full h-8 text-xs bg-black hover:bg-gray-800 text-white"
            >
              {operating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Deposit to Session'}
            </Button>
          </TabsContent>

          {/* Withdraw from session tab */}
          <TabsContent value="withdraw" className="space-y-3 mt-2">
            <p className="text-[11px] text-gray-500">
              Return funds from this session to your unified balance.
            </p>
            <div className="bg-gray-50 rounded-lg px-3 py-2 flex justify-between text-xs">
              <span className="text-gray-500">Your current allocation</span>
              <span className="font-medium text-gray-900">
                {myCurrentAlloc.toFixed(4)} {session.token?.toUpperCase()}
              </span>
            </div>
            <div>
              <Label className="text-xs text-gray-700">Amount to withdraw</Label>
              <Input
                type="number"
                min="0"
                step="any"
                placeholder="0.00"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                className="h-8 text-sm mt-1 bg-white border-gray-300"
              />
              {/* Use epsilon to avoid false positives from float precision. */}
              {withdrawAmount &&
                Number(withdrawAmount) > myCurrentAlloc + 1e-9 && (
                <p className="text-xs text-red-500 mt-1">
                  Cannot exceed your allocation of {myCurrentAlloc.toFixed(4)}
                </p>
              )}
            </div>
            {withdrawAmount &&
              Number(withdrawAmount) > 0 &&
              Number(withdrawAmount) <= myCurrentAlloc + 1e-9 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex justify-between text-xs">
                <span className="text-gray-500">Remaining allocation</span>
                <span className="font-medium text-amber-700">
                  {Math.max(0, myCurrentAlloc - Number(withdrawAmount)).toFixed(4)}{' '}
                  {session.token?.toUpperCase()}
                </span>
              </div>
            )}
            <Button
              onClick={handleWithdraw}
              disabled={
                operating ||
                !withdrawAmount ||
                Number(withdrawAmount) <= 0 ||
                Number(withdrawAmount) > myCurrentAlloc + 1e-9
              }
              className="w-full h-8 text-xs bg-black hover:bg-gray-800 text-white"
            >
              {operating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Withdraw from Session'}
            </Button>
          </TabsContent>
        </Tabs>
      ) : (
        <p className="text-xs text-gray-500">This session is closed.</p>
      )}

      {/* Close session */}
      {session.status === 'open' && (
        <div className="pt-2 border-t border-gray-100">
          <p className="text-[10px] text-gray-400 mb-2">
            Closing returns all funds to unified balance (off-chain). To move funds to
            wallet: close channel → custody withdraw.
          </p>
          <button
            onClick={handleClose}
            disabled={closing}
            className="w-full h-7 text-xs border border-red-200 text-red-600 hover:bg-red-50 rounded-md bg-white transition-colors disabled:opacity-50"
          >
            {closing ? <Loader2 className="h-3 w-3 animate-spin inline" /> : 'Close Session'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── App Session Dialog ────────────────────────────────────────────────────

type DialogMode = 'create' | 'join' | 'manage';

interface SessionDialogState {
  open: boolean;
  mode: DialogMode;
  managedSession: AppSession | null;
}

// ── Main View ─────────────────────────────────────────────────────────────

export function LightningNodesView() {
  const { userId } = useAuth();
  const [chain, setChain] = useState(DEFAULT_CHAIN);

  // All hooks — channels before custody so saveChannelId callback is available
  const auth = useYellowAuth(userId, chain);
  const balances = useYellowBalances(userId, chain, DEFAULT_ASSET, auth.authenticated);
  const channels = useChannelActions(userId, chain, balances.refreshBalances);
  const custody = useCustodyActions(
    userId,
    () => { balances.refreshBalances(); channels.fetchChannels(); },
    channels.saveChannelId,
  );
  const sessions = useAppSessions(userId, chain, auth.authenticated, auth.walletAddress, balances.refreshBalances);

  // Dialog state
  const [dialog, setDialog] = useState<SessionDialogState>({
    open: false,
    mode: 'create',
    managedSession: null,
  });

  const openCreate = () => setDialog({ open: true, mode: 'create', managedSession: null });
  const openJoin = () => setDialog({ open: true, mode: 'join', managedSession: null });
  const openManage = useCallback(
    async (session: AppSession) => {
      setDialog({ open: true, mode: 'manage', managedSession: session });
      await sessions.loadSessionDetail(session.appSessionId);
    },
    [sessions],
  );
  const closeDialog = () => setDialog((d) => ({ ...d, open: false }));

  // Poll session detail every 30s when manage dialog is open (multi-client sync).
  // Kept at 30s to avoid hammering the Yellow Network WebSocket — each poll
  // triggers an auth + WS round-trip and Yellow rate-limits concurrent connections.
  useEffect(() => {
    if (!dialog.open || dialog.mode !== 'manage' || !dialog.managedSession) return;
    const id = dialog.managedSession.appSessionId;
    const interval = setInterval(() => {
      sessions.loadSessionDetail(id);
    }, 30_000);
    return () => clearInterval(interval);
  }, [dialog.open, dialog.mode, dialog.managedSession?.appSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Derive managed session with fresh detail if available
  const managedSessionFresh =
    dialog.mode === 'manage' && sessions.selectedSessionDetail.session
      ? sessions.selectedSessionDetail.session
      : dialog.managedSession;

  if (!userId) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Zap className="h-10 w-10 text-gray-300 mb-3" />
        <p className="text-gray-500 text-sm">Sign in to use Lightning Nodes</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 pb-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-rubik-medium text-gray-900 flex items-center gap-1.5">
            <Zap className="h-4 w-4" />
            Lightning Node
          </h2>
          <p className="text-[11px] text-gray-500">
            Yellow Network off-chain payment channels
                </p>
              </div>
        <Select value={chain} onValueChange={setChain}>
          <SelectTrigger className="h-7 w-28 text-xs bg-white border-gray-300 text-gray-900">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CHAINS.map((c) => (
              <SelectItem key={c.id} value={c.id} className="text-xs">
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Auth Card */}
      <LightningAuthCard
        authenticated={auth.authenticated}
        authenticating={auth.authenticating}
        sessionId={auth.sessionId}
        expiresAt={auth.expiresAt}
        walletAddress={auth.walletAddress}
        authError={auth.authError}
        onReauth={auth.authenticate}
      />

      {/* Balances Card */}
      <LightningBalancesCard
        unified={balances.unified}
        custodyAvailable={balances.custodyAvailable}
        walletUsdcBalance={balances.walletUsdcBalance}
        loading={balances.balancesLoading}
        error={balances.balancesError}
        onRefresh={balances.refreshBalances}
      />

      {/* Custody + Channel actions — only shown when authenticated */}
      {auth.authenticated && (
        <>
          {/* Custody actions (Deposit / Withdraw / Move Balance) */}
          <CustodyActionsCard
            depositing={custody.depositing}
            withdrawing={custody.withdrawing}
            custodyAvailable={balances.custodyAvailable}
            unified={balances.unified}
            channels={channels.channels}
            channelsLoading={channels.channelsLoading}
            closingChannelId={channels.closingChannelId}
            storedChannelId={channels.storedChannelId}
            onDeposit={custody.depositToCustody}
            onWithdraw={custody.withdrawFromCustody}
            onCloseChannel={channels.closeChannel}
            onDismissStoredChannel={channels.dismissStoredChannel}
            onFetchChannels={channels.fetchChannels}
          />

          {/* App Sessions */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-rubik-medium text-gray-900">
                App Sessions
                {sessions.sessions.length > 0 && (
                  <span className="ml-1.5 bg-gray-100 text-gray-600 text-[10px] px-1.5 py-0.5 rounded-full">
                    {sessions.sessions.length}
                  </span>
                )}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={sessions.discoverSessions}
                  disabled={sessions.sessionsLoading}
                  className="text-gray-400 hover:text-gray-700 disabled:opacity-40"
                  title="Discover sessions"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${sessions.sessionsLoading ? 'animate-spin' : ''}`}
                  />
                </button>
                <button
                  onClick={openJoin}
                  className="h-7 px-3 text-xs border border-gray-300 text-gray-700 rounded-md bg-white hover:bg-gray-50 transition-colors"
                >
                  Join
                </button>
                <Button
                  onClick={openCreate}
                  className="h-7 text-xs bg-black hover:bg-gray-800 text-white"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Create
                </Button>
              </div>
            </div>

            {sessions.sessionsLoading && sessions.sessions.length === 0 && (
              <div className="flex items-center gap-2 text-xs text-gray-500 py-4 justify-center">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Discovering sessions…
              </div>
            )}

            {!sessions.sessionsLoading && sessions.sessionsError && (
              <p className="text-xs text-red-500">{sessions.sessionsError}</p>
            )}

            {!sessions.sessionsLoading && sessions.sessions.length === 0 && !sessions.sessionsError && (
              <div className="text-center py-6 text-xs text-gray-400">
                <Zap className="h-8 w-8 mx-auto mb-2 text-gray-200" />
                No sessions found. Create one to get started.
              </div>
            )}

            {sessions.sessions
              .filter((s) => (s.status || '').toLowerCase() !== 'closed')
              .filter((s) => {
                const me = auth.walletAddress?.toLowerCase();
                if (!me) return false;
                // Yellow Network returns participants: null in many responses so
                // normalised participants all get joined=false. Show the session
                // whenever the user's address appears in the list OR when the
                // participants list is empty (API already scopes to the authed user).
                if (!s.participants?.length) return true;
                return s.participants.some((p) => p.address.toLowerCase() === me);
              })
              .map((s) => (
              <SessionCard
                key={s.appSessionId}
                session={s}
                walletAddress={auth.walletAddress}
                onManage={() => openManage(s)}
                onClose={() => sessions.closeSession(s.appSessionId)}
                isClosing={sessions.closingSessionId === s.appSessionId}
              />
            ))}
          </div>
        </>
      )}

      {/* Hint when not authenticated */}
      {!auth.authenticated && !auth.authenticating && (
        <div className="text-center py-4">
          <p className="text-xs text-gray-400">
            Authenticate above to access custody, channels, and sessions.
          </p>
        </div>
      )}

      {/* Session Dialog */}
      <Dialog open={dialog.open} onOpenChange={(v) => !v && closeDialog()}>
        <DialogContent className="sm:max-w-[480px] bg-white text-gray-900 max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-gray-900">
              <Zap className="h-4 w-4" />
              {dialog.mode === 'create'
                ? 'Create Session'
                : dialog.mode === 'join'
                  ? 'Join Session'
                  : 'Manage Session'}
            </DialogTitle>
            <DialogDescription className="text-gray-500 text-xs">
              {dialog.mode === 'create'
                ? 'Create a new Yellow Network app session for instant off-chain transfers.'
                : dialog.mode === 'join'
                  ? 'Find a session you were invited to by entering its ID.'
                  : `Session ${managedSessionFresh ? truncate(managedSessionFresh.appSessionId, 6) : ''}`}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto pr-1">
            {dialog.mode === 'create' && userId && (
              <CreateSessionForm
                walletAddress={auth.walletAddress}
                userId={userId}
                chain={chain}
                creating={sessions.creating}
                onCreate={sessions.createSession}
                onCreated={(id) => {
                  closeDialog();
                  toast.success(`Session created: ${id}`);
                }}
              />
            )}

            {dialog.mode === 'join' && userId && (
              <JoinSessionForm
                userId={userId}
                chain={chain}
                onFound={(session) => {
                  // Normalize session data (query endpoint may return definition.participants)
                  const def = (session as any).definition;
                  const normalizeParticipants = (
                    participants: AppSession['participants'] | string[] | undefined,
                    allocations: SessionAllocation[] | undefined,
                    defParticipants?: string[],
                  ): AppSession['participants'] => {
                    if (participants && participants.length > 0) {
                      const first = participants[0] as any;
                      if (typeof first === 'string') {
                        return (participants as string[]).map((address) => ({
                          address,
                          joined: false,
                        }));
                      }
                      return participants as AppSession['participants'];
                    }
                    const fallbackList =
                      defParticipants && defParticipants.length > 0
                        ? defParticipants
                        : (allocations ?? [])
                            .map((a) => a.participant)
                            .filter(Boolean);
                    return fallbackList.map((address) => ({ address, joined: false }));
                  };
                  const normalized: AppSession = {
                    ...session,
                    chain: session.chain || chain,
                    token:
                      session.token ||
                      session.allocations?.[0]?.asset ||
                      'usdc',
                    participants: normalizeParticipants(
                      session.participants as any,
                      session.allocations,
                      def?.participants,
                    ),
                  };
                  // Add to sessions list if not present
                  sessions.discoverSessions();
                  closeDialog();
                  // Open manage dialog for found session
                  setTimeout(() => openManage(normalized), 150);
                }}
              />
            )}

            {dialog.mode === 'manage' && managedSessionFresh && userId && (
              <SessionManageView
                session={managedSessionFresh}
                balances={sessions.selectedSessionDetail.balances}
                walletAddress={auth.walletAddress}
                operating={sessions.operating}
                onPatch={(intent, allocs) =>
                  sessions.patchSession(managedSessionFresh.appSessionId, intent, allocs)
                }
                onClose={async () => {
                  const ok = await sessions.closeSession(managedSessionFresh.appSessionId);
                  if (ok) closeDialog();
                  return ok;
                }}
              />
            )}

            {dialog.mode === 'manage' && sessions.selectedSessionDetail.loading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
