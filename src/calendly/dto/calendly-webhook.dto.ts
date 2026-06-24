import { IsIn, IsNotEmpty, IsObject, IsString } from 'class-validator';

export class CalendlyWebhookDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['invitee.created', 'invitee.canceled', 'routing_form_submission.created'])
  event: string;

  @IsString()
  @IsNotEmpty()
  created_at: string;

  @IsString()
  @IsNotEmpty()
  created_by: string;

  @IsObject()
  @IsNotEmpty()
  payload: Record<string, any>;
}
