/**
 * CREATE APP SESSION USE CASE
 *
 * Application Layer - Business Operation
 *
 * Creates a new Yellow Network app session (Lightning Node).
 *
 * Business Flow:
 * 1. Get user's wallet address (creator)
 * 2. Build session definition (participants, weights, quorum)
 * 3. Build initial allocations
 * 4. Create domain entity (validates business rules)
 * 5. Register with Yellow Network
 * 6. Return result (NO database storage - Yellow Network is source of truth)
 *
 * Simplified from current implementation:
 * - Removed database persistence (overcomplicated in comparison guide)
 * - Removed participant status tracking (doesn't exist in Yellow Network)
 * - Removed EOA/ERC-4337 complexity (Yellow Network doesn't care)
 * - No URI generation (just use app_session_id directly)
 */

import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import type { IYellowNetworkPort } from '../../ports/yellow-network.port.js';
import { YELLOW_NETWORK_PORT } from '../../ports/yellow-network.port.js';
import type { IWalletProviderPort } from '../../ports/wallet-provider.port.js';
import { WALLET_PROVIDER_PORT } from '../../ports/wallet-provider.port.js';
import type { IChannelManagerPort } from '../../../channel/ports/channel-manager.port.js';
import { CHANNEL_MANAGER_PORT } from '../../../channel/ports/channel-manager.port.js';
import { AppSession } from '../../../../domain/app-session/entities/app-session.entity.js';
import { SessionDefinition } from '../../../../domain/app-session/value-objects/session-definition.vo.js';
import { Allocation } from '../../../../domain/app-session/value-objects/allocation.vo.js';
import {
  CreateAppSessionDto,
  CreateAppSessionResultDto,
} from './create-app-session.dto.js';

@Injectable()
export class CreateAppSessionUseCase {
  constructor(
    @Inject(YELLOW_NETWORK_PORT)
    private readonly yellowNetwork: IYellowNetworkPort,
    @Inject(WALLET_PROVIDER_PORT)
    private readonly walletProvider: IWalletProviderPort,
    @Inject(CHANNEL_MANAGER_PORT)
    private readonly channelManager: IChannelManagerPort,
  ) {}

