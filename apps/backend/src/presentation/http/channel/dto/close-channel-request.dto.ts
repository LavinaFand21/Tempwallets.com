/**
 * CLOSE CHANNEL REQUEST DTO
 *
 * Presentation Layer - HTTP Request Validation
 *
 * Validates incoming HTTP requests for closing channels.
 */

import { IsString, IsNotEmpty } from 'class-validator';

export class CloseChannelRequestDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsString()
  @IsNotEmpty()
  chain!: string;

  @IsString()
  @IsNotEmpty()
  channelId!: string;
}
