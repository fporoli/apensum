import { relations } from "drizzle-orm/relations";
import { users, user_identities, organization_memberships, organizations, organization_domains, roles, organization_invitations, audit_logs, teams, projects, project_times, subprojects, timesheet_periods, versions, workflow_definitions, static_data, workflows, notifications, work_times, documents, absences, field_config, locations, org_holidays, balance_adjustments, vacation_entitlements, work_schedules, project_time_periods, work_time_months, departments, employee_assignments, timesheet_documents, flow_messages, flows, saved_reports, report_schedules, report_runs, exchange_rates, ai_usage, news_posts, balance_years, assistant_prompts, user_two_factor, personnel_documents, permissions, role_permissions, project_teams, team_members, newsletter_deliveries, newsletter_subscribers, organization_licenses, membership_roles, news_post_reads } from "./schema";

export const user_identitiesRelations = relations(user_identities, ({one}) => ({
	user: one(users, {
		fields: [user_identities.user_id],
		references: [users.id]
	}),
}));

export const usersRelations = relations(users, ({many}) => ({
	user_identities: many(user_identities),
	organization_memberships_deputy_user_id: many(organization_memberships, {
		relationName: "organization_memberships_deputy_user_id_users_id"
	}),
	organization_memberships_user_id: many(organization_memberships, {
		relationName: "organization_memberships_user_id_users_id"
	}),
	organization_invitations: many(organization_invitations),
	audit_logs: many(audit_logs),
	teams: many(teams),
	projects: many(projects),
	project_times: many(project_times),
	subprojects: many(subprojects),
	timesheet_periods_reviewed_by_user_id: many(timesheet_periods, {
		relationName: "timesheet_periods_reviewed_by_user_id_users_id"
	}),
	timesheet_periods_user_id: many(timesheet_periods, {
		relationName: "timesheet_periods_user_id_users_id"
	}),
	versions_created_by_user_id: many(versions, {
		relationName: "versions_created_by_user_id_users_id"
	}),
	versions_lastmodified_by_user_id: many(versions, {
		relationName: "versions_lastmodified_by_user_id_users_id"
	}),
	organizations: many(organizations),
	notifications: many(notifications),
	work_times: many(work_times),
	documents: many(documents),
	absences_reviewed_by_user_id: many(absences, {
		relationName: "absences_reviewed_by_user_id_users_id"
	}),
	absences_user_id: many(absences, {
		relationName: "absences_user_id_users_id"
	}),
	balance_adjustments_created_by_user_id: many(balance_adjustments, {
		relationName: "balance_adjustments_created_by_user_id_users_id"
	}),
	balance_adjustments_user_id: many(balance_adjustments, {
		relationName: "balance_adjustments_user_id_users_id"
	}),
	vacation_entitlements: many(vacation_entitlements),
	work_schedules: many(work_schedules),
	project_time_periods_reviewed_by_user_id: many(project_time_periods, {
		relationName: "project_time_periods_reviewed_by_user_id_users_id"
	}),
	project_time_periods_user_id: many(project_time_periods, {
		relationName: "project_time_periods_user_id_users_id"
	}),
	work_time_months_closed_by_user_id: many(work_time_months, {
		relationName: "work_time_months_closed_by_user_id_users_id"
	}),
	work_time_months_user_id: many(work_time_months, {
		relationName: "work_time_months_user_id_users_id"
	}),
	departments: many(departments),
	employee_assignments_manager_user_id: many(employee_assignments, {
		relationName: "employee_assignments_manager_user_id_users_id"
	}),
	employee_assignments_user_id: many(employee_assignments, {
		relationName: "employee_assignments_user_id_users_id"
	}),
	timesheet_documents: many(timesheet_documents),
	flow_messages: many(flow_messages),
	saved_reports: many(saved_reports),
	report_runs: many(report_runs),
	flows_assignee_user_id: many(flows, {
		relationName: "flows_assignee_user_id_users_id"
	}),
	flows_requester_user_id: many(flows, {
		relationName: "flows_requester_user_id_users_id"
	}),
	ai_usages: many(ai_usage),
	news_posts: many(news_posts),
	balance_years_closed_by_user_id: many(balance_years, {
		relationName: "balance_years_closed_by_user_id_users_id"
	}),
	balance_years_user_id: many(balance_years, {
		relationName: "balance_years_user_id_users_id"
	}),
	assistant_prompts: many(assistant_prompts),
	user_two_factors: many(user_two_factor),
	personnel_documents_uploaded_by_user_id: many(personnel_documents, {
		relationName: "personnel_documents_uploaded_by_user_id_users_id"
	}),
	personnel_documents_user_id: many(personnel_documents, {
		relationName: "personnel_documents_user_id_users_id"
	}),
	membership_roles: many(membership_roles),
	news_post_reads: many(news_post_reads),
}));

