import { Injectable, Logger } from '@nestjs/common';
import { IAccountFactory } from '../interfaces/wallet.interfaces.js';
import { IAccount } from '../types/account.types.js';
import { AllChainTypes } from '../types/chain.types.js';
import { NativeEoaFactory } from './native-eoa.factory.js';

/**
 * Account Factory for EOA accounts.
 * Delegates EVM wallet creation to NativeEoaFactory.
 */
@Injectable()
export class AccountFactory implements IAccountFactory {
  private readonly logger = new Logger(AccountFactory.name);

  constructor(private readonly nativeEoaFactory: NativeEoaFactory) {}

  getAccountType(): string {
    return 'EOA';
  }

  async createAccount(
    seedPhrase: string,
    chain: AllChainTypes,
    accountIndex = 0,
  ): Promise<IAccount> {
    const normalizedChain = chain.replace(/Erc4337$/i, '').toLowerCase();

    if (!this.isSupportedEvmChain(normalizedChain)) {
      throw new Error(`Native EOA factory does not support chain: ${chain}`);
    }

    this.logger.debug(
      `Creating native EOA | chain=${normalizedChain} | index=${accountIndex}`,
    );

    return this.nativeEoaFactory.createAccount(
      seedPhrase,
      normalizedChain,
      accountIndex,
    );
  }

  private isSupportedEvmChain(
    chain: string,
  ): chain is
    | 'ethereum'
    | 'base'
    | 'arbitrum'
    | 'polygon'
    | 'avalanche'
    | 'optimism'
    | 'bnb' {
    return [
      'ethereum',
      'base',
      'arbitrum',
      'polygon',
      'avalanche',
      'optimism',
      'bnb',
    ].includes(chain);
  }
}
