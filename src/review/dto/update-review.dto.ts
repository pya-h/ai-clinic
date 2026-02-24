import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateReviewDto } from './create-review.dto';

/**
 * Only rating, title, overview can be updated. doctorId cannot change.
 */
export class UpdateReviewDto extends PartialType(
  OmitType(CreateReviewDto, ['doctorId'] as const),
) {}
