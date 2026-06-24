import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsUUID, Min } from 'class-validator';

export class CreateConsultationDto {
  @ApiProperty({
    description: 'The DoctorProfile ID (autoincrement Int) to consult with.',
  })
  @IsNotEmpty()
  @IsInt()
  @Min(1)
  doctorId: number;

  @ApiPropertyOptional({
    description: 'The SOAP note ID linked to this consultation.',
  })
  @IsOptional()
  @IsUUID()
  soapId?: string;
}
