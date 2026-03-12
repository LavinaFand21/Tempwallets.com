'use client';

/**
 * Yellow Network React Hooks
 *
 * Provides state management for all Yellow Network Lightning Node operations.
 * Hooks are independent and can be used in any combination.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import {
  yellowApi,
  AppSession,
  SessionAllocation,
  CreateSessionRequest,
  SessionIntent,
  UnifiedBalanceItem,
  ChannelDetail,
  SessionBalanceItem,
  YellowApiError,
} from '@/lib/yellow-api';

// ── useYellowAuth ─────────────────────────────────────────────────────────

export interface YellowAuthState {
  authenticated: boolean;
  authenticating: boolean;
  sessionId: string | null;
  expiresAt: string | null;
  walletAddress: string | null;
  authError: string | null;
  authenticate: () => Promise<void>;
}

export function useYellowAuth(
  userId: string | null,
  chain = 'base',
): YellowAuthState {
  const [authenticated, setAuthenticated] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const authenticate = useCallback(async () => {
    if (!userId || authenticating) return;
    setAuthenticating(true);
    setAuthError(null);

    try {
      const res = await yellowApi.authenticate(userId, chain);

      if (res.ok && res.authenticated) {
        setAuthenticated(true);
        setSessionId(res.sessionId ?? null);
        setExpiresAt(res.expiresAt ?? null);

        if (res.walletAddress) {
          setWalletAddress(res.walletAddress);
        } else {
          // Fetch wallet address separately if not included in auth response
          try {
            const addrRes = await yellowApi.getWalletAddresses(userId);
            const wallet = addrRes.data?.find((w) => w.chain === chain);
            if (wallet) setWalletAddress(wallet.address);
          } catch {
            // Non-critical — address display is optional
          }
        }
      } else {
        throw new Error(res.message || 'Authentication failed');
      }
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : 'Authentication failed';
      setAuthError(msg);
      setAuthenticated(false);
      toast.error(`Auth failed: ${msg}`);
    } finally {
      setAuthenticating(false);
    }
  }, [userId, chain]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-authenticate when userId becomes available
  const attemptedRef = useRef(false);
  useEffect(() => {
    if (userId && !authenticated && !authenticating && !attemptedRef.current) {
      attemptedRef.current = true;
      authenticate();
    }
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    authenticated,
    authenticating,
    sessionId,
    expiresAt,
    walletAddress,
    authError,
    authenticate,
  };
}

// ── useYellowBalances ─────────────────────────────────────────────────────

export interface YellowBalancesState {
  unified: UnifiedBalanceItem[];
  custodyAvailable: string | null;
  walletUsdcBalance: string | null;
  balancesLoading: boolean;
  balancesError: string | null;
  refreshBalances: () => void;
}

export function useYellowBalances(
  userId: string | null,
  chain = 'base',
  asset = 'usdc',
  authReady = false,
): YellowBalancesState {
  const [unified, setUnified] = useState<UnifiedBalanceItem[]>([]);
  const [custodyAvailable, setCustodyAvailable] = useState<string | null>(null);
  const [walletUsdcBalance, setWalletUsdcBalance] = useState<string | null>(null);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [balancesError, setBalancesError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!userId) return;
    setBalancesLoading(true);
    setBalancesError(null);

    const [unifiedRes, custodyRes, walletRes] = await Promise.allSettled([
      yellowApi.getUnifiedBalance(userId, chain),
      yellowApi.getCustodyAvailableBalance(userId, chain, asset),
      yellowApi.getWalletBalances(userId),
    ]);

    if (unifiedRes.status === 'fulfilled' && unifiedRes.value.ok) {
      setUnified(unifiedRes.value.data?.balances ?? []);
    } else if (unifiedRes.status === 'rejected') {
      setBalancesError('Failed to load unified balance');
    }

    if (custodyRes.status === 'fulfilled' && custodyRes.value.ok) {
      setCustodyAvailable(custodyRes.value.data?.availableBalance ?? null);
    }

    if (walletRes.status === 'fulfilled') {
      // Normalize wallet balances — response shape may vary across chains
      const raw = walletRes.value;
      const entries = Array.isArray(raw.data) ? raw.data : [];
      const usdc = entries.find(
        (b) =>
          b.symbol?.toLowerCase() === asset ||
          b.symbol?.toLowerCase() === asset.toUpperCase(),
      );
      if (usdc) {
        const bal = parseFloat(usdc.balance ?? '0');
        const dec = usdc.decimals ?? 6;
        // If balance looks like wei (very large number), convert
        const human = bal > 1e9 ? (bal / 10 ** dec).toFixed(6) : usdc.balance;
        setWalletUsdcBalance(human ?? '0');
      }
    }

    setBalancesLoading(false);
  }, [userId, chain, asset]);

  useEffect(() => {
    if (userId && authReady) {
      fetchAll();
    }
  }, [userId, authReady]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    unified,
    custodyAvailable,
    walletUsdcBalance,
    balancesLoading,
    balancesError,
    refreshBalances: fetchAll,
  };
}

// ── useCustodyActions ─────────────────────────────────────────────────────

export interface CustodyActionsState {
  depositing: boolean;
  withdrawing: boolean;
  depositToCustody: (chain: string, asset: string, amount: string) => Promise<boolean>;
  withdrawFromCustody: (chain: string, asset: string, amount: string) => Promise<boolean>;
}

export function useCustodyActions(
  userId: string | null,
  onSuccess?: () => void,
  onChannelId?: (channelId: string, chain: string) => void,
): CustodyActionsState {
  const [depositing, setDepositing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  const depositToCustody = useCallback(
    async (chain: string, asset: string, amount: string): Promise<boolean> => {
      if (!userId) return false;
      setDepositing(true);
      try {
        const res = await yellowApi.depositToCustody({ userId, chain, asset, amount });
        if (res.ok) {
          // Persist channelId returned by the deposit (backend uses channel internally)
          const channelId = res.data?.channelId;
          if (channelId) {
            onChannelId?.(channelId, chain);
          }
          toast.success('Deposit complete. Custody and unified balances updated.');
          onSuccess?.();
          return true;
        }
        toast.error(res.message || 'Deposit failed');
        return false;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Deposit failed');
        return false;
      } finally {
        setDepositing(false);
      }
    },
    [userId, onSuccess, onChannelId],
  );

  const withdrawFromCustody = useCallback(
    async (chain: string, asset: string, amount: string): Promise<boolean> => {
      if (!userId) return false;
      setWithdrawing(true);
      try {
        const res = await yellowApi.withdrawFromCustody({ userId, chain, asset, amount });
        if (res.ok) {
          toast.success('Custody withdrawal submitted successfully.');
          onSuccess?.();
          return true;
        }
        toast.error(res.message || 'Withdrawal failed');
        return false;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Withdrawal failed');
        return false;
      } finally {
        setWithdrawing(false);
      }
    },
    [userId, onSuccess],
  );

  return { depositing, withdrawing, depositToCustody, withdrawFromCustody };
}

// ── useChannelActions ─────────────────────────────────────────────────────

export interface ChannelActionsState {
  channels: ChannelDetail[];
  channelsLoading: boolean;
  funding: boolean;
  closingChannelId: string | null;
  storedChannelId: string | null;
  fetchChannels: () => Promise<void>;
  fundChannel: (asset: string, amount: string) => Promise<boolean>;
  closeChannel: (channelId: string) => Promise<boolean>;
  /** Persist a channelId to localStorage and update state (called after deposit) */
  saveChannelId: (channelId: string, chain: string) => void;
  /** Remove stored channel from localStorage without calling the API */
  dismissStoredChannel: () => void;
}

