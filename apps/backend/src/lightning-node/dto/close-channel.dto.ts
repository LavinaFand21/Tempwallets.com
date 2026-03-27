import { IsString, IsNotEmpty, IsIn } from 'class-validator';

/**
 * DTO for Closing a Payment Channel
 *
 * Closes the user's payment channel on a given chain, returning funds
 * from the channel to the unified balance.
 */
export class CloseChannelDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(['base', 'arbitrum', 'ethereum', 'avalanche'])
  chain: string;
}
