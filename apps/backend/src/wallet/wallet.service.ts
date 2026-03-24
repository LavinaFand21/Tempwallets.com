import { Injectable } from '@nestjs/common';
// import { SubstrateChainKey } from './substrate/config/substrate-chain.config.js';
import { AllChainTypes } from './types/chain.types.js';
import {
  WalletAddresses,
  UiWalletPayload,
  WalletAddressContext,
  WalletConnectNamespacePayload,
} from './interfaces/wallet.interfaces.js';
import { WalletBalanceService } from './services/wallet-balance.service.js';
import { WalletAddressService } from './services/wallet-address.service.js';
import { WalletConnectService } from './services/wallet-connect.service.js';
import { WalletTransactionService } from './services/wallet-transaction.service.js';
import { WalletSendService } from './services/wallet-send.service.js';
// import { WalletSubstrateService } from './services/wallet-substrate.service.js';
import { WalletIdentityService } from './services/wallet-identity.service.js';

@Injectable()
export class WalletService {
  constructor(
    private readonly walletBalanceService: WalletBalanceService,
    private readonly walletAddressService: WalletAddressService,
    private readonly walletConnectService: WalletConnectService,
    private readonly walletTransactionService: WalletTransactionService,
    private readonly walletSendService: WalletSendService,
    // private readonly walletSubstrateService: WalletSubstrateService,
    private readonly walletIdentityService: WalletIdentityService,
  ) {}

  /**
   * Get all wallet addresses for all chains
   * Auto-creates wallet if it doesn't exist
   * @param userId - The user ID
   * @returns Object containing addresses for all chains
   */
  async getAddresses(userId: string): Promise<WalletAddresses> {
    return this.walletAddressService.getAddresses(userId);
  }

  async getWalletAddressContext(userId: string): Promise<WalletAddressContext> {
    return this.walletAddressService.getWalletAddressContext(userId);
  }

  async getUiWalletAddresses(userId: string): Promise<UiWalletPayload> {
    return this.walletAddressService.getUiWalletAddresses(userId);
  }

  async getWalletConnectAccounts(
    userId: string,
  ): Promise<WalletConnectNamespacePayload[]> {
    return this.walletConnectService.getWalletConnectAccounts(userId);
  }

  /**
   * Create or import a wallet seed phrase
   * @param userId - The user ID
   * @param mode - Either 'random' to generate or 'mnemonic' to import
   * @param mnemonic - The mnemonic phrase (required if mode is 'mnemonic')
   * @param saveHistory - Whether to save current wallet to history (default: true for authenticated users)
   */
  async createOrImportSeed(
    userId: string,
    mode: 'random' | 'mnemonic',
    mnemonic?: string,
    saveHistory: boolean = true,
  ): Promise<void> {
    return this.walletIdentityService.createOrImportSeed(
      userId,
      mode,
      mnemonic,
      saveHistory,
    );
  }

  /**
   * Get wallet history for authenticated users
   * @param userId - The user ID
   */
  async getWalletHistory(userId: string) {
    return this.walletIdentityService.getWalletHistory(userId);
  }

  /**
   * Switch to a different wallet from history
   * @param userId - The user ID
   * @param walletId - The wallet history entry ID to switch to
   */
  async switchWallet(userId: string, walletId: string): Promise<boolean> {
    return this.walletIdentityService.switchWallet(userId, walletId);
  }

  /**
   * Delete a wallet from history
   * @param userId - The user ID
   * @param walletId - The wallet history entry ID to delete
   */
  async deleteWalletHistory(
    userId: string,
    walletId: string,
  ): Promise<boolean> {
    return this.walletIdentityService.deleteWalletHistory(userId, walletId);
  }

  /**
   * Get all token positions across any supported chains for the user's primary addresses
   * Uses Zerion any-chain endpoints per address (no chain filter) and merges results.
   * Primary addresses considered: EVM EOA (ethereum), first ERC-4337 smart account, and Solana.
   * @param userId - The user ID
   * @param forceRefresh - Force refresh from API (bypass Zerion's internal cache)
   */
  async getTokenBalancesAny(
    userId: string,
    forceRefresh: boolean = false,
  ): Promise<
    Array<{
      chain: string;
      address: string | null;
      symbol: string;
      balance: string;
      decimals: number;
      balanceHuman?: string;
    }>
  > {
    return this.walletBalanceService.getTokenBalancesAny(userId, forceRefresh);
  }

