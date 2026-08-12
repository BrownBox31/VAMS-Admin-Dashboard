const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Cleaning up existing data...');
  // Delete all in cascade or order to satisfy constraints
  await prisma.resolution.deleteMany({});
  await prisma.defectResolutionTimeline.deleteMany({});
  await prisma.alertAssignmentHistory.deleteMany({});
  await prisma.alert.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.companySettings.deleteMany({});
  await prisma.company.deleteMany({});

  console.log('Seeding VAMS Admin Portal data...');

  // 1. Create HQ Company for Super Admin
  const hqCompany = await prisma.company.create({
    data: {
      name: 'VAMS Global HQ',
      settings: {
        create: {
          maxUsers: 0,
          allowedRoles: ['SUPER_ADMIN'],
        }
      }
    }
  });

  // Create Super Admin user
  const superAdmin = await prisma.user.create({
    data: {
      email: 'admin@vams.com',
      name: 'Super Administrator',
      passwordHash: 'admin123',
      role: 'SUPER_ADMIN',
      companyId: hqCompany.id,
    }
  });

  // 1b. Create Bajaj Company and Admin
  const bajajCompany = await prisma.company.create({
    data: {
      name: 'Bajaj',
      settings: {
        create: {
          maxUsers: 10,
          allowedRoles: ['SUPER_ADMIN', 'FACTORY_MANAGER', 'SUPERVISOR', 'WORKER'],
        }
      }
    }
  });

  await prisma.user.create({
    data: {
      email: 'sbodkhe@gmail.com',
      name: 'S Bodkhe',
      passwordHash: 'Bajaj@123',
      role: 'SUPER_ADMIN',
      companyId: bajajCompany.id,
    }
  });

  // 2. Create Tata Motors Tenant
  const tataCompany = await prisma.company.create({
    data: {
      name: 'Tata Motors',
      settings: {
        create: {
          maxUsers: 10,
          allowedRoles: ['FACTORY_MANAGER', 'SUPERVISOR', 'WORKER', 'QUALITY_INSPECTOR'],
          whatsappEnabled: true,
          whatsappApiKey: 'tata_wa_key_xyz',
          whatsappSenderNum: '+14155238886',
        }
      }
    }
  });

  const tataManager = await prisma.user.create({
    data: {
      email: 'manager@tata.com',
      name: 'Tata Factory Manager',
      passwordHash: 'tata123',
      role: 'FACTORY_MANAGER',
      companyId: tataCompany.id,
    }
  });

  const tataWorker = await prisma.user.create({
    data: {
      email: 'worker@tata.com',
      name: 'Tata Floor Operator',
      passwordHash: 'tata123',
      role: 'WORKER',
      companyId: tataCompany.id,
    }
  });

  // Create Tata Alerts
  const alert1 = await prisma.alert.create({
    data: {
      vin: 'MALTATA778899123',
      companyId: tataCompany.id,
      defectName: 'Engine Misfire',
      severity: 'HIGH',
      status: 'OPEN',
      isManual: true,
    }
  });

  await prisma.defectResolutionTimeline.create({
    data: {
      alertId: alert1.id,
      actionType: 'CREATED',
      details: 'Manual defect Engine Misfire created for VIN MALTATA778899123 by Tata Factory Manager',
      performedByUserId: tataManager.id,
    }
  });

  const alert2 = await prisma.alert.create({
    data: {
      vin: 'MALTATA112233445',
      companyId: tataCompany.id,
      defectName: 'Brake System Fluid Leak',
      severity: 'CRITICAL',
      status: 'IN_PROGRESS',
      assignedToUserId: tataWorker.id,
      isManual: true,
    }
  });

  await prisma.defectResolutionTimeline.create({
    data: {
      alertId: alert2.id,
      actionType: 'CREATED',
      details: 'Manual defect Brake System Fluid Leak created for VIN MALTATA112233445',
      performedByUserId: tataManager.id,
    }
  });

  await prisma.alertAssignmentHistory.create({
    data: {
      alertId: alert2.id,
      assignedByUserId: tataManager.id,
      assignedToUserId: tataWorker.id,
      notes: 'Please inspect the front brake lines immediately.',
    }
  });

  await prisma.defectResolutionTimeline.create({
    data: {
      alertId: alert2.id,
      actionType: 'ASSIGNED',
      details: `Defect assigned to ${tataWorker.name} (${tataWorker.role})`,
      performedByUserId: tataManager.id,
    }
  });

  // 3. Create Mahindra Tenant
  const mahindraCompany = await prisma.company.create({
    data: {
      name: 'Mahindra',
      settings: {
        create: {
          maxUsers: 5,
          allowedRoles: ['FACTORY_MANAGER', 'WORKER'],
          whatsappEnabled: false,
        }
      }
    }
  });

  const mahindraManager = await prisma.user.create({
    data: {
      email: 'manager@mahindra.com',
      name: 'Mahindra Manager',
      passwordHash: 'mahindra123',
      role: 'FACTORY_MANAGER',
      companyId: mahindraCompany.id,
    }
  });

  const mahindraWorker = await prisma.user.create({
    data: {
      email: 'worker@mahindra.com',
      name: 'Mahindra Tech',
      passwordHash: 'mahindra123',
      role: 'WORKER',
      companyId: mahindraCompany.id,
    }
  });

  const alert3 = await prisma.alert.create({
    data: {
      vin: 'MALMAH112233445',
      companyId: mahindraCompany.id,
      defectName: 'Transmission Slippage',
      severity: 'MEDIUM',
      status: 'OPEN',
      isManual: true,
    }
  });

  await prisma.defectResolutionTimeline.create({
    data: {
      alertId: alert3.id,
      actionType: 'CREATED',
      details: 'Manual defect Transmission Slippage created by Mahindra Manager',
      performedByUserId: mahindraManager.id,
    }
  });

  // 4. Create Ashok Leyland Tenant
  const leylandCompany = await prisma.company.create({
    data: {
      name: 'Ashok Leyland',
      settings: {
        create: {
          maxUsers: 3,
          allowedRoles: ['SUPERVISOR', 'WORKER'],
          whatsappEnabled: false,
        }
      }
    }
  });

  const leylandSupervisor = await prisma.user.create({
    data: {
      email: 'supervisor@leyland.com',
      name: 'Leyland Supervisor',
      passwordHash: 'leyland123',
      role: 'SUPERVISOR',
      companyId: leylandCompany.id,
    }
  });

  const leylandWorker = await prisma.user.create({
    data: {
      email: 'worker@leyland.com',
      name: 'Leyland Operator',
      passwordHash: 'leyland123',
      role: 'WORKER',
      companyId: leylandCompany.id,
    }
  });

  // Seed resolved alert
  const alert4 = await prisma.alert.create({
    data: {
      vin: 'MALLEY556677889',
      companyId: leylandCompany.id,
      defectName: 'Electrical Harness Fault',
      severity: 'LOW',
      status: 'RESOLVED',
      isManual: true,
      assignedToUserId: leylandWorker.id,
    }
  });

  await prisma.defectResolutionTimeline.create({
    data: {
      alertId: alert4.id,
      actionType: 'CREATED',
      details: 'Defect created',
      performedByUserId: leylandSupervisor.id,
    }
  });

  await prisma.resolution.create({
    data: {
      alertId: alert4.id,
      resolvedByUserId: leylandWorker.id,
      reason: 'Replaced electrical connector on main wiring loom.',
    }
  });

  await prisma.defectResolutionTimeline.create({
    data: {
      alertId: alert4.id,
      actionType: 'RESOLVED',
      details: 'Defect resolved by Leyland Operator: Replaced electrical connector on main wiring loom.',
      performedByUserId: leylandWorker.id,
    }
  });

  console.log('Seeding completed successfully!');
  console.log('Super Admin login: admin@vams.com / admin123');
  console.log('Tata Manager login: manager@tata.com / tata123 (Company: Tata Motors)');
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
