'use client';

import { useState, useEffect } from 'react';
import { Loader2, Copy } from 'lucide-react';
import { Button } from '@repo/ui/components/ui/button';
import { Input } from '@repo/ui/components/ui/input';
import { Label } from '@repo/ui/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/ui/tabs';
import { AppSession, SessionAllocation } from '@/lib/yellow-api';
import { DEFAULT_ASSET, copyToClipboard, truncate } from './lightning-constants';
import { FieldError } from './field-error';

type ManageTab = 'info' | 'transfer' | 'deposit' | 'withdraw';

interface SessionManageViewProps {
  session: AppSession;
  balances: { asset: string; amount: string }[];
  walletAddress: string | null;
  operating: boolean;
  onPatch: (intent: 'OPERATE' | 'DEPOSIT' | 'WITHDRAW', allocs: SessionAllocation[]) => Promise<boolean>;
  onClose: () => Promise<boolean>;
}

export function SessionManageView({
  session,
  balances,
  walletAddress,
  operating,
  onPatch,
  onClose,
}: SessionManageViewProps) {
  const [tab, setTab] = useState<ManageTab>('info');
  const [transferAmount, setTransferAmount] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [allocErrors, setAllocErrors] = useState<string | null>(null);
  const [allocs, setAllocs] = useState<SessionAllocation[]>(session.allocations ?? []);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    setAllocs(session.allocations ?? []);
    setAllocErrors(null);
    setTransferAmount('');
  }, [session.appSessionId, session.allocations]);

  const sessionTotalNum = (session.allocations ?? []).reduce(
    (s, a) => s + parseFloat(a.amount || '0'),
    0,
  );
  const sessionTotal = sessionTotalNum.toFixed(6);

  const participantAddresses = (
    session.participants?.map((p) => p.address).filter(Boolean) ??
    allocs.map((a) => a.participant).filter(Boolean)
  ) as string[];

  const userAllocIdx = walletAddress
    ? allocs.findIndex((a) => a.participant.toLowerCase() === walletAddress.toLowerCase())
    : 0;
  const userAllocIdxSafe = userAllocIdx >= 0 ? userAllocIdx : 0;
  const otherAllocIdx = allocs.length === 2 ? (userAllocIdxSafe === 0 ? 1 : 0) : -1;
  const myCurrentAlloc = parseFloat(allocs[userAllocIdxSafe]?.amount ?? '0');

  const canTransfer =
    (session.status ?? '').toLowerCase() === 'open' &&
    (session.participants?.length ?? 0) >= 2 &&
    allocs.length >= 2 &&
    otherAllocIdx >= 0;

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
    return [{ participant, amount, asset: session.token ?? DEFAULT_ASSET }];
  }

  async function handleOperate() {
    if (!canTransfer) return;
    const payload = allocs.map((a) => ({
      participant: a.participant,
      amount: a.amount,
      asset: session.token ?? DEFAULT_ASSET,
    }));
    await onPatch('OPERATE', payload);
  }

  function handleTransferAmountChange(value: string) {
    setTransferAmount(value);
    const parsed = parseFloat(value);
    if (!value || Number.isNaN(parsed) || parsed <= 0) {
      setAllocErrors(null);
      return;
    }
    if (parsed > myCurrentAlloc + 1e-9) {
      setAllocErrors(`Cannot exceed your allocation of ${myCurrentAlloc.toFixed(4)}.`);
      return;
    }
    if (otherAllocIdx < 0) {
      setAllocErrors('Counterparty allocation is not available yet.');
      return;
    }

    const userNew = Math.max(0, myCurrentAlloc - parsed);
    const otherCurrent = parseFloat(allocs[otherAllocIdx]?.amount ?? '0');
    const otherNew = otherCurrent + parsed;

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
    const newAlloc = (currentAlloc + depositAmt).toFixed(6);
    const ok = await onPatch('DEPOSIT', buildDepositWithdrawPayload(participant, newAlloc));
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
    const remaining = Math.max(0, currentAlloc - withdrawAmt).toFixed(6);
    const ok = await onPatch('WITHDRAW', buildDepositWithdrawPayload(participant, remaining));
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
      <div className="bg-[#161616] border border-white/10 rounded-xl p-3 space-y-1.5 text-xs">
        <div className="flex justify-between">
          <span className="text-gray-300">Session ID</span>
          <button
            onClick={() => copyToClipboard(session.appSessionId, 'Session ID copied!')}
            className="font-mono text-gray-200 flex items-center gap-1 hover:text-white"
          >
            {truncate(session.appSessionId, 6)}
            <Copy className="h-3 w-3" />
          </button>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-300">Chain · Token</span>
          <span className="text-gray-200">{session.chain} · {session.token?.toUpperCase()}</span>
        </div>
        <div className="flex justify-between font-medium">
          <span className="text-gray-300">Session Total</span>
          <span className="text-white">{sessionTotal} {session.token?.toUpperCase()}</span>
        </div>
      </div>

      {session.status === 'open' ? (
        <Tabs value={tab} onValueChange={(v) => setTab(v as ManageTab)}>
          <TabsList className="grid grid-cols-4 h-8 bg-[#161616] border border-white/10 text-gray-300">
            {(['info', 'transfer', 'deposit', 'withdraw'] as const).map((t) => (
              <TabsTrigger key={t} value={t} className="text-[10px] text-gray-400 data-[state=active]:bg-yellow-400 data-[state=active]:text-black capitalize">
                {t}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Info tab */}
          <TabsContent value="info" className="space-y-2 mt-2">
            <p className="text-xs font-medium text-gray-200">Participants</p>
            {(() => {
              const participantEntries = session.participants ?? [];
              const fromA = (session.allocations ?? []).map((a) => a.participant).filter(Boolean);
              const addresses =
                participantEntries.length > 0
                  ? participantEntries.map((p) => p.address)
                  : fromA;
              return addresses.map((addr) => {
                const alloc = (session.allocations ?? []).find(
                  (a) => a.participant?.toLowerCase() === addr.toLowerCase(),
                );
                return (
                  <div
                    key={addr}
                    className="bg-black/40 border border-gray-800 rounded-lg px-2 py-1.5 flex items-center justify-between text-xs"
                  >
                    <span className="font-mono text-gray-200">{truncate(addr, 8)}</span>
                    <div className="flex items-center gap-1">
                      {alloc && (
                        <span className="text-[10px] font-medium text-gray-300">
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
                <p className="text-xs font-medium text-gray-100 mt-2">Session Balances</p>
                {balances.map((b) => (
                  <div key={b.asset} className="flex justify-between text-xs bg-black/40 border border-gray-800 rounded-lg px-2 py-1.5">
                    <span className="text-gray-500 uppercase">{b.asset}</span>
                    <span className="font-medium text-gray-200">{b.amount}</span>
                  </div>
                ))}
              </>
            )}
          </TabsContent>

          {/* Transfer (OPERATE) tab */}
          <TabsContent value="transfer" className="space-y-4 mt-3">
            {!canTransfer && (
              <div className="bg-yellow-400/10 border border-yellow-300/25 rounded-lg p-2 text-[10px] text-yellow-100">
                Counterparty has not joined yet. Transfers are disabled until both participants are present.
              </div>
            )}
            {allocs.length === 2 && sessionTotalNum > 0 && otherAllocIdx >= 0 ? (
              <div className="space-y-4">
                <div className="bg-[#161616] border border-white/10 rounded-lg px-3 py-2 text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Your balance</span>
                    <span className="font-medium text-gray-200">
                      {myCurrentAlloc.toFixed(4)} {session.token?.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Counterparty balance</span>
                    <span className="font-medium text-gray-200">
                      {parseFloat(allocs[otherAllocIdx]?.amount ?? '0').toFixed(4)}{' '}
                      {session.token?.toUpperCase()}
                    </span>
                  </div>
                </div>

                <div>
                  <Label className="text-xs text-gray-300">Amount to send</Label>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="0.00"
                    value={transferAmount}
                    onChange={(e) => handleTransferAmountChange(e.target.value)}
                    className="h-8 text-sm mt-1 bg-[#161616] border-white/10 text-white"
                  />
                </div>

                {transferAmount && Number(transferAmount) > 0 && Number(transferAmount) <= myCurrentAlloc + 1e-9 && (
                  <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2 text-xs space-y-1">
                    <div className="flex justify-between">
                      <span className="text-gray-500">You</span>
                      <span className="font-medium text-yellow-200">
                        {myCurrentAlloc.toFixed(4)}
                        {' -> '}
                        {Math.max(0, myCurrentAlloc - Number(transferAmount)).toFixed(4)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Counterparty</span>
                      <span className="font-medium text-yellow-200">
                        {parseFloat(allocs[otherAllocIdx]?.amount ?? '0').toFixed(4)}
                        {' -> '}
                        {(parseFloat(allocs[otherAllocIdx]?.amount ?? '0') + Number(transferAmount)).toFixed(4)}
                      </span>
                    </div>
                  </div>
                )}

                <FieldError msg={allocErrors} />

                <Button
                  onClick={handleOperate}
                  disabled={
                    operating ||
                    !canTransfer ||
                    !transferAmount ||
                    Number(transferAmount) <= 0 ||
                    Number(transferAmount) > myCurrentAlloc + 1e-9
                  }
                  className="w-full h-9 text-sm bg-yellow-400 hover:bg-yellow-500 text-black"
                >
                  {operating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send'}
                </Button>
              </div>
            ) : null}
          </TabsContent>

          {/* Deposit to session tab */}
          <TabsContent value="deposit" className="space-y-3 mt-2">
            <p className="text-[11px] text-gray-400">Add funds from your unified balance into this session.</p>
            <div className="bg-[#161616] border border-white/10 rounded-lg px-3 py-2 flex justify-between text-xs">
              <span className="text-gray-500">Your current allocation</span>
              <span className="font-medium text-gray-200">
                {myCurrentAlloc.toFixed(4)} {session.token?.toUpperCase()}
              </span>
            </div>
            <div>
              <Label className="text-xs text-gray-300">Amount to deposit</Label>
              <Input
                type="number" min="0" step="any" placeholder="0.00"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                className="h-8 text-sm mt-1 bg-[#161616] border-white/10 text-white"
              />
            </div>
            {depositAmount && Number(depositAmount) > 0 && (
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2 flex justify-between text-xs">
                <span className="text-gray-500">New allocation</span>
                <span className="font-medium text-yellow-200">
                  {(myCurrentAlloc + Number(depositAmount)).toFixed(4)} {session.token?.toUpperCase()}
                </span>
              </div>
            )}
            <Button
              onClick={handleDeposit}
              disabled={operating || !depositAmount || Number(depositAmount) <= 0}
              className="w-full h-8 text-xs bg-yellow-400 hover:bg-yellow-500 text-black"
            >
              {operating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Deposit to Session'}
            </Button>
          </TabsContent>

          {/* Withdraw from session tab */}
          <TabsContent value="withdraw" className="space-y-3 mt-2">
            <p className="text-[11px] text-gray-400">Return funds from this session to your unified balance.</p>
            <div className="bg-[#161616] border border-white/10 rounded-lg px-3 py-2 flex justify-between text-xs">
              <span className="text-gray-500">Your current allocation</span>
              <span className="font-medium text-gray-200">
                {myCurrentAlloc.toFixed(4)} {session.token?.toUpperCase()}
              </span>
            </div>
            <div>
              <Label className="text-xs text-gray-300">Amount to withdraw</Label>
              <Input
                type="number" min="0" step="any" placeholder="0.00"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                className="h-8 text-sm mt-1 bg-[#161616] border-white/10 text-white"
              />
              {withdrawAmount && Number(withdrawAmount) > myCurrentAlloc + 1e-9 && (
                <p className="text-xs text-red-500 mt-1">
                  Cannot exceed your allocation of {myCurrentAlloc.toFixed(4)}
                </p>
              )}
            </div>
            {withdrawAmount && Number(withdrawAmount) > 0 && Number(withdrawAmount) <= myCurrentAlloc + 1e-9 && (
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2 flex justify-between text-xs">
                <span className="text-gray-500">Remaining allocation</span>
                <span className="font-medium text-yellow-200">
                  {Math.max(0, myCurrentAlloc - Number(withdrawAmount)).toFixed(4)} {session.token?.toUpperCase()}
                </span>
              </div>
            )}
            <Button
              onClick={handleWithdraw}
              disabled={operating || !withdrawAmount || Number(withdrawAmount) <= 0 || Number(withdrawAmount) > myCurrentAlloc + 1e-9}
              className="w-full h-8 text-xs bg-yellow-400 hover:bg-yellow-500 text-black"
            >
              {operating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Withdraw from Session'}
            </Button>
          </TabsContent>
        </Tabs>
      ) : (
        <p className="text-xs text-gray-500">This session is closed.</p>
      )}

      {session.status === 'open' && (
        <div className="pt-2 border-t border-white/10">
          <p className="text-[10px] text-gray-400 mb-2">
            Closing returns all funds to unified balance (off-chain). To move funds to
            wallet: close channel → custody withdraw.
          </p>
          <button
            onClick={handleClose}
            disabled={closing}
            className="w-full h-7 text-xs border border-red-400/25 text-red-300 hover:bg-red-500/10 rounded-md bg-black/40 transition-colors disabled:opacity-50"
          >
            {closing ? <Loader2 className="h-3 w-3 animate-spin inline" /> : 'Close Session'}
          </button>
        </div>
      )}
    </div>
  );
}
