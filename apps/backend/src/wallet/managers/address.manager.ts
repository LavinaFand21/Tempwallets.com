import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import {
  IAddressManager,
  WalletAddresses,
  WalletAddressMetadataMap,
  WalletAddressKind,
  WalletAddressKey,
} from '../interfaces/wallet.interfaces.js';
import { AllChainTypes } from '../types/chain.types.js';
import { SeedManager } from './seed.manager.js';
import { AccountFactory } from '../factories/account.factory.js';
import { NativeEoaFactory } from '../factories/native-eoa.factory.js';
import { Eip7702AccountFactory } from '../factories/eip7702-account.factory.js';
import { AddressCacheRepository } from '../repositories/address-cache.repository.js';
import { mnemonicToAccount } from 'viem/accounts';
import { PimlicoConfigService } from '../config/pimlico.config.js';

/**
 * Address Manager
 * Handles address generation and retrieval for all supported chains
 */
@Injectable()
export class AddressManager implements IAddressManager {
  private readonly logger = new Logger(AddressManager.name);

  // Cache for addresses per user to avoid repeated fetching
  private addressCache: Map<
    string,
    {
      addresses: WalletAddresses;
      metadata: WalletAddressMetadataMap;
      timestamp: number;
    }
  > = new Map();
  private readonly ADDRESS_CACHE_TTL = 60 * 1000; // 1 minute cache