export const organization_membershipsRelations = relations(organization_memberships, ({one, many}) => ({
	user_deputy_user_id: one(users, {
		fields: [organization_memberships.deputy_user_id],
		references: [users.id],
		relationName: "organization_memberships_deputy_user_id_users_id"
	}),
	organization: one(organizations, {
		fields: [organization_memberships.organization_id],
		references: [organizations.id]
	}),
	user_user_id: one(users, {
		fields: [organization_memberships.user_id],
		references: [users.id],
		relationName: "organization_memberships_user_id_users_id"
	}),
	team_members: many(team_members),
	membership_roles: many(membership_roles),
}));

export const organizationsRelations = relations(organizations, ({one, many}) => ({
	organization_memberships: many(organization_memberships),
	organization_domains: many(organization_domains),
	roles: many(roles),
	organization_invitations: many(organization_invitations),
	audit_logs: many(audit_logs),
	teams: many(teams),
	projects: many(projects),
	project_times: many(project_times),
	subprojects: many(subprojects),
	timesheet_periods: many(timesheet_periods),
	user: one(users, {
		fields: [organizations.created_by_user_id],
		references: [users.id]
	}),
	organization: one(organizations, {
		fields: [organizations.parent_organization_id],
		references: [organizations.id],
		relationName: "organizations_parent_organization_id_organizations_id"
	}),
	organizations: many(organizations, {
		relationName: "organizations_parent_organization_id_organizations_id"
	}),
	workflow_definitions: many(workflow_definitions),
	static_data: many(static_data),
	workflows: many(workflows),
	notifications: many(notifications),
	work_times: many(work_times),
	documents: many(documents),
	absences: many(absences),
	field_configs: many(field_config),
	org_holidays: many(org_holidays),
	balance_adjustments: many(balance_adjustments),
	vacation_entitlements: many(vacation_entitlements),
	work_schedules: many(work_schedules),
	project_time_periods: many(project_time_periods),
	work_time_months: many(work_time_months),
	departments: many(departments),
	employee_assignments: many(employee_assignments),
	timesheet_documents: many(timesheet_documents),
	saved_reports: many(saved_reports),
	report_schedules: many(report_schedules),
	report_runs: many(report_runs),
	flows: many(flows),
	exchange_rates: many(exchange_rates),
	ai_usages: many(ai_usage),
	news_posts: many(news_posts),
	balance_years: many(balance_years),
	assistant_prompts: many(assistant_prompts),
	locations: many(locations),
	personnel_documents: many(personnel_documents),
	organization_licenses: many(organization_licenses),
}));

export const organization_domainsRelations = relations(organization_domains, ({one}) => ({
	organization: one(organizations, {
		fields: [organization_domains.organization_id],
		references: [organizations.id]
	}),
}));

export const rolesRelations = relations(roles, ({one, many}) => ({
	organization: one(organizations, {
		fields: [roles.organization_id],
		references: [organizations.id]
	}),
	organization_invitations: many(organization_invitations),
	role_permissions: many(role_permissions),
	team_members: many(team_members),
	membership_roles: many(membership_roles),
}));

export const organization_invitationsRelations = relations(organization_invitations, ({one}) => ({
	user: one(users, {
		fields: [organization_invitations.invited_by_user_id],
		references: [users.id]
	}),
	organization: one(organizations, {
		fields: [organization_invitations.organization_id],
		references: [organizations.id]
	}),
	role: one(roles, {
		fields: [organization_invitations.role_id],
		references: [roles.id]
	}),
}));

export const audit_logsRelations = relations(audit_logs, ({one}) => ({
	user: one(users, {
		fields: [audit_logs.actor_user_id],
		references: [users.id]
	}),
	organization: one(organizations, {
		fields: [audit_logs.organization_id],
		references: [organizations.id]
	}),
}));

