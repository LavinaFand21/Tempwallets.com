/**
 * Session Key Authentication for Yellow Network
 *
 * Implements the 3-step authentication flow with Clearnode:
 * 1. auth_request - Register session key with clearnode
 * 2. auth_challenge - Receive challenge from clearnode
 * 3. auth_verify - Prove ownership with EIP-712 signature
 *
 * Key Benefits:
 * - Sign once with main wallet, use session key for all subsequent operations
 * - Set spending allowances per asset
 * - Time-bounded expiration (default: 24h)
 * - No repeated wallet prompts during session
 *
 * Protocol Reference:
 * - Authentication Guide: /Users/monstu/Developer/crawl4Ai/yellow/docs_protocol_off-chain_authentication.md
 */

import {
  generatePrivateKey,
  privateKeyToAccount,
  type PrivateKeyAccount,
} from 'viem/accounts';
import { keccak256, toBytes, toHex, getAddress } from 'viem';
import type { Address } from 'viem';
import type { WebSocketManager } from './websocket-manager.js';
import type {
  AuthRequestParams,
  AuthChallengeResponse,
  AuthVerifyParams,
  AuthVerifyResponse,
  AuthPolicyTypedData,
  SessionKeyAllowance,
  RPCRequest,
  RPCRequestArray,
} from './types.js';

/**
 * Session Key Data
 */
interface SessionKeyData {
  account: PrivateKeyAccount; // Session key account (address + signer)
  privateKey: string; // Session key private key (for SDK signing)
  jwtToken: string; // JWT token from clearnode
  expiresAt: number; // Expiration timestamp (ms)
  allowances: SessionKeyAllowance[]; // Spending limits
  application: string; // Application identifier
  authSignature?: string; // Main wallet signature from auth_verify
}

/**
 * Main Wallet Interface
 * User's main wallet that owns the funds
 */
export interface MainWallet {
  address: Address;
  signTypedData(typedData: AuthPolicyTypedData): Promise<string>;
}

/**
 * Session Key Authentication Manager
 *
 * Handles session key generation, authentication, and request signing
 */
export class SessionKeyAuth {
  private sessionKey: SessionKeyData | null = null;
  private mainWallet: MainWallet;
  private ws: WebSocketManager;

  constructor(mainWallet: MainWallet, ws: WebSocketManager) {
    this.mainWallet = mainWallet;
    this.ws = ws;
  }

  /**
   * Authenticate with Clearnode using session key flow
   *
   * @param options - Authentication options
   * @returns Authentication result with JWT token
   */
  async authenticate(options?: {
    allowances?: SessionKeyAllowance[];
    application?: string;
    expiryHours?: number;
    scope?: string;
  }): Promise<AuthVerifyResponse> {
    const {
      allowances = [],
      application = 'tempwallets-lightning',
      expiryHours = 24,
      scope = 'transfer,app.create,app.submit,channel.create,channel.update,channel.close',
    } = options || {};

    // OPTIMIZATION: Skip re-authentication if session is still valid
    // Check if we have an existing session that hasn't expired
    if (this.sessionKey && this.isAuthenticated()) {
      // Return cached authentication result
      return {
        success: true,
        jwt_token: this.sessionKey.jwtToken,
        address: this.mainWallet.address,
        session_key: this.sessionKey.account.address,
      };
    }

    // Step 1: Generate session key
    const { account: sessionKeyAccount, privateKey: sessionKeyPrivateKey } =
      this.generateSessionKey();
    const expiresAtMs = Date.now() + expiryHours * 60 * 60 * 1000;
    const expiresAtSeconds = Math.floor(expiresAtMs / 1000);

    // Step 2: auth_request - Register session key
    // Ensure addresses are properly checksummed
    const mainWalletAddress = getAddress(this.mainWallet.address);
    const sessionKeyAddress = getAddress(sessionKeyAccount.address);

    const authParams: AuthRequestParams = {
      address: mainWalletAddress,
      session_key: sessionKeyAddress,
      application,
      allowances,
      scope,
      expires_at: expiresAtSeconds,
    };

    const requestId1 = this.ws.getNextRequestId();
    const authRequest: RPCRequest = {
      req: [requestId1, 'auth_request', authParams, Date.now()],
      sig: [] as string[], // Public method - no signature
    };

    const challengeResponse = await this.ws.send(authRequest);
    const challengeData = challengeResponse.res[2] as AuthChallengeResponse;
    const challengeMessage = challengeData.challenge_message;

    // Step 3a: Sign challenge with session key
    const sessionKeySig = await this.signWithSessionKey(
      sessionKeyAccount,
      challengeMessage,
    );

    // Step 3b: Build EIP-712 typed data for main wallet signature
    const typedData = this.buildAuthTypedData(authParams, challengeMessage);

    // Sign with main wallet
    const mainWalletSig = await this.mainWallet.signTypedData(typedData);

    // Step 4: auth_verify - Submit signatures
    const verifyParams: AuthVerifyParams = {
      challenge: challengeMessage,
      session_key_sig: sessionKeySig,
    };

    const requestId2 = this.ws.getNextRequestId();
    const verifyRequest: RPCRequest = {
      req: [requestId2, 'auth_verify', verifyParams, Date.now()],
      sig: [mainWalletSig] as string[], // Main wallet signature
    };

    try {
      const verifyResponse = await this.ws.send(verifyRequest);
      const responseData = verifyResponse.res[2];
      const isErrorResponse = verifyResponse.res[1] === 'error';
      const hasSuccess =
        !isErrorResponse &&
        (responseData as AuthVerifyResponse).success === true;

      if (isErrorResponse || !hasSuccess) {
        console.error('[SessionKeyAuth] Authentication failed:', responseData);
        throw new Error(
          `Authentication failed: ${JSON.stringify(responseData)}`,
        );
      }

      const authResult = responseData as AuthVerifyResponse;

      // Store session key data
      this.sessionKey = {
        account: sessionKeyAccount,
        privateKey: sessionKeyPrivateKey,
        jwtToken: authResult.jwt_token,
        expiresAt: expiresAtMs,
        allowances,
        application,
        authSignature: mainWalletSig,
      };

      console.log(
        `[SessionKeyAuth] ✅ Authentication successful, expires=${new Date(expiresAtMs).toISOString()}`,
      );

      return authResult;
    } catch (error) {
      console.error('[SessionKeyAuth] Authentication error:', error);
      throw error;
    }
  }

