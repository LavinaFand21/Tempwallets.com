import { Injectable } from '@nestjs/common';
import { ZerionAnyChainService } from './zerion-any-chain.service.js';
import { ZerionStreamService } from './zerion-stream.service.js';
import { ZerionPortfolioService } from './zerion-portfolio.service.js';
import { ZerionTokenLookupService } from './zerion-token-lookup.service.js';

@Injectable()
export class ZerionBalanceService {
  constructor(
    private readonly zerionAnyChainService: ZerionAnyChainService,
    private readonly zerionStreamService: ZerionStreamService,
    private readonly zerionPortfolioService: ZerionPortfolioService,
    private readonly zerionTokenLookupService: ZerionTokenLookupService,
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
    return this.zerionAnyChainService.getTokenBalancesAny(userId, forceRefresh);
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
    for await (const balance of this.zerionStreamService.streamBalances(
      userId,
    )) {
      yield balance;
    }
  }

  async getBalances(
    userId: string,
    forceRefresh: boolean = false,
  ): Promise<Array<{ chain: string; balance: string }>> {
    return this.zerionPortfolioService.getBalances(userId, forceRefresh);
  }

  async refreshBalances(
    userId: string,
  ): Promise<Array<{ chain: string; balance: string }>> {
    return this.zerionPortfolioService.refreshBalances(userId);
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
    return this.zerionPortfolioService.getTokenBalances(
      userId,
      chain,
      forceRefresh,
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
    return this.zerionTokenLookupService.getZerionTokenInfo(
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
    return this.zerionTokenLookupService.validateBalanceFromZerion(
      tokenAddress,
      amountSmallest,
      chain,
      walletAddress,
    );
  }
}
