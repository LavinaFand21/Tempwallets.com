import {
  Injectable,
  Logger,
  BadRequestException,
  UnprocessableEntityException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SeedRepository } from '../seed.repository.js';
import { ZerionService } from '../zerion.service.js';
import { PimlicoConfigService } from '../config/pimlico.config.js';
import { Eip7702DelegationRepository } from '../repositories/eip7702-delegation.repository.js';
import { WalletIdentityService } from './wallet-identity.service.js';
import { WalletBalanceService } from './wallet-balance.service.js';
import { WalletAccountService } from './wallet-account.service.js';
import { AllChainTypes } from '../types/chain.types.js';
import { getExplorerUrl } from '../utils/validation.utils.js';
import { convertToSmallestUnits } from '../utils/conversion.utils.js';

@Injectable()
export class WalletSendService {
  private readonly logger = new Logger(WalletSendService.name);

  constructor(
    private readonly seedRepository: SeedRepository,
    private readonly zerionService: ZerionService,
    private readonly pimlicoConfig: PimlicoConfigService,
    private readonly eip7702DelegationRepository: Eip7702DelegationRepository,
    private readonly walletIdentityService: WalletIdentityService,
    private readonly walletBalanceService: WalletBalanceService,
    private readonly walletAccountService: WalletAccountService,
  ) {}

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
    this.logger.log(
      `Sending crypto for user ${userId} on chain ${chain}: ${amount} to ${recipientAddress}`,
    );

    // Check if wallet exists, create if not
    const hasSeed = await this.seedRepository.hasSeed(userId);

    if (!hasSeed) {
      await this.walletIdentityService.createOrImportSeed(userId, 'random');
    }

