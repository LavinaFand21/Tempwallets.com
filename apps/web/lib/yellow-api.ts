/**
 * Yellow Network API
 *
 * Direct calls to the backend endpoints documented in the Postman collection.
 * Base URL: process.env.NEXT_PUBLIC_API_URL (default: http://localhost:5005)
 *
 * Recommended call order:
 * Authenticate → Check Balance → Discover Sessions → Create Session → Transfer → Close Session
 *
 * IMPORTANT RULES:
 * - Asset identifiers are always lowercase: "usdc", "usdt"
 * - OPERATE ZERO-SUM RULE: OPERATE intent allocations must sum exactly to the current session total.
 *   OPERATE only redistributes; it cannot add or remove funds.
 * - DEPOSIT increases session total (final desired state, not delta)
 * - WITHDRAW decreases session total (final desired state, not delta)
 * - Sessions use Judge governance: creator weight=100, quorum=100
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';

class YellowApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'YellowApiError';
  }
}

async function yellowFetch<T>(
  path: string,
  options?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const { timeoutMs = 30_000, ...init } = options ?? {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const token =
    typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      let msg = 'Request failed';
      try {
        const err = await res.json();
        msg = err.message || err.error || msg;
      } catch {
        msg = (await res.text()) || msg;
      }
      throw new YellowApiError(res.status, msg);
    }

    return res.json() as Promise<T>;
  } catch (e) {
    clearTimeout(timer);
    if (e instanceof YellowApiError) throw e;
    if (e instanceof Error && e.name === 'AbortError')
      throw new YellowApiError(408, 'Request timed out');
    if (
      e instanceof Error &&
      (e.message.includes('fetch') || e.message.includes('network'))
    )
      throw new YellowApiError(503, 'Network error. Please check your connection.');
    throw new YellowApiError(
      500,
      e instanceof Error ? e.message : 'Unknown error',
    );
  }
}

// ── Response Types ────────────────────────────────────────────────────────

export interface YellowAuthResponse {
  ok: boolean;
  authenticated: boolean;
  /** Yellow Network session ID (for re-auth tracking) */
  sessionId?: string;
  /** ISO timestamp when the session expires */
  expiresAt?: string;
  /** The wallet address authenticated */
  walletAddress?: string;
  message?: string;
}

export interface WalletAddress {
  chain: string;
  address: string;
  type?: string;
}

export interface WalletAddressesResponse {
  ok: boolean;
  data: WalletAddress[];
}

export interface UnifiedBalanceItem {
  asset: string;
  amount: string;
  locked: string;
  available: string;
}

export interface UnifiedBalanceResponse {
  ok: boolean;
  data: { balances: UnifiedBalanceItem[] };
  message?: string;
}

export interface CustodyAvailableBalanceResponse {
  ok: boolean;
  data: { availableBalance: string; asset: string; chain: string; accountId?: string; description?: string };
  message?: string;
}

export interface WalletBalanceEntry {
  symbol: string;
  balance: string;
  decimals?: number;
  address?: string | null;
  chain?: string;
}

export interface CustodyTxResponse {
  ok: boolean;
  txHash?: string;
  message?: string;
  /** Deposit response wraps result in `data` */
  data?: {
    channelId?: string;
    approveTxHash?: string;
    depositTxHash?: string;
    unifiedBalance?: string;
    [key: string]: unknown;
  };
}

export interface ChannelFundResponse {
  ok: boolean;
  channelId?: string;
  message?: string;
}

export interface ChannelDetail {
  channelId: string;
  status: string;
  asset?: string;
  balance?: string;
  amount?: string;
  chain?: string;
}

export interface ChannelsResponse {
  ok: boolean;
  data?: ChannelDetail[];
  channels?: ChannelDetail[];
  message?: string;
}

export interface CloseChannelResponse {
  ok: boolean;
  message?: string;
}

/** Allocation entry for OPERATE/DEPOSIT/WITHDRAW patch calls */
export interface SessionAllocation {
  participant: string;
  amount: string;
  /** Lowercase asset identifier, e.g. "usdc" */
  asset: string;
}

/** Allocation entry for CREATE — no asset field (token is at top level) */
export interface InitialAllocation {
  participant: string;
  amount: string;
}

