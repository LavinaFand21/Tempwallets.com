import type { YellowSessionData } from '../ports/yellow-network.port.js';

export interface DbParticipantSnapshot {
  address: string;
  status: string;
  balance: string;
  asset: string;
}

export interface CanonicalParticipant {
  address: string;
  joined: boolean;
  balance: number;
}

export interface CanonicalSessionState {
  token: string;
  participants: CanonicalParticipant[];
  allocations: Array<{ participant: string; asset: string; amount: string }>;
  totalBalance: number;
}

function normalizeAsset(asset?: string, fallback = 'usdc'): string {
  return (asset ?? fallback).toLowerCase();
}

function toNumberSafe(value: string | number | undefined): number {
  const num = typeof value === 'number' ? value : parseFloat(value ?? '0');
  return Number.isFinite(num) ? num : 0;
}

export function mergeSessionState(params: {
  yellow: YellowSessionData;
  dbParticipants: DbParticipantSnapshot[];
  dbToken?: string | null;
  tokenFallback?: string;
}): CanonicalSessionState {
  const { yellow, dbParticipants, dbToken, tokenFallback } = params;

  const yellowAllocations = yellow.allocations ?? [];
  const tokenFromYellow =
    yellowAllocations.find((a) => a.asset)?.asset ?? tokenFallback ?? 'usdc';
  const token = normalizeAsset(dbToken ?? tokenFromYellow ?? tokenFallback);

  const statusByAddress = new Map(
    dbParticipants.map((p) => [p.address.toLowerCase(), p.status]),
  );

  const dbBalanceByKey = new Map(
    dbParticipants.map((p) => [
      `${p.address.toLowerCase()}|${normalizeAsset(p.asset, token)}`,
      p.balance ?? '0',
    ]),
  );

  const yellowByKey = new Map(
    yellowAllocations.map((a) => [
      `${String(a.participant).toLowerCase()}|${normalizeAsset(a.asset, token)}`,
      a.amount ?? '0',
    ]),
  );

  const addressSet = new Set<string>();
  (yellow.definition?.participants ?? []).forEach((addr) =>
    addressSet.add(addr),
  );
  dbParticipants.forEach((p) => addressSet.add(p.address));

  const allocations: Array<{
    participant: string;
    asset: string;
    amount: string;
  }> = [];
  const participants: CanonicalParticipant[] = [];

  for (const address of addressSet) {
    const addrLower = address.toLowerCase();
    const dbAssets = dbParticipants
      .filter((p) => p.address.toLowerCase() === addrLower)
      .map((p) => normalizeAsset(p.asset, token));
    const yellowAssets = yellowAllocations
      .filter((a) => String(a.participant).toLowerCase() === addrLower)
      .map((a) => normalizeAsset(a.asset, token));

    const assets =
      dbAssets.length > 0
        ? dbAssets
        : yellowAssets.length > 0
          ? yellowAssets
          : [token];
    const uniqueAssets = [...new Set(assets)];

    for (const asset of uniqueAssets) {
      const key = `${addrLower}|${asset}`;
      // Prefer DB snapshot when available; Yellow responses can be partial or
      // temporarily stale per participant across concurrent clients.
      const amount = dbBalanceByKey.get(key) ?? yellowByKey.get(key) ?? '0';
      allocations.push({
        participant: address,
        asset,
        amount,
      });
    }

    const primaryAsset = uniqueAssets.includes(token) ? token : uniqueAssets[0];
    const primaryKey = `${addrLower}|${primaryAsset}`;
    const balance = toNumberSafe(
      dbBalanceByKey.get(primaryKey) ?? yellowByKey.get(primaryKey) ?? '0',
    );

    participants.push({
      address,
      joined: statusByAddress.get(addrLower) === 'joined',
      balance,
    });
  }

  const totalBalance = participants.reduce((sum, p) => sum + p.balance, 0);

  return { token, participants, allocations, totalBalance };
}
