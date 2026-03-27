/**
 * WITHDRAW FROM CUSTODY DTO
 *
 * Application Layer - Use Case Input/Output
 *
 * Withdraws funds from Yellow Network custody contract back to user's wallet.
 * This is an ON-CHAIN operation that debits the unified balance.
 *
 * Flow: Unified Balance → Custody Contract → Wallet (on-chain)
 */

export class WithdrawFromCustodyDto {
  userId!: string;
  chain!: string;
  asset!: string; // e.g., "usdc"
  amount!: string; // e.g., "0.1"
}

export class WithdrawFromCustodyResultDto {
  success!: boolean;
  withdrawTxHash!: string;
  chainId!: number;
  amount!: string;
  asset!: string;
  unifiedBalance!: string;
  message!: string;
}