export interface AppSession {
  appSessionId: string;
  chain: string;
  /** Lowercase token identifier, e.g. "usdc" */
  token: string;
  status: 'open' | 'closed' | string;
  participants: string[];
  allocations?: SessionAllocation[];
  version?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface DiscoverSessionsResponse {
  ok: boolean;
  sessions?: AppSession[];
  data?: AppSession[];
  message?: string;
}

export interface CreateSessionRequest {
  userId: string;
  chain: string;
  participants: string[];
  /** Lowercase token, e.g. "usdc" */
  token: string;
  /** Must NOT include an asset field — asset is implied by token */
  initialAllocations: InitialAllocation[];
}

export interface CreateSessionResponse {
  ok: boolean;
  appSessionId?: string;
  sessionId?: string;
  message?: string;
}

export interface SessionDetailResponse {
  ok: boolean;
  data?: AppSession;
  session?: AppSession;
  message?: string;
}

export interface SessionBalanceItem {
  asset: string;
  amount: string;
}

export interface SessionBalancesResponse {
  ok: boolean;
  data?: { balances: SessionBalanceItem[] };
  balances?: SessionBalanceItem[];
  message?: string;
}

export type SessionIntent = 'OPERATE' | 'DEPOSIT' | 'WITHDRAW';

export interface PatchSessionRequest {
  userId: string;
  chain: string;
  intent: SessionIntent;
  allocations: SessionAllocation[];
}

export interface PatchSessionResponse {
  ok: boolean;
  message?: string;
}

export interface CloseSessionResponse {
  ok: boolean;
  message?: string;
}

// ── API Object ────────────────────────────────────────────────────────────

export const yellowApi = {
  /**
   * Authenticate the user's wallet with Yellow Network clearnode.
   * POST /app-session/authenticate
   *
   * Creates/reuses an authenticated session. Required before sessions/transfers.
   * Backend creates a session key with USDC allowances (1000 USDC cap).
   */
  async authenticate(userId: string, chain = 'base'): Promise<YellowAuthResponse> {
    return yellowFetch<YellowAuthResponse>('/app-session/authenticate', {
      method: 'POST',
      body: JSON.stringify({ userId, chain }),
      timeoutMs: 90_000,
    });
  },

  /**
   * Get all wallet addresses for a user.
   * GET /wallet/addresses?userId=
   */
  async getWalletAddresses(userId: string): Promise<WalletAddressesResponse> {
    return yellowFetch<WalletAddressesResponse>(
      `/wallet/addresses?userId=${encodeURIComponent(userId)}`,
    );
  },

  /**
   * Get unified (off-chain) balance from Yellow Network ledger.
   * GET /custody/balance?userId=&chain=
   *
   * Returns the balance used for Lightning Nodes and gasless operations.
   */
  async getUnifiedBalance(
    userId: string,
    chain = 'base',
  ): Promise<UnifiedBalanceResponse> {
    return yellowFetch<UnifiedBalanceResponse>(
      `/custody/balance?userId=${encodeURIComponent(userId)}&chain=${encodeURIComponent(chain)}`,
    );
  },

  /**
   * Get available balance in the custody contract (on-chain, per asset).
   * GET /custody/available-balance?userId=&chain=&asset=
   *
   * Balance hierarchy:
   * Wallet → [custody deposit] → Available (here) → [fund channel] → Unified → [session] → Session
   */
  async getCustodyAvailableBalance(
    userId: string,
    chain: string,
    asset: string,
  ): Promise<CustodyAvailableBalanceResponse> {
    return yellowFetch<CustodyAvailableBalanceResponse>(
      `/custody/available-balance?userId=${encodeURIComponent(userId)}&chain=${encodeURIComponent(chain)}&asset=${encodeURIComponent(asset)}`,
    );
  },

  /**
   * Get on-chain wallet balances across all chains.
   * GET /wallet/balances?userId=
   */
  async getWalletBalances(
    userId: string,
  ): Promise<{ ok?: boolean; data?: WalletBalanceEntry[]; [k: string]: unknown }> {
    return yellowFetch<{
      ok?: boolean;
      data?: WalletBalanceEntry[];
      [k: string]: unknown;
    }>(`/wallet/balances?userId=${encodeURIComponent(userId)}`);
  },

  /**
   * Deposit from on-chain wallet to custody contract.
   * POST /custody/deposit
   *
   * Costs gas. Takes 60–90s for indexing. Increases available balance.
   */
  async depositToCustody(data: {
    userId: string;
    chain: string;
    asset: string;
    amount: string;
  }): Promise<CustodyTxResponse> {
    return yellowFetch<CustodyTxResponse>('/custody/deposit', {
      method: 'POST',
      body: JSON.stringify(data),
      timeoutMs: 120_000,
    });
  },

  /**
   * Withdraw from custody contract back to on-chain wallet.
   * POST /custody/withdraw
   *
   * Costs gas. Must close channels first to move funds from unified → available.
   */
  async withdrawFromCustody(data: {
    userId: string;
    chain: string;
    asset: string;
    amount: string;
  }): Promise<CustodyTxResponse> {
    return yellowFetch<CustodyTxResponse>('/custody/withdraw', {
      method: 'POST',
      body: JSON.stringify(data),
      timeoutMs: 120_000,
    });
  },

  /**
   * Fund a 2-party payment channel with Yellow Network clearnode.
   * POST /channel/fund
   *
   * Uses unified balance (must deposit to custody first).
   * Counterparty is always the clearnode.
   */
  async fundChannel(data: {
    userId: string;
    chain: string;
    asset: string;
    amount: string;
  }): Promise<ChannelFundResponse> {
    return yellowFetch<ChannelFundResponse>('/channel/fund', {
      method: 'POST',
      body: JSON.stringify(data),
      timeoutMs: 120_000,
    });
  },

  /**
   * Get payment channels for a user.
   * GET /channel?userId=&chain=
   */
  async getChannels(userId: string, chain = 'base'): Promise<ChannelsResponse> {
    return yellowFetch<ChannelsResponse>(
      `/channel?userId=${encodeURIComponent(userId)}&chain=${encodeURIComponent(chain)}`,
    );
  },

  /**
   * Close a payment channel cooperatively.
   * POST /channel/close
   *
   * Moves funds: Unified Balance → Available Balance (custody contract).
   * After closing, use withdrawFromCustody to send to wallet.
   */
  async closeChannel(data: {
    userId: string;
    chain: string;
    channelId: string;
  }): Promise<CloseChannelResponse> {
    return yellowFetch<CloseChannelResponse>('/channel/close', {
      method: 'POST',
      body: JSON.stringify(data),
      timeoutMs: 120_000,
    });
  },

  /**
   * Discover all app sessions where the user is a participant.
   * GET /app-session/discover/{userId}?chain=
   */
  async discoverSessions(
    userId: string,
    chain = 'base',
  ): Promise<DiscoverSessionsResponse> {
    return yellowFetch<DiscoverSessionsResponse>(
      `/app-session/discover/${encodeURIComponent(userId)}?chain=${encodeURIComponent(chain)}`,
      { timeoutMs: 60_000 },
    );
  },

  /**
   * Create a new app session (Lightning Node).
   * POST /app-session
   *
   * IMPORTANT: initialAllocations must only contain { participant, amount }.
   * Do NOT include asset — it is implied by the top-level `token` field.
   * Uses Judge governance: creator weight=100, quorum=100.
   */
  async createSession(
    data: CreateSessionRequest,
  ): Promise<CreateSessionResponse> {
    return yellowFetch<CreateSessionResponse>('/app-session', {
      method: 'POST',
      body: JSON.stringify(data),
      timeoutMs: 90_000,
    });
  },

  /**
   * Get details for a specific app session.
   * GET /app-session/{sessionId}?userId=&chain=
   */
  async getSession(
    sessionId: string,
    userId: string,
    chain = 'base',
  ): Promise<SessionDetailResponse> {
    return yellowFetch<SessionDetailResponse>(
      `/app-session/${encodeURIComponent(sessionId)}?userId=${encodeURIComponent(userId)}&chain=${encodeURIComponent(chain)}`,
      { timeoutMs: 60_000 },
    );
  },

  /**
   * Get per-asset balances within an app session.
   * GET /app-session/{sessionId}/balances?userId=&chain=
   */
  async getSessionBalances(
    sessionId: string,
    userId: string,
    chain = 'base',
  ): Promise<SessionBalancesResponse> {
    return yellowFetch<SessionBalancesResponse>(
      `/app-session/${encodeURIComponent(sessionId)}/balances?userId=${encodeURIComponent(userId)}&chain=${encodeURIComponent(chain)}`,
      { timeoutMs: 60_000 },
    );
  },

  /**
   * Update session allocations.
   * PATCH /app-session/{sessionId}
   *
   * Intent options:
   * - OPERATE: Zero-sum redistribution. Allocations MUST sum to exactly the current session total.
   * - DEPOSIT: Add funds from unified balance. Allocations are the FINAL desired state (not delta).
   * - WITHDRAW: Remove funds to unified balance. Allocations are the FINAL desired state (not delta).
   *
   * Note: The protocol auto-lowercases intent before submitting to clearnode.
   */
  async patchSession(
    sessionId: string,
    data: PatchSessionRequest,
  ): Promise<PatchSessionResponse> {
    return yellowFetch<PatchSessionResponse>(
      `/app-session/${encodeURIComponent(sessionId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(data),
        timeoutMs: 60_000,
      },
    );
  },

  /**
   * Close an app session and return funds to unified balance (off-chain).
   * DELETE /app-session/{sessionId}?userId=&chain=
   *
   * NOTE: OFF-CHAIN close. Funds go to unified balance, NOT to on-chain wallet.
   * To move funds on-chain: close payment channel + custody withdraw.
   */
  async closeSession(
    sessionId: string,
    userId: string,
    chain = 'base',
  ): Promise<CloseSessionResponse> {
    return yellowFetch<CloseSessionResponse>(
      `/app-session/${encodeURIComponent(sessionId)}?userId=${encodeURIComponent(userId)}&chain=${encodeURIComponent(chain)}`,
      { method: 'DELETE', timeoutMs: 90_000 },
    );
  },
};

export { YellowApiError };
