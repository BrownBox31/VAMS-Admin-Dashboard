import { IsString, IsNotEmpty, IsOptional, IsArray } from 'class-validator';

export class CreateBroadcastDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  message: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  targetUserIds?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  targetRoles?: string[];
}
