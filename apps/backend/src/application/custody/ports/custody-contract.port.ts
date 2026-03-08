/**
 * CUSTODY CONTRACT PORT (INTERFACE)
 *
 * Application Layer - Defines contract for custody operations
 *
 * Custody operations are ON-CHAIN transactions that move funds
 * between user's wallet and Yellow Network's custody contract.
 *
 * This creates/updates the "unified balance" in Yellow Network.
 */

export interface DepositParams {
  userPrivateKey: string;
  userAddress: string;
  tokenAddress: string;
  amount: bigint;
  chainId: number;
}

export interface WithdrawParams {
  userPrivateKey: string;
  userAddress: string;
  tokenAddress: string;
  amount: bigint;
  chainId: number;
}

export interface ICustodyContractPort {
  /**
   * Approve USDC/USDT spending for custody contract
   */
  approveToken(params: DepositParams): Promise<string>;

  /**
   * Deposit funds to custody contract (creates unified balance)
   * This is an on-chain transaction
   */
  deposit(params: DepositParams): Promise<string>;

  /**
   * Approve + Deposit in a single atomic flow.
   *
   * Fetches the account nonce once and submits approve (nonce N) then
   * deposit (nonce N+1) sequentially using the same client — avoids the
   * "nonce too low" race that occurs when two separate calls each query the
   * nonce from load-balanced RPC nodes that may not be in sync.
   *
   * Returns { approveTxHash, depositTxHash }
   */
  approveAndDeposit(params: DepositParams): Promise<{ approveTxHash: string; depositTxHash: string }>;

  /**
   * Withdraw funds from custody contract back to wallet
   * This is an on-chain transaction
   */
  withdraw(params: WithdrawParams): Promise<string>;

  /**
   * Get unified balance from Yellow Network
   */
  getUnifiedBalance(userAddress: string, asset: string): Promise<string>;

  /**
   * Get available balance from custody contract (on-chain).
   * This is the amount NOT locked in any channel — free to withdraw.
   * Uses getAccountsBalances(accounts[], tokens[]) view function.
   */
  getAvailableBalance(
    userAddress: string,
    tokenAddress: string,
    chainId: number,
  ): Promise<string>;

  /**
   * Trigger the "bring funds into ledger" step.
   *
   * This MUST NOT deposit from the user's wallet again.
   * It should use Yellow Network channel operations (create/resize) to
   * make Yellow index/credit funds that are already in the custody contract.
   */
  creditUnifiedBalanceFromCustody(params: {
    userId: string;
    chain: string;
    userAddress: string;
    tokenAddress: string;
    amount: bigint;
  }): Promise<{ channelId: string; credited: boolean }>;
}

/**
 * Dependency injection token
 */
export const CUSTODY_CONTRACT_PORT = Symbol('CUSTODY_CONTRACT_PORT');
