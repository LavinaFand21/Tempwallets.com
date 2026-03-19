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
import { AppSession } from '../../../../domain/app-session/entities/app-session.entity.js';
import { SessionDefinition } from '../../../../domain/app-session/value-objects/session-definition.vo.js';
import { Allocation } from '../../../../domain/app-session/value-objects/allocation.vo.js';
import { PrismaService } from '../../../../database/prisma.service.js';
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
    private readonly prisma: PrismaService,
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

    // 8. Create domain entity (validates all business rules)
    const session = AppSession.create(definition, allocations);

    // 9. Register with Yellow Network
    // Handle the common error where funds are locked in payment channels
    let yellowResponse: Awaited<
      ReturnType<IYellowNetworkPort['createSession']>
    >;
    try {
      yellowResponse = await this.yellowNetwork.createSession({
        sessionId: session.id.value, // Placeholder, Yellow will assign real ID
        definition: definition.toYellowFormat(),
        allocations: allocations.map((a) => a.toYellowFormat()),
      });
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (/locked/i.test(message)) {
        throw new BadRequestException(
          'Funds are locked in payment channels. Close channels or wait for funds to unlock.',
        );
      }
      throw error;
    }

    // 10. Persist deterministic participant join state
    const appSessionId = yellowResponse.app_session_id;
    const existing = await this.prisma.lightningNode.findUnique({
      where: { appSessionId },
      include: { participants: true },
    });

    if (!existing) {
      const creatorLower = creatorAddress.toLowerCase();
      const allocMap = new Map(
        allocations.map((a) => [a.participant.toLowerCase(), a.amount]),
      );
      await this.prisma.lightningNode.create({
        data: {
          userId: dto.userId,
          appSessionId,
          uri: `lightning://${appSessionId}`,
          chain: dto.chain,
          token: dto.token.toLowerCase(),
          status: yellowResponse.status,
          maxParticipants: participants.length,
          quorum,
          protocol: definition.protocol,
          challenge: definition.challenge,
          sessionData: dto.sessionData,
          participants: {
            create: participants.map((address, idx) => {
              const isCreator = address.toLowerCase() === creatorLower;
              return {
                address,
                weight: weights[idx] ?? 0,
                balance: allocMap.get(address.toLowerCase()) ?? '0',
                asset: dto.token.toLowerCase(),
                status: isCreator ? 'joined' : 'invited',
                joinedAt: isCreator ? new Date() : undefined,
                lastSeenAt: isCreator ? new Date() : undefined,
              };
            }),
          },
        },
      });
    } else {
      // Ensure creator is marked joined (idempotent)
      await this.prisma.lightningNodeParticipant.updateMany({
        where: {
          lightningNodeId: existing.id,
          address: creatorAddress,
        },
        data: {
          status: 'joined',
          joinedAt: new Date(),
          lastSeenAt: new Date(),
        } as any,
      });
    }

    // 11. Return result
    return {
      appSessionId,
      status: yellowResponse.status,
      version: yellowResponse.version,
      participants: yellowResponse.definition.participants.map((address) => ({
        address,
        joined: address.toLowerCase() === creatorAddress.toLowerCase(),
      })),
      allocations: yellowResponse.allocations,
    };
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
}
