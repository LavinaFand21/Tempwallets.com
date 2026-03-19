/**
 * CLOSE SESSION USE CASE
 *
 * Application Layer - Business Operation
 *
 * Close an app session and return funds to unified balance.
 *
 * Business Flow:
 * 1. Authenticate user's wallet
 * 2. Query current session state
 * 3. Verify user is a participant
 * 4. Close session on Yellow Network
 * 5. Return result
 *
 * Simplified from current implementation:
 * - No database update (Yellow Network is source of truth)
 * - No complex participant status checks
 * - Clean, simple close operation
 */

import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import type { IYellowNetworkPort } from '../../ports/yellow-network.port.js';
import { YELLOW_NETWORK_PORT } from '../../ports/yellow-network.port.js';
import type { IWalletProviderPort } from '../../ports/wallet-provider.port.js';
import { WALLET_PROVIDER_PORT } from '../../ports/wallet-provider.port.js';
import { CloseSessionDto, CloseSessionResultDto } from './close-session.dto.js';
import { PrismaService } from '../../../../database/prisma.service.js';

@Injectable()
export class CloseSessionUseCase {
  constructor(
    @Inject(YELLOW_NETWORK_PORT)
    private readonly yellowNetwork: IYellowNetworkPort,
    @Inject(WALLET_PROVIDER_PORT)
    private readonly walletProvider: IWalletProviderPort,
    private readonly prisma: PrismaService,
  ) {}

  async execute(dto: CloseSessionDto): Promise<CloseSessionResultDto> {
    // 1. Get user's wallet address
    const walletAddress = await this.walletProvider.getWalletAddress(
      dto.userId,
      dto.chain,
    );

    // 2. Authenticate with Yellow Network
    await this.yellowNetwork.authenticate(dto.userId, walletAddress);

    // 3. Query current session
    const session = await this.yellowNetwork.querySession(dto.appSessionId);

    // 4. Verify user is a participant
    const isParticipant = session.definition.participants.some(
      (p) => p.toLowerCase() === walletAddress.toLowerCase(),
    );

    if (!isParticipant) {
      throw new BadRequestException(
        'You are not a participant in this session',
      );
    }

    // 5. Verify session is open
    if (session.status !== 'open') {
      throw new BadRequestException(
        `Cannot close session in ${session.status} state`,
      );
    }

    // 6. Build COMPLETE final allocations (every participant must be listed).
    //
    // Yellow's `getLightningNode` allocations can be partial depending on
    // requester; any missing participant+asset allocation must not be forced to 0,
    // otherwise close will fail with "asset ... not fully redistributed".
    //
    // We fill missing values from local DB (lightning_node_participant.balance),
    // which we maintain from Yellow state after each successful mutation.
    const allParticipants = session.definition.participants ?? [];
    const sessionAllocs = session.allocations ?? [];

    const assets = [
      ...new Set(
        sessionAllocs
          .map((a: any) => a.asset?.toLowerCase?.() ?? a.asset)
          .filter(Boolean),
      ),
    ];
    if (assets.length === 0) assets.push('usdc');

    const localNode = await this.prisma.lightningNode.findUnique({
      where: { appSessionId: dto.appSessionId },
      include: { participants: true },
    });

    const sessionAllocMap = new Map(
      sessionAllocs.map((a: any) => [
        `${String(a.participant).toLowerCase()}|${String(a.asset).toLowerCase()}`,
        a.amount ?? '0',
      ]),
    );

    const dbAllocMap = new Map<string, string>(
      (localNode?.participants ?? []).map((p) => [
        `${p.address.toLowerCase()}|${p.asset.toLowerCase()}`,
        p.balance ?? '0',
      ]),
    );

    const finalAllocations: Array<{
      participant: string;
      asset: string;
      amount: string;
    }> = [];

    for (const asset of assets) {
      for (const p of allParticipants) {
        const key = `${p.toLowerCase()}|${asset.toLowerCase()}`;
        const amount = sessionAllocMap.get(key) ?? dbAllocMap.get(key) ?? '0';
        finalAllocations.push({
          participant: p,
          asset,
          amount,
        });
      }
    }

    // 7. Close session with Yellow Network
    await this.yellowNetwork.closeSession(
      dto.appSessionId,
      finalAllocations,
    );

    // 8. Return result
    return {
      appSessionId: dto.appSessionId,
      closed: true,
    };
  }
}