  private readonly eoaChains: WalletAddressKey[] = [
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

  constructor(
    private seedManager: SeedManager,
    private accountFactory: AccountFactory,
    private nativeEoaFactory: NativeEoaFactory,
    private eip7702AccountFactory: Eip7702AccountFactory,
    private addressCacheRepository: AddressCacheRepository,
    private pimlicoConfig: PimlicoConfigService,
  ) {}

  /**
   * Clear all cached addresses for a user (both in-memory and database)
   * Called when a new seed is created to ensure fresh addresses are generated
   * @param userId - The user ID
   */
  async clearAddressCache(userId: string): Promise<void> {
    // Clear in-memory cache
    this.addressCache.delete(userId);

    // Clear database cache
    await this.addressCacheRepository.clearAddresses(userId);

    this.logger.log(`Cleared all address caches for user ${userId}`);
  }

  /**
   * Get all wallet addresses for all chains
   * Auto-creates wallet if it doesn't exist
   * Fast path: Returns cached addresses from database instantly
   */
  async getAddresses(userId: string): Promise<WalletAddresses> {
    // Fast path: Check database cache first
    let cachedAddresses =
      await this.addressCacheRepository.getCachedAddresses(userId);
    let cacheInvalidated = false;

    // If we have cached addresses, check if they're complete
    if (Object.keys(cachedAddresses).length > 0) {
      const allExpectedChains = this.getAllExpectedChainNames();
      const hasAllChains = allExpectedChains.every(
        (chain) => cachedAddresses[chain] !== undefined,
      );

      if (hasAllChains) {
        // Before trusting cache, ensure it matches the current seed.
        // If the user switched/imported a new seed but cache wasn't cleared,
        // we must invalidate and regenerate to avoid address/signature mismatch.
        const hasSeed = await this.seedManager.hasSeed(userId);
        if (hasSeed) {
          const seedPhrase = await this.seedManager.getSeed(userId);
          const derived = mnemonicToAccount(seedPhrase, {
            accountIndex: 0,
            addressIndex: 0,
          }).address;
          const cachedBase =
            cachedAddresses['base'] ??
            cachedAddresses['ethereum'] ??
            cachedAddresses['arbitrum'] ??
            cachedAddresses['polygon'];
          if (
            cachedBase &&
            cachedBase.toLowerCase() !== derived.toLowerCase()
          ) {
            this.logger.warn(
              `Cached addresses are out of sync with seed for user ${userId}. ` +
                `Clearing cache and regenerating.`,
            );
            await this.addressCacheRepository.clearAddresses(userId);
            this.addressCache.delete(userId);
            cachedAddresses = {};
            cacheInvalidated = true;
          } else {
            // We have all addresses cached and seed matches, return immediately
            this.logger.debug(
              `Returning cached addresses from DB for user ${userId}`,
            );
            const partialResult =
              this.mapCachedAddressesToWalletAddresses(cachedAddresses);
            const result = this.ensureCompleteAddresses(partialResult);
            const metadata = this.buildMetadata(result);

            // Update in-memory cache
            this.addressCache.set(userId, {
              addresses: result,
              metadata,
              timestamp: Date.now(),
            });

            return result;
          }
        }
      }
    }

    // Ensure wallet exists
    const hasSeed = await this.seedManager.hasSeed(userId);
    if (!hasSeed) {
      this.logger.debug(`No wallet found for user ${userId}. Auto-creating...`);
      await this.seedManager.createOrImportSeed(userId, 'random');
      this.logger.debug(`Successfully auto-created wallet for user ${userId}`);
    }

    const seedPhrase = await this.seedManager.getSeed(userId);

    // Start with cached addresses, then generate missing ones
    const cachedPartial = cacheInvalidated
      ? ({} as WalletAddresses)
      : this.mapCachedAddressesToWalletAddresses(cachedAddresses);
    const addresses: Partial<WalletAddresses> = { ...cachedPartial };
    const addressesToSave: Record<string, string> = {};

    // EOA chains
    const evmChains: Array<
      'ethereum' | 'base' | 'arbitrum' | 'polygon' | 'avalanche'
    > = ['ethereum', 'base', 'arbitrum', 'polygon', 'avalanche'];

    for (const chain of evmChains) {
      if (addresses[chain]) {
        continue;
      }

      try {
        // Use EIP-7702 factory for enabled chains (same address as EOA), else native EOA
        // Only enable EIP-7702 for supported chains: ethereum, base, arbitrum, optimism
        const supportedEip7702Chains = [
          'ethereum',
          'base',
          'arbitrum',
          'optimism',
        ];
        const useEip7702 =
          this.pimlicoConfig.isEip7702Enabled(chain) &&
          supportedEip7702Chains.includes(chain);

        let account;
        try {
          if (useEip7702) {
            account = await this.eip7702AccountFactory.createAccount(
              seedPhrase,
              chain as 'ethereum' | 'base' | 'arbitrum' | 'optimism',
              0,
            );
          } else {
            account = await this.nativeEoaFactory.createAccount(
              seedPhrase,
              chain,
              0,
            );
          }
        } catch (innerError) {
          // If EIP-7702 fails, fall back to native EOA (addresses are the same)
          if (useEip7702) {
            this.logger.warn(
              `EIP-7702 creation failed for ${chain}, falling back to Native EOA: ${innerError instanceof Error ? innerError.message : 'Unknown error'}`,
            );
            account = await this.nativeEoaFactory.createAccount(
              seedPhrase,
              chain,
              0,
            );
          } else {
            throw innerError;
          }
        }

        const address =
          typeof account.getAddress === 'function'
            ? await account.getAddress()
            : account.address;

        addresses[chain] = address;
        addressesToSave[chain] = address as string;
        await this.addressCacheRepository.saveAddress(userId, chain, address);
      } catch (error) {
        this.logger.error(
          `Error getting EVM address for ${chain}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
        addresses[chain] = null as any;
      }
    }

    const result = addresses as WalletAddresses;
    const metadata = this.buildMetadata(result);

    // Update in-memory cache
    this.addressCache.set(userId, {
      addresses: result,
      metadata,
      timestamp: Date.now(),
    });
    this.logFinalAddresses(userId, metadata);

    return result;
  }

  async getManagedAddresses(userId: string): Promise<{
    addresses: WalletAddresses;
    metadata: WalletAddressMetadataMap;
  }> {
    await this.getAddresses(userId);
    const cached = this.addressCache.get(userId);
    if (!cached) {
      throw new Error('Address cache missing after retrieval');
    }
    return { addresses: cached.addresses, metadata: cached.metadata };
  }

  /**
   * Get address for a specific chain
   */
  async getAddressForChain(
    userId: string,
    chain: AllChainTypes,
  ): Promise<string> {
    const addresses = await this.getAddresses(userId);
    const address = addresses[chain as keyof WalletAddresses];

    if (!address) {
      throw new Error(`No address found for chain: ${chain}`);
    }

    return address;
  }
  private async resolveEvmAddress(account: any): Promise<string> {
    if (account && typeof account.getAddress === 'function') {
      return await account.getAddress();
    }

    if (account && typeof account.address === 'string') {
      return account.address;
    }

    throw new Error('Invalid EVM account object');
  }

  /**
   * Stream addresses progressively (for SSE)
   * Fast path: Streams cached addresses from database first (instant)
   * Then generates and streams missing addresses as they're created
   */
  async *streamAddresses(
    userId: string,
  ): AsyncGenerator<{ chain: string; address: string | null }, void, unknown> {
    // Ensure wallet exists
    const hasSeed = await this.seedManager.hasSeed(userId);
    if (!hasSeed) {
      this.logger.debug(`No wallet found for user ${userId}. Auto-creating...`);
      await this.seedManager.createOrImportSeed(userId, 'random');
      this.logger.debug(`Successfully auto-created wallet for user ${userId}`);
    }

    // Step 1: Fetch all cached addresses from database (instant)
    const cachedAddresses =
      await this.addressCacheRepository.getCachedAddresses(userId);
    this.logger.debug(
      `Found ${Object.keys(cachedAddresses).length} cached addresses for user ${userId}`,
    );

    // Step 2: Stream all cached addresses immediately
    const allExpectedChains = this.getAllExpectedChainNames();
    for (const chain of allExpectedChains) {
      if (cachedAddresses[chain]) {
        yield { chain, address: cachedAddresses[chain] };
      }
    }

    // Step 3: Determine which addresses are missing
    const missingChains = allExpectedChains.filter(
      (chain) => !cachedAddresses[chain],
    );

    if (missingChains.length === 0) {
      // All addresses are cached, we're done
      return;
    }

    this.logger.debug(
      `Generating ${missingChains.length} missing addresses for user ${userId}`,
    );

    // Step 4: Generate missing addresses
    const seedPhrase = await this.seedManager.getSeed(userId);

    // Process EVM chains (native/EIP-7702)
    const evmChains: {
      name: WalletAddressKey;
      chain: 'ethereum' | 'base' | 'arbitrum' | 'polygon' | 'avalanche';
    }[] = [
      { name: 'ethereum', chain: 'ethereum' },
      { name: 'base', chain: 'base' },
      { name: 'arbitrum', chain: 'arbitrum' },
      { name: 'polygon', chain: 'polygon' },
      { name: 'avalanche', chain: 'avalanche' },
    ];

    for (const { name, chain } of evmChains) {
      if (cachedAddresses[name]) {
        continue;
      }

      try {
        // Only enable EIP-7702 for supported chains: ethereum, base, arbitrum, optimism
        const supportedEip7702Chains = [
          'ethereum',
          'base',
          'arbitrum',
          'optimism',
        ];
        const useEip7702 =
          this.pimlicoConfig.isEip7702Enabled(chain) &&
          supportedEip7702Chains.includes(chain);

        let account;
        try {
          if (useEip7702) {
            account = await this.eip7702AccountFactory.createAccount(
              seedPhrase,
              chain as 'ethereum' | 'base' | 'arbitrum' | 'optimism',
              0,
            );
          } else {
            account = await this.nativeEoaFactory.createAccount(
              seedPhrase,
              chain,
              0,
            );
          }
        } catch (innerError) {
          // If EIP-7702 fails, fall back to native EOA (addresses are the same)
          if (useEip7702) {
            this.logger.warn(
              `EIP-7702 streaming failed for ${name}, falling back to Native EOA: ${innerError instanceof Error ? innerError.message : 'Unknown error'}`,
            );
            account = await this.nativeEoaFactory.createAccount(
              seedPhrase,
              chain,
              0,
            );
          } else {
            throw innerError;
          }
        }

        const address = await this.resolveEvmAddress(account);
        await this.addressCacheRepository.saveAddress(userId, name, address);
        yield { chain: name, address };
      } catch (error) {
        this.logger.error(
          `Error streaming address for ${name}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
        yield { chain: name, address: null };
      }
    }
  }

  /**
   * Invalidate address cache for a user
   */
  invalidateCache(userId: string): void {
    this.addressCache.delete(userId);
  }

  private logFinalAddresses(
    userId: string,
    metadata: WalletAddressMetadataMap,
  ): void {
    const summary = Object.fromEntries(
      Object.entries(metadata).map(([chain, entry]) => [
        chain,
        this.maskAddress(entry.address),
      ]),
    );
    this.logger.debug(
      `Wallet addresses ready for user ${userId}: ${JSON.stringify(summary)}`,
    );
  }

  private maskAddress(address: string | null): string | null {
    if (!address) {
      return null;
    }
    if (address.length <= 10) {
      return address;
    }
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  private buildMetadata(addresses: WalletAddresses): WalletAddressMetadataMap {
    const metadata = {} as WalletAddressMetadataMap;

    const assign = (
      chain: WalletAddressKey,
      kind: WalletAddressKind,
      visible: boolean,
    ) => {
      metadata[chain] = {
        chain,
        address: addresses[chain],
        kind,
        visible,
        label: this.getLabelForChain(chain, kind),
      };
    };

    this.eoaChains.forEach((chain) => assign(chain, 'eoa', true));

    return metadata;
  }

  private getLabelForChain(
    chain: WalletAddressKey,
    kind: WalletAddressKind,
  ): string {
    const baseLabels: Partial<Record<WalletAddressKey, string>> = {
      ethereum: 'Ethereum',
      base: 'Base',
      arbitrum: 'Arbitrum',
      polygon: 'Polygon',
      avalanche: 'Avalanche',
    };

    const label = baseLabels[chain];
    if (label) {
      if (kind === 'eoa') {
        return `${label} (EOA)`;
      }
      return label;
    }
    return chain;
  }

  /**
   * Get all expected chain names that should be cached
   */
  private getAllExpectedChainNames(): string[] {
    return [
      // EOA chains
      'ethereum',
      'base',
      'arbitrum',
      'polygon',
      'avalanche',
    ];
  }

  /**
   * Map cached addresses from database format to WalletAddresses format
   */
  private mapCachedAddressesToWalletAddresses(
    cachedAddresses: Record<string, string>,
  ): Partial<WalletAddresses> {
    const addresses: Partial<WalletAddresses> = {};

    // Map all known chains
    const allChains = this.getAllExpectedChainNames();
    for (const chain of allChains) {
      if (cachedAddresses[chain]) {
        addresses[chain as keyof WalletAddresses] = cachedAddresses[
          chain
        ] as any;
      }
    }

    return addresses;
  }

  /**
   * Ensure all required fields are present in WalletAddresses
   * Fills missing fields with null or empty string as appropriate
   */
  private ensureCompleteAddresses(
    partial: Partial<WalletAddresses>,
  ): WalletAddresses {
    const allChains = this.getAllExpectedChainNames();
    const complete: any = { ...partial };

    // Ensure all required string fields have a value (default to empty string)
    const stringFields: (keyof WalletAddresses)[] = [
      'ethereum',
      'base',
      'arbitrum',
      'polygon',
      'avalanche',
    ];

    for (const field of stringFields) {
      if (complete[field] === undefined || complete[field] === null) {
        complete[field] = '';
      }
    }

    return complete as WalletAddresses;
  }
}
