/**
 * CLOSE CHANNEL DTO
 *
 * Application Layer - Use Case Input/Output
 *
 * Closes a 2-party payment channel.
 * Moves funds from payment channel back to unified balance.
 *
 * Flow: Payment Channel → Unified Balance (available in custody contract)
 */

export class CloseChannelDto {
  userId!: string;
  chain!: string;
  channelId!: string;
}

export class CloseChannelResultDto {
  success!: boolean;
  channelId!: string;
  chainId!: number;
  message!: string;
}
