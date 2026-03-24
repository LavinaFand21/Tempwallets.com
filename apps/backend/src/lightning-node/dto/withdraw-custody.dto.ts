import { IsString, IsNotEmpty, IsIn } from 'class-validator';

/**
 * DTO for Withdrawing from Custody Contract
 *
 * Withdraws funds from the Yellow Network custody contract back to
 * the user's on-chain wallet. Requires the channel to be closed first.
 */
export class WithdrawCustodyDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(['base', 'arbitrum', 'ethereum', 'avalanche'])
  chain: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(['usdc', 'usdt'])
  asset: string;

  @IsString()
  @IsNotEmpty()
  amount: string; // Human-readable amount (e.g., "100.0")
}
