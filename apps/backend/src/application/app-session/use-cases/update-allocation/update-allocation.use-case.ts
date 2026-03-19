/**
 * UPDATE ALLOCATION USE CASE
 *
 * Application Layer - Business Operation
 *
 * Updates allocations in an app session (deposit, transfer, withdraw).
 * This is Yellow Network's core operation - gasless state transitions.
 *
 * Business Flow:
 * 1. Authenticate user's wallet
 * 2. Query current session state from Yellow Network
 * 3. Validate user is a participant
 * 4. Update allocations via Yellow Network (signed state transition)
 * 5. Return updated state (NO database update - Yellow Network is source of truth)
 *
 * Simplified from current implementation:
 * - No database sync (overcomplicated)
 * - Single operation for deposit/transfer/withdraw (cleaner)
 * - Yellow Network handles all validation
 */

import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import type { IYellowNetworkPort } from '../../ports/yellow-network.port.js';
import { YELLOW_NETWORK_PORT } from '../../ports/yellow-network.port.js';
import type { IWalletProviderPort } from '../../ports/wallet-provider.port.js';
import { WALLET_PROVIDER_PORT } from '../../ports/wallet-provider.port.js';
import { PrismaService } from '../../../../database/prisma.service.js';
import {
  UpdateAllocationDto,
  UpdateAllocationResultDto,
} from './update-allocation.dto.js';

@Injectable()
export class UpdateAllocationUseCase {
  constructor(
    @Inject(YELLOW_NETWORK_PORT)
    private readonly yellowNetwork: IYellowNetworkPort,
    @Inject(WALLET_PROVIDER_PORT)
    private readonly walletProvider: IWalletProviderPort,
    private readonly prisma: PrismaService,
  ) {}

  async execute(dto: UpdateAllocationDto): Promise<UpdateAllocationResultDto> {
    // 1. Get user's wallet address
    const walletAddress = await this.walletProvider.getWalletAddress(
      dto.userId,
      dto.chain,
    );

    // 2. Authenticate with Yellow Network
    await this.yellowNetwork.authenticate(dto.userId, walletAddress);

    // 3. Query current session to verify user is participant
    const currentSession = await this.yellowNetwork.querySession(
      dto.appSessionId,
    );

    // Guard: require two participants before transfers (OPERATE)
    if (dto.intent === 'OPERATE') {
      const participantCount =
        currentSession.definition?.participants?.length ?? 0;
      if (participantCount < 2) {
        throw new BadRequestException('Session must have at least 2 participants');
      }

      const participants = currentSession.definition?.participants ?? [];
      const allocations = currentSession.allocations ?? [];

      const node = await this.prisma.lightningNode.findUnique({
        where: { appSessionId: dto.appSessionId },
        include: { participants: true },
      });

      // A participant can be considered "joined" if either:
      // 1) local DB marks them joined (deterministic after QuerySession), or
      // 2) Yellow session allocations include their allocation entry.
      //
      // Yellow can return partial allocations depending on who queried,
      // so we always allow DB join-state when available.
      const joinedByDbSet = new Set(
        (node?.participants ?? [])
          .filter((p) => p.status === 'joined')
          .map((p) => p.address.toLowerCase()),
      );
      const allocJoinedSet = new Set(
        allocations
          .map((alloc) => (alloc.participant ?? '').toLowerCase())
          .filter(Boolean),
      );

      const participantDebug = participants.map((participantAddr) => {
        const addrLower = participantAddr.toLowerCase();
        const joinedByDb = joinedByDbSet.has(addrLower);
        const joinedByAlloc = allocJoinedSet.has(addrLower);
        return { addr: addrLower, joinedByDb, joinedByAlloc };
      });

      // Temporary diagnostic log: helps confirm why join-guard blocks OPERATE.
      // Remove once fixed.
      // eslint-disable-next-line no-console
      console.log('[UpdateAllocationUseCase][OPERATE join-guard]', {
        appSessionId: dto.appSessionId,
        participantCount,
        dbNodeFound: Boolean(node),
        participantDebug,
        yellowAllocationParticipants: Array.from(allocJoinedSet),
      });

      const joinedCount = participantDebug.filter((p) => p.joinedByDb || p.joinedByAlloc).length;

      if (joinedCount < 2) {
        throw new BadRequestException(
          'Counterparty has not joined yet. Transfers require all participants to have joined the session.',
        );
      }
    }

    // 4. Update allocations with Yellow Network
    const updated = await this.yellowNetwork.updateSession({
      sessionId: dto.appSessionId,
      intent: dto.intent,
      allocations: dto.allocations,
    });

    // 5. Persist latest balances in local DB for deterministic totals
    const node = await this.prisma.lightningNode.findUnique({
      where: { appSessionId: dto.appSessionId },
      include: { participants: true },
    });

    if (node) {
      const participantList =
        updated.definition?.participants?.length
          ? updated.definition.participants
          : currentSession.definition?.participants?.length
            ? currentSession.definition.participants
            : node.participants.map((p) => p.address);

      // IMPORTANT:
      // YellowNetworkAdapter.updateSession expects/caches COMPLETE per-participant
      // allocations. The client payload may be partial (e.g. DEPOSIT/WITHDRAW),
      // so persisting from dto.allocations can incorrectly zero out other
      // participants' balances and cause inconsistent session totals.
      const allocs = updated.allocations ?? dto.allocations ?? [];
      const assets = [
        ...new Set(
          (allocs.length > 0 ? allocs : []).map((a) =>
            a.asset?.toLowerCase?.() ?? a.asset,
          ),
        ),
      ];
      const completeAllocations: Array<{
        participant: string;
        asset: string;
        amount: string;
      }> = [];

      for (const asset of assets) {
        for (const address of participantList) {
          const existing = allocs.find(
            (a) =>
              a.participant.toLowerCase() === address.toLowerCase() &&
              (a.asset?.toLowerCase?.() ?? a.asset) === asset,
          );
          completeAllocations.push({
            participant: address,
            asset,
            amount: existing?.amount ?? '0',
          });
        }
      }

      const statusByAddress = new Map(
        node.participants.map((p) => [p.address.toLowerCase(), p.status]),
      );

      for (const alloc of completeAllocations) {
        const existing = node.participants.find(
          (p) =>
            p.address.toLowerCase() === alloc.participant.toLowerCase() &&
            p.asset.toLowerCase() === alloc.asset.toLowerCase(),
        );
        if (existing) {
          await this.prisma.lightningNodeParticipant.update({
            where: { id: existing.id },
            data: {
              balance: alloc.amount,
              asset: alloc.asset,
              lastSeenAt: new Date(),
            },
          });
        } else {
          await this.prisma.lightningNodeParticipant.create({
            data: {
              lightningNodeId: node.id,
              address: alloc.participant,
              asset: alloc.asset,
              balance: alloc.amount,
              weight: 0,
              status:
                statusByAddress.get(alloc.participant.toLowerCase()) ?? 'invited',
              lastSeenAt: new Date(),
            },
          });
        }
      }
    }

    // 6. Return result
    return {
      appSessionId: updated.app_session_id,
      version: updated.version,
      allocations: updated.allocations,
    };
  }
}
