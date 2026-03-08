/**
 * CUSTODY CONTRACT ADAPTER
 *
 * Infrastructure Layer - External System Integration
 *
 * Handles on-chain custody contract interactions.
 * Deposits funds from wallet to Yellow Network custody contract.
 *
 * Flow:
 * 1. USDC.approve(custodyAddress, amount) - Allow custody to spend
 * 2. Custody.deposit(asset, amount, recipient) - Transfer to custody
 * 3. Yellow Network listens to DepositEvent
 * 4. Unified balance is credited
 *
 * This is the CRITICAL MISSING STEP that credits unified balance.
 */

import { Injectable, BadRequestException } from '@nestjs/common';
import { createPublicClient, createWalletClient, http, Address } from 'viem';
import { base, arbitrum } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import type { IYellowNetworkPort } from '../../application/app-session/ports/yellow-network.port.js';
import { YELLOW_NETWORK_PORT } from '../../application/app-session/ports/yellow-network.port.js';
import { Inject } from '@nestjs/common';
import type { IChannelManagerPort } from '../../application/channel/ports/channel-manager.port.js';
import { CHANNEL_MANAGER_PORT } from '../../application/channel/ports/channel-manager.port.js';
import {
  ICustodyContractPort,
  DepositParams,
  WithdrawParams,
} from '../../application/custody/ports/custody-contract.port.js';

// ERC20 ABI (approve function)
const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

// Custody Contract ABI — matches @erc7824/nitrolite custodyAbi
// deposit(account, token, amount) — NOTE: account is FIRST, token is SECOND, amount is THIRD
const CUSTODY_ABI = [
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    // Returns available (unlocked) balance per account per token.
    // result[i][j] = balance of accounts[i] for tokens[j]
    name: 'getAccountsBalances',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'accounts', type: 'address[]' },
      { name: 'tokens', type: 'address[]' },
    ],
    outputs: [{ name: '', type: 'uint256[][]' }],
  },
] as const;

// Custody contract addresses (Yellow Network - from yellow-sdk-tutorials)
const CUSTODY_ADDRESSES: Record<number, Address> = {
  8453: '0x490fb189DdE3a01B00be9BA5F41e3447FbC838b6' as Address, // Base Mainnet
  42161: '0x...' as Address, // Arbitrum - TODO: Get from Yellow Network docs
  84532: '0x...' as Address, // Base Sepolia (testnet)
};

@Injectable()
export class CustodyContractAdapter implements ICustodyContractPort {
  constructor(
    @Inject(YELLOW_NETWORK_PORT)
    private readonly yellowNetwork: IYellowNetworkPort,
    @Inject(CHANNEL_MANAGER_PORT)
    private readonly channelManager: IChannelManagerPort,
  ) {}

