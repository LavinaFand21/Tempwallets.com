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
 * - No database sync (was 7 steps, now 1 step!)
 * - No "active" vs "invitations" split (artificial distinction)
 * - Yellow Network handles filtering
 */

import { Injectable, Inject } from '@nestjs/common';
import type { IYellowNetworkPort } from '../../ports/yellow-network.port.js';
import { YELLOW_NETWORK_PORT } from '../../ports/yellow-network.port.js';
import type { IWalletProviderPort } from '../../ports/wallet-provider.port.js';
import { WALLET_PROVIDER_PORT } from '../../ports/wallet-provider.port.js';
import {
  DiscoverSessionsDto,
  DiscoverSessionsResultDto,
} from './discover-sessions.dto.js';
import { PrismaService } from '../../../../database/prisma.service.js';

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
    // Yellow Network filters by participant for us
    const sessions = await this.yellowNetwork.querySessions({
      participant: walletAddress,
      status: dto.status,
    });

    // 4. Return enriched result — include chain from the request and
    //    derive token from allocations so the frontend can display them.
    const appSessionIds = sessions.map((s) => s.app_session_id);
    const localNodes = await this.prisma.lightningNode.findMany({
      where: { appSessionId: { in: appSessionIds } },
      include: { participants: true },
    });
    const statusBySession = new Map(
      localNodes.map((n) => [
        n.appSessionId,
        new Map(
          (n.participants || []).map((p) => [
            p.address.toLowerCase(),
            p.status,
          ]),
        ),
      ]),
    );

    const joinedSessions = sessions.filter((s) => {
      const statuses = statusBySession.get(s.app_session_id);
      return statuses?.get(walletAddress.toLowerCase()) === 'joined';
    });

    // Fetch full session details for joined sessions.
    // get_app_sessions often returns partial allocations (per-requester),
    // which causes totals to differ across clients.
    const detailResults = await Promise.allSettled(
      joinedSessions.map((s) => this.yellowNetwork.querySession(s.app_session_id)),
    );
    const detailById = new Map<string, (typeof sessions)[number]>();
    detailResults.forEach((r, idx) => {
      if (r.status !== 'fulfilled') return;
      detailById.set(joinedSessions[idx]!.app_session_id, r.value as any);
    });

    const nodeById = new Map(localNodes.map((n) => [n.appSessionId, n]));

    return {
      sessions: joinedSessions.map((s) => {
        const detail = detailById.get(s.app_session_id) ?? s;
        const allocations = detail.allocations ?? [];
        const node = nodeById.get(s.app_session_id);
        const dbToken = (node?.token ?? '').toLowerCase();
        const dbAllocs =
          node?.participants?.length
            ? node.participants.map((p) => ({
                participant: p.address,
                asset: (p.asset || dbToken || 'usdc').toLowerCase(),
                amount: p.balance ?? '0',
              }))
            : [];
        const mergedAllocs = allocations.length > 0 ? allocations : dbAllocs;
        // Token is the first non-empty asset from allocations
        const token = mergedAllocs.find((a) => a.asset)?.asset ?? dbToken ?? 'usdc';
        const participantStatuses = statusBySession.get(s.app_session_id);
        const participantList =
          detail.definition?.participants?.length
            ? detail.definition.participants
            : s.definition?.participants?.length
              ? s.definition.participants
              : Array.from(participantStatuses?.keys() ?? []);

        // Ensure allocations include every participant (0 for missing entries)
        const assets = [
          ...new Set(
            (mergedAllocs.length > 0 ? mergedAllocs : token ? [{ asset: token }] : []).map(
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
        const completeAllocations: typeof mergedAllocs = [];
        for (const asset of assets) {
          for (const address of participantList ?? []) {
            const existing = mergedAllocs.find(
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
          appSessionId: s.app_session_id,
          status: s.status,
          version: s.version,
          chain: dto.chain,
          token,
          participants: (participantList ?? []).map((address) => ({
            address,
            joined: participantStatuses?.get(address.toLowerCase()) === 'joined',
          })),
          allocations: completeAllocations.length > 0 ? completeAllocations : mergedAllocs,
        };
      }),
      count: joinedSessions.length,
    };
  }
}