    // Validate amount
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      throw new BadRequestException('Amount must be a positive number');
    }

    const forceEip7702 = options?.forceEip7702 === true;
    const isEip7702Chain = this.pimlicoConfig.isEip7702Enabled(chain);
    const accountType = isEip7702Chain ? 'EIP-7702' : 'EOA';

    try {
      const seedPhrase = await this.seedRepository.getSeedPhrase(userId);

      // Auto-route native sends on EIP-7702 enabled chains to the gasless flow to avoid zeroed gas fields
      if (isEip7702Chain && !tokenAddress && !forceEip7702) {
        const chainId = this.pimlicoConfig.getEip7702Config(
          chain as
            | 'ethereum'
            | 'base'
            | 'arbitrum'
            | 'optimism'
            | 'polygon'
            | 'bnb'
            | 'avalanche',
        ).chainId;

        this.logger.warn(
          `[Auto-Route] Chain ${chain} has EIP-7702 enabled but sendCrypto() was called. ` +
            `Routing to sendEip7702Gasless() for proper user operation flow.`,
        );

        const result = await this.sendEip7702Gasless(
          userId,
          chainId,
          recipientAddress,
          amount,
          tokenAddress,
          tokenDecimals,
        );

        return { txHash: result.transactionHash || result.userOpHash };
      }

      // Create account using appropriate factory
      const account = await this.walletAccountService.createAccountForChain(
        seedPhrase,
        chain,
        userId,
      );
      const walletAddress = await account.getAddress();

      this.logger.log(
        `[Send Debug] User is sending ${amount} ${tokenAddress || 'native'} from ${chain} ` +
          `(accountType: ${accountType}, address: ${walletAddress})`,
      );

      // Get decimals: Use provided tokenDecimals, or fetch from Zerion, or use native decimals
      let finalDecimals: number;
      let decimalsSource: string;

      if (tokenAddress) {
        // ERC-20 token
        if (
          tokenDecimals !== undefined &&
          tokenDecimals !== null &&
          tokenDecimals >= 0 &&
          tokenDecimals <= 36
        ) {
          // OPTIMIZED: Use provided decimals from UI/Zerion directly - no re-fetch
          finalDecimals = tokenDecimals;
          decimalsSource = 'frontend-zerion';
          this.logger.log(
            `[Decimals Optimization] Using frontend-provided token decimals: ${finalDecimals} ` +
              `(source: ${decimalsSource}). Skipping redundant Zerion API call.`,
          );
        } else {
          // Frontend didn't provide decimals or they're invalid - fetch from Zerion
          this.logger.warn(
            `[Decimals Fallback] Frontend did not provide valid tokenDecimals for ${tokenAddress}. ` +
              `Provided value: ${tokenDecimals}. Falling back to Zerion API lookup.`,
          );

          const tokenInfo = await this.walletBalanceService.getZerionTokenInfo(
            tokenAddress,
            chain,
            walletAddress,
          );
          if (
            tokenInfo &&
            tokenInfo.decimals !== null &&
            tokenInfo.decimals !== undefined &&
            tokenInfo.decimals >= 0 &&
            tokenInfo.decimals <= 36
          ) {
            finalDecimals = tokenInfo.decimals;
            decimalsSource = 'zerion-api';
            this.logger.log(
              `[Decimals Fallback] Fetched token decimals from Zerion API: ${finalDecimals} ` +
                `(source: ${decimalsSource})`,
            );
          } else {
            // Zerion failed - try RPC as final fallback
            this.logger.warn(
              `[Decimals Fallback] Zerion API lookup failed for ${tokenAddress} on ${chain}. ` +
                `Trying RPC decimals() call as final fallback.`,
            );

            const rpcDecimals =
              await this.walletBalanceService.fetchDecimalsFromRPC(
                tokenAddress,
                account,
              );
            if (rpcDecimals !== null && rpcDecimals >= 0 && rpcDecimals <= 36) {
              finalDecimals = rpcDecimals;
              decimalsSource = 'rpc-decimals()';
              this.logger.log(
                `[Decimals Fallback] Fetched token decimals from RPC: ${finalDecimals} ` +
                  `(source: ${decimalsSource})`,
              );
            } else {
              // All methods failed
              throw new BadRequestException(
                `Cannot determine token decimals for ${tokenAddress} on ${chain}. ` +
                  `Attempted: Frontend (${tokenDecimals}), Zerion API (failed), RPC decimals() (failed). ` +
                  `This token may not exist on ${chain}, or Zerion data is incomplete. ` +
                  `Please refresh your wallet data and try again.`,
              );
            }
          }
        }
      } else {
        // Native token
        finalDecimals = this.walletBalanceService.getNativeTokenDecimals(chain);
        decimalsSource = 'native';
        this.logger.log(
          `Using native token decimals: ${finalDecimals} (source: ${decimalsSource})`,
        );
      }

      // Convert human-readable amount to smallest units using Zerion's decimals
      const amountSmallest = convertToSmallestUnits(amount, finalDecimals);
      this.logger.log(
        `Send pre-check: chain=${chain}, accountType=${accountType}, token=${tokenAddress || 'native'}, ` +
          `humanAmount=${amount}, decimals=${finalDecimals} (source: ${decimalsSource}), ` +
          `amountSmallest=${amountSmallest.toString()}`,
      );

      // Validate address format (basic check)
      if (!recipientAddress || recipientAddress.trim().length === 0) {
        throw new BadRequestException('Recipient address is required');
      }

      // Validate balance using Zerion as primary source
      const balanceValidation =
        await this.walletBalanceService.validateBalanceFromZerion(
          tokenAddress || null,
          amountSmallest,
          chain,
          walletAddress,
        );

      this.logger.log(
        `Balance validation: zerionBalance=${balanceValidation.zerionBalance}, ` +
          `requested=${amountSmallest.toString()}, sufficient=${balanceValidation.sufficient}`,
      );

      // Use on-chain balance as source of truth - verify if Zerion says insufficient
      if (!balanceValidation.sufficient) {
        // Zerion says insufficient - verify with on-chain balance (source of truth)
        this.logger.warn(
          `Zerion reported insufficient balance (${balanceValidation.zerionBalance}), ` +
            `verifying with on-chain balance (source of truth)`,
        );

        try {
          const onChainValidation =
            await this.walletBalanceService.validateBalanceOnChain(
              tokenAddress || null,
              amountSmallest,
              account,
            );

          if (onChainValidation.sufficient) {
            // On-chain says sufficient - allow transaction (Zerion may be stale)
            this.logger.warn(
              `Balance discrepancy detected: Zerion shows ${balanceValidation.zerionBalance}, ` +
                `on-chain shows ${onChainValidation.balance}, requested ${amountSmallest.toString()}. ` +
                `Using on-chain balance (source of truth) - proceeding with transaction.`,
            );
            // Don't throw error - proceed with send
          } else {
            // Both Zerion AND on-chain say insufficient
            const errorMessage =
              `Insufficient balance confirmed by both Zerion and on-chain. ` +
              `Zerion: ${balanceValidation.zerionBalance} smallest units` +
              `${balanceValidation.error ? ` (${balanceValidation.error})` : ''}, ` +
              `On-chain: ${onChainValidation.balance} smallest units, ` +
              `Requested: ${amountSmallest.toString()} smallest units`;

            this.logger.error(
              `Insufficient balance: ${errorMessage}, token=${tokenAddress || 'native'}, ` +
                `decimals=${finalDecimals}, chain=${chain}`,
            );

            throw new UnprocessableEntityException(errorMessage);
          }
        } catch (e) {
          if (e instanceof UnprocessableEntityException) {
            throw e;
          }

          // Couldn't get on-chain balance - trust Zerion
          this.logger.error(
            `Could not verify with on-chain balance: ${e instanceof Error ? e.message : 'Unknown error'}. ` +
              `Trusting Zerion result.`,
          );

          const errorMessage =
            balanceValidation.error ||
            `Insufficient balance. Zerion shows: ${balanceValidation.zerionBalance} smallest units, ` +
              `Requested: ${amountSmallest.toString()} smallest units. ` +
              `Could not verify with on-chain balance.`;

          throw new UnprocessableEntityException(errorMessage);
        }
      } else {
        // Zerion says sufficient - log for debugging but proceed
        this.logger.log(
          `Balance validation passed: Zerion shows ${balanceValidation.zerionBalance}, ` +
            `requested ${amountSmallest.toString()}`,
        );
      }

      // Send transaction- single mapped method per account type
      let txHash: string = '';
      let sendMethod: string = 'unknown';

      try {
        if (tokenAddress) {
          // ERC-20 token transfer
          // Use account.transfer with structured parameters (preferred for both EOA and ERC-4337)
          if (
            'transfer' in account &&
            typeof (account as any).transfer === 'function'
          ) {
            try {
              // Try with 'recipient' key first
              // Define a type for accounts with transfer method
              type TransferableAccount = {
                transfer(params: {
                  token: string;
                  recipient: string;
                  amount: bigint;
                }): Promise<string | { hash?: string; txHash?: string }>;
              };
              const transferableAccount = account as TransferableAccount;
              const result = await transferableAccount.transfer({
                token: tokenAddress,
                recipient: recipientAddress,
                amount: amountSmallest,
              });
              if (typeof result === 'string') {
                txHash = result;
              } else if (
                typeof result === 'object' &&
                result !== null &&
                ('hash' in result || 'txHash' in result)
              ) {
                txHash =
                  (result as { hash?: string; txHash?: string }).hash ||
                  (result as { hash?: string; txHash?: string }).txHash ||
                  String(result);
              } else {
                txHash = String(result);
              }
              sendMethod = 'transfer({token, recipient, amount})';
            } catch (e1) {
              // Try with 'to' key if 'recipient' was not accepted
              try {
                const result = await (account as any).transfer({
                  token: tokenAddress,
                  to: recipientAddress,
                  amount: amountSmallest,
                });
                txHash =
                  typeof result === 'string'
                    ? result
                    : result?.hash || result?.txHash || String(result);
                sendMethod = 'transfer({token, to, amount})';
              } catch (e2) {
                this.logger.error(
                  `Token transfer via account.transfer failed: ${e2 instanceof Error ? e2.message : 'unknown'}`,
                );
                throw new ServiceUnavailableException(
                  `Token transfer method not supported. Account type: ${accountType}, ` +
                    `Error: ${e2 instanceof Error ? e2.message : 'unknown'}`,
                );
              }
            }
          } else {
            throw new ServiceUnavailableException(
              `Token transfer not supported for account type ${accountType} on chain ${chain}. ` +
                `The account does not support the transfer method.`,
            );
          }
        } else {
          // Native token transfer
          if ('send' in account && typeof account.send === 'function') {
            const result = await account.send(
              recipientAddress,
              amountSmallest.toString(),
            );
            txHash =
              typeof result === 'string'
                ? result
                : (result as any).hash ||
                  (result as any).txHash ||
                  String(result);
            sendMethod = 'send(recipient, amount)';
          } else if (
            'transfer' in account &&
            typeof (account as any).transfer === 'function'
          ) {
            const result = await (account as any).transfer({
              to: recipientAddress,
              amount: amountSmallest,
            });
            txHash =
              typeof result === 'string'
                ? result
                : result.hash || result.txHash || String(result);
            sendMethod = 'transfer({to, amount})';
          } else {
            throw new BadRequestException(
              `Native token send not supported for chain ${chain}. ` +
                `Account type: ${accountType}. Please check if this chain/account combination is supported.`,
            );
          }
        }

        if (!txHash || typeof txHash !== 'string') {
          throw new ServiceUnavailableException(
            'Transaction submitted but no transaction hash returned',
          );
        }

        // Structured logging for successful transaction
        this.logger.log(
          `Transaction successful: chain=${chain}, accountType=${accountType}, ` +
            `token=${tokenAddress || 'native'}, decimals=${finalDecimals} (source: ${decimalsSource}), ` +
            `humanAmount=${amount}, amountSmallest=${amountSmallest.toString()}, ` +
            `method=${sendMethod}, txHash=${txHash}, recipient=${recipientAddress}`,
        );

        // Invalidate caches after successful send
        try {
          // Invalidate Zerion cache
          this.zerionService.invalidateCache(walletAddress, chain);
          this.logger.log(
            `Invalidated Zerion cache for ${walletAddress} on ${chain} after send`,
          );
        } catch (cacheError) {
          this.logger.warn(
            `Failed to invalidate cache: ${cacheError instanceof Error ? cacheError.message : 'Unknown error'}`,
          );
        }

        return { txHash };
      } catch (error) {
        // Structured error logging
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(
          `Transaction failed: chain=${chain}, accountType=${accountType}, ` +
            `token=${tokenAddress || 'native'}, decimals=${finalDecimals} (source: ${decimalsSource}), ` +
            `humanAmount=${amount}, amountSmallest=${amountSmallest.toString()}, ` +
            `method=${sendMethod}, error=${errorMessage}`,
        );

        // Re-throw known exceptions
        if (
          error instanceof BadRequestException ||
          error instanceof UnprocessableEntityException ||
          error instanceof ServiceUnavailableException
        ) {
          throw error;
        }

        // Enhanced error handling with specific messages
        const lowerError = errorMessage.toLowerCase();

        if (
          lowerError.includes('insufficient') ||
          lowerError.includes('balance')
        ) {
          throw new UnprocessableEntityException(
            `Insufficient balance for this transaction. ` +
              `Please check your balance and try again. Error: ${errorMessage}`,
          );
        }

        if (
          lowerError.includes('network') ||
          lowerError.includes('timeout') ||
          lowerError.includes('rpc')
        ) {
          throw new ServiceUnavailableException(
            `Blockchain network is unavailable. Please try again later. Error: ${errorMessage}`,
          );
        }

        if (
          lowerError.includes('invalid address') ||
          lowerError.includes('address')
        ) {
          throw new BadRequestException(
            `Invalid recipient address. Error: ${errorMessage}`,
          );
        }

        if (
          lowerError.includes('nonce') ||
          lowerError.includes('replacement')
        ) {
          throw new ServiceUnavailableException(
            `Transaction nonce error. Please wait a moment and try again. Error: ${errorMessage}`,
          );
        }

        // Generic fallback
        throw new ServiceUnavailableException(
          `Transaction failed: ${errorMessage}`,
        );
      }
    } catch (error) {
      // Re-throw known exceptions (they already have proper error messages)
      if (
        error instanceof BadRequestException ||
        error instanceof UnprocessableEntityException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }
      // Log unexpected errors with full context
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Unexpected error in sendCrypto: userId=${userId}, chain=${chain}, ` +
          `token=${tokenAddress || 'native'}, amount=${amount}, error=${errorMessage}`,
      );
      this.logger.error(
        `Stack trace: ${error instanceof Error ? error.stack : 'No stack trace'}`,
      );
      throw new ServiceUnavailableException(
        `Failed to send crypto: ${errorMessage}`,
      );
    }
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
    const chainIdMap: Record<number, AllChainTypes> = {
      1: 'ethereum',
      8453: 'base',
      42161: 'arbitrum',
      10: 'optimism',
      137: 'polygon',
      43114: 'avalanche',
      56: 'bnb',
    };

    const chain = chainIdMap[chainId];
    if (!chain) {
      throw new BadRequestException(`Unsupported EIP-7702 chainId: ${chainId}`);
    }

    if (!this.pimlicoConfig.isEip7702Enabled(chain)) {
      throw new BadRequestException(
        `EIP-7702 is not enabled for chain ${chain}. Enable via config before sending gasless transactions.`,
      );
    }

    // Determine if this is the first delegation/transaction before sending
    const isFirstTransaction =
      !(await this.eip7702DelegationRepository.hasDelegation(userId, chainId));

    const { txHash } = await this.sendCrypto(
      userId,
      chain,
      recipientAddress,
      amount,
      tokenAddress,
      tokenDecimals,
      { forceEip7702: true },
    );

    // Generate explorer URL for the transaction
    const explorerUrl = getExplorerUrl(txHash, chainId);

    return {
      success: true,
      userOpHash: txHash,
      transactionHash: txHash,
      isFirstTransaction,
      explorerUrl,
    };
  }
}
