import { Injectable, UnauthorizedException, ConflictException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async login(dto: any) {
    const email = dto.email.trim().toLowerCase();
    
    // Resolve Company first if company name or ID is passed (supports both companyId and companyIdOrName)
    let targetCompanyId = dto.companyIdOrName || dto.companyId;
    if (targetCompanyId) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetCompanyId);
      if (!isUuid) {
        const comp = await this.prisma.company.findFirst({
          where: { name: { equals: targetCompanyId, mode: 'insensitive' } },
        });
        if (comp) {
          targetCompanyId = comp.id;
        }
      }
    }

    const user = await this.prisma.user.findFirst({
      where: {
        email: { equals: email, mode: 'insensitive' },
        ...(targetCompanyId ? { companyId: targetCompanyId } : {}),
      },
      include: { company: true },
    });

    // Support both password and passwordHash
    const incomingPassword = dto.passwordHash || dto.password;
    if (!user || user.passwordHash !== incomingPassword || !user.isActive || !user.company.isActive) {
      throw new UnauthorizedException('Invalid login credentials or account/tenant suspended');
    }

    const payload = { 
      sub: user.id, 
      email: user.email, 
      role: user.role, 
      companyId: user.companyId,
      companyName: user.company.name,
      companyCode: user.company.name,
    };
    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        companyId: user.companyId,
        companyName: user.company.name,
        companyCode: user.company.name,
      },
    };
  }

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    const companyIdOrName = dto.companyId.trim();

    // Check if the input is a valid UUID
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(companyIdOrName);
    let company: any = null;

    if (isUuid) {
      company = await this.prisma.company.findUnique({
        where: { id: companyIdOrName },
        include: { settings: true },
      });
    }

    if (!company) {
      company = await this.prisma.company.findFirst({
        where: { name: { equals: companyIdOrName, mode: 'insensitive' } },
        include: { settings: true },
      });
    }

    // Auto-create company & default settings if it doesn't exist
    if (!company) {
      company = await this.prisma.$transaction(async (tx) => {
        const newComp = await tx.company.create({
          data: { name: companyIdOrName },
        });
        const defaultRulebook = {
          workerAlertsEnabled: true,
          categoriesEnabled: ["Brake System", "Engine", "Assembly", "Transmission", "Cabin"],
          customAlertTypes: [],
          claimWorkflow: {
            allowedRolesToClaim: ["SUPERVISOR", "FACTORY_MANAGER", "SERVICE_ENGINEER"],
            keepClaimedVisible: true,
            autoReleaseHours: 4
          },
          escalation: {
            intervalsMin: {
              EMERGENCY: 15,
              CRITICAL: 60,
              HIGH: 240,
              MEDIUM: 1440,
              LOW: 4320
            }
          }
        };
        const settings = await tx.companySettings.create({
          data: {
            companyId: newComp.id,
            rulebook: defaultRulebook,
          },
        });
        return { ...newComp, settings };
      });
    }

    if (!company) {
      throw new NotFoundException('Company could not be resolved or created');
    }

    // Check email uniqueness under company
    const existing = await this.prisma.user.findFirst({
      where: {
        email: { equals: email, mode: 'insensitive' },
        companyId: company.id,
      },
    });
    if (existing) {
      throw new ConflictException('User is already registered under this company');
    }

    // Enforce allowed roles lockdown
    if (company.settings && company.settings.allowedRoles.length > 0) {
      if (!company.settings.allowedRoles.includes(dto.role)) {
        throw new ConflictException(`Role '${dto.role}' is not authorized to register under this company's licensing`);
      }
    }

    // Enforce max user limit restrictions
    if (company.settings && company.settings.maxUsers > 0) {
      const activeCount = await this.prisma.user.count({
        where: { companyId: company.id, isActive: true },
      });
      if (activeCount >= company.settings.maxUsers) {
        throw new ConflictException(`Company has reached its license registration ceiling of ${company.settings.maxUsers} users`);
      }
    }

    const user = await this.prisma.user.create({
      data: {
        email,
        name: dto.name,
        passwordHash: dto.passwordHash,
        role: dto.role as any,
        companyId: company.id,
      },
    });

    const { passwordHash, ...result } = user;
    return result;
  }

  async getSettings(companyId: string) {
    const settings = await this.prisma.companySettings.findUnique({
      where: { companyId },
      include: {
        company: {
          select: {
            name: true,
            isActive: true,
            tier: true,
          }
        }
      }
    });
    if (!settings) {
      throw new NotFoundException('Settings not found for this tenant');
    }
    return settings;
  }

  async updateSettings(companyId: string, data: any) {
    return this.prisma.$transaction(async (tx) => {
      // Update Company table fields (tier, isActive) if present
      if (data.tier !== undefined || data.isActive !== undefined) {
        await tx.company.update({
          where: { id: companyId },
          data: {
            tier: data.tier ?? undefined,
            isActive: data.isActive ?? undefined,
          },
        });
      }

      return tx.companySettings.update({
        where: { companyId },
        data: {
          maxUsers: data.maxUsers ?? undefined,
          allowedRoles: data.allowedRoles ?? undefined,
          whatsappEnabled: data.whatsappEnabled ?? undefined,
          whatsappApiKey: data.whatsappApiKey ?? undefined,
          whatsappSenderNum: data.whatsappSenderNum ?? undefined,
          soundEmergency: data.soundEmergency ?? undefined,
          rulebook: data.rulebook ?? undefined,
        },
      });
    });
  }

  async getCompanyUsers(companyId: string) {
    return this.prisma.user.findMany({
      where: { companyId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
      },
    });
  }

  async getAllCompanies() {
    const companies = await this.prisma.company.findMany({
      include: {
        users: { select: { id: true, isActive: true } },
        alerts: { select: { id: true, status: true } },
        settings: true,
      },
      orderBy: { name: 'asc' },
    });

    return companies.map(c => {
      const openAlerts = c.alerts.filter(a => a.status === 'OPEN' || a.status === 'IN_PROGRESS').length;
      return {
        id: c.id,
        name: c.name,
        isActive: c.isActive,
        createdAt: c.createdAt,
        userCount: c.users.length,
        openAlertCount: openAlerts,
        settings: c.settings,
      };
    });
  }

  async createCompany(name: string, settingsData?: any) {
    const existing = await this.prisma.company.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    if (existing) {
      throw new ConflictException('Company with this name already exists');
    }

    return this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: { 
          name,
          tier: settingsData?.tier || 'BASIC',
        },
      });
      const defaultRulebook = {
        workerAlertsEnabled: true,
        categoriesEnabled: ["Brake System", "Engine", "Assembly", "Transmission", "Cabin"],
        customAlertTypes: [],
        claimWorkflow: {
          allowedRolesToClaim: ["SUPERVISOR", "FACTORY_MANAGER", "SERVICE_ENGINEER"],
          keepClaimedVisible: true,
          autoReleaseHours: 4
        },
        escalation: {
          intervalsMin: {
            EMERGENCY: 15,
            CRITICAL: 60,
            HIGH: 240,
            MEDIUM: 1440,
            LOW: 4320
          }
        }
      };
      const settings = await tx.companySettings.create({
        data: {
          companyId: company.id,
          maxUsers: settingsData?.maxUsers ?? 0,
          allowedRoles: settingsData?.allowedRoles ?? [],
          whatsappEnabled: settingsData?.whatsappEnabled ?? false,
          whatsappApiKey: settingsData?.whatsappApiKey || null,
          whatsappSenderNum: settingsData?.whatsappSenderNum || null,
          soundEmergency: settingsData?.soundEmergency || 'siren.mp3',
          rulebook: settingsData?.rulebook || defaultRulebook,
        },
      });
      return { ...company, settings };
    });
  }

  async toggleCompanyStatus(id: string, isActive: boolean) {
    const company = await this.prisma.company.findUnique({ where: { id } });
    if (!company) {
      throw new NotFoundException('Company not found');
    }
    return this.prisma.company.update({
      where: { id },
      data: { isActive },
    });
  }
}
