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

@Injectable()
export class QuerySessionUseCase {
  constructor(
    @Inject(YELLOW_NETWORK_PORT)
    private readonly yellowNetwork: IYellowNetworkPort,
    @Inject(WALLET_PROVIDER_PORT)
    private readonly walletProvider: IWalletProviderPort,
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

    // 5. Build response — derive token and ensure every participant has an allocation
    const allocations = session.allocations ?? [];
    const token = allocations.find((a: any) => a.asset)?.asset ?? 'usdc';

    const assets = [
      ...new Set(
        (allocations.length > 0 ? allocations : token ? [{ asset: token }] : []).map(
          (a: any) => (a.asset ?? '').toLowerCase(),
        ).filter(Boolean),
      ),
    ];
    const completeAllocations: Array<{ participant: string; asset: string; amount: string }> = [];
    if (assets.length > 0 && participants.length > 0) {
      for (const asset of assets) {
        for (const address of participants) {
          const existing = allocations.find(
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
      appSessionId: session.app_session_id,
      status: session.status,
      version: session.version,
      chain: dto.chain,
      token,
      // Mark the querying wallet as joined=true — Yellow Network returning
      // this session means the user is an active participant.
      participants: participants.map((address) => ({
        address,
        joined: address.toLowerCase() === walletAddress.toLowerCase(),
      })),
      definition: session.definition,
      allocations: completeAllocations.length > 0 ? completeAllocations : allocations,
      sessionData: session.session_data,
    };
  }
}
