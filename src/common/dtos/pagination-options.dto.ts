import { IsNumberString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PaginationOptionsDto {
  @ApiProperty({
    description: 'The index of item to start fetching items from.',
    required: false,
  })
  @IsOptional()
  @IsNumberString()
  skip: number;

  @ApiProperty({
    description: 'Max number of items to be fetched.',
    required: false,
  })
  @IsOptional()
  @IsNumberString()
  take: number;
}
