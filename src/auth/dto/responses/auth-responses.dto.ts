import { ApiProperty } from '@nestjs/swagger';

export class AuthenticatedUserDto {
  @ApiProperty({ description: 'User id in our database', type: 'string' })
  id: string;
}