  /**
   * Get transactions across any supported chains for the user's primary addresses
   * Merges and dedupes by chain_id + tx hash.
   */
  async getTransactionsAny(
    userId: string,
    limit: number = 100,
  ): Promise<
    Array<{
      txHash: string;
      from: string;
      to: string | null;
      value: string;
      timestamp: number | null;
      blockNumber: number | null;
      status: 'success' | 'failed' | 'pending';
      chain: string;
      tokenSymbol?: string;
      tokenAddress?: string;
    }>
  > {
    return this.walletTransactionService.getTransactionsAny(userId, limit);
  }

  /**
   * Stream addresses progressively (for SSE)
   * Yields addresses as they become available
   */
  async *streamAddresses(
    userId: string,
  ): AsyncGenerator<UiWalletPayload, void, unknown> {
    for await (const payload of this.walletAddressService.streamAddresses(
      userId,
    )) {
      yield payload;
    }
  }

  /**
   * Stream balances progressively (for SSE)
   * Yields balances as they're fetched from Zerion
   */
  async *streamBalances(userId: string): AsyncGenerator<
    {
      chain: string;
      nativeBalance: string;
      tokens: Array<{
        address: string | null;
        symbol: string;
        balance: string;
        decimals: number;
      }>;
    },
    void,
    unknown
  > {
    for await (const balance of this.walletBalanceService.streamBalances(
      userId,
    )) {
      yield balance;
    }
  }

  /**
   * Get balances for all chains using Zerion API
   * Auto-creates wallet if it doesn't exist
   * @param userId - The user ID
   * @returns Array of balance objects
   */
  async getBalances(
    userId: string,
    forceRefresh: boolean = false,
  ): Promise<Array<{ chain: string; balance: string }>> {
    return this.walletBalanceService.getBalances(userId, forceRefresh);
  }

  /**
   * Refresh balances from external APIs and update cache
   * @param userId - The user ID
   * @returns Fresh balances from APIs
   */
  async refreshBalances(
    userId: string,
  ): Promise<Array<{ chain: string; balance: string }>> {
    return this.walletBalanceService.refreshBalances(userId);
  }

  /**
   * Get ERC-4337 paymaster token balances
   * @param userId - The user ID
   * @returns Array of paymaster token balances
   */
  async getErc4337PaymasterBalances(
    userId: string,
  ): Promise<Array<{ chain: string; balance: string }>> {
    return this.walletBalanceService.getErc4337PaymasterBalances(userId);
  }

  /**
   * Send crypto to a recipient address
   * @param userId - The user ID
   * @param chain - The blockchain network
   * @param recipientAddress - The recipient's address
   * @param amount - The amount to send (as string to preserve precision)
   * @param tokenAddress - Optional token contract address for ERC-20 tokens
   * @param tokenDecimals - Optional token decimals from Zerion/UI (if provided, will be used directly)
   * @returns Transaction hash
   */
  async sendCrypto(
    userId: string,
    chain: AllChainTypes,
    recipientAddress: string,
    amount: string,
    tokenAddress?: string,
    tokenDecimals?: number,
    options?: { forceEip7702?: boolean },
  ): Promise<{ txHash: string }> {
    return this.walletSendService.sendCrypto(
      userId,
      chain,
      recipientAddress,
      amount,
      tokenAddress,
      tokenDecimals,
      options,
    );
  }

  async sendEip7702Gasless(
    userId: string,
    chainId: number,
    recipientAddress: string,
    amount: string,
    tokenAddress?: string,
    tokenDecimals?: number,
  ): Promise<{
    success: boolean;
    userOpHash: string;
    transactionHash?: string;
    isFirstTransaction: boolean;
    explorerUrl?: string;
  }> {
    return this.walletSendService.sendEip7702Gasless(
      userId,
      chainId,
      recipientAddress,
      amount,
      tokenAddress,
      tokenDecimals,
    );
  }

  /**
   * Sign a WalletConnect transaction request
   * @param userId - The user ID
   * @param chainId - WalletConnect chain ID (e.g., "eip155:1", "eip155:8453")
   * @param transaction - Transaction parameters from WalletConnect
   * @returns Transaction hash
   */
  async signWalletConnectTransaction(
    userId: string,
    chainId: string,
    transaction: {
      from: string;
      to?: string;
      value?: string;
      data?: string;
      gas?: string;
      gasPrice?: string;
      maxFeePerGas?: string;
      maxPriorityFeePerGas?: string;
      nonce?: string;
    },
  ): Promise<{ txHash: string }> {
    return this.walletConnectService.signWalletConnectTransaction(
      userId,
      chainId,
      transaction,
    );
  }

