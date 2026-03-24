/**
 * CLOSE CHANNEL USE CASE
 *
 * Application Layer - Business Operation
 *
 * Closes a 2-party payment channel.
 * Moves funds from the channel back to unified balance.
 *
 * Business Flow:
 * 1. Get user's wallet address
 * 2. Authenticate with Yellow Network
 * 3. Resolve chain ID
 * 4. Close channel via channel manager
 * 5. Return result
 *
 * Prerequisites: Channel must exist and be open
 */

import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import type { IWalletProviderPort } from '../../../app-session/ports/wallet-provider.port.js';
import { WALLET_PROVIDER_PORT } from '../../../app-session/ports/wallet-provider.port.js';
import type { IYellowNetworkPort } from '../../../app-session/ports/yellow-network.port.js';
import { YELLOW_NETWORK_PORT } from '../../../app-session/ports/yellow-network.port.js';
import type { IChannelManagerPort } from '../../ports/channel-manager.port.js';
import { CHANNEL_MANAGER_PORT } from '../../ports/channel-manager.port.js';
import { CloseChannelDto, CloseChannelResultDto } from './close-channel.dto.js';

@Injectable()
export class CloseChannelUseCase {
  constructor(
    @Inject(WALLET_PROVIDER_PORT)
    private readonly walletProvider: IWalletProviderPort,
    @Inject(YELLOW_NETWORK_PORT)
    private readonly yellowNetwork: IYellowNetworkPort,
    @Inject(CHANNEL_MANAGER_PORT)
    private readonly channelManager: IChannelManagerPort,
  ) {}

  async execute(dto: CloseChannelDto): Promise<CloseChannelResultDto> {
    console.log(`\n=== CLOSE CHANNEL ===`);
    console.log(`User: ${dto.userId}`);
    console.log(`Chain: ${dto.chain}`);
    console.log(`Channel: ${dto.channelId}`);

    // 1. Get user's wallet address
    const userAddress = await this.walletProvider.getWalletAddress(
      dto.userId,
      dto.chain,
    );

    // 2. Authenticate with Yellow Network
    await this.yellowNetwork.authenticate(dto.userId, userAddress);

    // 3. Get chain ID
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

    // 4. Close the channel — treat "already closed" / "not found" as success.
    //
    // getChannels() filters out closed channels, so a pre-flight status check
    // can never detect a closed channel. Instead we attempt the close and catch
    // the specific ClearNode errors that mean "nothing left to close".
    console.log(
      `[CloseChannel] Closing channel ${dto.channelId} on chain ${chainId}...`,
    );
    try {
      await this.channelManager.closeChannel(
        dto.channelId,
        chainId,
        userAddress,
      );
      console.log(
        `[CloseChannel] Channel ${dto.channelId} closed successfully`,
      );
    } catch (err: any) {
      const msg = (err?.message ?? '').toLowerCase();
      // ClearNode returns these when the channel is already closed or gone
      const alreadyDone =
        msg.includes('not found') ||
        msg.includes('channel not open') ||
        msg.includes('channel not active') ||
        msg.includes('already closed') ||
        msg.includes('invalid status');
      if (alreadyDone) {
        console.log(
          `[CloseChannel] Channel ${dto.channelId} already closed or not found — treating as success.`,
        );
      } else {
        throw err; // re-throw real errors
      }
    }

    // 6. Return result
    return {
      success: true,
      channelId: dto.channelId,
      chainId,
      message: `Successfully closed channel ${dto.channelId}. Call POST /custody/withdraw to move custody funds to your wallet.`,
    };
  }
}
