import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VisitMethodsEnum } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class BookAppointmentDto {
  @ApiProperty({
    description: 'Doctor profile ID (autoincrement int).',
  })
  @IsInt()
  @Min(1)
  doctorId: number;

  @ApiPropertyOptional({
    description:
      'Consultation ID to link this appointment to. Must belong to the patient.',
  })
  @IsOptional()
  @IsUUID()
  consultationId?: string;

  @ApiProperty({
    description: 'Appointment date and time in ISO-8601 format.',
    example: '2026-03-15T10:00:00.000Z',
  })
  @IsString()
  dateTime: string;

  @ApiProperty({
    description: 'Duration in minutes (must match a doctor slot duration).',
    example: 30,
  })
  @IsInt()
  @Min(5)
  durationMinutes: number;

  @ApiProperty({
    description: 'Price for the appointment.',
    example: 50.0,
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price: number;

  @ApiProperty({
    description: 'Visit method for the appointment.',
    enum: VisitMethodsEnum,
  })
  @IsEnum(VisitMethodsEnum)
  method: VisitMethodsEnum;

  @ApiPropertyOptional({ description: 'Patient notes for the appointment.' })
  @IsOptional()
  @IsString()
  notes?: string;
}