  /**
   * Get token balances for a specific chain using Zerion API
   * @param userId - The user ID
   * @param chain - The blockchain network
   * @param forceRefresh - Force refresh from API (bypass Zerion's internal cache)
   * @returns Array of token balances
   */
  async getTokenBalances(
    userId: string,
    chain: string,
    forceRefresh: boolean = false,
  ): Promise<
    Array<{
      address: string | null;
      symbol: string;
      balance: string;
      decimals: number;
    }>
  > {
    return this.walletBalanceService.getTokenBalances(
      userId,
      chain,
      forceRefresh,
    );
  }

  /**
   * Get transaction history for a user on a specific chain using Zerion API
   * @param userId - The user ID
   * @param chain - The chain identifier
   * @param limit - Maximum number of transactions to return (default: 50)
   * @returns Array of transaction objects
   */
  async getTransactionHistory(
    userId: string,
    chain: string,
    limit: number = 50,
  ): Promise<
    Array<{
      txHash: string;
      from: string;
      to: string | null;
      value: string;
      timestamp: number | null;
      blockNumber: number | null;
      status: 'success' | 'failed' | 'pending';
      chain: string;
      tokenSymbol?: string;
      tokenAddress?: string;
    }>
  > {
    return this.walletTransactionService.getTransactionHistory(
      userId,
      chain,
      limit,
    );
  }

  /**
   * Get Substrate balances for all chains for a user
   *
   * @param userId - User ID
   * @param useTestnet - Whether to use testnet
   * @returns Map of chain -> balance information
  //  */
  // async getSubstrateBalances(
  //   userId: string,
  //   useTestnet: boolean = false,
  //   forceRefresh: boolean = false,
  // ): Promise<
  //   Record<
  //     SubstrateChainKey,
  //     {
  //       balance: string;
  //       address: string | null;
  //       token: string;
  //       decimals: number;
  //     }
  //   >
  // > {
  //   return this.walletBalanceService.getSubstrateBalances(
  //     userId,
  //     useTestnet,
  //     forceRefresh,
  //   );
  // }

  /**
   * Get Substrate transaction history for a user
   *
   * @param userId - User ID
  //  * @param chain - Chain key
  //  * @param useTestnet - Whether to use testnet
  //  * @param limit - Number of transactions to fetch
  //  * @param cursor - Pagination cursor
  //  * @returns Transaction history
  //  */
  // async getSubstrateTransactions(
  //   userId: string,
  //   chain: SubstrateChainKey,
  //   useTestnet: boolean = false,
  //   limit: number = 10,
  //   cursor?: string,
  // ) {
  //   return this.walletSubstrateService.getSubstrateTransactions(
  //     userId,
  //     chain,
  //     useTestnet,
  //     limit,
  //     cursor,
  //   );
  // }

  /**
   * Get Substrate addresses for a user
   *
   * @param userId - User ID
   * @param useTestnet - Whether to use testnet
   * @returns Substrate addresses
   */
  // async getSubstrateAddresses(userId: string, useTestnet: boolean = false) {
  //   return this.walletSubstrateService.getSubstrateAddresses(
  //     userId,
  //     useTestnet,
  //   );
  // }

  /**
   * Send Substrate transfer
   *
   * @param userId - User ID
   * @param chain - Chain key
   * @param to - Recipient address
   * @param amount - Amount in smallest units
   * @param useTestnet - Whether to use testnet
   * @param transferMethod - Transfer method ('transferAllowDeath' or 'transferKeepAlive')
   * @param accountIndex - Account index (default: 0)
   * @returns Transaction result
   */
  // async sendSubstrateTransfer(
  //   userId: string,
  //   chain: SubstrateChainKey,
  //   to: string,
  //   amount: string,
  //   useTestnet: boolean = false,
  //   transferMethod?: 'transferAllowDeath' | 'transferKeepAlive',
  //   accountIndex: number = 0,
  // ) {
  //   return this.walletSubstrateService.sendSubstrateTransfer(
  //     userId,
  //     chain,
  //     to,
  //     amount,
  //     useTestnet,
  //     transferMethod,
  //     accountIndex,
  //   );
  // }
}
