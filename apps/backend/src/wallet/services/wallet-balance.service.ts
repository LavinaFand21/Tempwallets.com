import { Injectable, Logger } from '@nestjs/common';
import { ZerionBalanceService } from './zerion-balance.service.js';
import { BalanceValidationService } from './balance-validation.service.js';
import { TokenMetadataService } from './token-metadata.service.js';

@Injectable()
export class WalletBalanceService {
  private readonly logger = new Logger(WalletBalanceService.name);

  constructor(
    private readonly zerionBalanceService: ZerionBalanceService,
    private readonly balanceValidationService: BalanceValidationService,
    private readonly tokenMetadataService: TokenMetadataService,
  ) {}

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
    return this.zerionBalanceService.getTokenBalancesAny(userId, forceRefresh);
  }

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
    for await (const balance of this.zerionBalanceService.streamBalances(
      userId,
    )) {
      yield balance;
    }
  }

  async getBalances(
    userId: string,
    forceRefresh: boolean = false,
  ): Promise<Array<{ chain: string; balance: string }>> {
    return this.zerionBalanceService.getBalances(userId, forceRefresh);
  }

  async refreshBalances(
    userId: string,
  ): Promise<Array<{ chain: string; balance: string }>> {
    return this.zerionBalanceService.refreshBalances(userId);
  }

  async getErc4337PaymasterBalances(
    userId: string,
  ): Promise<Array<{ chain: string; balance: string }>> {
    this.logger.warn(
      'EIP-7702 migration: paymaster balances for legacy ERC-4337 are disabled.',
    );
    return [];
  }

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
    return this.zerionBalanceService.getTokenBalances(
      userId,
      chain,
      forceRefresh,
    );
  }

  getNativeTokenDecimals(chain: string): number {
    return this.tokenMetadataService.getNativeTokenDecimals(chain);
  }

  async fetchDecimalsFromRPC(
    tokenAddress: string,
    account: any,
  ): Promise<number | null> {
    return this.balanceValidationService.fetchDecimalsFromRPC(
      tokenAddress,
      account,
    );
  }

  async validateBalanceOnChain(
    tokenAddress: string | null,
    amountSmallest: bigint,
    account: any,
  ): Promise<{ sufficient: boolean; balance: string }> {
    return this.balanceValidationService.validateBalanceOnChain(
      tokenAddress,
      amountSmallest,
      account,
    );
  }

  async getZerionTokenInfo(
    tokenAddress: string,
    chain: string,
    walletAddress: string,
  ): Promise<{
    decimals: number;
    balanceSmallest: string;
    symbol?: string;
  } | null> {
    return this.zerionBalanceService.getZerionTokenInfo(
      tokenAddress,
      chain,
      walletAddress,
    );
  }

  async validateBalanceFromZerion(
    tokenAddress: string | null,
    amountSmallest: bigint,
    chain: string,
    walletAddress: string,
  ): Promise<{
    sufficient: boolean;
    zerionBalance: string;
    onChainBalance?: string;
    error?: string;
  }> {
    return this.zerionBalanceService.validateBalanceFromZerion(
      tokenAddress,
      amountSmallest,
      chain,
      walletAddress,
    );
  }

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
  //   return this.substrateBalanceService.getSubstrateBalances(
  //     userId,
  //     useTestnet,
  //     forceRefresh,
  //   );
  // }
}
