// Directory structure for Lightning dashboard components:
//
// File                         Purpose
// --------------------------   ------------------------------------------------------------
// lightning-constants.ts       Shared constants (CHAINS, ASSETS, DEFAULT_CHAIN, etc.), and
//                             utility functions (copyToClipboard, formatExpiry, truncate)
//
// field-error.tsx              Tiny reusable FieldError validation message component
// status-card.tsx              Authentication status card (Status tab)
// balances-card.tsx            Balance ring chart + lightning/on-chain split (Balances tab)
// custody-actions-card.tsx     Deposit / Withdraw / Move channel funds (Move Funds tab)
// session-card.tsx             Individual session card in the sessions list
// create-session-form.tsx      Create session dialog form
// join-session-form.tsx        Join session dialog form
// session-manage-view.tsx      Session detail/manage dialog (transfer slider, deposit, withdraw, close)
// lightning-nodes-view.tsx     Slim orchestrator — hooks + tab routing + dialog, imports everything above


'use client';

import type React from 'react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, Zap, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@repo/ui/components/ui/button';
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
import { AppSession, SessionAllocation } from '@/lib/yellow-api';
import { CHAINS, DEFAULT_CHAIN, DEFAULT_ASSET } from './lightning-constants';
import { StatusCard } from './status-card';
import { BalancesCard } from './balances-card';
import { CustodyActionsCard } from './custody-actions-card';
import { SessionCard } from './session-card';
import { CreateSessionForm } from './create-session-form';
import { JoinSessionForm } from './join-session-form';
import { SessionManageView } from './session-manage-view';
import { SessionDialog } from './session-dialog';

type DialogMode = 'create' | 'join' | 'manage';
type LightningTopTab = 'status' | 'balances' | 'moveFunds' | 'appSessions';

interface SessionDialogState {
  open: boolean;
  mode: DialogMode;
  managedSession: AppSession | null;
}

