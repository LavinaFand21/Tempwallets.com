/**
 * QUERY SESSION USE CASE
 *
 * Application Layer - Business Operation
 *
 * Query a specific app session from Yellow Network.
 *
 * Business Flow:
 * 1. Authenticate user's wallet with Yellow Network
 * 2. Query session from Yellow Network
 * 3. Verify user is a participant
 * 4. Return session data
 *
 * Simplified from current implementation:
 * - No database sync (overcomplicated)
 * - Yellow Network is single source of truth
 * - Clean, simple query operation
 */

import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import type { IYellowNetworkPort } from '../../ports/yellow-network.port.js';
import { YELLOW_NETWORK_PORT } from '../../ports/yellow-network.port.js';
import type { IWalletProviderPort } from '../../ports/wallet-provider.port.js';
import { WALLET_PROVIDER_PORT } from '../../ports/wallet-provider.port.js';
import { QuerySessionDto, QuerySessionResultDto } from './query-session.dto.js';
import { PrismaService } from '../../../../database/prisma.service.js';

@Injectable()
export class QuerySessionUseCase {
  constructor(
    @Inject(YELLOW_NETWORK_PORT)
    private readonly yellowNetwork: IYellowNetworkPort,
    @Inject(WALLET_PROVIDER_PORT)
    private readonly walletProvider: IWalletProviderPort,
    private readonly prisma: PrismaService,
  ) {}

  async execute(dto: QuerySessionDto): Promise<QuerySessionResultDto> {
    // 1. Get user's wallet address
    const walletAddress = await this.walletProvider.getWalletAddress(
      dto.userId,
      dto.chain,
    );

    // 2. Authenticate with Yellow Network
    await this.yellowNetwork.authenticate(dto.userId, walletAddress);

    // 3. Query session from Yellow Network
    const session = await this.yellowNetwork.querySession(dto.sessionId);

    // 4. Verify user is a participant
    const isParticipant = session.definition.participants.some(
      (p) => p.toLowerCase() === walletAddress.toLowerCase(),
    );

    if (!isParticipant) {
      throw new BadRequestException(
        `You are not a participant in this session. ` +
          `Your wallet address (${walletAddress}) was not included when the session was created.`,
      );
    }

    // 5. Mark requesting user as joined in local DB (deterministic join state)
    const localNode = await this.prisma.lightningNode.findUnique({
      where: { appSessionId: session.app_session_id },
      include: { participants: true },
    });

    if (localNode) {
      const participantRow = localNode.participants.find(
        (p) => p.address.toLowerCase() === walletAddress.toLowerCase(),
      );
      if (participantRow && participantRow.status !== 'joined') {
        await this.prisma.lightningNodeParticipant.update({
          where: { id: participantRow.id },
          data: {
            status: 'joined',
            joinedAt: new Date(),
            lastSeenAt: new Date(),
          } as any,
        });
      }
    } else {
      const participants = session.definition.participants || [];
      const weights = session.definition.weights || [];
      const allocations = session.allocations || [];
      const token = allocations.find((a) => a.asset)?.asset ?? 'usdc';
      const allocMap = new Map(
        allocations.map((a) => [a.participant.toLowerCase(), a.amount]),
      );
      await this.prisma.lightningNode.create({
        data: {
          userId: dto.userId,
          appSessionId: session.app_session_id,
          uri: `lightning://${session.app_session_id}`,
          chain: dto.chain,
          token,
          status: session.status,
          maxParticipants: participants.length,
          quorum: session.definition.quorum,
          protocol: session.definition.protocol,
          challenge: session.definition.challenge,
          sessionData: session.session_data,
          participants: {
            create: participants.map((address, idx) => {
              const isMe = address.toLowerCase() === walletAddress.toLowerCase();
              return {
                address,
                weight: weights[idx] ?? 0,
                balance: allocMap.get(address.toLowerCase()) ?? '0',
                asset: token,
                status: isMe ? 'joined' : 'invited',
                joinedAt: isMe ? new Date() : undefined,
                lastSeenAt: isMe ? new Date() : undefined,
              };
            }),
          },
        },
      });
    }

    const refreshedNode = await this.prisma.lightningNode.findUnique({
      where: { appSessionId: session.app_session_id },
      include: { participants: true },
    });

    // 6. Return session data — include top-level participants, chain, and token
    //    so the frontend AppSession type is fully populated.
    //    If Yellow returns empty allocations, fall back to local DB balances.
    const dbToken = (refreshedNode?.token ?? localNode?.token ?? '').toLowerCase();
    const sessionAllocs = session.allocations ?? [];
    const dbParticipants = refreshedNode?.participants ?? localNode?.participants ?? [];
    const dbAllocs =
      dbParticipants.length > 0
        ? dbParticipants.map((p) => ({
            participant: p.address,
            asset: (p.asset || dbToken || 'usdc').toLowerCase(),
            amount: p.balance ?? '0',
          }))
        : [];
    const allocations = sessionAllocs.length > 0 ? sessionAllocs : dbAllocs;
    const token =
      allocations.find((a) => a.asset)?.asset || dbToken || 'usdc';

    const participants = session.definition.participants || [];
    const assets = [
      ...new Set(
        (allocations.length > 0 ? allocations : token ? [{ asset: token }] : []).map(
          (a: any) => a.asset?.toLowerCase?.() ?? a.asset,
        ),
      ),
    ];
    const dbAllocMap = new Map(
      dbAllocs.map((a) => [
        `${a.participant.toLowerCase()}|${a.asset.toLowerCase()}`,
        a.amount,
      ]),
    );
    const completeAllocations: typeof allocations = [];
    for (const asset of assets) {
      for (const address of participants) {
        const existing = allocations.find(
          (a) =>
            a.participant.toLowerCase() === address.toLowerCase() &&
            a.asset.toLowerCase() === asset,
        );
        completeAllocations.push({
          participant: address,
          asset,
          amount:
            existing?.amount ??
            dbAllocMap.get(`${address.toLowerCase()}|${asset.toLowerCase()}`) ??
            '0',
        });
      }
    }

    return {
      appSessionId: session.app_session_id,
      status: session.status,
      version: session.version,
      chain: dto.chain,
      token,
      participants: participants.map((address) => ({
        address,
        joined:
          refreshedNode?.participants.some(
            (p) =>
              p.address.toLowerCase() === address.toLowerCase() &&
              p.status === 'joined',
          ) ?? false,
      })),
      definition: session.definition,
      allocations: completeAllocations.length > 0 ? completeAllocations : allocations,
      sessionData: session.session_data,
    };
  }
}
