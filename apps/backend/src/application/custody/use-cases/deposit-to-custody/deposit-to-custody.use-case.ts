/**
 * DEPOSIT TO CUSTODY USE CASE
 *
 * Application Layer - Business Operation
 *
 * Deposits funds from wallet to Yellow Network custody contract.
 * This is the CRITICAL STEP that credits unified balance.
 *
 * Business Flow:
 * 1. Get user's wallet and private key
 * 2. Approve USDC for custody contract (on-chain)
 * 3. Deposit to custody contract (on-chain)
 * 4. Wait for Yellow Network to index deposit (30s max)
 * 5. Verify unified balance is credited
 * 6. Return success
 *
 * This solves the problem: "Custody balance shows funds but unified balance is 0"
 */

import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import type { IWalletProviderPort } from '../../../app-session/ports/wallet-provider.port.js';
import { WALLET_PROVIDER_PORT } from '../../../app-session/ports/wallet-provider.port.js';
import type { IYellowNetworkPort } from '../../../app-session/ports/yellow-network.port.js';
import { YELLOW_NETWORK_PORT } from '../../../app-session/ports/yellow-network.port.js';
import type { ICustodyContractPort } from '../../ports/custody-contract.port.js';
import { CUSTODY_CONTRACT_PORT } from '../../ports/custody-contract.port.js';
import {
  DepositToCustodyDto,
  DepositToCustodyResultDto,
} from './deposit-to-custody.dto.js';

@Injectable()
export class DepositToCustodyUseCase {
  constructor(
    @Inject(WALLET_PROVIDER_PORT)
    private readonly walletProvider: IWalletProviderPort,
    @Inject(YELLOW_NETWORK_PORT)
    private readonly yellowNetwork: IYellowNetworkPort,
    @Inject(CUSTODY_CONTRACT_PORT)
    private readonly custodyContract: ICustodyContractPort,
  ) {}

  async execute(dto: DepositToCustodyDto): Promise<DepositToCustodyResultDto> {
    console.log(`\n=== DEPOSIT TO CUSTODY ===`);
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

    // IMPORTANT: Unified balance is Yellow Network's OFF-CHAIN ledger.
    // To query it, we must be authenticated with Yellow Network first.
    // Fund-channel path already authenticates; custody deposits might not.
    try {
      await this.yellowNetwork.authenticate(dto.userId, userAddress);
    } catch (err) {
      console.warn(
        '[DepositToCustodyUseCase] Yellow Network authenticate failed (continuing; balance polling may fail until auth succeeds):',
        err,
      );
    }

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

    // 4+5. Approve + Deposit in one atomic call (avoids nonce race across RPC nodes)
    console.log(`\n--- Step 1+2: Approve & Deposit ---`);
    const { approveTxHash, depositTxHash } =
      await this.custodyContract.approveAndDeposit({
        userPrivateKey,
        userAddress,
        chainId,
        tokenAddress,
        amount: amountInSmallestUnits,
      });

    // 6. Step 3: Register the `bu` listener BEFORE triggering resize so we
    // cannot miss the notification that arrives during the RPC round-trip.
    // Yellow Network sends `bu` automatically when the unified balance changes.
    // We store the Promise here; await it AFTER the resize completes (step 7).
    const targetSymbol = dto.asset.toLowerCase();
    const targetToken = tokenAddress.toLowerCase();
    const buPromise = this.yellowNetwork
      .waitForBalanceUpdate(30_000)
      .catch(() => null);

    console.log(
      `\n--- Step 3: Crediting Unified Balance via resize_channel ---`,
    );
    let creditedChannelId: string | undefined;
    let creditStepError: string | null = null;
    try {
      const credit = await this.custodyContract.creditUnifiedBalanceFromCustody(
        {
          userId: dto.userId,
          chain: dto.chain,
          userAddress,
          tokenAddress,
          amount: amountInSmallestUnits,
        },
      );
      creditedChannelId = credit.channelId;
      console.log(
        `[DepositToCustodyUseCase] resize_channel sent via channel ${credit.channelId}`,
      );
    } catch (err: any) {
      creditStepError = err?.message ?? String(err);
      console.warn(
        `[DepositToCustodyUseCase] Could not trigger unified ledger credit step: ${creditStepError}`,
      );
    }

    // 7. Step 4: Await the `bu` notification (registered above).
    // If it times out, fall back to a single get_ledger_balances query.
    let unifiedBalance = '0';
    try {
      const balanceUpdates = await buPromise;
      const entry = balanceUpdates?.find((b) => {
        const a = (b.asset || '').toLowerCase();
        return a === targetSymbol || a === targetToken;
      });
      // ClearNode sends two bu notifications during a deposit+resize flow:
      // 1. After custody.create() — reports 0 (channel just opened, nothing locked yet)
      // 2. After custody.resize() is indexed (~7s later) — reports the actual balance
      // If the first bu shows 0, treat it as "not yet ready" and fall through to the
      // get_ledger_balances query, which will correctly show the post-resize balance.
      if (entry && parseFloat(entry.amount) > 0) {
        unifiedBalance = entry.amount;
        console.log(
          `[DepositToCustodyUseCase] bu notification received — unified balance: ${unifiedBalance}`,
        );
      } else {
        throw new Error(
          entry
            ? 'bu showed 0 (channel-create event, not resize)'
            : 'asset not in bu payload',
        );
      }
    } catch (err: any) {
      // bu was either 0 (channel-create event fired before resize indexed) or timed out.
      // Wait 8s for the resize to be indexed by ClearNode, then do a single direct query.
      // This matches the observed ~7s delay between resize TX confirm and the real bu.
      console.warn(
        `[DepositToCustodyUseCase] bu not usable (${err?.message}); waiting 8s for resize indexing then querying`,
      );
      try {
        await new Promise((r) => setTimeout(r, 8_000));
        const balances =
          await this.yellowNetwork.getUnifiedBalance(userAddress);
        const entry = balances.find((b) => {
          const a = (b.asset || '').toLowerCase();
          return a === targetSymbol || a === targetToken;
        });
        unifiedBalance = entry?.amount ?? '0';
        console.log(
          `[DepositToCustodyUseCase] Post-resize balance query: unified=${unifiedBalance}`,
        );
      } catch (queryErr: any) {
        console.warn(
          `[DepositToCustodyUseCase] Fallback balance query failed: ${queryErr?.message}`,
        );
      }
    }

    console.log(`\n✅ DEPOSIT COMPLETE`);
    console.log(`Approve TX: ${approveTxHash}`);
    console.log(`Deposit TX: ${depositTxHash}`);
    console.log(`Unified Balance: ${unifiedBalance}`);

    if (parseFloat(unifiedBalance) <= 0) {
      const reason =
        creditStepError ??
        'Unified balance is still zero after deposit and indexing wait.';
      throw new BadRequestException(
        `Deposit confirmed on-chain, but unified balance was not credited yet. Reason: ${reason}`,
      );
    }

    return {
      success: true,
      approveTxHash,
      depositTxHash,
      channelId: creditedChannelId,
      chainId,
      amount: amountInSmallestUnits.toString(),
      asset: dto.asset,
      unifiedBalance,
      message:
        `Successfully deposited ${dto.amount} ${dto.asset} to custody. ` +
        `Unified balance is off-chain and may take a moment to reflect indexing.`,
    };
  }
}