export const teamsRelations = relations(teams, ({one, many}) => ({
	user: one(users, {
		fields: [teams.lead_user_id],
		references: [users.id]
	}),
	organization: one(organizations, {
		fields: [teams.organization_id],
		references: [organizations.id]
	}),
	workflows: many(workflows),
	project_teams: many(project_teams),
	team_members: many(team_members),
}));

export const projectsRelations = relations(projects, ({one, many}) => ({
	organization: one(organizations, {
		fields: [projects.organization_id],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [projects.owner_user_id],
		references: [users.id]
	}),
	project_times: many(project_times),
	subprojects: many(subprojects),
	project_time_periods: many(project_time_periods),
	project_teams: many(project_teams),
}));

export const project_timesRelations = relations(project_times, ({one}) => ({
	organization: one(organizations, {
		fields: [project_times.organization_id],
		references: [organizations.id]
	}),
	project: one(projects, {
		fields: [project_times.project_id],
		references: [projects.id]
	}),
	subproject: one(subprojects, {
		fields: [project_times.subproject_id],
		references: [subprojects.id]
	}),
	user: one(users, {
		fields: [project_times.user_id],
		references: [users.id]
	}),
}));

export const subprojectsRelations = relations(subprojects, ({one, many}) => ({
	project_times: many(project_times),
	organization: one(organizations, {
		fields: [subprojects.organization_id],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [subprojects.owner_user_id],
		references: [users.id]
	}),
	project: one(projects, {
		fields: [subprojects.project_id],
		references: [projects.id]
	}),
}));

export const timesheet_periodsRelations = relations(timesheet_periods, ({one, many}) => ({
	organization: one(organizations, {
		fields: [timesheet_periods.organization_id],
		references: [organizations.id]
	}),
	user_reviewed_by_user_id: one(users, {
		fields: [timesheet_periods.reviewed_by_user_id],
		references: [users.id],
		relationName: "timesheet_periods_reviewed_by_user_id_users_id"
	}),
	user_user_id: one(users, {
		fields: [timesheet_periods.user_id],
		references: [users.id],
		relationName: "timesheet_periods_user_id_users_id"
	}),
	work_time_months: many(work_time_months),
	timesheet_documents: many(timesheet_documents),
}));

export const versionsRelations = relations(versions, ({one}) => ({
	user_created_by_user_id: one(users, {
		fields: [versions.created_by_user_id],
		references: [users.id],
		relationName: "versions_created_by_user_id_users_id"
	}),
	user_lastmodified_by_user_id: one(users, {
		fields: [versions.lastmodified_by_user_id],
		references: [users.id],
		relationName: "versions_lastmodified_by_user_id_users_id"
	}),
}));

export const workflow_definitionsRelations = relations(workflow_definitions, ({one, many}) => ({
	organization: one(organizations, {
		fields: [workflow_definitions.organization_id],
		references: [organizations.id]
	}),
	workflows: many(workflows),
}));

export const static_dataRelations = relations(static_data, ({one}) => ({
	organization: one(organizations, {
		fields: [static_data.organization_id],
		references: [organizations.id]
	}),
}));

export const workflowsRelations = relations(workflows, ({one, many}) => ({
	team: one(teams, {
		fields: [workflows.assigned_to_team_id],
		references: [teams.id]
	}),
	organization: one(organizations, {
		fields: [workflows.organization_id],
		references: [organizations.id]
	}),
	workflow_definition: one(workflow_definitions, {
		fields: [workflows.workflow_def_id],
		references: [workflow_definitions.workflow_def_id]
	}),
	notifications: many(notifications),
}));

export const notificationsRelations = relations(notifications, ({one}) => ({
	organization: one(organizations, {
		fields: [notifications.organization_id],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [notifications.recipient_user_id],
		references: [users.id]
	}),
	workflow: one(workflows, {
		fields: [notifications.workflow_id],
		references: [workflows.workflow_id]
	}),
}));

export const work_timesRelations = relations(work_times, ({one}) => ({
	organization: one(organizations, {
		fields: [work_times.organization_id],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [work_times.user_id],
		references: [users.id]
	}),
}));