  /**
   * Approve USDC for custody contract
   */
  async approveToken(params: DepositParams): Promise<string> {
    const { userPrivateKey, chainId, tokenAddress, amount } = params;

    const account = privateKeyToAccount(userPrivateKey as `0x${string}`);
    const chain = this.getChain(chainId);

    const publicClient = createPublicClient({
      chain,
      transport: http(),
    });

    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(),
    });

    const nonce = await publicClient.getTransactionCount({
      address: account.address,
      blockTag: 'pending',
    });

    console.log(`Approving ${amount} tokens for custody contract (nonce: ${nonce})...`);

    const custodyAddress = this.getCustodyAddress(chainId);

    const hash = await walletClient.writeContract({
      address: tokenAddress as Address,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [custodyAddress, amount],
      nonce,
    });

    console.log(`✅ Approval transaction: ${hash}`);

    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`✅ Approval confirmed`);

    return hash;
  }

  /**
   * Deposit to custody contract (THE CRITICAL STEP!)
   * This emits DepositEvent that Yellow Network indexes.
   *
   * Fetches the nonce explicitly before submitting to avoid stale-nonce errors
   * that occur when the approve and deposit wallet clients hit different RPC
   * nodes (load balancers) that haven't yet synced the confirmed approve tx.
   */
  async deposit(params: DepositParams): Promise<string> {
    const { userPrivateKey, chainId, tokenAddress, amount, userAddress } =
      params;

    const account = privateKeyToAccount(userPrivateKey as `0x${string}`);
    const chain = this.getChain(chainId);

    // Use a single publicClient for both nonce fetching and receipt waiting.
    const publicClient = createPublicClient({
      chain,
      transport: http(),
    });

    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(),
    });

    // Fetch the latest confirmed nonce so we don't collide with the approve tx.
    // Using 'pending' ensures we get the correct nonce even if the approve tx
    // was submitted seconds ago and is still propagating.
    const nonce = await publicClient.getTransactionCount({
      address: account.address,
      blockTag: 'pending',
    });

    console.log(`Depositing ${amount} tokens to custody contract (nonce: ${nonce})...`);

    const custodyAddress = this.getCustodyAddress(chainId);

    const hash = await walletClient.writeContract({
      address: custodyAddress,
      abi: CUSTODY_ABI,
      functionName: 'deposit',
      args: [
        userAddress as Address, // account (recipient of the custody credit)
        tokenAddress as Address, // token (ERC20 to deposit)
        amount, // amount in token's smallest units
      ],
      nonce,
    });

    console.log(`✅ Deposit transaction: ${hash}`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`✅ Deposit confirmed in block ${receipt.blockNumber}`);
    console.log(
      `Yellow Network will now index this deposit and credit unified balance`,
    );

    return hash;
  }

  /**
   * Approve + Deposit in a single atomic flow.
   *
   * Fetches the nonce ONCE from the RPC node, then submits:
   *   - approve  with nonce N   (broadcast immediately)
   *   - deposit  with nonce N+1 (broadcast immediately after)
   *
   * Both transactions are broadcast before waiting for either to confirm,
   * so there's no window for a load-balanced RPC node to return a stale nonce.
   */
  async approveAndDeposit(
    params: DepositParams,
  ): Promise<{ approveTxHash: string; depositTxHash: string }> {
    const { userPrivateKey, chainId, tokenAddress, amount, userAddress } =
      params;

    const account = privateKeyToAccount(userPrivateKey as `0x${string}`);
    const chain = this.getChain(chainId);
    const custodyAddress = this.getCustodyAddress(chainId);

    // Single publicClient for all RPC reads and receipt waits
    const publicClient = createPublicClient({ chain, transport: http() });
    const walletClient = createWalletClient({ account, chain, transport: http() });

    // Fetch nonce once — all subsequent txs use explicit sequential nonces
    const baseNonce = await publicClient.getTransactionCount({
      address: account.address,
      blockTag: 'pending',
    });

    console.log(`[approveAndDeposit] Base nonce: ${baseNonce}`);

    // --- approve (nonce N) ---
    console.log(`Approving ${amount} tokens for custody contract (nonce: ${baseNonce})...`);
    const approveHash = await walletClient.writeContract({
      address: tokenAddress as Address,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [custodyAddress, amount],
      nonce: baseNonce,
    });
    console.log(`✅ Approval submitted: ${approveHash}`);

    // --- deposit (nonce N+1, broadcast immediately — no need to wait for approve) ---
    const depositNonce = baseNonce + 1;
    console.log(`Depositing ${amount} tokens to custody contract (nonce: ${depositNonce})...`);
    const depositHash = await walletClient.writeContract({
      address: custodyAddress,
      abi: CUSTODY_ABI,
      functionName: 'deposit',
      args: [
        userAddress as Address,
        tokenAddress as Address,
        amount,
      ],
      nonce: depositNonce,
    });
    console.log(`✅ Deposit submitted: ${depositHash}`);

    // Wait for both transactions to be confirmed (in order)
    console.log(`Waiting for approval confirmation...`);
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
    console.log(`✅ Approval confirmed`);

    console.log(`Waiting for deposit confirmation...`);
    const depositReceipt = await publicClient.waitForTransactionReceipt({ hash: depositHash });
    console.log(`✅ Deposit confirmed in block ${depositReceipt.blockNumber}`);

    return { approveTxHash: approveHash, depositTxHash: depositHash };
  }

  /**
   * Withdraw from custody contract back to wallet (ON-CHAIN)
   * This reduces unified balance and returns funds to user
   */
  async withdraw(params: WithdrawParams): Promise<string> {
    const { userPrivateKey, chainId, tokenAddress, amount, userAddress } =
      params;

    const account = privateKeyToAccount(userPrivateKey as `0x${string}`);
    const chain = this.getChain(chainId);

    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(),
    });

    console.log(`Withdrawing ${amount} tokens from custody contract...`);

    const custodyAddress = this.getCustodyAddress(chainId);

    // Custody withdraw ABI — matches @erc7824/nitrolite SDK
    // withdraw(token, amount) — 2 parameters; recipient is implicit msg.sender
    // Include the InsufficientBalance error so viem can decode reverts.
    const CUSTODY_WITHDRAW_ABI = [
      {
        name: 'withdraw',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
          { name: 'token', type: 'address' },
          { name: 'amount', type: 'uint256' },
        ],
        outputs: [],
      },
      {
        name: 'InsufficientBalance',
        type: 'error',
        inputs: [
          { name: 'available', type: 'uint256' },
          { name: 'requested', type: 'uint256' },
        ],
      },
    ] as const;

    try {
      const hash = await walletClient.writeContract({
        address: custodyAddress,
        abi: CUSTODY_WITHDRAW_ABI,
        functionName: 'withdraw',
        args: [tokenAddress as Address, amount],
      });

      console.log(`Withdraw transaction: ${hash}`);

      const publicClient = createPublicClient({
        chain,
        transport: http(),
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      console.log(`Withdraw confirmed in block ${receipt.blockNumber}`);

      return hash;
    } catch (err: any) {
      // Decode InsufficientBalance revert into a human-readable error
      const raw = err?.cause?.raw ?? err?.raw ?? '';
      const sig = typeof raw === 'string' ? raw.slice(0, 10) : '';
      // InsufficientBalance(uint256,uint256) selector = 0xcf479181
      if (sig === '0xcf479181' || err?.cause?.signature === '0xcf479181') {
        // Parse available/requested from revert data
        const decimals = 6;
        let availHuman = '?';
        let reqHuman = '?';
        try {
          const data = typeof raw === 'string' ? raw : '';
          // Remove selector (10 chars = 0x + 8 hex), each uint256 is 64 hex
          const availHex = data.slice(10, 74);
          const reqHex = data.slice(74, 138);
          if (availHex) availHuman = (parseInt(availHex, 16) / 10 ** decimals).toFixed(decimals);
          if (reqHex) reqHuman = (parseInt(reqHex, 16) / 10 ** decimals).toFixed(decimals);
        } catch { /* use defaults */ }
        throw new BadRequestException(
          `Insufficient custody balance. Available: ${availHuman}, requested: ${reqHuman}. ` +
          `You can only withdraw funds that are in the custody contract (not locked in channels).`,
        );
      }
      // Re-throw other errors with a cleaner message
      const msg = err?.shortMessage || err?.message || String(err);
      if (msg.includes('revert')) {
        throw new BadRequestException(
          `Custody withdraw reverted on-chain. Ensure you have sufficient available balance. ` +
          `Close any open channels first to unlock funds.`,
        );
      }
      throw err;
    }
  }

  /**
   * Get available (unlocked) balance from the custody contract (ON-CHAIN).
   * Uses getAccountsBalances(accounts[], tokens[]) view function.
   * Returns the amount NOT currently locked in any payment channel.
   */
  async getAvailableBalance(
    userAddress: string,
    tokenAddress: string,
    chainId: number,
  ): Promise<string> {
    const chain = this.getChain(chainId);
    const custodyAddress = this.getCustodyAddress(chainId);

    const publicClient = createPublicClient({
      chain,
      transport: http(),
    });

    // getAccountsBalances([[userAddress]], [tokenAddress]) → uint256[][]
    // result[0][0] = balance of userAddress for tokenAddress
    const result = await publicClient.readContract({
      address: custodyAddress,
      abi: CUSTODY_ABI,
      functionName: 'getAccountsBalances',
      args: [[userAddress as Address], [tokenAddress as Address]],
    });

    // result is uint256[][] — result[0][0] is the balance (raw, 6 decimals for USDC)
    const rawBalance: bigint = (result as bigint[][])[0]?.[0] ?? BigInt(0);
    const decimals = 6;
    const humanBalance = (Number(rawBalance) / Math.pow(10, decimals)).toFixed(decimals);

    console.log(`[CustodyContractAdapter] Available balance for ${userAddress}: ${rawBalance} raw → ${humanBalance}`);

    return humanBalance;
  }

  /**
   * Get unified balance from Yellow Network
   * NOTE: This queries the off-chain unified balance, NOT custody contract
   */
  async getUnifiedBalance(userAddress: string, asset: string): Promise<string> {
    console.log(`Querying unified balance for ${userAddress}...`);

    // Unified balance is an OFF-CHAIN ledger maintained by Yellow Network.
    // We can only query it after the user authenticated with Yellow Network
    // (POST /app-session/authenticate).
    let balances: Array<{ asset: string; amount: string }>;
    try {
      // Query by account_id to avoid relying on "current authenticated user" on the adapter.
      // Yellow expects lowercase address.
      balances = await this.yellowNetwork.getUnifiedBalance(
        userAddress.toLowerCase(),
      );
    } catch (err) {
      throw new BadRequestException(
        'Not authenticated with Yellow Network. Call POST /app-session/authenticate first, then retry.',
      );
    }

    const normalizedAsset = asset.toLowerCase();
    const match = (balances || []).find(
      (b) => (b.asset || '').toLowerCase() === normalizedAsset,
    );
    return match?.amount ?? '0';
  }

  /**
   * "Bring funds into ledger" without another wallet deposit.
   *
   * We rely on Yellow's channel protocol to credit unified balance from
   * funds that are already present in the custody contract.
   */
  async creditUnifiedBalanceFromCustody(params: {
    userId: string;
    chain: string;
    userAddress: string;
    tokenAddress: string;
    amount: bigint;
  }): Promise<{ channelId: string; credited: boolean }> {
    const { userId, chain, userAddress, tokenAddress, amount } = params;

    const chainIdMap: Record<string, number> = {
      ethereum: 1,
      base: 8453,
      arbitrum: 42161,
      avalanche: 43114,
    };
    const chainId = chainIdMap[chain.toLowerCase()];
    if (!chainId) {
      throw new BadRequestException(`Unsupported chain: ${chain}`);
    }

    // Ensure Yellow auth is established
    await this.yellowNetwork.authenticate(userId, userAddress);

    // Ensure we have an open channel; create a zero-balance one if needed.
    // NOTE: get_channels can return channels not owned by the authenticated wallet;
    // our adapter filters, but as a fallback we also parse the "already exists" error.
    const existing = await this.channelManager.getChannels(userAddress);
    const open = existing.find(
      (ch) => ch.status === 'open' || ch.status === 'active',
    );

    let channelId = open?.channelId;
    if (!channelId) {
      try {
        const created = await this.channelManager.createChannel({
          userAddress,
          chainId,
          tokenAddress,
          initialBalance: 0n,
        });
        channelId = created.channelId;
      } catch (err: any) {
        const msg = String(err?.message ?? '');
        const match = msg.match(/already exists[:\s]+(0x[a-fA-F0-9]{64})/);
        if (!match?.[1]) throw err;
        channelId = match[1];
      }
    }

    // IMPORTANT: This should NOT touch the wallet. resizeChannel is an off-chain
    // operation that moves funds from custody -> unified ledger, assuming funds
    // are already deposited into the custody contract.
    await this.channelManager.resizeChannel({
      channelId,
      chainId,
      amount,
      userAddress,
      tokenAddress,
      participants: [],
    });

    return { channelId, credited: true };
  }

  /**
   * Get custody contract address for chain
   */
  private getCustodyAddress(chainId: number): Address {
    const address = CUSTODY_ADDRESSES[chainId];
    if (!address || address === '0x...') {
      throw new Error(
        `Custody contract address not configured for chain ${chainId}. ` +
          `Please add the Yellow Network custody address to CUSTODY_ADDRESSES.`,
      );
    }
    return address;
  }

  /**
   * Get viem chain config
   */
  private getChain(chainId: number) {
    switch (chainId) {
      case 8453:
        return base;
      case 42161:
        return arbitrum;
      default:
        throw new Error(`Unsupported chain ID: ${chainId}`);
    }
  }
}
