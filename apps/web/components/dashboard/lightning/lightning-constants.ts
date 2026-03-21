import { toast } from 'sonner';

export const CHAINS = [
  { id: 'base', label: 'Base' },
  { id: 'arbitrum', label: 'Arbitrum' },
];

export const ASSETS = [
  { id: 'usdc', label: 'USDC' },
  { id: 'usdt', label: 'USDT' },
];

export const DEFAULT_CHAIN = 'base';
export const DEFAULT_ASSET = 'usdc';

export const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export function copyToClipboard(text: string, label = 'Copied!') {
  navigator.clipboard.writeText(text).catch(() => {});
  toast.success(label);
}

export function formatExpiry(iso: string | null): string {
  if (!iso) return 'Unknown';
  const d = new Date(iso);
  const diff = d.getTime() - Date.now();
  if (diff <= 0) return 'Expired';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function truncate(s: string, chars = 8): string {
  if (s.length <= chars * 2 + 3) return s;
  return `${s.slice(0, chars)}…${s.slice(-chars)}`;
}