export const documentsRelations = relations(documents, ({one, many}) => ({
	organization: one(organizations, {
		fields: [documents.organization_id],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [documents.uploaded_by_user_id],
		references: [users.id]
	}),
	absences: many(absences),
	timesheet_documents: many(timesheet_documents),
	report_runs: many(report_runs),
	personnel_documents: many(personnel_documents),
}));

export const absencesRelations = relations(absences, ({one}) => ({
	document: one(documents, {
		fields: [absences.document_id],
		references: [documents.id]
	}),
	organization: one(organizations, {
		fields: [absences.organization_id],
		references: [organizations.id]
	}),
	user_reviewed_by_user_id: one(users, {
		fields: [absences.reviewed_by_user_id],
		references: [users.id],
		relationName: "absences_reviewed_by_user_id_users_id"
	}),
	user_user_id: one(users, {
		fields: [absences.user_id],
		references: [users.id],
		relationName: "absences_user_id_users_id"
	}),
}));

export const field_configRelations = relations(field_config, ({one}) => ({
	organization: one(organizations, {
		fields: [field_config.organization_id],
		references: [organizations.id]
	}),
}));

export const org_holidaysRelations = relations(org_holidays, ({one}) => ({
	location: one(locations, {
		fields: [org_holidays.location_id],
		references: [locations.id]
	}),
	organization: one(organizations, {
		fields: [org_holidays.organization_id],
		references: [organizations.id]
	}),
}));

export const locationsRelations = relations(locations, ({one, many}) => ({
	org_holidays: many(org_holidays),
	employee_assignments: many(employee_assignments),
	organization: one(organizations, {
		fields: [locations.organization_id],
		references: [organizations.id]
	}),
}));

export const balance_adjustmentsRelations = relations(balance_adjustments, ({one}) => ({
	user_created_by_user_id: one(users, {
		fields: [balance_adjustments.created_by_user_id],
		references: [users.id],
		relationName: "balance_adjustments_created_by_user_id_users_id"
	}),
	organization: one(organizations, {
		fields: [balance_adjustments.organization_id],
		references: [organizations.id]
	}),
	user_user_id: one(users, {
		fields: [balance_adjustments.user_id],
		references: [users.id],
		relationName: "balance_adjustments_user_id_users_id"
	}),
}));

export const vacation_entitlementsRelations = relations(vacation_entitlements, ({one}) => ({
	organization: one(organizations, {
		fields: [vacation_entitlements.organization_id],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [vacation_entitlements.user_id],
		references: [users.id]
	}),
}));

export const work_schedulesRelations = relations(work_schedules, ({one}) => ({
	organization: one(organizations, {
		fields: [work_schedules.organization_id],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [work_schedules.user_id],
		references: [users.id]
	}),
}));

export const project_time_periodsRelations = relations(project_time_periods, ({one}) => ({
	organization: one(organizations, {
		fields: [project_time_periods.organization_id],
		references: [organizations.id]
	}),
	project: one(projects, {
		fields: [project_time_periods.project_id],
		references: [projects.id]
	}),
	user_reviewed_by_user_id: one(users, {
		fields: [project_time_periods.reviewed_by_user_id],
		references: [users.id],
		relationName: "project_time_periods_reviewed_by_user_id_users_id"
	}),
	user_user_id: one(users, {
		fields: [project_time_periods.user_id],
		references: [users.id],
		relationName: "project_time_periods_user_id_users_id"
	}),
}));

export const work_time_monthsRelations = relations(work_time_months, ({one}) => ({
	user_closed_by_user_id: one(users, {
		fields: [work_time_months.closed_by_user_id],
		references: [users.id],
		relationName: "work_time_months_closed_by_user_id_users_id"
	}),
	organization: one(organizations, {
		fields: [work_time_months.organization_id],
		references: [organizations.id]
	}),
	timesheet_period: one(timesheet_periods, {
		fields: [work_time_months.timesheet_period_id],
		references: [timesheet_periods.id]
	}),
	user_user_id: one(users, {
		fields: [work_time_months.user_id],
		references: [users.id],
		relationName: "work_time_months_user_id_users_id"
	}),
}));

export const departmentsRelations = relations(departments, ({one, many}) => ({
	user: one(users, {
		fields: [departments.leader_user_id],
		references: [users.id]
	}),
	organization: one(organizations, {
		fields: [departments.organization_id],
		references: [organizations.id]
	}),
	employee_assignments: many(employee_assignments),
	flows: many(flows),
}));

