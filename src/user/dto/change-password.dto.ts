import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ description: 'Current password' })
  @IsString()
  @IsNotEmpty({ message: 'Current password is required!' })
  currentPassword: string;

  @ApiProperty({ description: 'New password' })
  @IsString()
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{8,}$/, {
    message:
      'Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter and one digit',
  })
  @MaxLength(128)
  @IsNotEmpty({ message: 'New password is required!' })
  newPassword: string;
}
