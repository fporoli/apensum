import { relations } from "drizzle-orm/relations";
import { organizations, ai_usage, users, news_posts, basicdata_versions, absences, documents, field_config, work_schedules, org_holidays, balance_adjustments, vacation_entitlements, project_time_periods, projects, work_time_months, timesheet_periods, departments, employee_assignments, user_identities, organization_domains, roles, teams, organization_memberships, organization_invitations, audit_logs, subprojects, project_times, static_data, versions, workflow_definitions, workflows, notifications, work_times, work_time_balance_entries, requests, request_messages, timesheet_documents, report_schedules, saved_reports, personnel_documents, report_runs, news_post_departments, news_post_documents, role_permissions, permissions, request_message_documents, project_teams, newsletter_deliveries, newsletter_subscribers, team_members, news_post_reads, membership_roles, work_time_balances } from "./schema";

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

export const organizationsRelations = relations(organizations, ({one, many}) => ({
	ai_usages: many(ai_usage),
	news_posts: many(news_posts),
	absences: many(absences),
	field_configs: many(field_config),
	work_schedules: many(work_schedules),
	org_holidays: many(org_holidays),
	balance_adjustments: many(balance_adjustments),
	vacation_entitlements: many(vacation_entitlements),
	project_time_periods: many(project_time_periods),
	work_time_months: many(work_time_months),
	departments: many(departments),
	employee_assignments: many(employee_assignments),
	organization_domains: many(organization_domains),
	roles: many(roles),
	teams: many(teams),
	organization_memberships: many(organization_memberships),
	organization_invitations: many(organization_invitations),
	audit_logs: many(audit_logs),
	projects: many(projects),
	subprojects: many(subprojects),
	project_times: many(project_times),
	static_data: many(static_data),
	timesheet_periods: many(timesheet_periods),
	organization: one(organizations, {
		fields: [organizations.parent_organization_id],
		references: [organizations.id],
		relationName: "organizations_parent_organization_id_organizations_id"
	}),
	organizations: many(organizations, {
		relationName: "organizations_parent_organization_id_organizations_id"
	}),
	user: one(users, {
		fields: [organizations.created_by_user_id],
		references: [users.id]
	}),
	workflow_definitions: many(workflow_definitions),
	notifications: many(notifications),
	work_times: many(work_times),
	work_time_balance_entries: many(work_time_balance_entries),
	documents: many(documents),
	requests: many(requests),
	timesheet_documents: many(timesheet_documents),
	report_schedules: many(report_schedules),
	personnel_documents: many(personnel_documents),
	saved_reports: many(saved_reports),
	report_runs: many(report_runs),
	work_time_balances: many(work_time_balances),
}));