export function LightningNodesView({
  onYellowAuthStateChangeAction,
}: {
  onYellowAuthStateChangeAction?: (next: { authenticated: boolean; authenticating: boolean }) => void;
}) {
  const { userId } = useAuth();
  const [chain, setChain] = useState(DEFAULT_CHAIN);

  const auth = useYellowAuth(userId, chain);
  const balances = useYellowBalances(userId, chain, DEFAULT_ASSET, auth.authenticated);
  const channels = useChannelActions(userId, chain, balances.refreshBalances);
  const custody = useCustodyActions(
    userId,
    () => { balances.refreshBalances(); channels.fetchChannels(); },
    channels.saveChannelId,
  );
  const sessions = useAppSessions(userId, chain, auth.authenticated, auth.walletAddress, balances.refreshBalances);

  useEffect(() => {
    onYellowAuthStateChangeAction?.({
      authenticated: auth.authenticated,
      authenticating: auth.authenticating,
    });
  }, [auth.authenticated, auth.authenticating, onYellowAuthStateChangeAction]);

  // ── Dialog state ────────────────────────────────────────────────────────
  const [dialog, setDialog] = useState<SessionDialogState>({
    open: false,
    mode: 'create',
    managedSession: null,
  });

  const openCreate = () => setDialog({ open: true, mode: 'create', managedSession: null });
  const openManage = useCallback(
    async (session: AppSession) => {
      setDialog({ open: true, mode: 'manage', managedSession: session });
      await sessions.loadSessionDetail(session.appSessionId);
    },
    [sessions],
  );
  const closeDialog = () => setDialog((d: SessionDialogState) => ({ ...d, open: false }));

  useEffect(() => {
    if (!dialog.open || dialog.mode !== 'manage' || !dialog.managedSession) return;
    const id = dialog.managedSession.appSessionId;
    const interval = setInterval(() => {
      sessions.loadSessionDetail(id);
    }, 30_000);
    return () => clearInterval(interval);
  }, [dialog.open, dialog.mode, dialog.managedSession?.appSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const managedSessionFresh =
    dialog.mode === 'manage' && sessions.selectedSessionDetail.session
      ? sessions.selectedSessionDetail.session
      : dialog.managedSession;

  // ── Top tab state ───────────────────────────────────────────────────────
  const [topTab, setTopTab] = useState<LightningTopTab>('status');
  const handleTopTabChange = (value: LightningTopTab) => setTopTab(value);
  const hasAutoSwitchedToBalancesRef = useRef(false);
  const [dismissedSessionIds, setDismissedSessionIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!auth.authenticated) return;
    if (hasAutoSwitchedToBalancesRef.current) return;
    if (topTab !== 'status') return;
    hasAutoSwitchedToBalancesRef.current = true;
    setTopTab('balances');
  }, [auth.authenticated, topTab]);

  const visibleSessions = sessions.sessions
    .filter((s) => (s.status || '').toLowerCase() !== 'closed')
    .filter((s) => !dismissedSessionIds.has(s.appSessionId))
    .filter((s) => {
      const me = auth.walletAddress?.toLowerCase();
      if (!me) return false;
      if (!s.participants?.length) return true;
      return s.participants.some((p) => p.address.toLowerCase() === me);
    });

  // ── Not signed in ───────────────────────────────────────────────────────
  if (!userId) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Zap className="h-10 w-10 text-gray-300 mb-3" />
        <p className="text-gray-500 text-sm">Sign in to use Lightning Nodes</p>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="bg-[#161616] border border-white/10 rounded-2xl p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-rubik-medium text-white flex items-center gap-1.5">
            <Zap className="h-4 w-4 text-yellow-400" />
            Lightning Node
          </h2>
          <p className="text-[11px] text-gray-300">Yellow Network off-chain payment channels</p>
        </div>
        <Select value={chain} onValueChange={setChain}>
          <SelectTrigger className="h-7 w-28 text-xs bg-[#161616] border-white/10 text-white">
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

      {/* Top Tabs */}
  <Tabs value={topTab} onValueChange={(v: string) => handleTopTabChange(v as LightningTopTab)}>
        <TabsList className="grid grid-cols-4 h-9 bg-[#161616] border border-white/10 rounded-xl p-1">
          {(
            [
              { id: 'status', label: 'Status' },
              { id: 'balances', label: 'Balances' },
              { id: 'moveFunds', label: 'Move Funds' },
              { id: 'appSessions', label: 'App Sessions' },
            ] as const
          ).map((t) => (
            <TabsTrigger
              key={t.id}
              value={t.id}
              className="text-xs text-gray-300 rounded-lg px-2 data-[state=active]:bg-yellow-400 data-[state=active]:text-black data-[state=active]:shadow-sm"
            >
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Status */}
        <TabsContent value="status" className="mt-3 min-h-[430px] max-h-[430px] overflow-y-auto">
          <StatusCard
            authenticated={auth.authenticated}
            authenticating={auth.authenticating}
            sessionId={auth.sessionId}
            expiresAt={auth.expiresAt}
            walletAddress={auth.walletAddress}
            authError={auth.authError}
            onReauth={auth.authenticate}
          />
        </TabsContent>

        {/* Balances */}
        <TabsContent value="balances" className="mt-3">
          <BalancesCard
            unified={balances.unified}
            custodyAvailable={balances.custodyAvailable}
            walletUsdcBalance={balances.walletUsdcBalance}
            loading={balances.balancesLoading}
            error={balances.balancesError}
            onRefresh={balances.refreshBalances}
            onAddFunds={() => setTopTab('moveFunds')}
          />
        </TabsContent>

        {/* Move Funds */}
        <TabsContent value="moveFunds" className="mt-3 min-h-[430px] max-h-[430px] overflow-y-auto">
          {auth.authenticated ? (
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
          ) : (
            <div className="text-center py-8">
              <p className="text-xs text-gray-400">
                Authenticate to access deposit/withdraw and custody channels.
              </p>
            </div>
          )}
        </TabsContent>

        {/* App Sessions */}
        <TabsContent value="appSessions" className="mt-3 min-h-[430px] max-h-[430px] overflow-y-auto">
          {auth.authenticated ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-rubik-medium text-white">
                  App Sessions
                  {sessions.sessions.length > 0 && (
                    <span className="ml-1.5 bg-gray-800 text-gray-200 text-[10px] px-1.5 py-0.5 rounded-full">
                      {sessions.sessions.length}
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={sessions.discoverSessions}
                    disabled={sessions.sessionsLoading}
                    className="text-gray-400 hover:text-gray-200 disabled:opacity-40"
                    title="Discover sessions"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${sessions.sessionsLoading ? 'animate-spin' : ''}`}
                    />
                  </button>
                  <Button
                    onClick={openCreate}
                    className="h-7 text-xs bg-yellow-400 hover:bg-yellow-500 text-black px-3"
                  >
                    New Session
                  </Button>
                </div>
              </div>

              {sessions.sessionsLoading && sessions.sessions.length === 0 && (
                <div className="flex items-center gap-2 text-xs text-gray-400 py-4 justify-center">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Discovering sessions…
                </div>
              )}

              {!sessions.sessionsLoading && sessions.sessionsError && (
                <p className="text-xs text-red-400">{sessions.sessionsError}</p>
              )}

              {!sessions.sessionsLoading && sessions.sessions.length === 0 && !sessions.sessionsError && (
                <div className="text-center py-6 text-xs text-gray-400">
                  <Zap className="h-8 w-8 mx-auto mb-2 text-gray-700" />
                  No sessions found. Create one to get started.
                </div>
              )}

              {visibleSessions.map((s) => (
                  <SessionCard
                    key={s.appSessionId}
                    session={s}
                    walletAddress={auth.walletAddress}
                    onManage={() => openManage(s)}
                    onClose={() => sessions.closeSession(s.appSessionId)}
                    isClosing={sessions.closingSessionId === s.appSessionId}
                    onDismiss={() =>
                      setDismissedSessionIds((prev: Set<string>) => {
                        const next = new Set(prev);
                        next.add(s.appSessionId);
                        return next;
                      })
                    }
                  />
                ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-xs text-gray-400">Authenticate to access app sessions.</p>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <SessionDialog
        open={dialog.open}
        mode={dialog.mode}
        managedSession={managedSessionFresh}
        loading={dialog.mode === 'manage' && sessions.selectedSessionDetail.loading}
        onClose={closeDialog}
        createContent={
          userId ? (
            <>
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
              <div className="pt-3 text-center">
                <button
                  type="button"
                  onClick={() => setDialog({ open: true, mode: 'join', managedSession: null })}
                  className="text-xs text-gray-400 hover:text-gray-200 underline underline-offset-2"
                >
                  Have an invite? Join with Session ID
                </button>
              </div>
            </>
          ) : null
        }
        joinContent={
          userId ? (
            <JoinSessionForm
              userId={userId}
              chain={chain}
              onFound={(session) => {
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
                sessions.discoverSessions();
                closeDialog();
                setTimeout(() => openManage(normalized), 150);
              }}
            />
          ) : null
        }
        manageContent={
          dialog.mode === 'manage' && managedSessionFresh && userId ? (
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
          ) : null
        }
      />
    </div>
  );
}
