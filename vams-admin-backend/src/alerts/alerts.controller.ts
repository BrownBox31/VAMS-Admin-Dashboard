import { Controller, Post, Body, Get, Put, Delete, UseGuards, Request, Param, Patch } from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { CreateManualAlertDto } from './dto/create-manual-alert.dto';
import { CreateAlertDefinitionDto } from './dto/create-alert-definition.dto';
import { CreateBroadcastDto } from './dto/create-broadcast.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('alerts')
@UseGuards(JwtAuthGuard)
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get('python-raw')
  getPythonRaw() {
    return this.alertsService.getPythonRaw();
  }

  @Get('python-cleaned')
  getPythonCleaned() {
    return this.alertsService.getPythonCleaned();
  }

  @Get('python-grouped')
  getPythonGrouped() {
    return this.alertsService.getPythonGrouped();
  }

  @Post('python-clean')
  runPythonClean() {
    return this.alertsService.runPythonClean();
  }

  @Post('python-cluster')
  runPythonCluster() {
    return this.alertsService.runPythonCluster();
  }

  @Get('python-status')
  getPythonStatus() {
    return this.alertsService.getPythonStatus();
  }

  @Post('python-sync-db')
  syncPythonDb(@Request() req: any) {
    const companyId = req.user.role === 'SUPER_ADMIN'
      ? (req.headers['x-company-id'] || req.user.companyId)
      : req.user.companyId;
    return this.alertsService.syncPythonToDb(companyId);
  }

  @Post('manual')
  createManual(
    @Request() req: any,
    @Body() dto: CreateManualAlertDto,
  ) {
    const companyId = req.user.role === 'SUPER_ADMIN'
      ? (req.headers['x-company-id'] || req.user.companyId)
      : req.user.companyId;
    return this.alertsService.createManualAlert(companyId, req.user.id, dto);
  }

  @Get('analytics')
  getAnalytics(@Request() req: any) {
    const companyId = req.user.role === 'SUPER_ADMIN'
      ? (req.headers['x-company-id'] || 'all')
      : req.user.companyId;
    return this.alertsService.getAdvancedAnalytics(companyId, req.user);
  }

  // Alert Definitions CRUD
  @Get('definitions')
  getDefinitions(@Request() req: any) {
    const companyId = req.user.role === 'SUPER_ADMIN'
      ? (req.headers['x-company-id'] || req.user.companyId)
      : req.user.companyId;
    return this.alertsService.getDefinitions(companyId);
  }

  @Post('definitions')
  createDefinition(@Request() req: any, @Body() dto: CreateAlertDefinitionDto) {
    const companyId = req.user.role === 'SUPER_ADMIN'
      ? (req.headers['x-company-id'] || req.user.companyId)
      : req.user.companyId;
    return this.alertsService.createDefinition(companyId, req.user.id, dto);
  }

  @Put('definitions/:id')
  updateDefinition(@Request() req: any, @Param('id') id: string, @Body() dto: CreateAlertDefinitionDto) {
    const companyId = req.user.role === 'SUPER_ADMIN'
      ? (req.headers['x-company-id'] || req.user.companyId)
      : req.user.companyId;
    return this.alertsService.updateDefinition(companyId, id, dto);
  }

  @Delete('definitions/:id')
  deleteDefinition(@Request() req: any, @Param('id') id: string) {
    const companyId = req.user.role === 'SUPER_ADMIN'
      ? (req.headers['x-company-id'] || req.user.companyId)
      : req.user.companyId;
    return this.alertsService.deleteDefinition(companyId, id);
  }

  @Post('definitions/:id/dispatch')
  dispatchDefinition(@Request() req: any, @Param('id') id: string) {
    const companyId = req.user.role === 'SUPER_ADMIN'
      ? (req.headers['x-company-id'] || req.user.companyId)
      : req.user.companyId;
    return this.alertsService.dispatchDefinition(companyId, req.user.id, id);
  }

  // Broadcasts Endpoints
  @Post('broadcast')
  createBroadcast(@Request() req: any, @Body() dto: CreateBroadcastDto) {
    const companyId = req.user.role === 'SUPER_ADMIN'
      ? (req.headers['x-company-id'] || req.user.companyId || 'all')
      : (req.user.companyId || 'all');
    return this.alertsService.createBroadcast(companyId, req.user.id, dto);
  }

  @Get('broadcasts')
  getBroadcasts(@Request() req: any) {
    const companyId = req.user.role === 'SUPER_ADMIN'
      ? (req.headers['x-company-id'] || req.user.companyId || 'all')
      : (req.user.companyId || 'all');
    return this.alertsService.getBroadcasts(companyId);
  }

  @Delete('broadcasts/:id')
  deleteBroadcast(@Request() req: any, @Param('id') id: string) {
    const companyId = req.user.role === 'SUPER_ADMIN'
      ? (req.headers['x-company-id'] || req.user.companyId || 'all')
      : (req.user.companyId || 'all');
    return this.alertsService.deleteBroadcast(companyId, id);
  }

  // Live Alert Actions
  @Post(':id/takeover')
  takeoverAlert(@Request() req: any, @Param('id') id: string) {
    return this.alertsService.takeoverAlert(req.user.id, id, req.headers.authorization);
  }

  @Post(':id/resolve')
  resolveAlert(@Request() req: any, @Param('id') id: string, @Body('reason') reason: string) {
    return this.alertsService.resolveAlert(req.user.id, id, reason, req.headers.authorization);
  }

  @Post(':id/reopen')
  reopenAlert(@Request() req: any, @Param('id') id: string) {
    return this.alertsService.reopenAlert(req.user.id, id, req.headers.authorization);
  }

  @Patch(':id/assign')
  reassignAlert(@Request() req: any, @Param('id') id: string, @Body('assignedToUserId') assignedToUserId: string) {
    return this.alertsService.reassignAlert(req.user.id, id, assignedToUserId, req.headers.authorization);
  }

  @Get()
  findAll(@Request() req: any) {
    const companyId = req.user.role === 'SUPER_ADMIN'
      ? (req.headers['x-company-id'] || 'all')
      : req.user.companyId;
    return this.alertsService.findAll(companyId, req.user);
  }

  @Get('defect-masters')
  getDefectMasters(@Request() req: any) {
    const companyId = req.user.role === 'SUPER_ADMIN'
      ? (req.headers['x-company-id'] || 'all')
      : req.user.companyId;
    return this.alertsService.getDefectMasters(companyId);
  }

  @Get(':id')
  findOne(@Request() req: any, @Param('id') id: string) {
    const companyId = req.user.role === 'SUPER_ADMIN'
      ? (req.headers['x-company-id'] || 'all')
      : req.user.companyId;
    return this.alertsService.findOne(companyId, id, req.user);
  }
}