export const usersRelations = relations(users, ({many}) => ({
	ai_usages: many(ai_usage),
	news_posts: many(news_posts),
	basicdata_versions_user_id: many(basicdata_versions, {
		relationName: "basicdata_versions_user_id_users_id"
	}),
	basicdata_versions_lastmodified_by_user_id: many(basicdata_versions, {
		relationName: "basicdata_versions_lastmodified_by_user_id_users_id"
	}),
	absences_user_id: many(absences, {
		relationName: "absences_user_id_users_id"
	}),
	absences_reviewed_by_user_id: many(absences, {
		relationName: "absences_reviewed_by_user_id_users_id"
	}),
	work_schedules: many(work_schedules),
	balance_adjustments_user_id: many(balance_adjustments, {
		relationName: "balance_adjustments_user_id_users_id"
	}),
	balance_adjustments_created_by_user_id: many(balance_adjustments, {
		relationName: "balance_adjustments_created_by_user_id_users_id"
	}),
	vacation_entitlements: many(vacation_entitlements),
	project_time_periods_user_id: many(project_time_periods, {
		relationName: "project_time_periods_user_id_users_id"
	}),
	project_time_periods_reviewed_by_user_id: many(project_time_periods, {
		relationName: "project_time_periods_reviewed_by_user_id_users_id"
	}),
	work_time_months_user_id: many(work_time_months, {
		relationName: "work_time_months_user_id_users_id"
	}),
	work_time_months_closed_by_user_id: many(work_time_months, {
		relationName: "work_time_months_closed_by_user_id_users_id"
	}),
	departments: many(departments),
	employee_assignments_user_id: many(employee_assignments, {
		relationName: "employee_assignments_user_id_users_id"
	}),
	employee_assignments_manager_user_id: many(employee_assignments, {
		relationName: "employee_assignments_manager_user_id_users_id"
	}),
	user_identities: many(user_identities),
	teams: many(teams),
	organization_memberships: many(organization_memberships),
	organization_invitations: many(organization_invitations),
	audit_logs: many(audit_logs),
	projects: many(projects),
	subprojects: many(subprojects),
	project_times: many(project_times),
	timesheet_periods_user_id: many(timesheet_periods, {
		relationName: "timesheet_periods_user_id_users_id"
	}),
	timesheet_periods_reviewed_by_user_id: many(timesheet_periods, {
		relationName: "timesheet_periods_reviewed_by_user_id_users_id"
	}),
	organizations: many(organizations),
	versions_created_by_user_id: many(versions, {
		relationName: "versions_created_by_user_id_users_id"
	}),
	versions_lastmodified_by_user_id: many(versions, {
		relationName: "versions_lastmodified_by_user_id_users_id"
	}),
	notifications: many(notifications),
	work_times: many(work_times),
	work_time_balance_entries_user_id: many(work_time_balance_entries, {
		relationName: "work_time_balance_entries_user_id_users_id"
	}),
	work_time_balance_entries_created_by_user_id: many(work_time_balance_entries, {
		relationName: "work_time_balance_entries_created_by_user_id_users_id"
	}),
	documents: many(documents),
	request_messages: many(request_messages),
	requests_requester_user_id: many(requests, {
		relationName: "requests_requester_user_id_users_id"
	}),
	requests_assignee_user_id: many(requests, {
		relationName: "requests_assignee_user_id_users_id"
	}),
	timesheet_documents: many(timesheet_documents),
	personnel_documents_user_id: many(personnel_documents, {
		relationName: "personnel_documents_user_id_users_id"
	}),
	personnel_documents_uploaded_by_user_id: many(personnel_documents, {
		relationName: "personnel_documents_uploaded_by_user_id_users_id"
	}),
	saved_reports: many(saved_reports),
	report_runs: many(report_runs),
	news_post_reads: many(news_post_reads),
	membership_roles: many(membership_roles),
	work_time_balances: many(work_time_balances),
}));

export const news_postsRelations = relations(news_posts, ({one, many}) => ({
	organization: one(organizations, {
		fields: [news_posts.organization_id],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [news_posts.author_user_id],
		references: [users.id]
	}),
	news_post_departments: many(news_post_departments),
	news_post_documents: many(news_post_documents),
	newsletter_deliveries: many(newsletter_deliveries),
	news_post_reads: many(news_post_reads),
}));

export const basicdata_versionsRelations = relations(basicdata_versions, ({one}) => ({
	user_user_id: one(users, {
		fields: [basicdata_versions.user_id],
		references: [users.id],
		relationName: "basicdata_versions_user_id_users_id"
	}),
	user_lastmodified_by_user_id: one(users, {
		fields: [basicdata_versions.lastmodified_by_user_id],
		references: [users.id],
		relationName: "basicdata_versions_lastmodified_by_user_id_users_id"
	}),
}));

export const absencesRelations = relations(absences, ({one}) => ({
	organization: one(organizations, {
		fields: [absences.organization_id],
		references: [organizations.id]
	}),
	user_user_id: one(users, {
		fields: [absences.user_id],
		references: [users.id],
		relationName: "absences_user_id_users_id"
	}),
	user_reviewed_by_user_id: one(users, {
		fields: [absences.reviewed_by_user_id],
		references: [users.id],
		relationName: "absences_reviewed_by_user_id_users_id"
	}),
	document: one(documents, {
		fields: [absences.document_id],
		references: [documents.id]
	}),
}));

