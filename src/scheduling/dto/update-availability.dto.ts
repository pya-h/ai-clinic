import { PartialType } from '@nestjs/swagger';
import { CreateAvailabilityDto } from './create-availability.dto';

export class UpdateAvailabilityDto extends PartialType(CreateAvailabilityDto) {}
