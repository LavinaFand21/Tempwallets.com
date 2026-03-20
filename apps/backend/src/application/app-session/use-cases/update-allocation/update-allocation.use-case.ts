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
 * 5. Persist canonical balances to DB (single source of truth)
 *
 * Simplified from current implementation:
 * - Single operation for deposit/transfer/withdraw (cleaner)
 * - Canonical session state stored in DB for consistency
 */

import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import type { IYellowNetworkPort } from '../../ports/yellow-network.port.js';
import { YELLOW_NETWORK_PORT } from '../../ports/yellow-network.port.js';
import type { IWalletProviderPort } from '../../ports/wallet-provider.port.js';
import { WALLET_PROVIDER_PORT } from '../../ports/wallet-provider.port.js';
import { PrismaService } from '../../../../database/prisma.service.js';
import { mergeSessionState } from '../../utils/canonical-session.js';
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

    const existingNode = await this.prisma.lightningNode.findUnique({
      where: { appSessionId: dto.appSessionId },
      include: { participants: true },
    });
    const walletLower = walletAddress.toLowerCase();

    // Guard: prevent negative balances in requested allocations
    if (dto.allocations?.some((a) => Number(a.amount) < 0 || Number.isNaN(Number(a.amount)))) {
      throw new BadRequestException('Negative balances are not allowed');
    }

    // Guard: require two participants before transfers (OPERATE)
    if (dto.intent === 'OPERATE') {
      const participantCount =
        existingNode?.participants.length ??
        currentSession.definition?.participants?.length ??
        0;
      if (participantCount < 2) {
        throw new BadRequestException('Session must have at least 2 participants');
      }

      const joinedCount =
        existingNode?.participants.filter(
          (p) => p.status === 'joined' || p.address.toLowerCase() === walletLower,
        ).length ?? 0;

      if (joinedCount < 2) {
        throw new BadRequestException(
          'Counterparty has not joined yet. Transfers require all participants to have joined the session.',
        );
      }
    }

    if (dto.intent === 'OPERATE') {
      console.log('[UpdateAllocation] Before transfer balances', {
        sessionId: dto.appSessionId,
        balances: (existingNode?.participants ?? []).map((p) => ({
          address: p.address,
          asset: p.asset,
          balance: p.balance,
          status: p.status,
        })),
      });
    }

    // 4. Update allocations with Yellow Network
    const updated = await this.yellowNetwork.updateSession({
      sessionId: dto.appSessionId,
      intent: dto.intent,
      allocations: dto.allocations,
    });

    // 5. Persist latest balances in local DB for deterministic totals
    const tokenFromUpdated =
      (updated.allocations ?? currentSession.allocations ?? []).find((a: any) => a.asset)?.asset ??
      existingNode?.token ??
      'usdc';
    const token = tokenFromUpdated.toLowerCase();

    const participantList =
      updated.definition?.participants?.length
        ? updated.definition.participants
        : currentSession.definition?.participants?.length
          ? currentSession.definition.participants
          : existingNode?.participants.map((p) => p.address) ?? [];

    // Yellow can return partial allocations for OPERATE. Build a canonical map
    // by layering: current session -> requested allocations -> confirmed update.
    // This preserves zero-sum target amounts even when Yellow omits one side.
    const allocationByKey = new Map(
      (currentSession.allocations ?? []).map((a: any) => [
        `${String(a.participant).toLowerCase()}|${String(a.asset ?? token).toLowerCase()}`,
        a.amount ?? '0',
      ]),
    );
    for (const alloc of dto.allocations ?? []) {
      allocationByKey.set(
        `${String(alloc.participant).toLowerCase()}|${String(alloc.asset ?? token).toLowerCase()}`,
        alloc.amount ?? '0',
      );
    }
    for (const alloc of updated.allocations ?? []) {
      allocationByKey.set(
        `${String(alloc.participant).toLowerCase()}|${String(alloc.asset ?? token).toLowerCase()}`,
        alloc.amount ?? '0',
      );
    }

    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const node = await tx.lightningNode.upsert({
        where: { appSessionId: dto.appSessionId },
        update: {
          status: updated.status,
          token,
          chain: dto.chain,
          updatedAt: now,
        },
        create: {
          userId: dto.userId,
          appSessionId: dto.appSessionId,
          uri: `lightning://${dto.appSessionId}`,
          chain: dto.chain,
          token,
          status: updated.status,
          maxParticipants: participantList.length || 2,
          quorum: updated.definition?.quorum ?? currentSession.definition?.quorum ?? 100,
          protocol: updated.definition?.protocol ?? currentSession.definition?.protocol ?? 'NitroRPC/0.4',
          challenge: updated.definition?.challenge ?? currentSession.definition?.challenge ?? 3600,
          sessionData:
            typeof updated.session_data === 'string'
              ? updated.session_data
              : JSON.stringify(updated.session_data ?? {}),
        },
      });

      for (const address of participantList) {
        const addrLower = address.toLowerCase();
        const key = `${addrLower}|${token}`;
        const existing = existingNode?.participants.find(
          (p) =>
            p.address.toLowerCase() === addrLower &&
            p.asset.toLowerCase() === token,
        );
        const currentStatus = existing?.status ?? 'invited';
        const shouldJoin = addrLower === walletLower || currentStatus === 'joined';
        const nextBalance = allocationByKey.get(key) ?? existing?.balance ?? '0';

        await tx.lightningNodeParticipant.upsert({
          where: {
            lightningNodeId_address_asset: {
              lightningNodeId: node.id,
              address,
              asset: token,
            },
          },
          update: {
            balance: nextBalance,
            status: shouldJoin ? 'joined' : currentStatus,
            joinedAt: shouldJoin ? now : undefined,
            lastSeenAt: addrLower === walletLower ? now : undefined,
          },
          create: {
            lightningNodeId: node.id,
            address,
            weight: updated.definition?.weights?.[participantList.indexOf(address)] ?? 0,
            balance: nextBalance,
            asset: token,
            status: shouldJoin ? 'joined' : 'invited',
            joinedAt: shouldJoin ? now : null,
            lastSeenAt: addrLower === walletLower ? now : null,
          },
        });
      }
    });

    const syncedNode = await this.prisma.lightningNode.findUnique({
      where: { appSessionId: dto.appSessionId },
      include: { participants: true },
    });

    const canonical = mergeSessionState({
      yellow: updated,
      dbParticipants: (syncedNode?.participants ?? []).map((p) => ({
        address: p.address,
        status: p.status,
        balance: p.balance,
        asset: p.asset,
      })),
      dbToken: syncedNode?.token ?? token,
    });

    if (dto.intent === 'OPERATE') {
      console.log('[UpdateAllocation] After transfer balances', {
        sessionId: dto.appSessionId,
        balances: canonical.participants.map((p) => ({
          address: p.address,
          balance: p.balance,
        })),
      });
      console.log('[UpdateAllocation] Canonical session state', {
        sessionId: dto.appSessionId,
        totalBalance: canonical.totalBalance,
        participants: canonical.participants,
      });
    }

    // 6. Return result
    return {
      appSessionId: updated.app_session_id,
      version: updated.version,
      allocations: canonical.allocations,
      session: {
        appSessionId: updated.app_session_id,
        status: updated.status,
        version: updated.version,
        chain: dto.chain,
        token: canonical.token,
        totalBalance: canonical.totalBalance,
        participants: canonical.participants.map((p) => ({
          address: p.address,
          joined: p.joined,
          balance: p.balance,
        })),
        allocations: canonical.allocations,
        definition: updated.definition,
        sessionData: updated.session_data,
      },
    };
  }
}

