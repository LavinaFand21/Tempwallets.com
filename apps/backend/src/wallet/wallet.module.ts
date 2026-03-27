import { Module } from '@nestjs/common';
import { WalletController } from './wallet.controller.js';
import { WalletService } from './wallet.service.js';
import { WalletBalanceService } from './services/wallet-balance.service.js';
import { WalletIdentityService } from './services/wallet-identity.service.js';
import { WalletAddressService } from './services/wallet-address.service.js';
import { WalletAccountService } from './services/wallet-account.service.js';
import { WalletConnectService } from './services/wallet-connect.service.js';
import { WalletTransactionService } from './services/wallet-transaction.service.js';
import { WalletSendService } from './services/wallet-send.service.js';
import { TokenMetadataService } from './services/token-metadata.service.js';
import { ZerionBalanceService } from './services/zerion-balance.service.js';
import { BalanceValidationService } from './services/balance-validation.service.js';
import { ZerionAnyChainService } from './services/zerion-any-chain.service.js';
import { ZerionPortfolioService } from './services/zerion-portfolio.service.js';
import { ZerionStreamService } from './services/zerion-stream.service.js';
import { ZerionChainService } from './services/zerion-chain.service.js';
import { ZerionTokenLookupService } from './services/zerion-token-lookup.service.js';
import { SeedRepository } from './seed.repository.js';
import { ZerionService } from './zerion.service.js';
import { PrismaModule } from '../database/prisma.module.js';
import { CryptoModule } from '../crypto/crypto.module.js';
// Import new modular services
import { ChainConfigService } from './config/chain.config.js';
import { PimlicoConfigService } from './config/pimlico.config.js';
import { SeedManager } from './managers/seed.manager.js';
import { AddressManager } from './managers/address.manager.js';
import { AccountFactory } from './factories/account.factory.js';
import { NativeEoaFactory } from './factories/native-eoa.factory.js';
import { Eip7702AccountFactory } from './factories/eip7702-account.factory.js';
import { Eip7702DelegationRepository } from './repositories/eip7702-delegation.repository.js';
// Import Pimlico service for bundler/paymaster operations
import { PimlicoService } from './services/pimlico.service.js';
// Import Polkadot EVM RPC service
// import { PolkadotEvmRpcService } from './services/polkadot-evm-rpc.service.js';
// Import Token List service
import { TokenListService } from './services/token-list.service.js';
// // Import Substrate module
// import { SubstrateModule } from './substrate/substrate.module.js';
// Import EVM module
import { EvmModule } from './evm/evm.module.js';
// Import cache repositories
import { AddressCacheRepository } from './repositories/address-cache.repository.js';
import { BalanceCacheRepository } from './repositories/balance-cache.repository.js';
import { WalletHistoryRepository } from './repositories/wallet-history.repository.js';
import { WalletMapper } from './mappers/wallet.mapper.js';
@Module({
  imports: [
    PrismaModule,
    CryptoModule,
    // SubstrateModule,
    EvmModule,
  ],
  controllers: [WalletController],
  providers: [
    WalletService,
    WalletBalanceService,
    WalletIdentityService,
    WalletAddressService,
    WalletAccountService,
    WalletConnectService,
    WalletTransactionService,
    WalletSendService,
    TokenMetadataService,
    ZerionBalanceService,
    ZerionAnyChainService,
    ZerionPortfolioService,
    ZerionStreamService,
    ZerionChainService,
    ZerionTokenLookupService,
    BalanceValidationService,
    SeedRepository,
    ZerionService,
    // Configuration services
    ChainConfigService,
    PimlicoConfigService,
    // Managers
    SeedManager,
    AddressManager,
    // Factories
    AccountFactory,
    NativeEoaFactory,
    Eip7702AccountFactory,
    // Delegation repository for EIP-7702
    Eip7702DelegationRepository,
    // Pimlico bundler/paymaster service
    PimlicoService,
    // Polkadot EVM RPC service
    // PolkadotEvmRpcService,
    // Token List service
    TokenListService,
    // Cache repositories
    AddressCacheRepository,
    BalanceCacheRepository,
    WalletHistoryRepository,
    WalletMapper,
  ],
  exports: [
    WalletService,
    WalletBalanceService,
    WalletIdentityService,
    WalletAddressService,
    WalletAccountService,
    WalletConnectService,
    WalletTransactionService,
    WalletSendService,
    TokenMetadataService,
    ZerionBalanceService,
    ZerionAnyChainService,
    ZerionPortfolioService,
    ZerionStreamService,
    ZerionChainService,
    ZerionTokenLookupService,
    BalanceValidationService,
    SeedRepository,
    ZerionService,
    // Configuration services
    ChainConfigService,
    PimlicoConfigService,
    // Export managers and factories for use in other modules if needed
    SeedManager,
    AddressManager,
    AccountFactory,
    NativeEoaFactory,
    Eip7702AccountFactory,
    Eip7702DelegationRepository,
    // Export Pimlico service
    PimlicoService,
    // Export Polkadot EVM RPC service
    // PolkadotEvmRpcService,
    // Export Token List service
    TokenListService,
    // Export cache repositories
    AddressCacheRepository,
    BalanceCacheRepository,
    WalletHistoryRepository,
    WalletMapper,
  ],
})
export class WalletModule {}
