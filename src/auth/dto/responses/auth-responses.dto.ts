import { ApiProperty } from '@nestjs/swagger';

export class AuthenticatedUserDto {
  @ApiProperty({ description: 'User id in our database', type: 'number' })
  id: number;

  @ApiProperty({ description: 'jwt token of the user', type: 'string' })
  token: string;
}
