import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateConsultationDto {
  @ApiProperty({
    description: 'The DoctorProfile ID (autoincrement Int) to consult with.',
  })
  @IsNotEmpty()
  @IsInt()
  doctorId: number;

  @ApiPropertyOptional({
    description: 'The SOAP note ID linked to this consultation.',
  })
  @IsOptional()
  @IsString()
  soapId?: string;
}
