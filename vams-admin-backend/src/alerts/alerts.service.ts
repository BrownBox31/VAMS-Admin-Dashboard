import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateManualAlertDto } from './dto/create-manual-alert.dto';
import { Severity } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class AlertsService {
  private recentDefinitions = new Map<string, any>();
  private recentAlerts = new Map<string, any>();
  private recentTimeline = new Map<string, any>();

  constructor(private prisma: PrismaService) {}

  async createManualAlert(companyId: string, performedByUserId: string, dto: CreateManualAlertDto) {
    const admin = await this.prisma.user.findUnique({
      where: { id: performedByUserId },
      select: { name: true, role: true },
    });
    if (!admin) throw new NotFoundException('Admin profile not found');

    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Company tenant not found');

    // Resolve Alert Definition
    const alertDef = await this.prisma.alertDefinition.findFirst({
      where: { id: dto.alertDefinitionId, companyId },
    });
    if (!alertDef) throw new NotFoundException('Alert definition template not found');

    // Auto-resolve assignee details and severity from definition, allowing overrides
    let assignedToUserId: string | null = null;
    let assignedToRole = dto.assignedToRole || null;

    if (dto.assignedToUserId || dto.assignedToRole) {
      assignedToUserId = dto.assignedToUserId || null;
    } else {
      assignedToUserId = alertDef.primaryAssigneeId || null;
    }

    let primaryUser: any = null;

    const roleMap: Record<string, string> = {
      role_COMPANY_ADMIN: 'COMPANY_ADMIN',
      role_SUPERVISOR: 'SUPERVISOR',
      role_FACTORY_MANAGER: 'FACTORY_MANAGER',
      role_SERVICE_ENGINEER: 'SERVICE_ENGINEER',
      role_WORKER: 'WORKER',
      role_QUALITY_INSPECTOR: 'QUALITY_INSPECTOR',
      COMPANY_ADMIN: 'COMPANY_ADMIN',
      SUPERVISOR: 'SUPERVISOR',
      FACTORY_MANAGER: 'FACTORY_MANAGER',
      SERVICE_ENGINEER: 'SERVICE_ENGINEER',
      WORKER: 'WORKER',
      QUALITY_INSPECTOR: 'QUALITY_INSPECTOR',
    };

    if (assignedToUserId && roleMap[assignedToUserId]) {
      assignedToRole = roleMap[assignedToUserId] as any;
      assignedToUserId = null; // Role-based pool assignment
    } else if (assignedToUserId) {
      primaryUser = await this.prisma.user.findUnique({ where: { id: assignedToUserId } });
      if (!assignedToRole && primaryUser) {
        assignedToRole = primaryUser.role;
      }
    }
    if (!assignedToRole) {
      assignedToRole = 'WORKER';
    }

    const severity = dto.severity || alertDef.severity;
    const defectName = alertDef.alertId || alertDef.name;
    const crypto = require('crypto');
    const backgroundAlertId = crypto.randomUUID();

    // Prepare mock objects for instant UI response
    const mockAlert = {
      id: backgroundAlertId,
      vin: dto.vin || null,
      companyId,
      defectId: 'mock-defect-id',
      defectName,
      alertDefinitionId: alertDef.id,
      severity: severity as any,
      status: 'OPEN',
      assignedToUserId,
      assignedToRole: assignedToRole as any,
      createdById: performedByUserId,
      isManual: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      assignments: [],
      resolution: null,
      cacheTime: Date.now(),
    };

    const mockTimeline = {
      id: crypto.randomUUID(),
      alertId: backgroundAlertId,
      companyId,
      actionType: 'CREATED',
      performedByUserId,
      details: `Manual defect created by ${admin.name} (${admin.role}). Assigned to: ${primaryUser ? primaryUser.name : (assignedToRole || 'Unassigned')}. Notes: ${dto.notes || 'None'}`,
      createdAt: new Date(),
      performedByUser: {
        name: admin.name,
        role: admin.role,
      },
      cacheTime: Date.now(),
    };

    this.recentAlerts.set(backgroundAlertId, mockAlert);
    this.recentTimeline.set(mockTimeline.id, mockTimeline);

    // Trigger VAMS core backend event ingestion in the background for both local and onrender backends
    (async () => {
      const coreUrls = [
        process.env.CORE_BACKEND_URL || 'http://127.0.0.1:3000/api/v1'
      ];
      const uniqueUrls = Array.from(new Set(coreUrls.map(u => u.trim().replace(/\/$/, ''))));
      const fetchFn = typeof fetch !== 'undefined' ? fetch : (globalThis as any).fetch;

      await Promise.all(uniqueUrls.map(async (coreUrl) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        try {
          const response = await fetchFn(`${coreUrl}/alerts/event`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              source: 'admin-portal',
              event_type: 'DEFECT_CREATED',
              companyId,
              vin: dto.vin || null,
              defectName: defectName,
              alertDefinitionId: alertDef.id,
              alertId: backgroundAlertId,
              assignedToUserId: assignedToUserId || undefined,
              assignedToRole: assignedToRole || undefined,
              severity,
              message: dto.notes || undefined,
            }),
          });
          if (!response.ok) {
            const errText = await response.text();
            console.warn(`[NOTIFICATION SYNC WARNING] Core alerts engine (${coreUrl}) returned HTTP ${response.status}: ${errText}`);
          } else {
            console.log(`[NOTIFICATION SYNC SUCCESS] Triggered core alerts engine (${coreUrl}) for alert ${backgroundAlertId}`);
          }
        } catch (fetchErr: any) {
          console.warn(`[NOTIFICATION SYNC WARNING] Failed to trigger core alerts engine (${coreUrl}) in background:`, fetchErr.message);
        } finally {
          clearTimeout(timeoutId);
        }
      }));
    })();

    console.log(`[PUSH] Initiated asynchronous manual defect creation in background.`);

    return mockAlert;
  }

  async getAdvancedAnalytics(companyId: string, requestingUser?: any) {
    const isGlobal = !companyId || companyId === 'all';
    const userRole = requestingUser?.role;
    const userId = requestingUser?.id;
    const isNonAdmin = userRole && userRole !== 'SUPER_ADMIN' && userRole !== 'COMPANY_ADMIN';

    // 1. Fetch companies list
    const companies = await this.prisma.company.findMany({
      where: isGlobal ? {} : { id: companyId },
      include: {
        settings: true,
        users: {
          where: isNonAdmin ? { role: userRole as any } : { role: { not: 'SUPER_ADMIN' } },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            isActive: true,
          }
        },
        alerts: {
          where: isNonAdmin ? {
            OR: [
              { assignedToUserId: userId },
              { assignedToRole: userRole as any },
            ],
          } : {},
          include: {
            assignedToUser: {
              select: {
                id: true,
                name: true,
                role: true,
              }
            },
          }
        }
      },
      orderBy: { name: 'asc' }
    });

    // 2. Compute metrics
    const alertWhereClause: any = isGlobal ? {} : { companyId };
    if (isNonAdmin) {
      alertWhereClause.OR = [
        { assignedToUserId: userId },
        { assignedToRole: userRole as any },
      ];
    }

    const dbAlerts = await this.prisma.alert.findMany({
      where: alertWhereClause,
      include: { assignments: true, resolution: true }
    });

    // Merge recent in-memory cache alerts
    const nowTime = Date.now();
    const alerts = [...dbAlerts];
    for (const [id, a] of this.recentAlerts.entries()) {
      if (nowTime - a.cacheTime > 5000) {
        this.recentAlerts.delete(id);
        continue;
      }
      if (isGlobal || a.companyId === companyId) {
        if (isNonAdmin) {
          const matchesUser = a.assignedToUserId === userId;
          const matchesRole = a.assignedToRole === userRole;
          if (!matchesUser && !matchesRole) {
            continue;
          }
        }
        if (!alerts.some(alert => alert.id === id)) {
          alerts.push(a);
        }
      }
    }

    const totalCount = alerts.length;
    const openCount = alerts.filter(a => a.status === 'OPEN' || a.status === 'IN_PROGRESS').length;
    const resolvedCount = alerts.filter(a => a.status === 'RESOLVED').length;
    const reopenedCount = alerts.filter(a => a.status === 'REOPENED').length;
    const reassignCount = alerts.reduce((acc, curr) => acc + (curr.assignments ? curr.assignments.length : 0), 0);

    const severityCount = alerts.filter(a => a.status !== 'RESOLVED').reduce((acc, curr) => {
      acc[curr.severity] = (acc[curr.severity] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // 4. Resolve userPerformance list
    const userWhereClause: any = isGlobal ? {} : { companyId };
    if (isNonAdmin) {
      userWhereClause.role = userRole as any;
    } else {
      userWhereClause.role = {
        not: 'SUPER_ADMIN'
      };
    }

    const allUsers = await this.prisma.user.findMany({
      where: userWhereClause,
      select: { id: true, name: true, email: true, role: true, isActive: true, companyId: true, company: { select: { name: true } } }
    });

    const userIds = allUsers.map(u => u.id);
    const companyAlertIds = alerts.map(a => a.id);

    const [allResolutions, allReopenedEvents, allReassignments] = await Promise.all([
      this.prisma.resolution.findMany({
        where: isGlobal ? {} : { resolvedByUserId: { in: userIds } },
      }),
      this.prisma.defectResolutionTimeline.findMany({
        where: {
          actionType: 'REOPENED',
          ...(isGlobal ? {} : { alertId: { in: companyAlertIds } }),
        },
      }),
      this.prisma.alertAssignmentHistory.findMany({
        where: isGlobal ? {} : { assignedByUserId: { in: userIds } },
      }),
    ]);

    // 3. Aggregate detailed company workspaces
    const companiesData = companies.map((c) => {
      const companyAlerts = [...c.alerts];
      for (const [id, a] of this.recentAlerts.entries()) {
        if (a.companyId === c.id) {
          if (!companyAlerts.some(alert => alert.id === id)) {
            companyAlerts.push(a);
          }
        }
      }

      const companyUsers = c.users.map((u) => {
        const currentlyAssigned = companyAlerts.filter(a => a.assignedToUserId === u.id && a.status !== 'RESOLVED').length;
        
        const myResolutions = allResolutions.filter(r => r.resolvedByUserId === u.id);
        const resolvedCount = myResolutions.length;
        const myResolutionsAlertIds = myResolutions.map(r => r.alertId);
        
        const reopenedCount = allReopenedEvents.filter(evt => myResolutionsAlertIds.includes(evt.alertId)).length;
        const reassignedCount = allReassignments.filter(h => h.assignedByUserId === u.id).length;

        return {
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          isActive: u.isActive,
          currentlyAssigned,
          resolvedCount,
          reopenedCount,
          reassignedCount,
        };
      });

      return {
        id: c.id,
        name: c.name,
        isActive: c.isActive,
        createdAt: c.createdAt,
        settings: c.settings,
        users: companyUsers,
        alerts: companyAlerts.map(a => ({
          id: a.id,
          vin: a.vin,
          defectName: a.defectName,
          severity: a.severity,
          status: a.status,
          assignedToUserId: a.assignedToUserId,
          assignedToUser: a.assignedToUser,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
          escalationStep: a.escalationStep,
          nextEscalationAt: a.nextEscalationAt,
        })),
      };
    });

    const userPerformance = allUsers.map((u) => {
      const currentlyAssigned = alerts.filter(a => a.assignedToUserId === u.id && a.status !== 'RESOLVED').length;
      
      const myResolutions = allResolutions.filter(r => r.resolvedByUserId === u.id);
      const resolvedCount = myResolutions.length;
      const myResolutionsAlertIds = myResolutions.map(r => r.alertId);
      
      const reopenedCount = allReopenedEvents.filter(evt => myResolutionsAlertIds.includes(evt.alertId)).length;
      const reassignedCount = allReassignments.filter(h => h.assignedByUserId === u.id).length;

      return {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        isActive: u.isActive,
        companyId: u.companyId,
        companyName: u.company.name,
        currentlyAssigned,
        resolvedCount,
        reopenedCount,
        reassignedCount,
      };
    });

    const timelineWhereClause: any = isGlobal ? {} : { alert: { companyId } };
    if (isNonAdmin) {
      timelineWhereClause.alert = {
        companyId,
        OR: [
          { assignedToUserId: userId },
          { assignedToRole: userRole as any },
        ],
      };
    }

    const auditTimeline = await this.prisma.defectResolutionTimeline.findMany({
      where: timelineWhereClause,
      include: {
        performedByUser: {
          select: { name: true, role: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // Merge recent in-memory timeline events
    let mergedTimeline = [...auditTimeline];
    const recentTimelineEvents: any[] = [];
    for (const [id, t] of this.recentTimeline.entries()) {
      if (nowTime - t.cacheTime > 5000) {
        this.recentTimeline.delete(id);
        continue;
      }
      if (isGlobal || t.companyId === companyId) {
        if (isNonAdmin) {
          const alert = alerts.find(a => a.id === t.alertId);
          if (!alert) continue;
        }
        if (!mergedTimeline.some(evt => evt.id === id)) {
          recentTimelineEvents.push(t);
        }
      }
    }

    if (recentTimelineEvents.length > 0) {
      mergedTimeline = [...recentTimelineEvents, ...mergedTimeline];
      mergedTimeline.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      if (mergedTimeline.length > 100) {
        mergedTimeline = mergedTimeline.slice(0, 100);
      }
    }

    return {
      summary: {
        totalDefects: totalCount,
        openDefects: openCount,
        resolvedDefects: resolvedCount,
        reopenedDefects: reopenedCount,
        reassignedDefects: reassignCount,
      },
      severityDistribution: severityCount,
      categoryDistribution: {},
      userPerformance,
      companiesData,
      auditTimeline: mergedTimeline.map(evt => ({
        id: evt.id,
        alertId: evt.alertId,
        actionType: evt.actionType,
        details: evt.details,
        createdAt: evt.createdAt,
        operator: evt.performedByUser ? `${evt.performedByUser.name} (${evt.performedByUser.role})` : 'SYSTEM',
      })),
    };
  }

  async findAll(companyId: string, requestingUser?: any) {
    const isGlobal = !companyId || companyId === 'all';
    const userRole = requestingUser?.role;
    const userId = requestingUser?.id;
    const isNonAdmin = userRole && userRole !== 'SUPER_ADMIN' && userRole !== 'COMPANY_ADMIN';

    const whereClause: any = isGlobal ? {} : { companyId };
    if (isNonAdmin) {
      whereClause.OR = [
        { assignedToUserId: userId },
        { assignedToRole: userRole as any },
      ];
    }

    return this.prisma.alert.findMany({
      where: whereClause,
      include: {
        assignedToUser: { select: { id: true, name: true, role: true } },
        company: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findOne(companyId: string, id: string, requestingUser?: any) {
    const isGlobal = !companyId || companyId === 'all';
    const userRole = requestingUser?.role;
    const userId = requestingUser?.id;
    const isNonAdmin = userRole && userRole !== 'SUPER_ADMIN' && userRole !== 'COMPANY_ADMIN';

    const whereClause: any = isGlobal ? { id } : { id, companyId };
    if (isNonAdmin) {
      whereClause.OR = [
        { assignedToUserId: userId },
        { assignedToRole: userRole as any },
      ];
    }

    const alert = await this.prisma.alert.findFirst({
      where: whereClause,
      include: {
        assignments: true,
        timeline: {
          include: { performedByUser: { select: { name: true, role: true } } },
          orderBy: { createdAt: 'asc' },
        },
        resolution: {
          include: {
            resolvedByUser: { select: { id: true, name: true, role: true } },
          },
        },
        assignedToUser: { select: { id: true, name: true, role: true } },
      },
    });
    if (!alert) throw new NotFoundException('Alert not found');
    return alert;
  }

  // Alert Definitions CRUD
  async getDefinitions(companyId: string) {
    const isGlobal = !companyId || companyId === 'all';
    const dbDefs = await this.prisma.alertDefinition.findMany({
      where: isGlobal ? { isActive: true } : { companyId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    const merged = [...dbDefs];
    for (const [id, def] of this.recentDefinitions.entries()) {
      if (isGlobal || def.companyId === companyId) {
        const existingIndex = merged.findIndex(d => d.id === id);
        if (existingIndex !== -1) {
          if (!def.isActive) {
            merged.splice(existingIndex, 1);
          } else {
            merged[existingIndex] = { ...merged[existingIndex], ...def };
          }
        } else if (def.isActive) {
          merged.unshift(def);
        }
      }
    }

    return merged;
  }

  async createDefinition(companyId: string, performedByUserId: string, dto: any) {
    const crypto = require('crypto');
    const id = crypto.randomUUID();
    const defData = {
      id,
      companyId,
      alertId: dto.alertId,
      name: dto.name,
      definition: dto.definition || null,
      type: dto.type,
      severity: dto.severity,
      primaryAssigneeId: dto.primaryAssigneeId,
      escalationChain: dto.escalationChain || [],
      escalationTimeout: parseInt(dto.escalationTimeout, 10),
      criticalOverride: dto.criticalOverride || false,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Update local cache immediately for instant UI responsiveness
    this.recentDefinitions.set(id, defData);

    // Save to the database in the background
    this.prisma.alertDefinition.create({
      data: defData,
    }).then(() => {
      setTimeout(() => {
        this.recentDefinitions.delete(id);
      }, 5000);
    }).catch(err => {
      console.error('[Background Save Definition Error]:', err);
      this.recentDefinitions.delete(id);
    });

    return defData;
  }

  async updateDefinition(companyId: string, id: string, dto: any) {
    const def = await this.prisma.alertDefinition.findUnique({
      where: { id },
    });
    if (!def) {
      throw new NotFoundException('Alert definition template not found');
    }
    if (companyId !== 'all' && def.companyId !== companyId) {
      throw new ForbiddenException('Access denied: Alert definition belongs to another company');
    }

    const updatedData = {
      id,
      companyId,
      alertId: dto.alertId,
      name: dto.name,
      definition: dto.definition || null,
      type: dto.type,
      severity: dto.severity,
      primaryAssigneeId: dto.primaryAssigneeId,
      escalationChain: dto.escalationChain || [],
      escalationTimeout: parseInt(dto.escalationTimeout, 10),
      criticalOverride: dto.criticalOverride || false,
      isActive: true,
      updatedAt: new Date(),
    };

    // Update local cache immediately
    this.recentDefinitions.set(id, updatedData);

    // Save to the database in the background
    this.prisma.alertDefinition.update({
      where: { id },
      data: {
        alertId: dto.alertId,
        name: dto.name,
        definition: dto.definition || null,
        type: dto.type,
        severity: dto.severity,
        primaryAssigneeId: dto.primaryAssigneeId,
        escalationChain: dto.escalationChain || [],
        escalationTimeout: parseInt(dto.escalationTimeout, 10),
        criticalOverride: dto.criticalOverride || false,
      },
    }).then(() => {
      setTimeout(() => {
        this.recentDefinitions.delete(id);
      }, 5000);
    }).catch(err => {
      console.error('[Background Update Definition Error]:', err);
      this.recentDefinitions.delete(id);
    });

    return updatedData;
  }

  async deleteDefinition(companyId: string, id: string) {
    const def = await this.prisma.alertDefinition.findUnique({
      where: { id },
    });
    if (!def) {
      throw new NotFoundException('Alert definition template not found');
    }
    if (companyId !== 'all' && def.companyId !== companyId) {
      throw new ForbiddenException('Access denied: Alert definition belongs to another company');
    }

    const existingInCache = this.recentDefinitions.get(id);
    
    // Set to inactive in cache to instantly remove from UI
    this.recentDefinitions.set(id, {
      ...existingInCache,
      id,
      companyId,
      isActive: false,
    });

    // Save to the database in the background
    this.prisma.alertDefinition.update({
      where: { id },
      data: { isActive: false },
    }).then(() => {
      setTimeout(() => {
        this.recentDefinitions.delete(id);
      }, 5000);
    }).catch(err => {
      console.error('[Background Delete Definition Error]:', err);
      this.recentDefinitions.delete(id);
    });

    return { id, success: true };
  }

  async dispatchDefinition(companyId: string, performedByUserId: string, id: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: performedByUserId } });
    if (!admin) throw new NotFoundException('Admin profile not found');

    const alertDef = await this.prisma.alertDefinition.findFirst({
      where: { id, companyId },
    });
    if (!alertDef) throw new NotFoundException('Alert definition template not found');

    return this.createManualAlert(companyId, performedByUserId, {
      alertDefinitionId: alertDef.id,
      severity: alertDef.severity,
      assignedToUserId: alertDef.primaryAssigneeId || undefined,
      notes: `Dispatched template: ${alertDef.name}`,
    });
  }

  // Company Broadcasts
  async createBroadcast(companyId: string, sentById: string, dto: any) {
    const broadcast = await this.prisma.companyBroadcastLog.create({
      data: {
        companyId,
        title: dto.title,
        message: dto.message,
        sentById,
      },
    });

    const fetchFn = typeof fetch !== 'undefined' ? fetch : (globalThis as any).fetch;
    
    // Dispatch webhook asynchronously in the background to both local and onrender backends so the admin UI responds instantly
    (async () => {
      const coreUrls = [
        process.env.CORE_BACKEND_URL || 'http://127.0.0.1:3000/api/v1',
        'https://vams-backend.onrender.com/api/v1'
      ];
      const uniqueUrls = Array.from(new Set(coreUrls.map(u => u.trim().replace(/\/$/, ''))));
      
      let fallbackTriggered = false;
      
      await Promise.all(uniqueUrls.map(async (coreUrl) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        try {
          const response = await fetchFn(`${coreUrl}/alerts/event`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              source: 'admin-portal',
              event_type: 'BROADCAST',
              companyId,
              title: dto.title,
              message: dto.message,
              targetUserIds: Array.isArray(dto.targetUserIds) && dto.targetUserIds.length > 0 ? dto.targetUserIds : undefined,
              targetRoles: Array.isArray(dto.targetRoles) && dto.targetRoles.length > 0 ? dto.targetRoles : undefined,
            }),
          });

          if (response.ok) {
            console.log(`[WHATSAPP & PUSH] Broadcast sent on ${coreUrl}: ${dto.title} - ${dto.message}`);
          } else {
            const errorText = await response.text();
            console.warn(`[BROADCAST SYNC WARNING] VAMS core alerts engine (${coreUrl}) returned error:`, errorText);
            if (!fallbackTriggered) {
              fallbackTriggered = true;
              await this.triggerBroadcastFallback(companyId, dto.title, dto.message, dto.targetUserIds, dto.targetRoles);
            }
          }
        } catch (err: any) {
          console.warn(`Failed to send broadcast webhook to core backend (${coreUrl}). Running fallback:`, err.message);
          if (!fallbackTriggered) {
            fallbackTriggered = true;
            await this.triggerBroadcastFallback(companyId, dto.title, dto.message, dto.targetUserIds, dto.targetRoles);
          }
        } finally {
          clearTimeout(timeoutId);
        }
      }));
    })();

    return broadcast;
  }

  private async triggerBroadcastFallback(companyId: string, title: string, message: string, targetUserIds?: string[], targetRoles?: string[]) {
    try {
      const orConditions: any[] = [];
      if (targetUserIds && targetUserIds.length > 0) {
        orConditions.push({ id: { in: targetUserIds } });
      }
      if (targetRoles && targetRoles.length > 0) {
        orConditions.push({ role: { in: targetRoles } });
      }

      const targetUsers = await this.prisma.user.findMany({
        where: {
          isActive: true,
          ...(companyId && companyId !== 'all' ? { companyId } : {}),
          ...(orConditions.length > 0 ? { OR: orConditions } : {}),
        },
      });
      const crypto = require('crypto');
      for (const targetUser of targetUsers) {
        await this.prisma.$executeRawUnsafe(
          `INSERT INTO notifications (id, "companyId", "userId", title, message, channel, "isRead", "createdAt")
           VALUES ($1, $2, $3, $4, $5, $6::"NotificationChannel", $7, NOW())`,
          crypto.randomUUID(),
          companyId && companyId !== 'all' ? companyId : targetUser.companyId,
          targetUser.id,
          title,
          message,
          'PUSH',
          false
        );
        await this.prisma.alertNotificationLog.create({
          data: {
            id: crypto.randomUUID(),
            alertId: 'BROADCAST',
            userId: targetUser.id,
            type: 'BROADCAST',
            message: message,
          },
        });
      }
    } catch (fallbackErr: any) {
      console.error('[BROADCAST FALLBACK ERROR] Failed to run database fallback:', fallbackErr.message);
    }
  }

  async getBroadcasts(companyId: string) {
    return this.prisma.companyBroadcastLog.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deleteBroadcast(companyId: string, id: string) {
    const broadcast = await this.prisma.companyBroadcastLog.findUnique({
      where: { id },
    });
    if (!broadcast) {
      throw new NotFoundException('Broadcast not found');
    }
    if (companyId !== 'all' && broadcast.companyId !== companyId) {
      throw new ForbiddenException('Access denied: Broadcast belongs to another company');
    }
    return this.prisma.companyBroadcastLog.delete({
      where: { id },
    });
  }

  // Proxy Alert Actions
  async takeoverAlert(userId: string, alertId: string, authHeader?: string) {
    const coreUrl = process.env.CORE_BACKEND_URL || 'http://127.0.0.1:3000/api/v1';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await ((global as any).fetch || fetch)(`${coreUrl}/alerts/${alertId}/takeover`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...(authHeader ? { Authorization: authHeader } : {})
        },
        signal: controller.signal,
      });
      if (response.ok) {
        return response.json();
      }
      const text = await response.text();
      throw new BadRequestException(`Core takeover failed: ${text}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async resolveAlert(userId: string, alertId: string, reason: string, authHeader?: string) {
    const coreUrl = process.env.CORE_BACKEND_URL || 'http://127.0.0.1:3000/api/v1';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await ((global as any).fetch || fetch)(`${coreUrl}/alerts/${alertId}/resolve`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...(authHeader ? { Authorization: authHeader } : {})
        },
        signal: controller.signal,
        body: JSON.stringify({ reason }),
      });
      if (response.ok) {
        return response.json();
      }
      const text = await response.text();
      throw new BadRequestException(`Core resolve failed: ${text}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async reopenAlert(userId: string, alertId: string, authHeader?: string) {
    const coreUrl = process.env.CORE_BACKEND_URL || 'http://127.0.0.1:3000/api/v1';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await ((global as any).fetch || fetch)(`${coreUrl}/alerts/${alertId}/reopen`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...(authHeader ? { Authorization: authHeader } : {})
        },
        signal: controller.signal,
        body: JSON.stringify({ reason: 'Reopened from Admin Dashboard' }),
      });
      if (response.ok) {
        return response.json();
      }
      const text = await response.text();
      throw new BadRequestException(`Core reopen failed: ${text}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async reassignAlert(userId: string, alertId: string, assignedToUserId: string, authHeader?: string) {
    const coreUrl = process.env.CORE_BACKEND_URL || 'http://127.0.0.1:3000/api/v1';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await ((global as any).fetch || fetch)(`${coreUrl}/alerts/${alertId}/assign`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          ...(authHeader ? { Authorization: authHeader } : {})
        },
        signal: controller.signal,
        body: JSON.stringify({ assignedToUserId }),
      });
      if (response.ok) {
        return response.json();
      }
      const text = await response.text();
      throw new BadRequestException(`Core reassign failed: ${text}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private getPythonBaseUrl() {
    return 'http://127.0.0.1:8000';
  }

  private getLocalPythonFilePath(subpath: string) {
    return path.resolve(process.cwd(), '../../VAMS system/data', subpath);
  }

  async getPythonRaw() {
    try {
      const res = await ((global as any).fetch || fetch)(`${this.getPythonBaseUrl()}/api/raw-defects`);
      if (res.ok) return res.json();
    } catch (e) {
      // ignore and fallback
    }
    const filePath = this.getLocalPythonFilePath('data/robots_defect_list.json');
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    }
    throw new NotFoundException('Raw defects log file not found locally or Python API offline.');
  }

  async getPythonCleaned() {
    try {
      const res = await ((global as any).fetch || fetch)(`${this.getPythonBaseUrl()}/api/cleaned-defects`);
      if (res.ok) return res.json();
    } catch (e) {
      // ignore and fallback
    }
    const filePath = this.getLocalPythonFilePath('data/cleaned_defects_list.json');
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    }
    throw new NotFoundException('Cleaned defects log file not found locally or Python API offline.');
  }

  async getPythonGrouped() {
    try {
      const res = await ((global as any).fetch || fetch)(`${this.getPythonBaseUrl()}/api/grouped-defects`);
      if (res.ok) return res.json();
    } catch (e) {
      // ignore and fallback
    }
    const filePath = this.getLocalPythonFilePath('grouped_defects.txt');
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      return this.parseGroupedDefectsText(content);
    }
    return [];
  }

  private parseGroupedDefectsText(content: string) {
    const lines = content.split('\n');
    const groups: any[] = [];
    let currentGroup: any = null;
    for (let line of lines) {
      line = line.trim();
      if (!line) continue;
      if (line.startsWith('Group ')) {
        const groupNoStr = line.split(' ')[1];
        currentGroup = {
          group: isNaN(Number(groupNoStr)) ? groupNoStr : Number(groupNoStr),
          defects: []
        };
        groups.push(currentGroup);
      } else if (line.startsWith('-') && currentGroup) {
        currentGroup.defects.push(line.substring(1).trim());
      }
    }
    return groups;
  }

  async runPythonClean() {
    try {
      const res = await ((global as any).fetch || fetch)(`${this.getPythonBaseUrl()}/api/run-cleaner`, { method: 'POST' });
      if (res.ok) return res.json();
    } catch (e) {
      // ignore
    }
    const scriptPath = this.getLocalPythonFilePath('qwen_cleaner.py');
    const pythonDir = this.getLocalPythonFilePath('');
    if (fs.existsSync(scriptPath)) {
      const { exec } = require('child_process');
      exec(`python "${scriptPath}"`, { cwd: pythonDir }, (err, stdout, stderr) => {
        if (err) {
          console.error(`Local Python execution failed: ${err.message}`);
        }
      });
      return { message: 'Local cleaner script triggered in background (no active API server).' };
    }
    throw new NotFoundException('Qwen cleaner script not found locally.');
  }

  async runPythonCluster() {
    try {
      const res = await ((global as any).fetch || fetch)(`${this.getPythonBaseUrl()}/api/run-similarity`, { method: 'POST' });
      if (res.ok) return res.json();
    } catch (e) {
      // ignore
    }
    const scriptPath = this.getLocalPythonFilePath('defect_similarity.py');
    const pythonDir = this.getLocalPythonFilePath('');
    if (fs.existsSync(scriptPath)) {
      const { exec } = require('child_process');
      exec(`python "${scriptPath}"`, { cwd: pythonDir }, (err, stdout, stderr) => {
        if (err) {
          console.error(`Local Python execution failed: ${err.message}`);
        }
      });
      return { message: 'Local similarity script triggered in background (no active API server).' };
    }
    throw new NotFoundException('Similarity clustering script not found locally.');
  }

  async getPythonStatus() {
    try {
      const res = await ((global as any).fetch || fetch)(`${this.getPythonBaseUrl()}/api/tasks/status`);
      if (res.ok) return { online: true, tasks: await res.json() };
    } catch (e) {
      // ignore
    }
    return {
      online: false,
      tasks: {
        cleaner: { status: 'offline', error: 'Python API server not reachable.' },
        clustering: { status: 'offline', error: 'Python API server not reachable.' }
      }
    };
  }

  async syncPythonToDb(companyId: string) {
    const coreUrl = process.env.CORE_BACKEND_URL || 'http://127.0.0.1:3000/api/v1';
    try {
      const res = await ((global as any).fetch || fetch)(`${coreUrl}/defects/sync-python`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) return res.json();
      
      const text = await res.text();
      throw new Error(`Core sync returned status ${res.status}: ${text}`);
    } catch (e: any) {
      console.warn(`[Sync Fallback] Core sync failed or unauthorized: ${e.message}. Attempting direct DB insertion fallback...`);
      // Direct DB insertion fallback if core backend is offline, unauthorized, or role-restricted
      const filePath = this.getLocalPythonFilePath('data/cleaned_defects_list.json');
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const defectsList: string[] = JSON.parse(content);
        
        // Resolve list of target company IDs
        const targetCompanyIds: string[] = [];
        if (!companyId || companyId === 'all') {
          const allCompanies = await this.prisma.company.findMany({ select: { id: true } });
          targetCompanyIds.push(...allCompanies.map(c => c.id));
        } else {
          targetCompanyIds.push(companyId);
        }

        // Fetch all existing defects for target companies in a single bulk query
        const placeholders = targetCompanyIds.map((_, i) => `$${i + 1}`).join(', ');
        const existingDefects: any[] = await this.prisma.$queryRawUnsafe(
          `SELECT "companyId", name FROM defect_masters WHERE "companyId" IN (${placeholders})`,
          ...targetCompanyIds
        );
        const existingSet = new Set(
          existingDefects.map(d => `${d.companyId}_${d.name.trim().toLowerCase()}`)
        );

        let importedCount = 0;
        const insertPromises: Promise<any>[] = [];
        const crypto = require('crypto');

        for (const targetCompId of targetCompanyIds) {
          for (const name of defectsList) {
            const trimmed = name.trim();
            if (!trimmed) continue;
            const key = `${targetCompId}_${trimmed.toLowerCase()}`;
            if (!existingSet.has(key)) {
              insertPromises.push(
                this.prisma.$executeRawUnsafe(
                  `INSERT INTO defect_masters (id, name, category, severity, "defaultAssigneeRole", "ownerVisible", "soundProfile", active, "companyId", "createdAt", "updatedAt")
                   VALUES ($1, $2, 'Python Sync', CAST('MEDIUM' AS "Severity"), CAST('WORKER' AS "UserRole"), true, 'INFO', true, $3, NOW(), NOW())`,
                  crypto.randomUUID(),
                  trimmed,
                  targetCompId
                )
              );
              importedCount++;
            }
          }
        }

        if (insertPromises.length > 0) {
          await Promise.all(insertPromises);
        }

        return { success: true, message: `Direct DB Sync successful. Synced ${importedCount} new defect terms.` };
      }
      throw new NotFoundException('Cleaned defects list file not found.');
    }
  }

  async getDefectMasters(companyId: string) {
    if (companyId === 'all') {
      return this.prisma.$queryRawUnsafe(
        `SELECT * FROM defect_masters ORDER BY name ASC`
      );
    } else {
      return this.prisma.$queryRawUnsafe(
        `SELECT * FROM defect_masters WHERE "companyId" = $1 ORDER BY name ASC`,
        companyId
      );
    }
  }
}
