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

@Injectable()
export class DiscoverSessionsUseCase {
  constructor(
    @Inject(YELLOW_NETWORK_PORT)
    private readonly yellowNetwork: IYellowNetworkPort,
    @Inject(WALLET_PROVIDER_PORT)
    private readonly walletProvider: IWalletProviderPort,
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

    return {
      sessions: sessions.map((s) => {
        const detail = detailById.get(s.app_session_id) ?? s;
        const allocations = (detail as any).allocations ?? s.allocations ?? [];

        // Derive token from allocations, fall back to 'usdc'
        const token = (allocations as any[]).find((a: any) => a.asset)?.asset ?? 'usdc';

        // Build participant list from definition (most complete source)
        const participantList: string[] =
          (detail as any).definition?.participants?.length
            ? (detail as any).definition.participants
            : s.definition?.participants?.length
              ? s.definition.participants
              : (allocations as any[]).map((a: any) => a.participant).filter(Boolean);

        // Ensure every participant has an allocation entry (0 for missing)
        const assets = [
          ...new Set(
            (allocations as any[]).map((a: any) => (a.asset ?? '').toLowerCase()).filter(Boolean),
          ),
        ];
        const completeAllocations: Array<{ participant: string; asset: string; amount: string }> = [];
        if (assets.length > 0 && participantList.length > 0) {
          for (const asset of assets) {
            for (const address of participantList) {
              const existing = (allocations as any[]).find(
                (a: any) =>
                  a.participant?.toLowerCase() === address.toLowerCase() &&
                  (a.asset ?? '').toLowerCase() === asset,
              );
              completeAllocations.push({
                participant: address,
                asset,
                amount: existing?.amount ?? '0',
              });
            }
          }
        }

        return {
          appSessionId: s.app_session_id,
          status: s.status,
          version: s.version,
          chain: dto.chain,
          token,
          // Mark the requesting wallet as joined=true; Yellow Network is the
          // source of truth and returning the session means the user is active.
          participants: participantList.map((address) => ({
            address,
            joined: address.toLowerCase() === walletAddress.toLowerCase(),
          })),
          allocations: completeAllocations.length > 0 ? completeAllocations : allocations,
        };
      }),
      count: sessions.length,
    };
  }
}