export const employee_assignmentsRelations = relations(employee_assignments, ({one}) => ({
	department: one(departments, {
		fields: [employee_assignments.department_id],
		references: [departments.id]
	}),
	location: one(locations, {
		fields: [employee_assignments.location_id],
		references: [locations.id]
	}),
	user_manager_user_id: one(users, {
		fields: [employee_assignments.manager_user_id],
		references: [users.id],
		relationName: "employee_assignments_manager_user_id_users_id"
	}),
	organization: one(organizations, {
		fields: [employee_assignments.organization_id],
		references: [organizations.id]
	}),
	user_user_id: one(users, {
		fields: [employee_assignments.user_id],
		references: [users.id],
		relationName: "employee_assignments_user_id_users_id"
	}),
}));

export const timesheet_documentsRelations = relations(timesheet_documents, ({one}) => ({
	document: one(documents, {
		fields: [timesheet_documents.document_id],
		references: [documents.id]
	}),
	organization: one(organizations, {
		fields: [timesheet_documents.organization_id],
		references: [organizations.id]
	}),
	timesheet_period: one(timesheet_periods, {
		fields: [timesheet_documents.timesheet_period_id],
		references: [timesheet_periods.id]
	}),
	user: one(users, {
		fields: [timesheet_documents.user_id],
		references: [users.id]
	}),
}));

export const flow_messagesRelations = relations(flow_messages, ({one}) => ({
	user: one(users, {
		fields: [flow_messages.author_user_id],
		references: [users.id]
	}),
	flow: one(flows, {
		fields: [flow_messages.flow_id],
		references: [flows.id]
	}),
}));

export const flowsRelations = relations(flows, ({one, many}) => ({
	flow_messages: many(flow_messages),
	user_assignee_user_id: one(users, {
		fields: [flows.assignee_user_id],
		references: [users.id],
		relationName: "flows_assignee_user_id_users_id"
	}),
	organization: one(organizations, {
		fields: [flows.organization_id],
		references: [organizations.id]
	}),
	user_requester_user_id: one(users, {
		fields: [flows.requester_user_id],
		references: [users.id],
		relationName: "flows_requester_user_id_users_id"
	}),
	department: one(departments, {
		fields: [flows.target_department_id],
		references: [departments.id]
	}),
}));

export const saved_reportsRelations = relations(saved_reports, ({one, many}) => ({
	organization: one(organizations, {
		fields: [saved_reports.organization_id],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [saved_reports.owner_user_id],
		references: [users.id]
	}),
	report_schedules: many(report_schedules),
}));

export const report_schedulesRelations = relations(report_schedules, ({one, many}) => ({
	organization: one(organizations, {
		fields: [report_schedules.organization_id],
		references: [organizations.id]
	}),
	saved_report: one(saved_reports, {
		fields: [report_schedules.saved_report_id],
		references: [saved_reports.id]
	}),
	report_runs: many(report_runs),
}));

export const report_runsRelations = relations(report_runs, ({one}) => ({
	document: one(documents, {
		fields: [report_runs.document_id],
		references: [documents.id]
	}),
	organization: one(organizations, {
		fields: [report_runs.organization_id],
		references: [organizations.id]
	}),
	report_schedule: one(report_schedules, {
		fields: [report_runs.schedule_id],
		references: [report_schedules.id]
	}),
	user: one(users, {
		fields: [report_runs.user_id],
		references: [users.id]
	}),
}));

export const exchange_ratesRelations = relations(exchange_rates, ({one}) => ({
	organization: one(organizations, {
		fields: [exchange_rates.organization_id],
		references: [organizations.id]
	}),
}));

export const ai_usageRelations = relations(ai_usage, ({one}) => ({
	organization: one(organizations, {
		fields: [ai_usage.organization_id],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [ai_usage.user_id],
		references: [users.id]
	}),
}));

export const news_postsRelations = relations(news_posts, ({one, many}) => ({
	user: one(users, {
		fields: [news_posts.author_user_id],
		references: [users.id]
	}),
	organization: one(organizations, {
		fields: [news_posts.organization_id],
		references: [organizations.id]
	}),
	newsletter_deliveries: many(newsletter_deliveries),
	news_post_reads: many(news_post_reads),
}));

