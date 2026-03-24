/**
 * CUSTODY CONTROLLER
 *
 * Presentation Layer - HTTP Adapter
 *
 * Manages custody operations (on-chain deposits/withdrawals).
 * Deposits move funds from wallet to custody contract, creating unified balance.
 *
 * Flow: Wallet (on-chain) → Custody Contract → Unified Balance
 *
 * This is the FIRST step in Yellow Network flow:
 *   1. Deposit to custody (this controller) - ON-CHAIN
 *   2. Fund channel (optional) - moves to 2-party channel
 *   3. Create app session - multi-party off-chain
 *
 * Endpoints:
 * POST /custody/deposit - Deposit funds to custody contract
 *
 * NOTE: This is a PLACEHOLDER controller since custody operations
 * require direct smart contract interaction which needs proper
 * Web3 setup. For now, this returns a helpful message.
 */

import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  ValidationPipe,
} from '@nestjs/common';
import { DepositToCustodyUseCase } from '../../../application/custody/use-cases/deposit-to-custody/deposit-to-custody.use-case.js';
import { WithdrawFromCustodyUseCase } from '../../../application/custody/use-cases/withdraw-from-custody/withdraw-from-custody.use-case.js';
import { Inject } from '@nestjs/common';
import type { IYellowNetworkPort } from '../../../application/app-session/ports/yellow-network.port.js';
import { YELLOW_NETWORK_PORT } from '../../../application/app-session/ports/yellow-network.port.js';
import type { IWalletProviderPort } from '../../../application/app-session/ports/wallet-provider.port.js';
import { WALLET_PROVIDER_PORT } from '../../../application/app-session/ports/wallet-provider.port.js';
import type { ICustodyContractPort } from '../../../application/custody/ports/custody-contract.port.js';
import { CUSTODY_CONTRACT_PORT } from '../../../application/custody/ports/custody-contract.port.js';

@Controller('custody')
export class CustodyController {
  constructor(
    private readonly depositToCustodyUseCase: DepositToCustodyUseCase,
    private readonly withdrawFromCustodyUseCase: WithdrawFromCustodyUseCase,
    @Inject(YELLOW_NETWORK_PORT)
    private readonly yellowNetwork: IYellowNetworkPort,
    @Inject(WALLET_PROVIDER_PORT)
    private readonly walletProvider: IWalletProviderPort,
    @Inject(CUSTODY_CONTRACT_PORT)
    private readonly custodyContract: ICustodyContractPort,
  ) {}

  /**
   * POST /custody/deposit
   *
   * Deposit funds from wallet to custody contract.
   * This is an ON-CHAIN operation that creates unified balance.
   *
   * This solves the problem: "Custody balance shows funds but unified balance is 0"
   *
   * Flow:
   * 1. USDC.approve(custodyAddress, amount) - on-chain
   * 2. Custody.deposit(asset, amount, recipient) - on-chain
   * 3. Wait for Yellow Network to index deposit
   * 4. Verify unified balance is credited
   */
  @Post('deposit')
  @HttpCode(HttpStatus.OK)
  async depositToCustody(
    @Body(ValidationPipe)
    request: {
      userId: string;
      chain: string;
      asset: string;
      amount: string;
    },
  ) {
    const result = await this.depositToCustodyUseCase.execute({
      userId: request.userId,
      chain: request.chain,
      asset: request.asset,
      amount: request.amount,
    });

    return {
      ok: true,
      data: result,
    };
  }

  /**
   * POST /custody/withdraw
   *
   * Withdraw funds from custody contract back to user's wallet.
   * This is an ON-CHAIN operation that debits the unified balance.
   *
   * Prerequisites:
   * 1. Channel must be closed (funds returned to unified balance)
   * 2. Sufficient unified balance available
   */
  @Post('withdraw')
  @HttpCode(HttpStatus.OK)
  async withdrawFromCustody(
    @Body(ValidationPipe)
    request: {
      userId: string;
      chain: string;
      asset: string;
      amount: string;
    },
  ) {
    const result = await this.withdrawFromCustodyUseCase.execute({
      userId: request.userId,
      chain: request.chain,
      asset: request.asset,
      amount: request.amount,
    });

    return {
      ok: true,
      data: result,
    };
  }

  /**
   * GET /custody/available-balance
   *
   * Returns the on-chain available (unlocked) balance in the custody contract.
   * This is funds deposited to custody that are NOT locked in any payment channel.
   * Reads directly from the custody contract — no Yellow Network auth needed.
   *
   * Balance tiers:
   *   Wallet → [deposit] → Available Balance → [fund channel] → Unified Balance → [app session] → Session Balance
   *   Available Balance ← [withdraw] ← Unified Balance ← [close channel] ← (after close_app_session)
   */
  @Get('available-balance')
  @HttpCode(HttpStatus.OK)
  async getAvailableBalance(
    @Query('userId') userId: string,
    @Query('chain') chain: string,
    @Query('asset') asset: string,
  ) {
    const chainIdMap: Record<string, number> = {
      ethereum: 1,
      base: 8453,
      arbitrum: 42161,
      avalanche: 43114,
    };
    const tokenAddressMap: Record<string, Record<string, string>> = {
      base: {
        usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        usdt: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
      },
      arbitrum: {
        usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        usdt: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
      },
      ethereum: {
        usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        usdt: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      },
      avalanche: {
        usdc: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
        usdt: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
      },
    };

    const chainId = chainIdMap[chain.toLowerCase()];
    const tokenAddress =
      tokenAddressMap[chain.toLowerCase()]?.[asset.toLowerCase()];

    if (!chainId || !tokenAddress) {
      return { ok: false, error: `Unsupported chain/asset: ${chain}/${asset}` };
    }

    const walletAddress = await this.walletProvider.getWalletAddress(
      userId,
      chain,
    );
    const balance = await this.custodyContract.getAvailableBalance(
      walletAddress,
      tokenAddress,
      chainId,
    );

    return {
      ok: true,
      data: {
        accountId: walletAddress,
        chain,
        asset: asset.toLowerCase(),
        availableBalance: balance,
        description:
          'On-chain custody contract balance (not locked in any channel)',
      },
    };
  }

  /**
   * GET /custody/balance
   *
   * Returns off-chain unified balance (Yellow Network ledger balances).
   * Requires prior authentication via POST /app-session/authenticate.
   */
  @Get('balance')
  @HttpCode(HttpStatus.OK)
  async getUnifiedBalance(
    @Query('userId') userId: string,
    @Query('chain') chain: string,
  ) {
    // Ensure the adapter is authenticated for the user's wallet.
    // This avoids the common case where deposit succeeded on-chain
    // but unified balance reads return 0 because we never authenticated.
    const walletAddress = await this.walletProvider.getWalletAddress(
      userId,
      chain,
    );
    await this.yellowNetwork.authenticate(userId, walletAddress);

    const balances = await this.yellowNetwork.getUnifiedBalance(walletAddress);

    return {
      ok: true,
      data: {
        accountId: walletAddress,
        balances,
      },
    };
  }
}