  /**
   * Remove undefined values from objects (needed for consistent hashing)
   */
  private cleanParams(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.cleanParams(item));
    }
    if (typeof obj === 'object') {
      const cleaned: any = {};
      for (const key in obj) {
        if (obj[key] !== undefined) {
          cleaned[key] = this.cleanParams(obj[key]);
        }
      }
      return cleaned;
    }
    return obj;
  }

  /**
   * Validate that session key exists and has not expired.
   * Throws if not authenticated or expired.
   */
  private ensureSession(): void {
    if (!this.sessionKey) {
      throw new Error('Not authenticated. Call authenticate() first.');
    }
    if (Date.now() >= this.sessionKey.expiresAt) {
      throw new Error('Session expired. Please re-authenticate.');
    }
  }

  /**
   * Sign an RPC request with session key
   *
   * @param request - RPC request to sign
   * @returns Signed request with session key signature
   */
  async signRequest(request: RPCRequest): Promise<RPCRequest> {
    this.ensureSession();

    const cleanedReq = this.cleanParams(request.req);
    const messageHash = keccak256(toBytes(JSON.stringify(cleanedReq)));

    // CRITICAL: Use raw signing to avoid EIP-191 prefix.
    // Yellow Network expects raw ECDSA over the hash, not EIP-191 prefixed.
    const signature = await this.sessionKey!.account.sign({
      hash: messageHash,
    });

    return {
      ...request,
      sig: [signature],
    };
  }

  /**
   * Sign a raw request payload and return ONLY the signature string.
   *
   * Used for multi-party signing: the primary signer calls signRequest(),
   * additional signers call signPayload() on the same req array, and
   * all signatures are combined into the sig[] array before sending.
   *
   * @param reqArray - The req array (same format as RPCRequest.req)
   * @returns Hex-encoded ECDSA signature
   */
  async signPayload(reqArray: RPCRequestArray): Promise<string> {
    this.ensureSession();

    const cleanedReq = this.cleanParams(reqArray);
    const messageHash = keccak256(toBytes(JSON.stringify(cleanedReq)));

    return await this.sessionKey!.account.sign({ hash: messageHash });
  }

  /**
   * Check if authenticated and session is valid
   */
  isAuthenticated(): boolean {
    return this.sessionKey !== null && Date.now() < this.sessionKey.expiresAt;
  }

  /**
   * Get session key JWT token
   */
  getJwtToken(): string | null {
    return this.sessionKey?.jwtToken || null;
  }

  /**
   * Get session key address
   */
  getSessionKeyAddress(): Address | null {
    return this.sessionKey?.account.address || null;
  }

  /**
   * Get authentication signature
   */
  getAuthSignature(): string | null {
    return this.sessionKey?.authSignature || null;
  }

  /**
   * Get session key private key (for SDK signing)
   */
  getSessionKeyPrivateKey(): `0x${string}` {
    if (!this.sessionKey) {
      throw new Error('Session key not available');
    }
    return this.sessionKey.privateKey as `0x${string}`;
  }

  /**
   * Get session expiration timestamp
   */
  getExpiresAt(): number | null {
    return this.sessionKey?.expiresAt || null;
  }

  /**
   * Clear session key (logout)
   */
  clearSession(): void {
    console.log('[SessionKeyAuth] Clearing session');
    this.sessionKey = null;
  }

  /**
   * Check if session is about to expire (within 1 hour)
   */
  isSessionExpiringSoon(): boolean {
    if (!this.sessionKey) return false;
    const oneHour = 60 * 60 * 1000;
    return this.sessionKey.expiresAt - Date.now() < oneHour;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Generate a new session key pair
   */
  private generateSessionKey(): {
    account: PrivateKeyAccount;
    privateKey: string;
  } {
    const privateKey = generatePrivateKey();
    return {
      account: privateKeyToAccount(privateKey),
      privateKey,
    };
  }

  /**
   * Sign challenge message with session key
   */
  private async signWithSessionKey(
    sessionKeyAccount: PrivateKeyAccount,
    challengeMessage: string,
  ): Promise<string> {
    const signature = await sessionKeyAccount.signMessage({
      message: challengeMessage,
    });
    return signature;
  }

  /**
   * Build EIP-712 typed data for main wallet signature
   */
  private buildAuthTypedData(
    authParams: AuthRequestParams,
    challengeMessage: string,
  ): AuthPolicyTypedData {
    const typedData: AuthPolicyTypedData = {
      types: {
        EIP712Domain: [{ name: 'name', type: 'string' }],
        Policy: [
          { name: 'challenge', type: 'string' },
          { name: 'scope', type: 'string' },
          { name: 'wallet', type: 'address' },
          { name: 'session_key', type: 'address' },
          { name: 'expires_at', type: 'uint64' },
          { name: 'allowances', type: 'Allowance[]' },
        ],
        Allowance: [
          { name: 'asset', type: 'string' },
          { name: 'amount', type: 'string' },
        ],
      },
      primaryType: 'Policy',
      domain: {
        name: authParams.application || 'tempwallets-lightning',
      },
      message: {
        challenge: challengeMessage,
        scope:
          authParams.scope ||
          'transfer,app.create,app.submit,channel.create,channel.update,channel.close',
        wallet: getAddress(authParams.address), // Ensure checksummed
        session_key: getAddress(authParams.session_key), // Ensure checksummed
        expires_at: authParams.expires_at,
        allowances: authParams.allowances || [],
      },
    };

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/005b81a7-88d6-4d11-8cdb-3c666a545d81', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        location: 'session-auth.ts:350',
        message: 'Built typed data - structure check',
        data: {
          typedDataStructure: JSON.stringify(typedData),
          domainName: typedData.domain.name,
          primaryType: typedData.primaryType,
          messageWallet: typedData.message.wallet,
          messageSessionKey: typedData.message.session_key,
          messageExpiresAt: typedData.message.expires_at,
          messageAllowancesLength: typedData.message.allowances.length,
        },
        timestamp: Date.now(),
        sessionId: 'debug-session',
        runId: 'run1',
        hypothesisId: 'B',
      }),
    }).catch(() => {});
    // #endregion

    return typedData;
  }
}

