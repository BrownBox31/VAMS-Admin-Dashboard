import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReminderSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReminderSchedulerService.name);
  private intervalId: NodeJS.Timeout | null = null;

  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    this.logger.log('Repeating reminder scheduler service disabled in Admin Backend to prevent connection pool exhaustion. Core backend handles reminders.');
  }

  onModuleDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }

  async checkEscalationsAndReminders() {
    this.logger.log('SLA Checker: Polling active alert assignments...');
    const now = new Date();

    // 1. Fetch all active open assignments
    const activeAssignments = await this.prisma.alertAssignment.findMany({
      where: { status: 'OPEN' },
    });

    if (activeAssignments.length === 0) {
      return;
    }

    // 2. Pre-fetch all alerts and their company references in bulk
    const alertIds = Array.from(new Set(activeAssignments.map(a => a.alertId)));
    const alerts = await this.prisma.alert.findMany({
      where: { id: { in: alertIds } },
      include: { company: true },
    });
    const alertMap = new Map(alerts.map(a => [a.id, a]));

    // 3. Pre-fetch all alert definitions in bulk
    const defIds = Array.from(new Set(alerts.map(a => a.alertDefinitionId).filter(Boolean))) as string[];
    const alertDefs = defIds.length > 0
      ? await this.prisma.alertDefinition.findMany({ where: { id: { in: defIds } } })
      : [];
    const defMap = new Map(alertDefs.map(d => [d.id, d]));

    for (const assignment of activeAssignments) {
      try {
        // Fetch full alert and definition context from maps
        const alert = alertMap.get(assignment.alertId);
        if (!alert || alert.status === 'RESOLVED') {
          // If alert is already resolved, deactivate this assignment
          await this.prisma.alertAssignment.update({
            where: { id: assignment.id },
            data: { status: 'RESOLVED' },
          });
          continue;
        }

        // Resolve Alert Definition details if present
        let escalationTimeoutMin = 30; // default fallback 30m
        let escalationChain: string[] = [];
        let primaryAssigneeId = alert.assignedToUserId;
        let criticalOverride = false;

        if (alert.alertDefinitionId) {
          const alertDef = defMap.get(alert.alertDefinitionId);
          if (alertDef) {
            escalationTimeoutMin = alertDef.escalationTimeout;
            escalationChain = alertDef.escalationChain || [];
            primaryAssigneeId = alertDef.primaryAssigneeId;
            criticalOverride = alertDef.criticalOverride;
          }
        }

        // Calculate time elapsed since assignment and notification
        const elapsedSinceAssignedMs = now.getTime() - new Date(assignment.assignedAt).getTime();
        const elapsedSinceNotifiedMs = now.getTime() - new Date(assignment.notifiedAt).getTime();

        const elapsedAssignedMin = elapsedSinceAssignedMs / (60 * 1000);
        const elapsedNotifiedMin = elapsedSinceNotifiedMs / (60 * 1000);

        // --- CHECK ESCALATION ---
        if (alert.alertDefinitionId && escalationChain.length > 0 && elapsedAssignedMin >= escalationTimeoutMin) {
          this.logger.warn(`Alert ${alert.id} SLA exceeded timeout of ${escalationTimeoutMin}m. Escalate!`);

          let rawNextTarget: string | null = null;
          let nextEscalationLevel = assignment.escalationLevel + 1;
          let loopCompleted = false;

          if (escalationChain.length > 0 && nextEscalationLevel <= escalationChain.length) {
            // Pick next target in the escalation list
            rawNextTarget = escalationChain[nextEscalationLevel - 1];
          } else {
            // Loop back around to the first step
            rawNextTarget = escalationChain[0] || primaryAssigneeId;
            nextEscalationLevel = 1;
            loopCompleted = true;
          }

          if (rawNextTarget) {
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

            const isRoleTarget = !!roleMap[rawNextTarget];
            const nextTargetRole = isRoleTarget ? roleMap[rawNextTarget] : null;
            const nextUserId = isRoleTarget ? null : rawNextTarget;

            this.logger.log(`Escalating alert ${alert.id} to ${isRoleTarget ? `ROLE: ${nextTargetRole}` : `USER: ${nextUserId}`} (Level: ${nextEscalationLevel})`);

            // Perform transaction to execute transition
            await this.prisma.$transaction(async (tx) => {
              // Deactivate current active assignment
              await tx.alertAssignment.update({
                where: { id: assignment.id },
                data: { status: 'ESCALATED' },
              });

              // Create new assignment
              await tx.alertAssignment.create({
                data: {
                  alertId: alert.id,
                  severity: alert.severity,
                  assignedToId: isRoleTarget ? rawNextTarget : nextUserId!,
                  assignedAt: now,
                  notifiedAt: now,
                  seenAt: null,
                  reminderCount: 0,
                  escalationLevel: nextEscalationLevel,
                  status: 'OPEN',
                },
              });

              // Update Alert assignee details
              let resolvedRole = 'WORKER';
              if (isRoleTarget) {
                resolvedRole = nextTargetRole!;
              } else {
                const nextUser = await tx.user.findUnique({ where: { id: nextUserId! } });
                if (nextUser) resolvedRole = nextUser.role;
              }

              await tx.alert.update({
                where: { id: alert.id },
                data: {
                  assignedToUserId: nextUserId,
                  assignedToRole: resolvedRole as any,
                },
              });

              // Write Audit Log for all target members
              const crypto = require('crypto');
              let targetUsers: any[] = [];
              if (isRoleTarget) {
                targetUsers = await tx.user.findMany({
                  where: { companyId: alert.companyId, role: resolvedRole as any, isActive: true }
                });
              } else if (nextUserId) {
                const u = await tx.user.findUnique({ where: { id: nextUserId } });
                if (u) targetUsers.push(u);
              }

              for (const targetUser of targetUsers) {
                await tx.alertNotificationLog.create({
                  data: {
                    id: crypto.randomUUID(),
                    alertId: alert.id,
                    userId: targetUser.id,
                    type: 'ESCALATION',
                    message: `Alert SLA exceeded. Auto-escalated to level ${nextEscalationLevel} (Role: ${resolvedRole}).`,
                  },
                });
              }

              await tx.defectResolutionTimeline.create({
                data: {
                  alertId: alert.id,
                  actionType: 'ASSIGNED',
                  details: `Alert auto-escalated to ${isRoleTarget ? `All ${resolvedRole}s` : (targetUsers[0]?.name || 'Operator')} (Level ${nextEscalationLevel}) due to SLA timeout.`,
                },
              });

              // If loop completed, notify the Admin/Owner directly as a fallback
              if (loopCompleted) {
                const admins = await tx.user.findMany({
                  where: {
                    companyId: alert.companyId,
                    role: { in: ['COMPANY_ADMIN', 'FACTORY_MANAGER'] },
                    isActive: true,
                  },
                });

                for (const adminUser of admins) {
                  await tx.alertNotificationLog.create({
                    data: {
                      id: crypto.randomUUID(),
                      alertId: alert.id,
                      userId: adminUser.id,
                      type: 'ESCALATION',
                      message: `ALERT SLA LOOP COMPLETE: Alert has looped through entire escalation chain and remains unresolved.`,
                    },
                  });
                }
              }
            });

            // Trigger core notification webhook to both local and onrender servers
            try {
              const msg = `SLA Exceeded. Escalated to ${isRoleTarget ? `Role ${nextTargetRole}` : 'you'}: defect '${alert.defectName}' (VIN: ${alert.vin || 'N/A'}).`;
              
              const payload: any = {
                source: 'scheduler',
                event_type: 'ESCALATION',
                companyId: alert.companyId,
                alertId: alert.id,
                assignedToUserId: nextUserId || undefined,
                assignedToRole: nextTargetRole || undefined,
                message: msg,
              };

              if (loopCompleted) {
                payload.loopCompleted = true;
              }

              const coreUrls = [
                process.env.CORE_BACKEND_URL || 'http://127.0.0.1:3000/api/v1',
                'https://vams-backend.onrender.com/api/v1'
              ];
              const uniqueUrls = Array.from(new Set(coreUrls.map(u => u.trim().replace(/\/$/, ''))));

              await Promise.all(uniqueUrls.map(async (coreUrl) => {
                try {
                  await (global as any).fetch(`${coreUrl}/alerts/event`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                  });
                } catch (err: any) {
                  this.logger.warn(`Failed to trigger escalation webhook for ${coreUrl}: ${err.message}`);
                }
              }));
            } catch (err: any) {
              this.logger.warn(`Failed to trigger escalation webhook setup: ${err.message}`);
            }

            continue; // Skip reminder check for this loop since we transitioned
          }
        }

        // --- CHECK REMINDERS (If unseen) ---
        if (assignment.seenAt === null) {
          let intervalMin = 120; // Default Medium/High: 2 hours
          if (alert.severity === 'CRITICAL' || alert.severity === 'EMERGENCY') {
            intervalMin = 30; // 30 minutes
          } else if (alert.severity === 'LOW' || alert.severity === 'INFO') {
            intervalMin = 24 * 60; // 1 day (24 hours)
          }

          if (elapsedNotifiedMin >= intervalMin) {
            this.logger.warn(`Reminder SLA matched for active assignment ${assignment.id} (Interval: ${intervalMin}m)`);

            // Update notifiedAt timestamp and increment reminder count
            await this.prisma.alertAssignment.update({
              where: { id: assignment.id },
              data: {
                notifiedAt: now,
                reminderCount: assignment.reminderCount + 1,
              },
            });

            const crypto = require('crypto');
            await this.prisma.alertNotificationLog.create({
              data: {
                id: crypto.randomUUID(),
                alertId: alert.id,
                userId: assignment.assignedToId,
                type: 'REMINDER',
                message: `Unseen Alert Reminder: Defect '${alert.defectName}' is still awaiting response.`,
              },
            });

            // Trigger core notification webhook to both local and onrender servers
            try {
              const msg = `Reminder! Your assigned alert '${alert.defectName}' (VIN: ${alert.vin || 'N/A'}) is unresolved and unseen.`;
              const coreUrls = [
                process.env.CORE_BACKEND_URL || 'http://127.0.0.1:3000/api/v1',
                'https://vams-backend.onrender.com/api/v1'
              ];
              const uniqueUrls = Array.from(new Set(coreUrls.map(u => u.trim().replace(/\/$/, ''))));

              await Promise.all(uniqueUrls.map(async (coreUrl) => {
                try {
                  await (global as any).fetch(`${coreUrl}/alerts/event`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      source: 'scheduler',
                      event_type: 'REMINDER',
                      companyId: alert.companyId,
                      alertId: alert.id,
                      assignedToUserId: assignment.assignedToId,
                      message: msg,
                    }),
                  });
                } catch (err: any) {
                  this.logger.warn(`Failed to trigger reminder webhook for ${coreUrl}: ${err.message}`);
                }
              }));
            } catch (err: any) {
              this.logger.warn(`Failed to trigger reminder webhook setup: ${err.message}`);
            }
          }
        }
      } catch (err: any) {
        this.logger.error(`Error processing SLA check for assignment ${assignment.id}: ${err.message}`);
      }
    }
  }
}
