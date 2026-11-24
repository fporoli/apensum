import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { AuditService } from './audit.service';
import { DocumentsService } from './documents.service';
import type { ApiPlugin, PluginCore } from './plugin';
import { VersionsService } from './versions.service';
import { WorkflowsService } from './workflows.service';

/** The loaded plugins (plugins.ts), for providers that register what they declare. */
export const API_PLUGINS = Symbol('API_PLUGINS');

/**
 * Registers what the plugins declare in defineApiPlugin with the core services that use it:
 * workflow actions, source tables and manager routing (WorkflowsService) and personal documents
 * (DocumentsService). Reports, team views, payroll items and backups are registered while the
 * plugins load (plugins.ts), since they live in module-level catalogues.
 */
@Injectable()
export class PluginRegistrar implements OnModuleInit {
  constructor(
    @Inject(API_PLUGINS) private readonly plugins: readonly ApiPlugin[],
    private readonly workflows: WorkflowsService,
    private readonly documents: DocumentsService,
    private readonly versions: VersionsService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    const core: PluginCore = { versions: this.versions, audit: this.audit };
    for (const plugin of this.plugins) {
      const wf = plugin.workflows;
      for (const [name, action] of Object.entries(wf?.actions ?? {})) {
        this.workflows.registerAction(name, (db, ctx) => action(db, ctx, core));
      }
      for (const [table, source] of Object.entries(wf?.sources ?? {})) {
        this.workflows.registerSourceOrgResolver(table, source.organization);
        if (source.records) this.workflows.registerSourceRecords(table, source.records.field, source.records.load);
      }
      for (const name of wf?.managerRouted ?? []) this.workflows.registerManagerRoutedWorkflow(name);
      for (const kind of wf?.kinds ?? []) this.workflows.registerKind(kind);
      for (const [category, list] of Object.entries(plugin.documents ?? {})) this.documents.registerPersonalDocuments(category, list);
    }
  }
}
