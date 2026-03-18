/**
 * Yellow Network Analytics Module
 *
 * Comprehensive event tracking for Yellow Network features:
 * - App Sessions (create, join, operate, close)
 * - Custody Operations (deposit, withdraw)
 * - Balance Updates
 * - State Channel Operations
 */

import {
  trackEvent,
  timeEvent,
  incrementUserProperty,
} from "@/lib/mixpanel";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type SessionIntent =
  | "OPERATE"
  | "DEPOSIT"
  | "WITHDRAW"
  | "REQUEST_WITHDRAW";

export interface SessionEventProps {
  sessionId?: string;
  channelId?: string;
  participantAddress?: string;
  counterpartyAddress?: string;
  chainId?: number;
  tokenSymbol?: string;
  amount?: string;
}

export interface CustodyEventProps {
  chainId?: number;
  tokenSymbol?: string;
  tokenAddress?: string;
  amount?: string;
  txHash?: string;
}

export interface BalanceEventProps {
  totalBalance?: string;
  custodyBalance?: string;
  walletBalance?: string;
  currency?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// APP SESSION EVENTS
// ═══════════════════════════════════════════════════════════════════════════

export const trackSession = {
  /**
   * Track session creation initiated
   */
  createInitiated: (props: SessionEventProps) => {
    timeEvent("yellow_session_created");
    trackEvent("yellow_session_create_initiated", {
      chain_id: props.chainId,
      participant_address: props.participantAddress,
      counterparty_address: props.counterpartyAddress,
    });
  },

  /**
   * Track successful session creation
   */
  createSuccess: (props: SessionEventProps) => {
    trackEvent("yellow_session_created", {
      session_id: props.sessionId,
      channel_id: props.channelId,
      chain_id: props.chainId,
      participant_address: props.participantAddress,
      counterparty_address: props.counterpartyAddress,
    });
    incrementUserProperty("total_sessions_created");
  },

  /**
   * Track session creation failure
   */
  createFailed: (props: SessionEventProps & { error?: string }) => {
    trackEvent("yellow_session_create_failed", {
      chain_id: props.chainId,
      participant_address: props.participantAddress,
      counterparty_address: props.counterpartyAddress,
      error: props.error,
    });
  },

  /**
   * Track session discovery
   */
  discovered: (props: { count: number; chainId?: number }) => {
    trackEvent("yellow_sessions_discovered", {
      session_count: props.count,
      chain_id: props.chainId,
    });
  },

  /**
   * Track session join
   */
  joined: (props: SessionEventProps) => {
    trackEvent("yellow_session_joined", {
      session_id: props.sessionId,
      channel_id: props.channelId,
      chain_id: props.chainId,
    });
    incrementUserProperty("total_sessions_joined");
  },

  /**
   * Track session operation (OPERATE, DEPOSIT, WITHDRAW, REQUEST_WITHDRAW)
   */
  operationInitiated: (intent: SessionIntent, props: SessionEventProps) => {
    const eventName = `yellow_session_${intent.toLowerCase()}_initiated`;
    timeEvent(eventName.replace("_initiated", "_completed"));
    trackEvent(eventName, {
      session_id: props.sessionId,
      channel_id: props.channelId,
      token_symbol: props.tokenSymbol,
      amount: props.amount,
    });
  },

  /**
   * Track successful session operation
   */
  operationSuccess: (intent: SessionIntent, props: SessionEventProps) => {
    const eventName = `yellow_session_${intent.toLowerCase()}_completed`;
    trackEvent(eventName, {
      session_id: props.sessionId,
      channel_id: props.channelId,
      token_symbol: props.tokenSymbol,
      amount: props.amount,
    });
    incrementUserProperty(`total_session_${intent.toLowerCase()}s`);
  },

  /**
   * Track failed session operation
   */
  operationFailed: (
    intent: SessionIntent,
    props: SessionEventProps & { error?: string },
  ) => {
    trackEvent(`yellow_session_${intent.toLowerCase()}_failed`, {
      session_id: props.sessionId,
      channel_id: props.channelId,
      token_symbol: props.tokenSymbol,
      amount: props.amount,
      error: props.error,
    });
  },

  /**
   * Track session close initiated
   */
  closeInitiated: (props: SessionEventProps) => {
    timeEvent("yellow_session_closed");
    trackEvent("yellow_session_close_initiated", {
      session_id: props.sessionId,
      channel_id: props.channelId,
    });
  },

  /**
   * Track successful session close
   */
  closeSuccess: (props: SessionEventProps) => {
    trackEvent("yellow_session_closed", {
      session_id: props.sessionId,
      channel_id: props.channelId,
    });
    incrementUserProperty("total_sessions_closed");
  },

  /**
   * Track session close failure
   */
  closeFailed: (props: SessionEventProps & { error?: string }) => {
    trackEvent("yellow_session_close_failed", {
      session_id: props.sessionId,
      channel_id: props.channelId,
      error: props.error,
    });
  },

  /**
   * Track session status update
   */
  statusUpdated: (props: SessionEventProps & { status: string }) => {
    trackEvent("yellow_session_status_updated", {
      session_id: props.sessionId,
      channel_id: props.channelId,
      status: props.status,
    });
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// CUSTODY EVENTS
// ═══════════════════════════════════════════════════════════════════════════

export const trackCustody = {
  /**
   * Track custody deposit initiated
   */
  depositInitiated: (props: CustodyEventProps) => {
    timeEvent("yellow_custody_deposit_completed");
    trackEvent("yellow_custody_deposit_initiated", {
      chain_id: props.chainId,
      token_symbol: props.tokenSymbol,
      token_address: props.tokenAddress,
      amount: props.amount,
    });
  },

  /**
   * Track successful custody deposit
   */
  depositSuccess: (props: CustodyEventProps) => {
    trackEvent("yellow_custody_deposit_completed", {
      chain_id: props.chainId,
      token_symbol: props.tokenSymbol,
      token_address: props.tokenAddress,
      amount: props.amount,
      tx_hash: props.txHash,
    });
    incrementUserProperty("total_custody_deposits");
    if (props.amount) {
      incrementUserProperty("total_custody_deposit_volume", parseFloat(props.amount) || 0);
    }
  },

  /**
   * Track custody deposit failure
   */
  depositFailed: (props: CustodyEventProps & { error?: string }) => {
    trackEvent("yellow_custody_deposit_failed", {
      chain_id: props.chainId,
      token_symbol: props.tokenSymbol,
      token_address: props.tokenAddress,
      amount: props.amount,
      error: props.error,
    });
  },

  /**
   * Track custody withdrawal initiated
   */
  withdrawInitiated: (props: CustodyEventProps) => {
    timeEvent("yellow_custody_withdraw_completed");
    trackEvent("yellow_custody_withdraw_initiated", {
      chain_id: props.chainId,
      token_symbol: props.tokenSymbol,
      token_address: props.tokenAddress,
      amount: props.amount,
    });
  },

  /**
   * Track successful custody withdrawal
   */
  withdrawSuccess: (props: CustodyEventProps) => {
    trackEvent("yellow_custody_withdraw_completed", {
      chain_id: props.chainId,
      token_symbol: props.tokenSymbol,
      token_address: props.tokenAddress,
      amount: props.amount,
      tx_hash: props.txHash,
    });
    incrementUserProperty("total_custody_withdrawals");
    if (props.amount) {
      incrementUserProperty("total_custody_withdrawal_volume", parseFloat(props.amount) || 0);
    }
  },

  /**
   * Track custody withdrawal failure
   */
  withdrawFailed: (props: CustodyEventProps & { error?: string }) => {
    trackEvent("yellow_custody_withdraw_failed", {
      chain_id: props.chainId,
      token_symbol: props.tokenSymbol,
      token_address: props.tokenAddress,
      amount: props.amount,
      error: props.error,
    });
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// BALANCE EVENTS
// ═══════════════════════════════════════════════════════════════════════════

export const trackBalance = {
  /**
   * Track balance refresh action
   */
  refreshed: (props: BalanceEventProps) => {
    trackEvent("yellow_balance_refreshed", {
      total_balance: props.totalBalance,
      custody_balance: props.custodyBalance,
      wallet_balance: props.walletBalance,
      currency: props.currency,
    });
  },

  /**
   * Track unified balance viewed
   */
  viewed: (props: BalanceEventProps) => {
    trackEvent("yellow_balance_viewed", {
      total_balance: props.totalBalance,
      custody_balance: props.custodyBalance,
      wallet_balance: props.walletBalance,
      currency: props.currency,
    });
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// TRANSFER EVENTS (between participants in session)
// ═══════════════════════════════════════════════════════════════════════════

export const trackTransfer = {
  /**
   * Track transfer initiated within a session
   */
  initiated: (props: {
    sessionId?: string;
    channelId?: string;
    tokenSymbol?: string;
    amount?: string;
    recipientAddress?: string;
  }) => {
    timeEvent("yellow_transfer_completed");
    trackEvent("yellow_transfer_initiated", {
      session_id: props.sessionId,
      channel_id: props.channelId,
      token_symbol: props.tokenSymbol,
      amount: props.amount,
      recipient_address: props.recipientAddress,
    });
  },

  /**
   * Track successful transfer
   */
  success: (props: {
    sessionId?: string;
    channelId?: string;
    tokenSymbol?: string;
    amount?: string;
    recipientAddress?: string;
  }) => {
    trackEvent("yellow_transfer_completed", {
      session_id: props.sessionId,
      channel_id: props.channelId,
      token_symbol: props.tokenSymbol,
      amount: props.amount,
      recipient_address: props.recipientAddress,
    });
    incrementUserProperty("total_transfers");
    if (props.amount) {
      incrementUserProperty("total_transfer_volume", parseFloat(props.amount) || 0);
    }
  },

  /**
   * Track failed transfer
   */
  failed: (props: {
    sessionId?: string;
    channelId?: string;
    tokenSymbol?: string;
    amount?: string;
    recipientAddress?: string;
    error?: string;
  }) => {
    trackEvent("yellow_transfer_failed", {
      session_id: props.sessionId,
      channel_id: props.channelId,
      token_symbol: props.tokenSymbol,
      amount: props.amount,
      recipient_address: props.recipientAddress,
      error: props.error,
    });
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// WALLET CONNECTION EVENTS (Yellow Network specific)
// ═══════════════════════════════════════════════════════════════════════════

export const trackYellowWallet = {
  /**
   * Track wallet connected to Yellow Network
   */
  connected: (props: { chainId?: number; address?: string }) => {
    trackEvent("yellow_wallet_connected", {
      chain_id: props.chainId,
      wallet_address: props.address,
    });
  },

  /**
   * Track wallet disconnected from Yellow Network
   */
  disconnected: (props: { chainId?: number; address?: string }) => {
    trackEvent("yellow_wallet_disconnected", {
      chain_id: props.chainId,
      wallet_address: props.address,
    });
  },
};
