import { PartialType, OmitType } from '@nestjs/swagger';
import { IntroduceDoctorDto } from './introduce-doctor.dto';

/**
 * All fields from IntroduceDoctorDto become optional.
 * `startedAt` is excluded — cannot be changed after initial profile creation.
 */
export class UpdateDoctorProfileDto extends PartialType(
  OmitType(IntroduceDoctorDto, ['startedAt'] as const),
) {}
