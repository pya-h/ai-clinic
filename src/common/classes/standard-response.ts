import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum StandardResponseStatusEnum {
  SUCCESS = 'success',
  ERROR = 'error',
}

export class StandardResponse<T> {
  @ApiProperty({
    enum: StandardResponseStatusEnum,
    enumName: 'StandardResponseStatusEnum',
    description: 'Response status',
    default: StandardResponseStatusEnum.SUCCESS,
  })
  status: StandardResponseStatusEnum;

  @ApiPropertyOptional({
    description: 'Response actual data',
    nullable: true,
  })
  contents?: T;

  @ApiPropertyOptional({
    description:
      'Specific message of the endpoint call; usually for indicating error messages.',
    nullable: true,
  })
  message?: string;

  @ApiPropertyOptional({
    type: Object,
    description: 'Additional fields providing detailed information',
    nullable: true,
  })
  fields?: object;

  constructor(
    status: StandardResponseStatusEnum,
    data?: T,
    message?: string,
    fields?: object,
  ) {
    this.status = status;
    this.contents = data ?? null;
    this.message = message ?? null;
    this.fields = fields ?? null;
  }
}
