'use client';

import { useState } from 'react';
import { Loader2, Copy, X, Info } from 'lucide-react';
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
import { CHAINS, ASSETS, DEFAULT_CHAIN, DEFAULT_ASSET, copyToClipboard, truncate } from './lightning-constants';
import { FieldError } from './field-error';

type CustodyTab = 'deposit' | 'withdraw' | 'move';

interface CustodyActionsCardProps {
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
}

export function CustodyActionsCard({
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
}: CustodyActionsCardProps) {
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
    <div className="h-full bg-[#161616] border border-white/10 rounded-xl p-4">
      <p className="text-sm font-rubik-medium text-white mb-2">Custody</p>

      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as CustodyTab);
          if (v === 'move') onFetchChannels();
        }}
      >
        <TabsList className="grid grid-cols-3 h-9 mb-3 bg-[#161616] border border-white/10 rounded-xl p-1">
          <TabsTrigger value="deposit" className="text-xs text-gray-300 rounded-lg data-[state=active]:bg-yellow-400 data-[state=active]:text-black">
            Deposit
          </TabsTrigger>
          <TabsTrigger value="withdraw" className="text-xs text-gray-300 rounded-lg data-[state=active]:bg-yellow-400 data-[state=active]:text-black">
            Withdraw
          </TabsTrigger>
          <TabsTrigger value="move" className="text-xs text-gray-300 rounded-lg data-[state=active]:bg-yellow-400 data-[state=active]:text-black">
            Move
          </TabsTrigger>
        </TabsList>

        <TabsContent value="deposit" className="space-y-2 mt-0">
          <p className="text-[10px] text-gray-400">
            Move on-chain wallet funds into custody contract (costs gas).
          </p>

          <div>
            <Label className="text-xs text-gray-300">Amount</Label>
            <Input
              type="number"
              min="0"
              step="any"
              placeholder="0.00"
              value={depositAmt}
              onChange={(e) => { setDepositAmt(e.target.value); setAmountError(null); }}
              onBlur={() => setAmountError(validateAmount(depositAmt))}
              className="h-8 text-sm mt-1 bg-[#161616] border-white/10 text-white placeholder:text-gray-500"
            />
            <FieldError msg={tab === 'deposit' ? amountError : null} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-gray-300">Asset</Label>
              <Select value={asset} onValueChange={setAsset}>
                <SelectTrigger className="h-8 text-xs mt-1 bg-[#161616] border-white/10 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#161616] text-white border-white/10">
                  {ASSETS.map((a) => (
                    <SelectItem key={a.id} value={a.id} className="text-xs">
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-gray-300">Chain</Label>
              <Select value={chain} onValueChange={setChain}>
                <SelectTrigger className="h-8 text-xs mt-1 bg-[#161616] border-white/10 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#161616] text-white border-white/10">
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
            className="w-full h-8 text-xs bg-yellow-400 hover:bg-yellow-500 text-black"
          >
            {depositing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Deposit to Custody'}
          </Button>
        </TabsContent>

        <TabsContent value="withdraw" className="space-y-2 mt-0">
          <p className="text-[10px] text-gray-400">
            Move custody funds back to your wallet (costs gas).
          </p>

          {custodyAvailable != null && (
            <div className="bg-[#161616] border border-white/10 rounded-lg px-3 py-1.5 flex justify-between text-xs">
              <span className="text-gray-300">Available to withdraw</span>
              <span className="font-medium text-white">
                {parseFloat(custodyAvailable).toFixed(4)} {asset.toUpperCase()}
              </span>
            </div>
          )}

          <div>
            <Label className="text-xs text-gray-300">Amount</Label>
            <Input
              type="number"
              min="0"
              step="any"
              placeholder="0.00"
              value={withdrawAmt}
              onChange={(e) => { setWithdrawAmt(e.target.value); setAmountError(null); }}
              onBlur={() => setAmountError(validateAmount(withdrawAmt))}
              className="h-8 text-sm mt-1 bg-[#161616] border-white/10 text-white placeholder:text-gray-500"
            />
            <FieldError msg={tab === 'withdraw' ? amountError : null} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-gray-300">Asset</Label>
              <Select value={asset} onValueChange={setAsset}>
                <SelectTrigger className="h-8 text-xs mt-1 bg-[#161616] border-white/10 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#161616] text-white border-white/10">
                  {ASSETS.map((a) => (
                    <SelectItem key={a.id} value={a.id} className="text-xs">
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-gray-300">Chain</Label>
              <Select value={chain} onValueChange={setChain}>
                <SelectTrigger className="h-8 text-xs mt-1 bg-[#161616] border-white/10 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#161616] text-white border-white/10">
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
            className="w-full h-8 text-xs bg-yellow-400 hover:bg-yellow-500 text-black"
          >
            {withdrawing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Withdraw from Custody'}
          </Button>
        </TabsContent>

        <TabsContent value="move" className="space-y-2 mt-0">
          <p className="text-[10px] text-gray-400">
            Close your payment channel to release locked funds back to custody.
            Then use the <strong>Withdraw</strong> tab to send funds to your wallet.
          </p>

          {/* Balances summary */}
          <div className="grid grid-cols-2 gap-1.5">
            <div className="bg-gray-950/30 border border-gray-800 rounded-lg px-2.5 py-1.5">
              <p className="text-[10px] text-gray-400">Unified</p>
              <p className="text-xs font-medium text-white">{unifiedAvail.toFixed(4)} USDC</p>
            </div>
            <div className="bg-gray-950/30 border border-gray-800 rounded-lg px-2.5 py-1.5">
              <p className="text-[10px] text-gray-400">Custody available</p>
              <p className="text-xs font-medium text-white">
                {custodyAvailable != null ? `${parseFloat(custodyAvailable).toFixed(4)} USDC` : '—'}
              </p>
            </div>
          </div>

          {/* Active Channel from localStorage */}
          {storedChannelId && (
            <div className="bg-gray-950/30 border border-yellow-400/20 rounded-lg px-2.5 py-2">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] text-yellow-300 font-medium">Active Channel</p>
                <button
                  onClick={onDismissStoredChannel}
                  className="text-gray-400 hover:text-gray-200"
                  title="Dismiss"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-mono text-xs text-gray-200">{truncate(storedChannelId, 8)}</p>
                  <button
                    onClick={() => copyToClipboard(storedChannelId, 'Channel ID copied!')}
                    className="flex items-center gap-1 text-[10px] text-yellow-300/80 hover:text-yellow-300 mt-0.5"
                  >
                    <Copy className="h-2.5 w-2.5" />
                    Copy full ID
                  </button>
                </div>
                <Button
                  onClick={() => onCloseChannel(storedChannelId)}
                  disabled={closingChannelId === storedChannelId}
                  variant="outline"
                  className="h-7 text-[10px] px-2.5 border-yellow-400/20 text-yellow-200 hover:bg-yellow-500/10 bg-gray-950/30"
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
            <div className="flex items-center gap-1.5 text-xs text-gray-400 py-2 justify-center">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading channels…
            </div>
          ) : channels.length === 0 && !storedChannelId ? (
            <div className="bg-gray-950/30 border border-gray-800 rounded-lg p-2 text-[10px] text-gray-400 text-center">
              No open payment channels. Deposit to custody to get started.
            </div>
          ) : channels.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-[10px] text-gray-400 font-medium">Open channels:</p>
              {channels.map((ch) => {
                const isStored = ch.channelId === storedChannelId;
                return (
                  <div
                    key={ch.channelId}
                    className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs ${
                      isStored ? 'bg-yellow-400/10 border border-yellow-400/20' : 'bg-gray-950/30 border border-gray-800'
                    }`}
                  >
                    <div>
                      <p className="font-mono text-gray-200">{truncate(ch.channelId, 5)}</p>
                      <p className="text-[10px] text-gray-400">{ch.status}</p>
                    </div>
                    <Button
                      onClick={() => onCloseChannel(ch.channelId)}
                      disabled={closingChannelId === ch.channelId}
                      variant="outline"
                      className="h-6 text-[10px] px-2 border-gray-700 text-gray-200 hover:bg-gray-900 bg-gray-950/30"
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