/**
 * Main Wallet Auth (Alternative to Session Keys)
 *
 * Signs every request with main wallet instead of using session keys.
 * Provides maximum security but requires user interaction for each operation.
 *
 * Use this for:
 * - Single operations
 * - High-value transactions
 * - When maximum security is required
 */
export class MainWalletAuth {
  private mainWallet: MainWallet;

  constructor(mainWallet: MainWallet) {
    this.mainWallet = mainWallet;
  }

  /**
   * Sign an RPC request with main wallet
   *
   * @param request - RPC request to sign
   * @returns Signed request with main wallet signature
   */
  async signRequest(request: RPCRequest): Promise<RPCRequest> {
    // Helper function to remove undefined values from objects
    const cleanParams = (obj: any): any => {
      if (obj === null || obj === undefined) {
        return obj;
      }
      if (Array.isArray(obj)) {
        return obj.map(cleanParams);
      }
      if (typeof obj === 'object') {
        const cleaned: any = {};
        for (const key in obj) {
          if (obj[key] !== undefined) {
            cleaned[key] = cleanParams(obj[key]);
          }
        }
        return cleaned;
      }
      return obj;
    };

    // Clean params to remove undefined values
    const cleanedParams = cleanParams(request.req[2]);

    // Build EIP-712 typed data for RPC request
    const typedData = {
      types: {
        EIP712Domain: [{ name: 'name', type: 'string' }],
        Request: [
          { name: 'requestId', type: 'uint256' },
          { name: 'method', type: 'string' },
          { name: 'params', type: 'string' },
          { name: 'timestamp', type: 'uint256' },
        ],
      },
      primaryType: 'Request' as const,
      domain: {
        name: 'Clearnode',
      },
      message: {
        requestId: request.req[0],
        method: request.req[1],
        params: JSON.stringify(cleanedParams),
        timestamp: request.req[3],
      },
    };

    const signature = await this.mainWallet.signTypedData(typedData as any);

    return {
      ...request,
      sig: [signature],
    };
  }

  /**
   * Check if authenticated (always true for main wallet)
   */
  isAuthenticated(): boolean {
    return true;
  }
}