export const documentsRelations = relations(documents, ({one, many}) => ({
	absences: many(absences),
	organization: one(organizations, {
		fields: [documents.organization_id],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [documents.uploaded_by_user_id],
		references: [users.id]
	}),
	timesheet_documents: many(timesheet_documents),
	personnel_documents: many(personnel_documents),
	report_runs: many(report_runs),
	news_post_documents: many(news_post_documents),
	request_message_documents: many(request_message_documents),
}));

export const field_configRelations = relations(field_config, ({one}) => ({
	organization: one(organizations, {
		fields: [field_config.organization_id],
		references: [organizations.id]
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

export const org_holidaysRelations = relations(org_holidays, ({one}) => ({
	organization: one(organizations, {
		fields: [org_holidays.organization_id],
		references: [organizations.id]
	}),
}));

export const balance_adjustmentsRelations = relations(balance_adjustments, ({one}) => ({
	organization: one(organizations, {
		fields: [balance_adjustments.organization_id],
		references: [organizations.id]
	}),
	user_user_id: one(users, {
		fields: [balance_adjustments.user_id],
		references: [users.id],
		relationName: "balance_adjustments_user_id_users_id"
	}),
	user_created_by_user_id: one(users, {
		fields: [balance_adjustments.created_by_user_id],
		references: [users.id],
		relationName: "balance_adjustments_created_by_user_id_users_id"
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

export const project_time_periodsRelations = relations(project_time_periods, ({one}) => ({
	organization: one(organizations, {
		fields: [project_time_periods.organization_id],
		references: [organizations.id]
	}),
	user_user_id: one(users, {
		fields: [project_time_periods.user_id],
		references: [users.id],
		relationName: "project_time_periods_user_id_users_id"
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
}));

export const projectsRelations = relations(projects, ({one, many}) => ({
	project_time_periods: many(project_time_periods),
	organization: one(organizations, {
		fields: [projects.organization_id],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [projects.owner_user_id],
		references: [users.id]
	}),
	subprojects: many(subprojects),
	project_times: many(project_times),
	project_teams: many(project_teams),
}));

export const work_time_monthsRelations = relations(work_time_months, ({one}) => ({
	user_user_id: one(users, {
		fields: [work_time_months.user_id],
		references: [users.id],
		relationName: "work_time_months_user_id_users_id"
	}),
	timesheet_period: one(timesheet_periods, {
		fields: [work_time_months.timesheet_period_id],
		references: [timesheet_periods.id]
	}),
	user_closed_by_user_id: one(users, {
		fields: [work_time_months.closed_by_user_id],
		references: [users.id],
		relationName: "work_time_months_closed_by_user_id_users_id"
	}),
	organization: one(organizations, {
		fields: [work_time_months.organization_id],
		references: [organizations.id]
	}),
}));

export const timesheet_periodsRelations = relations(timesheet_periods, ({one, many}) => ({
	work_time_months: many(work_time_months),
	organization: one(organizations, {
		fields: [timesheet_periods.organization_id],
		references: [organizations.id]
	}),
	user_user_id: one(users, {
		fields: [timesheet_periods.user_id],
		references: [users.id],
		relationName: "timesheet_periods_user_id_users_id"
	}),
	user_reviewed_by_user_id: one(users, {
		fields: [timesheet_periods.reviewed_by_user_id],
		references: [users.id],
		relationName: "timesheet_periods_reviewed_by_user_id_users_id"
	}),
	timesheet_documents: many(timesheet_documents),
}));

export const departmentsRelations = relations(departments, ({one, many}) => ({
	organization: one(organizations, {
		fields: [departments.organization_id],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [departments.leader_user_id],
		references: [users.id]
	}),
	employee_assignments: many(employee_assignments),
	requests: many(requests),
	news_post_departments: many(news_post_departments),
}));

export const employee_assignmentsRelations = relations(employee_assignments, ({one}) => ({
	organization: one(organizations, {
		fields: [employee_assignments.organization_id],
		references: [organizations.id]
	}),
	user_user_id: one(users, {
		fields: [employee_assignments.user_id],
		references: [users.id],
		relationName: "employee_assignments_user_id_users_id"
	}),
	department: one(departments, {
		fields: [employee_assignments.department_id],
		references: [departments.id]
	}),
	user_manager_user_id: one(users, {
		fields: [employee_assignments.manager_user_id],
		references: [users.id],
		relationName: "employee_assignments_manager_user_id_users_id"
	}),
}));

export const user_identitiesRelations = relations(user_identities, ({one}) => ({
	user: one(users, {
		fields: [user_identities.user_id],
		references: [users.id]
	}),
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

export const teamsRelations = relations(teams, ({one, many}) => ({
	organization: one(organizations, {
		fields: [teams.organization_id],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [teams.lead_user_id],
		references: [users.id]
	}),
	workflows: many(workflows),
	project_teams: many(project_teams),
	team_members: many(team_members),
}));

export const organization_membershipsRelations = relations(organization_memberships, ({one, many}) => ({
	organization: one(organizations, {
		fields: [organization_memberships.organization_id],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [organization_memberships.user_id],
		references: [users.id]
	}),
	team_members: many(team_members),
	membership_roles: many(membership_roles),
}));

export const organization_invitationsRelations = relations(organization_invitations, ({one}) => ({
	organization: one(organizations, {
		fields: [organization_invitations.organization_id],
		references: [organizations.id]
	}),
	role: one(roles, {
		fields: [organization_invitations.role_id],
		references: [roles.id]
	}),
	user: one(users, {
		fields: [organization_invitations.invited_by_user_id],
		references: [users.id]
	}),
}));

export const audit_logsRelations = relations(audit_logs, ({one}) => ({
	organization: one(organizations, {
		fields: [audit_logs.organization_id],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [audit_logs.actor_user_id],
		references: [users.id]
	}),
}));

export const subprojectsRelations = relations(subprojects, ({one, many}) => ({
	project: one(projects, {
		fields: [subprojects.project_id],
		references: [projects.id]
	}),
	organization: one(organizations, {
		fields: [subprojects.organization_id],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [subprojects.owner_user_id],
		references: [users.id]
	}),
	project_times: many(project_times),
}));

export const project_timesRelations = relations(project_times, ({one}) => ({
	user: one(users, {
		fields: [project_times.user_id],
		references: [users.id]
	}),
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
}));

export const static_dataRelations = relations(static_data, ({one}) => ({
	organization: one(organizations, {
		fields: [static_data.organization_id],
		references: [organizations.id]
	}),
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

export const workflowsRelations = relations(workflows, ({one, many}) => ({
	workflow_definition: one(workflow_definitions, {
		fields: [workflows.workflow_def_id],
		references: [workflow_definitions.workflow_def_id]
	}),
	team: one(teams, {
		fields: [workflows.assigned_to_team_id],
		references: [teams.id]
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
	user: one(users, {
		fields: [work_times.user_id],
		references: [users.id]
	}),
	organization: one(organizations, {
		fields: [work_times.organization_id],
		references: [organizations.id]
	}),
}));

export const work_time_balance_entriesRelations = relations(work_time_balance_entries, ({one}) => ({
	organization: one(organizations, {
		fields: [work_time_balance_entries.organization_id],
		references: [organizations.id]
	}),
	user_user_id: one(users, {
		fields: [work_time_balance_entries.user_id],
		references: [users.id],
		relationName: "work_time_balance_entries_user_id_users_id"
	}),
	user_created_by_user_id: one(users, {
		fields: [work_time_balance_entries.created_by_user_id],
		references: [users.id],
		relationName: "work_time_balance_entries_created_by_user_id_users_id"
	}),
}));

export const request_messagesRelations = relations(request_messages, ({one, many}) => ({
	request: one(requests, {
		fields: [request_messages.request_id],
		references: [requests.id]
	}),
	user: one(users, {
		fields: [request_messages.author_user_id],
		references: [users.id]
	}),
	request_message_documents: many(request_message_documents),
}));

export const requestsRelations = relations(requests, ({one, many}) => ({
	request_messages: many(request_messages),
	user_requester_user_id: one(users, {
		fields: [requests.requester_user_id],
		references: [users.id],
		relationName: "requests_requester_user_id_users_id"
	}),
	department: one(departments, {
		fields: [requests.target_department_id],
		references: [departments.id]
	}),
	user_assignee_user_id: one(users, {
		fields: [requests.assignee_user_id],
		references: [users.id],
		relationName: "requests_assignee_user_id_users_id"
	}),
	organization: one(organizations, {
		fields: [requests.organization_id],
		references: [organizations.id]
	}),
}));

export const timesheet_documentsRelations = relations(timesheet_documents, ({one}) => ({
	organization: one(organizations, {
		fields: [timesheet_documents.organization_id],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [timesheet_documents.user_id],
		references: [users.id]
	}),
	document: one(documents, {
		fields: [timesheet_documents.document_id],
		references: [documents.id]
	}),
	timesheet_period: one(timesheet_periods, {
		fields: [timesheet_documents.timesheet_period_id],
		references: [timesheet_periods.id]
	}),
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

export const saved_reportsRelations = relations(saved_reports, ({one, many}) => ({
	report_schedules: many(report_schedules),
	organization: one(organizations, {
		fields: [saved_reports.organization_id],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [saved_reports.owner_user_id],
		references: [users.id]
	}),
}));

export const personnel_documentsRelations = relations(personnel_documents, ({one}) => ({
	organization: one(organizations, {
		fields: [personnel_documents.organization_id],
		references: [organizations.id]
	}),
	user_user_id: one(users, {
		fields: [personnel_documents.user_id],
		references: [users.id],
		relationName: "personnel_documents_user_id_users_id"
	}),
	document: one(documents, {
		fields: [personnel_documents.document_id],
		references: [documents.id]
	}),
	user_uploaded_by_user_id: one(users, {
		fields: [personnel_documents.uploaded_by_user_id],
		references: [users.id],
		relationName: "personnel_documents_uploaded_by_user_id_users_id"
	}),
}));

export const report_runsRelations = relations(report_runs, ({one}) => ({
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
	document: one(documents, {
		fields: [report_runs.document_id],
		references: [documents.id]
	}),
}));

export const news_post_departmentsRelations = relations(news_post_departments, ({one}) => ({
	news_post: one(news_posts, {
		fields: [news_post_departments.post_id],
		references: [news_posts.id]
	}),
	department: one(departments, {
		fields: [news_post_departments.department_id],
		references: [departments.id]
	}),
}));

export const news_post_documentsRelations = relations(news_post_documents, ({one}) => ({
	news_post: one(news_posts, {
		fields: [news_post_documents.post_id],
		references: [news_posts.id]
	}),
	document: one(documents, {
		fields: [news_post_documents.document_id],
		references: [documents.id]
	}),
}));

export const role_permissionsRelations = relations(role_permissions, ({one}) => ({
	role: one(roles, {
		fields: [role_permissions.role_id],
		references: [roles.id]
	}),
	permission: one(permissions, {
		fields: [role_permissions.permission_id],
		references: [permissions.id]
	}),
}));

export const permissionsRelations = relations(permissions, ({many}) => ({
	role_permissions: many(role_permissions),
}));

export const request_message_documentsRelations = relations(request_message_documents, ({one}) => ({
	request_message: one(request_messages, {
		fields: [request_message_documents.message_id],
		references: [request_messages.id]
	}),
	document: one(documents, {
		fields: [request_message_documents.document_id],
		references: [documents.id]
	}),
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

export const team_membersRelations = relations(team_members, ({one}) => ({
	team: one(teams, {
		fields: [team_members.team_id],
		references: [teams.id]
	}),
	organization_membership: one(organization_memberships, {
		fields: [team_members.membership_id],
		references: [organization_memberships.id]
	}),
	role: one(roles, {
		fields: [team_members.team_role_id],
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

export const membership_rolesRelations = relations(membership_roles, ({one}) => ({
	organization_membership: one(organization_memberships, {
		fields: [membership_roles.membership_id],
		references: [organization_memberships.id]
	}),
	role: one(roles, {
		fields: [membership_roles.role_id],
		references: [roles.id]
	}),
	user: one(users, {
		fields: [membership_roles.granted_by_user_id],
		references: [users.id]
	}),
}));

export const work_time_balancesRelations = relations(work_time_balances, ({one}) => ({
	organization: one(organizations, {
		fields: [work_time_balances.organization_id],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [work_time_balances.user_id],
		references: [users.id]
	}),
}));