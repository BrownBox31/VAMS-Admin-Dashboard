import { Controller, Post, Body, Get, Patch, UseGuards, Request, Param, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('auth/login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('auth/register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Get('companies')
  @UseGuards(JwtAuthGuard)
  async getAllCompanies(@Request() req: any) {
    if (req.user.role !== 'SUPER_ADMIN') {
      throw new UnauthorizedException('Access denied: Super Admin role required');
    }
    return this.authService.getAllCompanies();
  }

  @Post('companies')
  @UseGuards(JwtAuthGuard)
  async createCompany(@Request() req: any, @Body() data: { name: string; settings?: any }) {
    if (req.user.role !== 'SUPER_ADMIN') {
      throw new UnauthorizedException('Access denied: Super Admin role required');
    }
    return this.authService.createCompany(data.name, data.settings);
  }

  @Patch('companies/:id/status')
  @UseGuards(JwtAuthGuard)
  async toggleCompanyStatus(@Request() req: any, @Param('id') id: string, @Body() data: { isActive: boolean }) {
    if (req.user.role !== 'SUPER_ADMIN') {
      throw new UnauthorizedException('Access denied: Super Admin role required');
    }
    return this.authService.toggleCompanyStatus(id, data.isActive);
  }

  @Get('companies/settings')
  @UseGuards(JwtAuthGuard)
  getSettings(@Request() req: any) {
    const companyId = req.user.role === 'SUPER_ADMIN'
      ? (req.headers['x-company-id'] || req.user.companyId)
      : req.user.companyId;
    return this.authService.getSettings(companyId);
  }

  @Patch('companies/settings')
  @UseGuards(JwtAuthGuard)
  updateSettings(@Request() req: any, @Body() data: any) {
    const companyId = req.user.role === 'SUPER_ADMIN'
      ? (req.headers['x-company-id'] || req.user.companyId)
      : req.user.companyId;
    return this.authService.updateSettings(companyId, data);
  }

  @Get('companies/:companyId/users')
  @UseGuards(JwtAuthGuard)
  getUsers(@Param('companyId') companyId: string) {
    return this.authService.getCompanyUsers(companyId);
  }

  @Get('system/config')
  getSystemConfig() {
    return {
      coreBackendUrl: process.env.CORE_BACKEND_URL || 'http://127.0.0.1:3000/api/v1'
    };
  }
}
