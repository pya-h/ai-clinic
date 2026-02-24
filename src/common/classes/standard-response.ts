import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StandardResponse<T> {
  @ApiProperty({
    description: 'HTTP status code',
    example: 200,
    type: 'number',
  })
  status: number;

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
    status: number,
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
