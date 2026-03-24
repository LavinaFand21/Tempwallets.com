import { Injectable, Logger } from '@nestjs/common';
import { PimlicoConfigService } from '../config/pimlico.config.js';
import { AccountFactory } from '../factories/account.factory.js';
import { NativeEoaFactory } from '../factories/native-eoa.factory.js';
import { Eip7702AccountFactory } from '../factories/eip7702-account.factory.js';
import { AllChainTypes } from '../types/chain.types.js';
import { IAccount } from '../types/account.types.js';

@Injectable()
export class WalletAccountService {
  private readonly logger = new Logger(WalletAccountService.name);

  constructor(
    private readonly pimlicoConfig: PimlicoConfigService,
    private readonly accountFactory: AccountFactory,
    private readonly nativeEoaFactory: NativeEoaFactory,
    private readonly eip7702AccountFactory: Eip7702AccountFactory,
  ) {}

  /**
   * Create an account instance using appropriate factory based on chain type
   * @param seedPhrase - The mnemonic seed phrase
   * @param chain - The blockchain network
   * @returns Account instance implementing IAccount interface
   */
  async createAccountForChain(
    seedPhrase: string,
    chain: AllChainTypes,
    userId?: string,
  ): Promise<IAccount> {
    const eip7702Chains: AllChainTypes[] = [
      'ethereum',
      'base',
      'arbitrum',
      'optimism',
    ];

    const isEip7702 =
      this.pimlicoConfig.isEip7702Enabled(chain) &&
      eip7702Chains.includes(chain);

    if (isEip7702) {
      return this.eip7702AccountFactory.createAccount(
        seedPhrase,
        chain as 'ethereum' | 'base' | 'arbitrum' | 'optimism',
        0,
        userId,
      );
    }

    const evmChains: AllChainTypes[] = [
      'ethereum',
      'base',
      'arbitrum',
      'optimism',
      'polygon',
      'avalanche',
      'bnb',
    ];

    if (evmChains.includes(chain)) {
      return this.nativeEoaFactory.createAccount(
        seedPhrase,
        chain as 'ethereum' | 'base' | 'arbitrum' | 'polygon' | 'avalanche',
        0,
      );
    }

    return this.accountFactory.createAccount(seedPhrase, chain, 0);
  }

  /**
   * Check if a smart account is deployed on-chain
   * @param account - WDK account instance
   * @returns true if account is deployed, false otherwise
   */
  async checkIfDeployed(account: any): Promise<boolean> {
    try {
      const address = await account.getAddress();

      // Get provider from account
      let provider: any = null;
      if ('provider' in account) {
        provider = account.provider;
      } else if (
        'getProvider' in account &&
        typeof account.getProvider === 'function'
      ) {
        provider = await account.getProvider();
      }

      if (!provider || typeof provider.request !== 'function') {
        this.logger.warn(
          `Cannot check deployment status: provider not available for address ${address}`,
        );
        return false;
      }

      // Check if contract code exists at address
      const code = await provider.request({
        method: 'eth_getCode',
        params: [address, 'latest'],
      });

      const isDeployed = code && code !== '0x' && code !== '0x0';

      this.logger.log(
        `[Deployment Check] Address: ${address}, deployed: ${isDeployed}, code length: ${code?.length || 0}`,
      );

      return isDeployed;
    } catch (e) {
      this.logger.error(
        `Failed to check deployment status: ${e instanceof Error ? e.message : 'Unknown error'}`,
      );
      return false;
    }
  }

  /**
   * Deploy an ERC-4337 smart account using UserOperation
   * @param account - WDK ERC-4337 account instance
   * @param address - Account address
   * @param chain - Internal chain name
   * @returns Promise that resolves when deployment is complete
   */
  async deployErc4337Account(
    account: any,
    address: string,
    chain: string,
  ): Promise<void> {
    this.logger.log(
      `[Deploy] Starting deployment for ERC-4337 account ${address} on ${chain}`,
    );

    try {
      // Method 1: Try deployAccount() if available
      if (
        'deployAccount' in account &&
        typeof account.deployAccount === 'function'
      ) {
        await account.deployAccount();
        return;
      }

      // Method 2: Try deploy() if available
      if ('deploy' in account && typeof account.deploy === 'function') {
        await account.deploy();
        return;
      }

      // Method 3: Send a zero-value transaction to self to trigger deployment
      // ERC-4337 accounts typically auto-deploy on first UserOperation
      if ('send' in account && typeof account.send === 'function') {
        await account.send(address, '0');

        // Wait a bit for deployment to be confirmed
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Verify deployment
        const isNowDeployed = await this.checkIfDeployed(account);
        if (!isNowDeployed) {
          throw new Error(
            'Deployment transaction sent but account not deployed yet. Please try again in a moment.',
          );
        }
        return;
      }

      // Method 4: Try transfer with structured params
      if ('transfer' in account && typeof account.transfer === 'function') {
        this.logger.debug(
          `[Deploy] Using account.transfer() to trigger deployment`,
        );
        const result = await account.transfer({
          to: address,
          amount: 0,
        });
        this.logger.log(
          `[Deploy] Deployment triggered via transfer: ${JSON.stringify(result)}`,
        );

        // Wait for deployment confirmation
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Verify deployment
        const isNowDeployed = await this.checkIfDeployed(account);
        if (!isNowDeployed) {
          throw new Error(
            'Deployment transaction sent but account not deployed yet. Please try again in a moment.',
          );
        }
        return;
      }

      // If no deployment method found, throw error
      throw new Error(
        `No deployment method available for ERC-4337 account. ` +
          `Account type may not support auto-deployment. ` +
          `Available methods: ${Object.keys(account)
            .filter((k) => typeof account[k] === 'function')
            .join(', ')}`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`[Deploy] Deployment failed: ${errorMessage}`);
      throw error;
    }
  }
}