  async execute(dto: CreateAppSessionDto): Promise<CreateAppSessionResultDto> {
    // 1. Get creator's wallet address
    const creatorAddress = await this.walletProvider.getWalletAddress(
      dto.userId,
      dto.chain,
    );

    // 2. Authenticate with Yellow Network
    await this.yellowNetwork.authenticate(dto.userId, creatorAddress);

    // 3. Build participant list (creator + requested participants)
    const participants = this.buildParticipantList(
      creatorAddress,
      dto.participants,
    );

    // 4. Build weights — Judge model: creator gets 100, others get 0
    // This allows the backend (creator) to sign all operations alone.
    const weights =
      dto.weights || participants.map((_, i) => (i === 0 ? 100 : 0));

    // 5. Build quorum — Judge model: 100 (only creator meets it)
    const quorum = dto.quorum ?? 100;

    // 6. Create session definition (validates business rules)
    const definition = SessionDefinition.create({
      protocol: 'NitroRPC/0.4',
      participants,
      weights,
      quorum,
      challenge: 3600, // 1 hour challenge period
      nonce: Date.now(),
    });

    // 7. Build initial allocations
    const allocations = (dto.initialAllocations || []).map((alloc) =>
      Allocation.create(
        alloc.participant,
        dto.token.toLowerCase(),
        alloc.amount,
      ),
    );
    const allocatedParticipants = new Set(
      allocations.map((a) => a.participant.toLowerCase()),
    );
    for (const address of definition.participants) {
      if (allocatedParticipants.has(address.toLowerCase())) continue;
      allocations.push(
        Allocation.create(address, dto.token.toLowerCase(), '0'),
      );
    }

    // 8. Create domain entity (validates all business rules)
    const session = AppSession.create(definition, allocations);

    // 9. Proactively close stale/open channels before app session creation.
    // ClearNode rejects create_app_session while any owned channel has non-zero allocation.
    const chainId = this.getChainId(dto.chain);
    await this.closeAllOpenChannels(creatorAddress, chainId);

    // 9. Register with Yellow Network
    // Channels are closed after deposit so this should succeed on first try.
    // Retry once as a safety net in case ClearNode hasn't indexed the close yet.
    const MAX_ATTEMPTS = 3;
    const RETRY_DELAY_MS = 8000;
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const yellowResponse = await this.yellowNetwork.createSession({
          sessionId: session.id.value,
          definition: definition.toYellowFormat(),
          allocations: allocations.map((a) => a.toYellowFormat()),
        });

        const definitionParticipants = definition.participants;
        const normalizedAllocationParticipants = new Set(
          (yellowResponse.allocations || []).map((alloc) =>
            alloc.participant.toLowerCase(),
          ),
        );

        return {
          appSessionId: yellowResponse.app_session_id,
          status: yellowResponse.status,
          version: yellowResponse.version,
          participants: definitionParticipants.map((address: string) => ({
            address,
            joined:
              normalizedAllocationParticipants.size === 0
                ? true
                : normalizedAllocationParticipants.has(address.toLowerCase()),
          })),
          allocations: yellowResponse.allocations,
        };
      } catch (error) {
        lastError = error;
        const errorMsg = error instanceof Error ? error.message : String(error);
        const isChannelLag =
          errorMsg.includes('non-zero allocation') &&
          errorMsg.includes('channel');

        if (isChannelLag && attempt < MAX_ATTEMPTS) {
          console.log(
            `[CreateAppSession] Channel allocation not yet cleared (attempt ${attempt}/${MAX_ATTEMPTS}), retrying in ${RETRY_DELAY_MS}ms...`,
          );
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }

        if (isChannelLag) {
          throw new BadRequestException(
            'Cannot create app session: an active payment channel still has locked funds. ' +
              'Please wait a moment and try again.',
          );
        }

        throw error;
      }
    }

    throw lastError;
  }

  /**
   * Build participant list with deduplication
   * Creator is always first
   */
  private buildParticipantList(
    creatorAddress: string,
    requestedParticipants: string[],
  ): string[] {
    const seen = new Set<string>();
    const participants: string[] = [];

    const addUnique = (addr: string) => {
      const normalized = addr.toLowerCase();
      if (seen.has(normalized)) return;
      seen.add(normalized);
      participants.push(addr);
    };

    // Creator first
    addUnique(creatorAddress);

    // Then requested participants
    requestedParticipants.forEach(addUnique);

    // Yellow Network supports 1+ participants (simplified from current 2+ requirement)
    if (participants.length < 1) {
      throw new BadRequestException(
        'App session must have at least one participant',
      );
    }

    return participants;
  }

  private getChainId(chain: string): number {
    const chainIdMap: Record<string, number> = {
      ethereum: 1,
      base: 8453,
      arbitrum: 42161,
      avalanche: 43114,
    };
    const chainId = chainIdMap[chain.toLowerCase()];
    if (!chainId) throw new BadRequestException(`Unsupported chain: ${chain}`);
    return chainId;
  }

  private async closeAllOpenChannels(
    userAddress: string,
    chainId: number,
  ): Promise<void> {
    const openChannels = await this.channelManager.getChannels(userAddress);
    if (openChannels.length === 0) return;

    console.log(
      `[CreateAppSession] Found ${openChannels.length} open channel(s). Closing before create_app_session...`,
    );

    for (const channel of openChannels) {
      try {
        await this.channelManager.closeChannel(
          channel.channelId,
          chainId,
          userAddress,
        );
        console.log(
          `[CreateAppSession] Closed stale channel ${channel.channelId}`,
        );
      } catch (error) {
        console.warn(
          `[CreateAppSession] Failed to close stale channel ${channel.channelId}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    // Allow ClearNode indexers to observe close transactions before create_app_session.
    await new Promise((r) => setTimeout(r, 5000));
  }
}