export const balance_yearsRelations = relations(balance_years, ({one}) => ({
	user_closed_by_user_id: one(users, {
		fields: [balance_years.closed_by_user_id],
		references: [users.id],
		relationName: "balance_years_closed_by_user_id_users_id"
	}),
	organization: one(organizations, {
		fields: [balance_years.organization_id],
		references: [organizations.id]
	}),
	user_user_id: one(users, {
		fields: [balance_years.user_id],
		references: [users.id],
		relationName: "balance_years_user_id_users_id"
	}),
}));

export const assistant_promptsRelations = relations(assistant_prompts, ({one}) => ({
	organization: one(organizations, {
		fields: [assistant_prompts.organization_id],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [assistant_prompts.user_id],
		references: [users.id]
	}),
}));

export const user_two_factorRelations = relations(user_two_factor, ({one}) => ({
	user: one(users, {
		fields: [user_two_factor.user_id],
		references: [users.id]
	}),
}));

export const personnel_documentsRelations = relations(personnel_documents, ({one}) => ({
	document: one(documents, {
		fields: [personnel_documents.document_id],
		references: [documents.id]
	}),
	organization: one(organizations, {
		fields: [personnel_documents.organization_id],
		references: [organizations.id]
	}),
	user_uploaded_by_user_id: one(users, {
		fields: [personnel_documents.uploaded_by_user_id],
		references: [users.id],
		relationName: "personnel_documents_uploaded_by_user_id_users_id"
	}),
	user_user_id: one(users, {
		fields: [personnel_documents.user_id],
		references: [users.id],
		relationName: "personnel_documents_user_id_users_id"
	}),
}));

export const role_permissionsRelations = relations(role_permissions, ({one}) => ({
	permission: one(permissions, {
		fields: [role_permissions.permission_id],
		references: [permissions.id]
	}),
	role: one(roles, {
		fields: [role_permissions.role_id],
		references: [roles.id]
	}),
}));

export const permissionsRelations = relations(permissions, ({many}) => ({
	role_permissions: many(role_permissions),
}));

export const project_teamsRelations = relations(project_teams, ({one}) => ({
	project: one(projects, {
		fields: [project_teams.project_id],
		references: [projects.id]
	}),
	team: one(teams, {
		fields: [project_teams.team_id],
		references: [teams.id]
	}),
}));

export const team_membersRelations = relations(team_members, ({one}) => ({
	organization_membership: one(organization_memberships, {
		fields: [team_members.membership_id],
		references: [organization_memberships.id]
	}),
	team: one(teams, {
		fields: [team_members.team_id],
		references: [teams.id]
	}),
	role: one(roles, {
		fields: [team_members.team_role_id],
		references: [roles.id]
	}),
}));

export const newsletter_deliveriesRelations = relations(newsletter_deliveries, ({one}) => ({
	news_post: one(news_posts, {
		fields: [newsletter_deliveries.post_id],
		references: [news_posts.id]
	}),
	newsletter_subscriber: one(newsletter_subscribers, {
		fields: [newsletter_deliveries.subscriber_id],
		references: [newsletter_subscribers.id]
	}),
}));

export const newsletter_subscribersRelations = relations(newsletter_subscribers, ({many}) => ({
	newsletter_deliveries: many(newsletter_deliveries),
}));

export const organization_licensesRelations = relations(organization_licenses, ({one}) => ({
	organization: one(organizations, {
		fields: [organization_licenses.organization_id],
		references: [organizations.id]
	}),
}));

export const membership_rolesRelations = relations(membership_roles, ({one}) => ({
	user: one(users, {
		fields: [membership_roles.granted_by_user_id],
		references: [users.id]
	}),
	organization_membership: one(organization_memberships, {
		fields: [membership_roles.membership_id],
		references: [organization_memberships.id]
	}),
	role: one(roles, {
		fields: [membership_roles.role_id],
		references: [roles.id]
	}),
}));

export const news_post_readsRelations = relations(news_post_reads, ({one}) => ({
	news_post: one(news_posts, {
		fields: [news_post_reads.post_id],
		references: [news_posts.id]
	}),
	user: one(users, {
		fields: [news_post_reads.user_id],
		references: [users.id]
	}),
}));