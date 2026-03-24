import { WalletAddressKey } from '../interfaces/wallet.interfaces.js';

export const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const SMART_ACCOUNT_CHAIN_KEYS: Array<
  'ethereum' | 'base' | 'arbitrum' | 'polygon' | 'avalanche'
> = ['ethereum', 'base', 'arbitrum', 'polygon', 'avalanche'];

export const EOA_CHAIN_KEYS: Array<
  | 'ethereum'
  | 'base'
  | 'arbitrum'
  | 'polygon'
  | 'avalanche'
  | 'moonbeamTestnet'
  | 'astarShibuya'
  | 'paseoPassetHub'
  | 'hydration'
  | 'unique'
  | 'bifrost'
  | 'bifrostTestnet'
> = [
  'ethereum',
  'base',
  'arbitrum',
  'polygon',
  'avalanche',
  'moonbeamTestnet',
  'astarShibuya',
  'paseoPassetHub',
  'hydration',
  'unique',
  'bifrost',
  'bifrostTestnet',
];

export const NON_EVM_CHAIN_KEYS: Array<'tron' | 'bitcoin' | 'solana'> = [
  'tron',
  'bitcoin',
  'solana',
];

export const UI_SMART_ACCOUNT_LABEL = 'EVM Smart Account';

export const WALLETCONNECT_CHAIN_CONFIG = [
  { chainId: 1, key: 'ethereum' as WalletAddressKey, label: 'Ethereum' },
  { chainId: 8453, key: 'base' as WalletAddressKey, label: 'Base' },
  { chainId: 42161, key: 'arbitrum' as WalletAddressKey, label: 'Arbitrum' },
  { chainId: 137, key: 'polygon' as WalletAddressKey, label: 'Polygon' },
  { chainId: 43114, key: 'avalanche' as WalletAddressKey, label: 'Avalanche' },
];
