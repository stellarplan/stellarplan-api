import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { PlanType } from '@prisma/client';

export class CreatePlanDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  @MinLength(1)
  category: string;

  @IsNumber({ maxDecimalPlaces: 7 })
  @Min(0.0000001)
  amount: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  unlockDay?: number;

  @IsOptional()
  @IsEnum(PlanType)
  planType?: PlanType;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  icon?: string;
}

export class UpdatePlanDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 7 })
  @Min(0.0000001)
  amount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  unlockDay?: number;

  @IsOptional()
  @IsEnum(PlanType)
  planType?: PlanType;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  active?: boolean;
}