export function useChannelActions(
  userId: string | null,
  chain: string,
  onSuccess?: () => void,
): ChannelActionsState {
  const [channels, setChannels] = useState<ChannelDetail[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [funding, setFunding] = useState(false);
  const [closingChannelId, setClosingChannelId] = useState<string | null>(null);
  const [storedChannelId, setStoredChannelId] = useState<string | null>(null);

  // Load stored channelId from localStorage whenever userId/chain changes
  useEffect(() => {
    if (!userId || typeof window === 'undefined') {
      setStoredChannelId(null);
      return;
    }
    const key = `yellow_channel_id_${userId}_${chain}`;
    setStoredChannelId(localStorage.getItem(key));
  }, [userId, chain]);

  const fetchChannels = useCallback(async () => {
    if (!userId) return;
    setChannelsLoading(true);
    try {
      const res = await yellowApi.getChannels(userId, chain);
      setChannels(res.data ?? res.channels ?? []);
    } catch {
      // Non-critical — channel list is optional
    } finally {
      setChannelsLoading(false);
    }
  }, [userId, chain]);

  const fundChannel = useCallback(
    async (asset: string, amount: string): Promise<boolean> => {
      if (!userId) return false;
      setFunding(true);
      try {
        const res = await yellowApi.fundChannel({ userId, chain, asset, amount });
        if (res.ok) {
          // Persist channelId to localStorage for use in close operations
          if (res.channelId && typeof window !== 'undefined') {
            const key = `yellow_channel_id_${userId}_${chain}`;
            localStorage.setItem(key, res.channelId);
            setStoredChannelId(res.channelId);
          }
          toast.success('Payment channel funded. Unified balance updated.');
          onSuccess?.();
          await fetchChannels();
          return true;
        }
        toast.error(res.message || 'Channel funding failed');
        return false;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Channel funding failed');
        return false;
      } finally {
        setFunding(false);
      }
    },
    [userId, chain, onSuccess, fetchChannels],
  );

  const closeChannel = useCallback(
    async (channelId: string): Promise<boolean> => {
      if (!userId) return false;
      setClosingChannelId(channelId);
      try {
        const res = await yellowApi.closeChannel({ userId, chain, channelId });
        if (res.ok) {
          // Clear stored channelId if this was the active channel
          if (typeof window !== 'undefined') {
            const key = `yellow_channel_id_${userId}_${chain}`;
            if (localStorage.getItem(key) === channelId) {
              localStorage.removeItem(key);
              setStoredChannelId(null);
            }
          }
          toast.success('Channel closed. Funds returned to custody available balance.');
          onSuccess?.();
          setChannels((prev) => prev.filter((c) => c.channelId !== channelId));
          return true;
        }
        toast.error(res.message || 'Channel close failed');
        return false;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Channel close failed');
        return false;
      } finally {
        setClosingChannelId(null);
      }
    },
    [userId, chain, onSuccess],
  );

  const saveChannelId = useCallback(
    (channelId: string, chainParam: string) => {
      if (!userId || typeof window === 'undefined') return;
      const key = `yellow_channel_id_${userId}_${chainParam}`;
      localStorage.setItem(key, channelId);
      // Update state only if this is the currently active chain
      if (chainParam === chain) {
        setStoredChannelId(channelId);
      }
    },
    [userId, chain],
  );

  const dismissStoredChannel = useCallback(() => {
    if (!userId || typeof window === 'undefined') return;
    const key = `yellow_channel_id_${userId}_${chain}`;
    localStorage.removeItem(key);
    setStoredChannelId(null);
  }, [userId, chain]);

  return {
    channels,
    channelsLoading,
    funding,
    closingChannelId,
    storedChannelId,
    fetchChannels,
    fundChannel,
    closeChannel,
    saveChannelId,
    dismissStoredChannel,
  };
}

// ── useAppSessions ────────────────────────────────────────────────────────

export interface SessionDetail {
  session: AppSession | null;
  balances: SessionBalanceItem[];
  loading: boolean;
}

export interface AppSessionsState {
  sessions: AppSession[];
  sessionsLoading: boolean;
  sessionsError: string | null;
  creating: boolean;
  operating: boolean;
  closingSessionId: string | null;
  selectedSessionDetail: SessionDetail;
  discoverSessions: () => Promise<void>;
  createSession: (
    params: Omit<CreateSessionRequest, 'userId' | 'chain'>,
  ) => Promise<string | null>;
  loadSessionDetail: (sessionId: string) => Promise<void>;
  patchSession: (
    sessionId: string,
    intent: SessionIntent,
    allocations: SessionAllocation[],
  ) => Promise<boolean>;
  closeSession: (sessionId: string) => Promise<boolean>;
}

export function useAppSessions(
  userId: string | null,
  chain: string,
  authReady = false,
  walletAddress: string | null = null,
  onBalanceChange?: () => void,
): AppSessionsState {
  const [sessions, setSessions] = useState<AppSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [operating, setOperating] = useState(false);
  const [closingSessionId, setClosingSessionId] = useState<string | null>(null);
  const [selectedSessionDetail, setSelectedSessionDetail] = useState<SessionDetail>({
    session: null,
    balances: [],
    loading: false,
  });

  const discoverSessions = useCallback(async () => {
    if (!userId) return;
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const res = await yellowApi.discoverSessions(userId, chain);
      const raw = res.sessions ?? res.data ?? [];
      // Normalize sessions: ensure chain/token are populated and
      // participants are derived from allocations when missing.
      const normalized = raw.map((s) => ({
        ...s,
        chain: s.chain || chain,
        token: s.token || (s.allocations?.[0]?.asset ?? 'usdc'),
        participants:
          s.participants?.length > 0
            ? s.participants
            : (s.allocations ?? []).map((a) => a.participant).filter(Boolean),
      }));
      setSessions(normalized as AppSession[]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to discover sessions';
      setSessionsError(msg);
    } finally {
      setSessionsLoading(false);
    }
  }, [userId, chain]);

  const createSession = useCallback(
    async (
      params: Omit<CreateSessionRequest, 'userId' | 'chain'>,
    ): Promise<string | null> => {
      if (!userId) return null;
      setCreating(true);
      try {
        const res = await yellowApi.createSession({ ...params, userId, chain });
        if (res.ok && (res.appSessionId || res.sessionId)) {
          const id = (res.appSessionId ?? res.sessionId)!;
          toast.success('App session created successfully.');
          await discoverSessions();
          return id;
        }
        toast.error(res.message || 'Failed to create session');
        return null;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to create session');
        return null;
      } finally {
        setCreating(false);
      }
    },
    [userId, chain, discoverSessions],
  );

  const loadSessionDetail = useCallback(
    async (sessionId: string) => {
      if (!userId) return;
      setSelectedSessionDetail((prev) => ({ ...prev, loading: true }));
      try {
        const [detailRes, balRes] = await Promise.allSettled([
          yellowApi.getSession(sessionId, userId, chain),
          yellowApi.getSessionBalances(sessionId, userId, chain),
        ]);

        let session: AppSession | null =
          detailRes.status === 'fulfilled'
            ? (detailRes.value.data ?? detailRes.value.session ?? null)
            : null;

        // Normalize: ensure chain, token, and participants are populated
        if (session) {
          const def = (session as any).definition;
          session = {
            ...session,
            chain: session.chain || chain,
            token:
              session.token ||
              session.allocations?.[0]?.asset ||
              'usdc',
            participants:
              session.participants?.length > 0
                ? session.participants
                : def?.participants ??
                  (session.allocations ?? [])
                    .map((a) => a.participant)
                    .filter(Boolean),
          };
        }

        const balances =
          balRes.status === 'fulfilled'
            ? (balRes.value.data?.balances ?? balRes.value.balances ?? [])
            : [];

        setSelectedSessionDetail({ session, balances, loading: false });
      } catch {
        setSelectedSessionDetail((prev) => ({ ...prev, loading: false }));
      }
    },
    [userId, chain],
  );

  const patchSession = useCallback(
    async (
      sessionId: string,
      intent: SessionIntent,
      allocations: SessionAllocation[],
    ): Promise<boolean> => {
      if (!userId) return false;
      setOperating(true);
      try {
        const res = await yellowApi.patchSession(sessionId, {
          userId,
          chain,
          intent,
          allocations,
        });
        if (res.ok) {
          const labels: Record<SessionIntent, string> = {
            OPERATE: 'Transfer completed (gasless).',
            DEPOSIT: 'Funds deposited into session.',
            WITHDRAW: 'Funds withdrawn from session.',
          };
          toast.success(labels[intent]);
          // Refresh session detail
          await loadSessionDetail(sessionId);
          onBalanceChange?.();
          return true;
        }
        toast.error(res.message || `${intent} operation failed`);
        return false;
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Operation failed';
        // Surface OPERATE zero-sum errors with context
        if (msg.includes('zero') || msg.includes('sum') || msg.includes('delta')) {
          toast.error(
            'OPERATE failed: allocations must sum to exactly the current session total.',
          );
        } else {
          toast.error(msg);
        }
        return false;
      } finally {
        setOperating(false);
      }
    },
    [userId, chain, loadSessionDetail, onBalanceChange],
  );

  const closeSession = useCallback(
    async (sessionId: string): Promise<boolean> => {
      if (!userId) return false;
      setClosingSessionId(sessionId);
      try {
        const res = await yellowApi.closeSession(sessionId, userId, chain);
        if (res.ok) {
          toast.success(
            'Session closed. Funds returned to unified balance (off-chain).',
          );
          setSessions((prev) =>
            prev.filter((s) => s.appSessionId !== sessionId),
          );
          onBalanceChange?.();
          return true;
        }
        toast.error(res.message || 'Failed to close session');
        return false;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to close session');
        return false;
      } finally {
        setClosingSessionId(null);
      }
    },
    [userId, chain, onBalanceChange],
  );

  useEffect(() => {
    if (userId && authReady) {
      discoverSessions();
    }
  }, [userId, authReady]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    sessions,
    sessionsLoading,
    sessionsError,
    creating,
    operating,
    closingSessionId,
    selectedSessionDetail,
    discoverSessions,
    createSession,
    loadSessionDetail,
    patchSession,
    closeSession,
  };
}
