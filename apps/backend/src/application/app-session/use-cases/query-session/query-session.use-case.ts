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
 * - Canonical session state is synced to DB for consistency
 * - Yellow Network provides raw session data
 * - Clean, simple query operation
 */

import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import type { IYellowNetworkPort } from '../../ports/yellow-network.port.js';
import { YELLOW_NETWORK_PORT } from '../../ports/yellow-network.port.js';
import type { IWalletProviderPort } from '../../ports/wallet-provider.port.js';
import { WALLET_PROVIDER_PORT } from '../../ports/wallet-provider.port.js';
import { PrismaService } from '../../../../database/prisma.service.js';
import { mergeSessionState } from '../../utils/canonical-session.js';
import { QuerySessionDto, QuerySessionResultDto } from './query-session.dto.js';

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

    // 2. Authenticate with Yellow Network (reuses existing session when valid)
    await this.yellowNetwork.authenticate(dto.userId, walletAddress);

    // 3. Query session from Yellow Network — single source of truth, no DB sync
    const session = await this.yellowNetwork.querySession(dto.sessionId);

    // 4. Verify user is a participant
    const participants = session.definition?.participants ?? [];
    const isParticipant = participants.some(
      (p) => p.toLowerCase() === walletAddress.toLowerCase(),
    );

    if (!isParticipant) {
      throw new BadRequestException(
        `You are not a participant in this session. ` +
          `Your wallet address (${walletAddress}) was not included when the session was created.`,
      );
    }

    // 5. Sync canonical session state to DB (participants + balances)
    const allocations = session.allocations ?? [];
    const tokenFromYellow =
      allocations.find((a: any) => a.asset)?.asset ?? 'usdc';
    const token = tokenFromYellow.toLowerCase();
    const walletLower = walletAddress.toLowerCase();
    const now = new Date();

    const existingNode = await this.prisma.lightningNode.findUnique({
      where: { appSessionId: dto.sessionId },
      include: { participants: true },
    });

    // Yellow may return partial allocations for a session query. Start from DB
    // snapshot and overlay Yellow values so missing participants keep balance.
    const allocationByKey = new Map(
      (existingNode?.participants ?? []).map((p) => [
        `${p.address.toLowerCase()}|${p.asset.toLowerCase()}`,
        p.balance ?? '0',
      ]),
    );
    for (const alloc of allocations) {
      allocationByKey.set(
        `${String(alloc.participant).toLowerCase()}|${String(alloc.asset ?? token).toLowerCase()}`,
        alloc.amount ?? '0',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const node = await tx.lightningNode.upsert({
        where: { appSessionId: dto.sessionId },
        update: {
          status: session.status,
          token,
          chain: dto.chain,
          updatedAt: now,
        },
        create: {
          userId: dto.userId,
          appSessionId: dto.sessionId,
          uri: `lightning://${dto.sessionId}`,
          chain: dto.chain,
          token,
          status: session.status,
          maxParticipants: participants.length || 2,
          quorum: session.definition?.quorum ?? 100,
          protocol: session.definition?.protocol ?? 'NitroRPC/0.4',
          challenge: session.definition?.challenge ?? 3600,
          sessionData:
            typeof session.session_data === 'string'
              ? session.session_data
              : JSON.stringify(session.session_data ?? {}),
        },
      });

      for (const address of participants) {
        const addrLower = address.toLowerCase();
        const key = `${addrLower}|${token}`;
        const existing = existingNode?.participants.find(
          (p) =>
            p.address.toLowerCase() === addrLower &&
            p.asset.toLowerCase() === token,
        );
        const currentStatus = existing?.status ?? 'invited';
        const shouldJoin =
          addrLower === walletLower || currentStatus === 'joined';
        const nextBalance =
          existing?.balance ?? allocationByKey.get(key) ?? '0';

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
            weight:
              session.definition?.weights?.[participants.indexOf(address)] ?? 0,
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
      where: { appSessionId: dto.sessionId },
      include: { participants: true },
    });

    const canonical = mergeSessionState({
      yellow: session,
      dbParticipants: (syncedNode?.participants ?? []).map((p) => ({
        address: p.address,
        status: p.status,
        balance: p.balance,
        asset: p.asset,
      })),
      dbToken: syncedNode?.token ?? token,
    });

    return {
      appSessionId: session.app_session_id,
      status: session.status,
      version: session.version,
      chain: dto.chain,
      token: canonical.token,
      totalBalance: canonical.totalBalance,
      participants: canonical.participants.map((p) => ({
        address: p.address,
        joined: p.joined,
        balance: p.balance,
      })),
      definition: session.definition,
      allocations: canonical.allocations,
      sessionData: session.session_data,
    };
  }
}
