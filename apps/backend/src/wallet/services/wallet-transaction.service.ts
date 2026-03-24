import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { SeedRepository } from '../seed.repository.js';
import { ZerionService } from '../zerion.service.js';
// import { PolkadotEvmRpcService } from './polkadot-evm-rpc.service.js';
import { AddressManager } from '../managers/address.manager.js';
import { WalletIdentityService } from './wallet-identity.service.js';
import { WalletAddresses } from '../interfaces/wallet.interfaces.js';

@Injectable()
export class WalletTransactionService {
  private readonly logger = new Logger(WalletTransactionService.name);

  constructor(
    private readonly seedRepository: SeedRepository,
    private readonly zerionService: ZerionService,
    // private readonly polkadotEvmRpcService: PolkadotEvmRpcService,
    private readonly addressManager: AddressManager,
    private readonly walletIdentityService: WalletIdentityService,
  ) {}

  private async getAddresses(userId: string): Promise<WalletAddresses> {
    return this.addressManager.getAddresses(userId);
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
    const hasSeed = await this.seedRepository.hasSeed(userId);
    if (!hasSeed) {
      await this.walletIdentityService.createOrImportSeed(userId, 'random');
    }

    const addresses = await this.getAddresses(userId);
    const targetAddresses = [addresses.ethereum].filter(Boolean);

    // Polkadot EVM chains use the same EOA address as ethereum
    // const polkadotEvmAddress = addresses.ethereum;

    // Fetch transactions from Zerion with timeout protection
    const zerionPerAddr =
      targetAddresses.length > 0
        ? await Promise.allSettled(
            targetAddresses.map((addr) =>
              Promise.race([
                this.zerionService.getTransactionsAnyChain(addr, limit),
                new Promise<never>((_, reject) =>
                  setTimeout(
                    () =>
                      reject(
                        new Error(
                          `Transaction fetch timeout for ${addr} after 30s`,
                        ),
                      ),
                    30000,
                  ),
                ),
              ]).catch((error) => {
                this.logger.warn(
                  `Failed to fetch transactions for ${addr}: ${error instanceof Error ? error.message : 'Unknown error'}`,
                );
                return []; // Return empty array on error/timeout
              }),
            ),
          ).then((results) =>
            results.map((result) =>
              result.status === 'fulfilled' ? result.value : [],
            ),
          )
        : [];

    // Fetch Polkadot EVM chain transactions using RPC
    // const polkadotEvmChains = [
    //   'moonbeamTestnet',
    //   'astarShibuya',
    //   'paseoPassetHub',
    // ];
    // const polkadotTransactions: Array<{
    //   txHash: string;
    //   from: string;
    //   to: string | null;
    //   value: string;
    //   timestamp: number | null;
    //   blockNumber: number | null;
    //   status: 'success' | 'failed' | 'pending';
    //   chain: string;
    //   tokenSymbol?: string;
    //   tokenAddress?: string;
    // }> = [];

    // if (polkadotEvmAddress) {
    //   // Use Promise.allSettled with timeout to ensure RPC errors don't block Zerion results
    //   const polkadotResults = await Promise.allSettled(
    //     polkadotEvmChains.map(async (chain) => {
    //       try {
    //         const txs = await Promise.race([
    //           this.polkadotEvmRpcService.getTransactions(
    //             polkadotEvmAddress,
    //             chain,
    //             limit,
    //           ),
    //           new Promise<never>((_, reject) =>
    //             setTimeout(
    //               () => reject(new Error(`RPC timeout for ${chain} after 20s`)),
    //               20000,
    //             ),
    //           ),
    //         ]);
    //         return txs.map((tx) => ({
    //           txHash: tx.txHash,
    //           from: tx.from,
    //           to: tx.to,
    //           value: tx.value,
    //           timestamp: tx.timestamp,
    //           blockNumber: tx.blockNumber,
    //           status: tx.status,
    //           chain: tx.chain,
    //         }));
    //       } catch (error) {
    //         this.logger.warn(
    //           `Error fetching transactions for ${chain}: ${error instanceof Error ? error.message : 'Unknown error'}`,
    //         );
    //         return []; // Return empty array on error
    //       }
    //     }),
    //   );

    //   // Flatten the results
    //   for (const result of polkadotResults) {
    //     if (result.status === 'fulfilled') {
    //       polkadotTransactions.push(...result.value);
    //     }
    //   }
    // }

    const perAddr = [...zerionPerAddr];

    const byKey = new Map<
      string,
      {
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
      }
    >();

    for (const list of perAddr) {
      for (const tx of list) {
        try {
          const attrs = tx.attributes || {};
          const chainId =
            tx.relationships?.chain?.data?.id?.toLowerCase() || 'unknown';
          const hash = (attrs.hash || tx.id || '').toLowerCase();
          if (!hash) continue;

          // Determine status
          let status: 'success' | 'failed' | 'pending' = 'pending';
          if (attrs.status) {
            const s = attrs.status.toLowerCase();
            if (s === 'confirmed' || s === 'success') status = 'success';
            else if (s === 'failed' || s === 'error') status = 'failed';
          } else if (
            attrs.block_confirmations !== undefined &&
            attrs.block_confirmations > 0
          ) {
            status = 'success';
          }

          const transfers = attrs.transfers || [];
          let tokenSymbol: string | undefined;
          let tokenAddress: string | undefined;
          let value = '0';
          let toAddress: string | null = null;

          if (transfers.length > 0) {
            const tr = transfers[0];
            if (tr) {
              tokenSymbol = tr.fungible_info?.symbol;
              const q = tr.quantity;
              if (q) {
                const intPart = q.int || '0';
                const decimals = q.decimals || 0;
                value = `${intPart}${'0'.repeat(Math.max(0, 18 - decimals))}`;
              }
              toAddress = tr.to?.address || null;
            }
          }

          const key = `${chainId}:${hash}`;
          if (!byKey.has(key)) {
            byKey.set(key, {
              txHash: hash,
              from: '',
              to: toAddress,
              value,
              timestamp: attrs.mined_at || attrs.sent_at || null,
              blockNumber: attrs.block_number || null,
              status,
              chain: chainId,
              tokenSymbol,
              tokenAddress,
            });
          }
        } catch (e) {
          this.logger.debug(
            `Error processing any-chain tx: ${e instanceof Error ? e.message : 'Unknown error'}`,
          );
        }
      }
    }

    // Process Polkadot EVM RPC transactions
    // for (const tx of polkadotTransactions) {
    //   try {
    //     const key = `${tx.chain}:${tx.txHash.toLowerCase()}`;
    //     if (!byKey.has(key)) {
    //       byKey.set(key, {
    //         txHash: tx.txHash,
    //         from: tx.from,
    //         to: tx.to,
    //         value: tx.value,
    //         timestamp: tx.timestamp,
    //         blockNumber: tx.blockNumber,
    //         status: tx.status,
    //         chain: tx.chain,
    //       });
    //     }
    //   } catch (e) {
    //     this.logger.debug(
    //       `Error processing Polkadot EVM transaction: ${e instanceof Error ? e.message : 'Unknown error'}`,
    //     );
    //   }
    // }

    const sorted = Array.from(byKey.values()).sort((a, b) => {
      const timeA = a.timestamp || 0;
      const timeB = b.timestamp || 0;
      return timeB - timeA; // Most recent first
    });

    this.logger.log(
      `Returning ${Math.min(sorted.length, limit)} transactions (from ${sorted.length} total) for user ${userId}`,
    );

    return sorted.slice(0, limit);
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
    this.logger.log(
      `Getting transaction history for user ${userId} on chain ${chain} using Zerion`,
    );

    // Check if wallet exists, create if not
    const hasSeed = await this.seedRepository.hasSeed(userId);

    if (!hasSeed) {
      this.logger.debug(`No wallet found for user ${userId}. Auto-creating...`);
      await this.walletIdentityService.createOrImportSeed(userId, 'random');
      this.logger.debug(`Successfully auto-created wallet for user ${userId}`);
    }

    try {
      // Get address for this chain
      const addresses = await this.getAddresses(userId);
      const address = addresses[chain as keyof WalletAddresses];

      if (!address) {
        this.logger.warn(`No address found for chain ${chain}`);
        return [];
      }

      // Get transactions from Zerion
      const zerionTransactions = await this.zerionService.getTransactions(
        address,
        chain,
        limit,
      );

      if (!zerionTransactions || zerionTransactions.length === 0) {
        this.logger.debug(
          `No transactions from Zerion for ${address} on ${chain}`,
        );
        return [];
      }

      const transactions: Array<{
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
      }> = [];

      // Map Zerion transactions to our format
      for (const zerionTx of zerionTransactions) {
        try {
          const attributes = zerionTx.attributes || {};
          const txHash = attributes.hash || zerionTx.id || '';
          const timestamp = attributes.mined_at || attributes.sent_at || null;
          const blockNumber = attributes.block_number || null;

          // Determine status
          let status: 'success' | 'failed' | 'pending' = 'pending';
          if (attributes.status) {
            const statusLower = attributes.status.toLowerCase();
            if (statusLower === 'confirmed' || statusLower === 'success') {
              status = 'success';
            } else if (statusLower === 'failed' || statusLower === 'error') {
              status = 'failed';
            }
          } else if (
            attributes.block_confirmations !== undefined &&
            attributes.block_confirmations > 0
          ) {
            status = 'success';
          }

          // Get transfer information
          const transfers = attributes.transfers || [];
          let tokenSymbol: string | undefined;
          let tokenAddress: string | undefined;
          let value = '0';
          let toAddress: string | null = null;

          if (transfers.length > 0) {
            // Use first transfer for token info
            const transfer = transfers[0];
            if (transfer) {
              tokenSymbol = transfer.fungible_info?.symbol;
              const quantity = transfer.quantity;
              if (quantity) {
                const intPart = quantity.int || '0';
                const decimals = quantity.decimals || 0;
                value = `${intPart}${'0'.repeat(Math.max(0, 18 - decimals))}`;
              }
              toAddress = transfer.to?.address || null;
            }
          } else {
            // Native token transfer - get from fee or use default
            if (attributes.fee?.value) {
              value = attributes.fee.value.toString();
            }
          }

          transactions.push({
            txHash,
            from: address,
            to: toAddress,
            value,
            timestamp,
            blockNumber,
            status,
            chain,
            tokenSymbol,
            tokenAddress,
          });
        } catch (error) {
          this.logger.debug(
            `Error processing transaction from Zerion: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        }
      }

      this.logger.log(
        `Retrieved ${transactions.length} transactions from Zerion for ${chain}`,
      );
      return transactions;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Error getting transaction history from Zerion: ${errorMessage}`,
      );
      return [];
    }
  }
}
