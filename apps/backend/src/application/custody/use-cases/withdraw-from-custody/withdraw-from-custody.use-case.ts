/**
 * WITHDRAW FROM CUSTODY USE CASE
 *
 * Application Layer - Business Operation
 *
 * Withdraws funds from Yellow Network unified balance back to user's wallet
 * in a single operation:
 *   1. Reverse resize: unified → channel → custody free
 *   2. custody.withdraw(): custody free → user's wallet (on-chain)
 *
 * Business Flow:
 * 1. Get user's wallet address and private key
 * 2. Convert amount to smallest units (6 decimals)
 * 3. Resolve chain ID and token address
 * 4. Reverse resize to move funds from unified to custody free
 * 5. Withdraw from custody contract to wallet (on-chain)
 * 6. Fetch updated unified balance
 * 7. Return result
 *
 * Prerequisites:
 * - Sufficient unified balance available
 * - An open channel exists (created during deposit)
 */

import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import type { IWalletProviderPort } from '../../../app-session/ports/wallet-provider.port.js';
import { WALLET_PROVIDER_PORT } from '../../../app-session/ports/wallet-provider.port.js';
import type { IYellowNetworkPort } from '../../../app-session/ports/yellow-network.port.js';
import { YELLOW_NETWORK_PORT } from '../../../app-session/ports/yellow-network.port.js';
import type { ICustodyContractPort } from '../../ports/custody-contract.port.js';
import { CUSTODY_CONTRACT_PORT } from '../../ports/custody-contract.port.js';
import {
  WithdrawFromCustodyDto,
  WithdrawFromCustodyResultDto,
} from './withdraw-from-custody.dto.js';

@Injectable()
export class WithdrawFromCustodyUseCase {
  constructor(
    @Inject(WALLET_PROVIDER_PORT)
    private readonly walletProvider: IWalletProviderPort,
    @Inject(YELLOW_NETWORK_PORT)
    private readonly yellowNetwork: IYellowNetworkPort,
    @Inject(CUSTODY_CONTRACT_PORT)
    private readonly custodyContract: ICustodyContractPort,
  ) {}

  async execute(
    dto: WithdrawFromCustodyDto,
  ): Promise<WithdrawFromCustodyResultDto> {
    console.log(`\n=== WITHDRAW FROM UNIFIED BALANCE ===`);
    console.log(`User: ${dto.userId}`);
    console.log(`Chain: ${dto.chain}`);
    console.log(`Asset: ${dto.asset}`);
    console.log(`Amount: ${dto.amount}`);

    // 1. Get user's wallet address and private key
    const userAddress = await this.walletProvider.getWalletAddress(
      dto.userId,
      dto.chain,
    );
    const userPrivateKey = await this.walletProvider.getPrivateKey(
      dto.userId,
      dto.chain,
    );

    console.log(`User address: ${userAddress}`);

    // 2. Convert amount to smallest units (USDC/USDT = 6 decimals)
    const decimals = 6;
    const amountInSmallestUnits = BigInt(
      Math.floor(parseFloat(dto.amount) * Math.pow(10, decimals)),
    );

    console.log(`Amount in smallest units: ${amountInSmallestUnits}`);

    // 3. Get chain ID and token address
    const chainIdMap: Record<string, number> = {
      ethereum: 1,
      base: 8453,
      arbitrum: 42161,
      avalanche: 43114,
    };
    const chainId = chainIdMap[dto.chain.toLowerCase()];
    if (!chainId) {
      throw new BadRequestException(`Unsupported chain: ${dto.chain}`);
    }

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

    const tokenAddress =
      tokenAddressMap[dto.chain.toLowerCase()]?.[dto.asset.toLowerCase()];
    if (!tokenAddress) {
      throw new BadRequestException(
        `Token ${dto.asset} not supported on chain ${dto.chain}`,
      );
    }

    console.log(`Chain ID: ${chainId}`);
    console.log(`Token address: ${tokenAddress}`);

    // 4. Check custody free balance — only reverse resize if needed
    console.log(`\n--- Step 1: Check Custody Free Balance ---`);
    const availableHuman = await this.custodyContract.getAvailableBalance(
      userAddress,
      tokenAddress,
      chainId,
    );
    const available = BigInt(
      Math.floor(parseFloat(availableHuman) * Math.pow(10, decimals)),
    );
    console.log(
      `[WithdrawUseCase] Custody free: ${available}, need: ${amountInSmallestUnits}`,
    );

    if (available < amountInSmallestUnits) {
      const deficit = amountInSmallestUnits - available;
      console.log(
        `\n--- Step 2: Reverse Resize for deficit ${deficit} (unified → custody free) ---`,
      );
      try {
        const { channelId } =
          await this.custodyContract.debitUnifiedBalanceToCustody({
            userId: dto.userId,
            chain: dto.chain,
            userAddress,
            tokenAddress,
            amount: deficit,
          });
        console.log(
          `[WithdrawUseCase] Reverse resize complete via channel ${channelId}`,
        );
      } catch (err: any) {
        throw new BadRequestException(
          `Insufficient funds. Custody free: ${available}, unified could not cover deficit: ${err?.message ?? err}`,
        );
      }
    } else {
      console.log(
        `[WithdrawUseCase] Custody free sufficient, skipping reverse resize`,
      );
    }

    // 5. Withdraw from custody contract to wallet (ON-CHAIN)
    console.log(`\n--- Step 3: Custody Withdraw (custody free → wallet) ---`);
    const withdrawTxHash = await this.custodyContract.withdraw({
      userPrivateKey,
      userAddress,
      chainId,
      tokenAddress,
      amount: amountInSmallestUnits,
    });

    // 6. Fetch updated unified balance
    let unifiedBalance = '0';
    try {
      await this.yellowNetwork.authenticate(dto.userId, userAddress);
      const balances = await this.yellowNetwork.getUnifiedBalance(userAddress);
      const targetSymbol = dto.asset.toLowerCase();
      const targetToken = tokenAddress.toLowerCase();

      const entry = balances.find((b) => {
        const asset = (b.asset || '').toLowerCase();
        return asset === targetSymbol || asset === targetToken;
      });

      if (entry?.amount) {
        unifiedBalance = entry.amount;
      }
    } catch (err) {
      console.warn(
        '[WithdrawUseCase] Failed to fetch unified balance after withdraw:',
        err,
      );
    }

    console.log(`\n✅ WITHDRAW COMPLETE`);
    console.log(`Withdraw TX: ${withdrawTxHash}`);
    console.log(`Unified Balance: ${unifiedBalance}`);

    return {
      success: true,
      withdrawTxHash,
      chainId,
      amount: amountInSmallestUnits.toString(),
      asset: dto.asset,
      unifiedBalance,
      message: `Successfully withdrew ${dto.amount} ${dto.asset} from unified balance to wallet ${userAddress}.`,
    };
  }
}
