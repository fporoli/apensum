import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './jwt.guard';
import { HealthController } from './health.controller';
import { AboutController } from './about.controller';
import { ProjectTimeService } from './project-time.service';
import { RbacService } from './rbac.service';
import { ScreenShareController } from './screen-share.controller';
import { ScreenShareService } from './screen-share.service';
import { AuditService } from './audit.service';
import { VersionsService } from './versions.service';
import { WorkflowsService } from './workflows.service';
import { AuthController } from './auth.controller';
import { UsersController } from './users.controller';
import { OrgsController } from './orgs.controller';
import { PermissionsController } from './permissions.controller';
import { OrgRolesController, RolesController } from './roles.controller';
import { TeamsController } from './teams.controller';
import { ProjectsController } from './projects.controller';
import { ProjectTimeController } from './project-time.controller';
import { WorkTimeController } from './work-time.controller';
import { WorkTimeService } from './work-time.service';
import { DocumentsService } from './documents.service';
import { AbsencesController } from './absences.controller';
import { BalancesController } from './balances.controller';
import { WorkSchedulesController } from './work-schedules.controller';
import { VacationController } from './vacation.controller';
import { TeamOverviewController } from './team-overview.controller';
import { EmploymentController } from './employment.controller';
import { LocationsController } from './locations.controller';
import { RequestsController } from './requests.controller';
import { NewsController } from './news.controller';
import { PublicNewsController } from './public-news.controller';
import { DocumentsController } from './documents.controller';
import { DirectoryController } from './directory.controller';
import { ReportsController } from './reports.controller';
import { SetupController } from './setup.controller';
import { SavedReportsController } from './saved-reports.controller';
import { ReportsService } from './reports.service';
import { ReportSchedulesService } from './report-schedules.service';
import { PersonnelDocumentsController } from './personnel-documents.controller';
import { WeekReportController } from './week-report.controller';
import { TimesheetDocumentsService } from './timesheet-documents.service';
import { ForwardMailService } from './forward-mail.service';
import { WorkTimeModelService } from './work-time-model.service';
import { BalancesService } from './balances.service';
import { RequestsService } from './requests.service';
import { ProjectTimesheetsController } from './project-timesheets.controller';
import { TimesheetsController } from './timesheets.controller';
import { SiteContactController } from './site-contact.controller';
import { SiteNewsletterController } from './site-newsletter.controller';
import { WorkflowsController } from './workflows.controller';
import { StaticDataController } from './static-data.controller';
import { AuditController } from './audit.controller';
import { AssistantController } from './assistant.controller';
import { AvatarsController } from './avatars.controller';
import { AssistantService } from './assistant.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';
import { BasicDataController } from './basicdata.controller';
import { BasicDataService } from './basicdata.service';
import { FieldsController } from './fields.controller';
import { FieldsService } from './fields.service';
import { DbService } from './db.service';
import { ImportExportController } from './import-export.controller';
import { ImportExportService } from './import-export.service';
import { CalendarFeedController } from './calendar-feed.controller';
import { CalendarFeedService } from './calendar-feed.service';
import { AiSettingsController } from './ai-settings.controller';
import { OperatorController } from './operator.controller';
import { AiBudgetService } from './ai-budget.service';
import { loadApiPlugins } from './plugins';
import { API_PLUGINS, PluginRegistrar } from './plugin-registrar';

// Plugins (plugins/<id>, docs/PLUGINS.md): their controllers and providers join the core's.
const plugins = loadApiPlugins();

@Module({
  controllers: [
    ScreenShareController,
    HealthController,
    AboutController,
    AuthController,
    UsersController,
    BasicDataController,
    FieldsController,
    OrgsController,
    PermissionsController,
    RolesController,
    OrgRolesController,
    TeamsController,
    ProjectsController,
    ProjectTimeController,
    WorkTimeController,
    AbsencesController,
    BalancesController,
    WorkSchedulesController, VacationController,
    TeamOverviewController,
    EmploymentController,
    LocationsController,
    RequestsController,
    NewsController,
    PublicNewsController,
    DocumentsController,
    DirectoryController,
    ReportsController,
    SetupController,
    SavedReportsController,
    PersonnelDocumentsController,
    WeekReportController,
    TimesheetsController,
    ProjectTimesheetsController,
    SiteContactController,
    SiteNewsletterController,
    WorkflowsController,
    StaticDataController,
    AuditController,
    AssistantController,
    AvatarsController,
    NotificationsController,
    ImportExportController,
    CalendarFeedController,
    AiSettingsController,
    OperatorController,
    ...plugins.controllers,
  ],
  providers: [
    DbService,
    AiBudgetService,
    ImportExportService,
    CalendarFeedService,
    ProjectTimeService,
    WorkTimeService,
    BalancesService,
    RequestsService,
    ReportsService,
    ReportSchedulesService,
    WorkTimeModelService,
    DocumentsService,
    TimesheetDocumentsService,
    ForwardMailService,
    RbacService,
    ScreenShareService,
    AuditService,
    VersionsService,
    WorkflowsService,
    AssistantService,
    NotificationsService,
    NotificationsGateway,
    BasicDataService,
    FieldsService,
    { provide: API_PLUGINS, useValue: plugins.plugins },
    PluginRegistrar,
    ...plugins.providers,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
