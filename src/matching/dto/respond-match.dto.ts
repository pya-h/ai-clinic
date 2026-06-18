import { IsEnum, IsUUID } from 'class-validator';

export enum MatchResponseAction {
  ACCEPT = 'ACCEPT',
  REJECT = 'REJECT',
}

export class RespondMatchDto {
  @IsUUID()
  matchRequestId: string;

  @IsEnum(MatchResponseAction)
  action: MatchResponseAction;
}
