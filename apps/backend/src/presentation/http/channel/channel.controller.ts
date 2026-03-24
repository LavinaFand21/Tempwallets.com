/**
 * CHANNEL CONTROLLER
 *
 * Presentation Layer - HTTP Adapter
 *
 * Manages 2-party payment channels (user ↔ clearnode).
 * Channels move funds from unified balance into payment channels.
 *
 * Flow: Unified Balance → Payment Channel
 *
 * Prerequisites: User must have funds in unified balance (deposit to custody first)
 *
 * Endpoints:
 * POST /channel/fund - Create or fund a payment channel
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
  Inject,
} from '@nestjs/common';

import { FundChannelUseCase } from '../../../application/channel/use-cases/fund-channel/fund-channel.use-case.js';
import { CloseChannelUseCase } from '../../../application/channel/use-cases/close-channel/close-channel.use-case.js';
import { FundChannelRequestDto } from './dto/fund-channel-request.dto.js';
import { CloseChannelRequestDto } from './dto/close-channel-request.dto.js';
import type { IChannelManagerPort } from '../../../application/channel/ports/channel-manager.port.js';
import { CHANNEL_MANAGER_PORT } from '../../../application/channel/ports/channel-manager.port.js';
import type { IWalletProviderPort } from '../../../application/app-session/ports/wallet-provider.port.js';
import { WALLET_PROVIDER_PORT } from '../../../application/app-session/ports/wallet-provider.port.js';

@Controller('channel')
export class ChannelController {
  constructor(
    private readonly fundChannelUseCase: FundChannelUseCase,
    private readonly closeChannelUseCase: CloseChannelUseCase,
    @Inject(CHANNEL_MANAGER_PORT)
    private readonly channelManager: IChannelManagerPort,
    @Inject(WALLET_PROVIDER_PORT)
    private readonly walletProvider: IWalletProviderPort,
  ) {}

  /**
   * GET /channel
   *
   * List open payment channels for a user on a given chain.
   * Returns the channelId(s) needed to call POST /channel/close.
   *
   * Query params: userId, chain
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  async getChannels(
    @Query('userId') userId: string,
    @Query('chain') chain: string,
  ) {
    const userAddress = await this.walletProvider.getWalletAddress(
      userId,
      chain,
    );
    const channels = await this.channelManager.getChannels(userAddress);
    return {
      ok: true,
      channels,
    };
  }

  /**
   * POST /channel/fund
   *
   * Create or fund a 2-party payment channel.
   * Moves funds from unified balance into the channel.
   *
   * Prerequisites:
   * 1. User must have deposited to custody (POST /custody/deposit)
   * 2. User must be authenticated with Yellow Network
   */
  @Post('fund')
  @HttpCode(HttpStatus.OK)
  async fundChannel(@Body(ValidationPipe) request: FundChannelRequestDto) {
    const result = await this.fundChannelUseCase.execute({
      userId: request.userId,
      chain: request.chain,
      asset: request.asset,
      amount: request.amount,
    });

    return {
      ok: true,
      ...result,
    };
  }

  /**
   * POST /channel/close
   *
   * Close a 2-party payment channel.
   * Moves funds from the channel back to unified balance.
   *
   * Prerequisites:
   * 1. Channel must exist and be open
   * 2. All app sessions on the channel should be closed first
   */
  @Post('close')
  @HttpCode(HttpStatus.OK)
  async closeChannel(@Body(ValidationPipe) request: CloseChannelRequestDto) {
    const result = await this.closeChannelUseCase.execute({
      userId: request.userId,
      chain: request.chain,
      channelId: request.channelId,
    });

    return {
      ok: true,
      ...result,
    };
  }
}
