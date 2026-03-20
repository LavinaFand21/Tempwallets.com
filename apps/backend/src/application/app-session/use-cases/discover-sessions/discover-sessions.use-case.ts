/**
 * DISCOVER SESSIONS USE CASE
 *
 * Application Layer - Business Operation
 *
 * Discover all app sessions where user is a participant.
 *
 * Business Flow:
 * 1. Get user's wallet address
 * 2. Authenticate with Yellow Network
 * 3. Query all sessions where user is participant
 * 4. Return filtered sessions
 *
 * Simplified from current implementation:
 * - Canonical session state is synced to DB for consistency
 * - No "active" vs "invitations" split (artificial distinction)
 * - Yellow Network handles filtering
 */

import { Injectable, Inject } from '@nestjs/common';
import type { IYellowNetworkPort } from '../../ports/yellow-network.port.js';
import { YELLOW_NETWORK_PORT } from '../../ports/yellow-network.port.js';
import type { IWalletProviderPort } from '../../ports/wallet-provider.port.js';
import { WALLET_PROVIDER_PORT } from '../../ports/wallet-provider.port.js';
import { PrismaService } from '../../../../database/prisma.service.js';
import { mergeSessionState } from '../../utils/canonical-session.js';
import {
  DiscoverSessionsDto,
  DiscoverSessionsResultDto,
} from './discover-sessions.dto.js';

@Injectable()
export class DiscoverSessionsUseCase {
  constructor(
    @Inject(YELLOW_NETWORK_PORT)
    private readonly yellowNetwork: IYellowNetworkPort,
    @Inject(WALLET_PROVIDER_PORT)
    private readonly walletProvider: IWalletProviderPort,
    private readonly prisma: PrismaService,
  ) {}

  async execute(dto: DiscoverSessionsDto): Promise<DiscoverSessionsResultDto> {
    // 1. Get user's wallet address
    const walletAddress = await this.walletProvider.getWalletAddress(
      dto.userId,
      dto.chain,
    );

    // 2. Authenticate with Yellow Network
    await this.yellowNetwork.authenticate(dto.userId, walletAddress);

    // 3. Query sessions from Yellow Network
    // Yellow Network already filters by participant so every returned session
    // belongs to this user — no secondary DB filter needed.
    const sessions = await this.yellowNetwork.querySessions({
      participant: walletAddress,
      status: dto.status,
    });

    // 4. Fetch full details for each session so allocations and participants
    //    are complete (the list endpoint returns partial data).
    const detailResults = await Promise.allSettled(
      sessions.map((s) => this.yellowNetwork.querySession(s.app_session_id)),
    );
    const detailById = new Map<string, (typeof sessions)[number]>();
    detailResults.forEach((r, idx) => {
      if (r.status !== 'fulfilled') return;
      detailById.set(sessions[idx]!.app_session_id, r.value as any);
    });

    const now = new Date();
    const walletLower = walletAddress.toLowerCase();

    const enrichedSessions = await Promise.all(
      sessions.map(async (s) => {
        const detail = detailById.get(s.app_session_id) ?? s;
        const allocations = (detail as any).allocations ?? s.allocations ?? [];

        const tokenFromYellow = (allocations as any[]).find((a: any) => a.asset)?.asset ?? 'usdc';
        const token = tokenFromYellow.toLowerCase();

        const participantList: string[] =
          (detail as any).definition?.participants?.length
            ? (detail as any).definition.participants
            : s.definition?.participants?.length
              ? s.definition.participants
              : (allocations as any[]).map((a: any) => a.participant).filter(Boolean);

        const existingNode = await this.prisma.lightningNode.findUnique({
          where: { appSessionId: s.app_session_id },
          include: { participants: true },
        });

        // List/detail responses can omit some participant allocations. Merge
        // Yellow values over DB snapshot to keep full participant balances.
        const allocationByKey = new Map(
          (existingNode?.participants ?? []).map((p) => [
            `${p.address.toLowerCase()}|${p.asset.toLowerCase()}`,
            p.balance ?? '0',
          ]),
        );
        for (const alloc of allocations as any[]) {
          allocationByKey.set(
            `${String(alloc.participant).toLowerCase()}|${String(alloc.asset ?? token).toLowerCase()}`,
            alloc.amount ?? '0',
          );
        }

        await this.prisma.$transaction(async (tx) => {
          const node = await tx.lightningNode.upsert({
            where: { appSessionId: s.app_session_id },
            update: {
              status: detail.status,
              token,
              chain: dto.chain,
              updatedAt: now,
            },
            create: {
              userId: dto.userId,
              appSessionId: s.app_session_id,
              uri: `lightning://${s.app_session_id}`,
              chain: dto.chain,
              token,
              status: detail.status,
              maxParticipants: participantList.length || 2,
              quorum: detail.definition?.quorum ?? 100,
              protocol: detail.definition?.protocol ?? 'NitroRPC/0.4',
              challenge: detail.definition?.challenge ?? 3600,
              sessionData:
                typeof detail.session_data === 'string'
                  ? detail.session_data
                  : JSON.stringify(detail.session_data ?? {}),
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
            const nextBalance = existing?.balance ?? allocationByKey.get(key) ?? '0';

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
                status: currentStatus,
                lastSeenAt: addrLower === walletLower ? now : undefined,
              },
              create: {
                lightningNodeId: node.id,
                address,
                weight: detail.definition?.weights?.[participantList.indexOf(address)] ?? 0,
                balance: nextBalance,
                asset: token,
                status: currentStatus,
                joinedAt: currentStatus === 'joined' ? now : null,
                lastSeenAt: addrLower === walletLower ? now : null,
              },
            });
          }
        });

        const syncedNode = await this.prisma.lightningNode.findUnique({
          where: { appSessionId: s.app_session_id },
          include: { participants: true },
        });

        const canonical = mergeSessionState({
          yellow: detail as any,
          dbParticipants: (syncedNode?.participants ?? []).map((p) => ({
            address: p.address,
            status: p.status,
            balance: p.balance,
            asset: p.asset,
          })),
          dbToken: syncedNode?.token ?? token,
        });

        return {
          appSessionId: s.app_session_id,
          status: detail.status,
          version: detail.version,
          chain: dto.chain,
          token: canonical.token,
          totalBalance: canonical.totalBalance,
          participants: canonical.participants.map((p) => ({
            address: p.address,
            joined: p.joined,
            balance: p.balance,
          })),
          allocations: canonical.allocations,
        };
      }),
    );

    return {
      sessions: enrichedSessions,
      count: sessions.length,
    };
  }
}

