import { pgTable, bigint, index, uniqueIndex, foreignKey, check, uuid, text, timestamp, boolean, date, jsonb, numeric, integer, unique, varchar, inet, primaryKey, pgView, pgEnum, customType, char } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});

export const absence_status = pgEnum("absence_status", ['pending', 'approved', 'rejected'])
export const auth_provider_type = pgEnum("auth_provider_type", ['password', 'google', 'apple', 'github', 'saml_sso', 'oidc', 'passkey'])
export const balance_entry_type = pgEnum("balance_entry_type", ['overtime', 'vacation'])
export const invitation_status = pgEnum("invitation_status", ['pending', 'accepted', 'revoked', 'expired'])
export const membership_status = pgEnum("membership_status", ['active', 'invited', 'suspended'])
export const organization_type = pgEnum("organization_type", ['personal', 'team', 'enterprise'])
export const project_type = pgEnum("project_type", ['internal', 'customer', 'research'])
export const subproject_type = pgEnum("subproject_type", ['phase', 'work_package', 'task'])
export const timesheet_status = pgEnum("timesheet_status", ['open', 'submitted', 'approved', 'rejected'])
export const user_status = pgEnum("user_status", ['active', 'suspended', 'deactivated'])


export const requests = pgTable("requests", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	requester_user_id: uuid(),
	target_kind: text().notNull(),
	target_department_id: uuid(),
	subject: text().notNull(),
	status: text().default('open').notNull(),
	assignee_user_id: uuid(),
	opened_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	last_activity_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	resolved_at: timestamp({ withTimezone: true, mode: 'string' }),
	archived_at: timestamp({ withTimezone: true, mode: 'string' }),
	request_type: text(),
	urgent: boolean().default(false).notNull(),
	link_url: text(),
	due_date: date(),
	overdue_alerted_at: timestamp({ withTimezone: true, mode: 'string' }),
	source: text(),
	source_key: text(),
	source_section: text(),
	confidential: boolean().default(false).notNull(),
	custom: jsonb().default({}).notNull(),
}, (table) => [
	index("idx_requests_department").using("btree", table.organization_id.asc().nullsLast(), table.target_department_id.asc().nullsLast()),
	index("idx_requests_due").using("btree", table.due_date.asc().nullsLast()).where(sql`((due_date IS NOT NULL) AND (overdue_alerted_at IS NULL))`),
	index("idx_requests_requester").using("btree", table.organization_id.asc().nullsLast(), table.requester_user_id.asc().nullsLast()),
	uniqueIndex("uq_requests_source_key").using("btree", table.organization_id.asc().nullsLast(), table.source_key.asc().nullsLast()).where(sql`(source_key IS NOT NULL)`),
	foreignKey({
			columns: [table.requester_user_id],
			foreignColumns: [users.id],
			name: "requests_requester_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.target_department_id],
			foreignColumns: [departments.id],
			name: "requests_target_department_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.assignee_user_id],
			foreignColumns: [users.id],
			name: "requests_assignee_user_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "requests_organization_id_fkey"
		}).onDelete("cascade"),
	check("chk_requests_requester_or_source", sql`(requester_user_id IS NOT NULL) OR ((source IS NOT NULL) AND (target_kind = 'department'::text))`),
	check("chk_requests_subject", sql`length(btrim(subject)) > 0`),
	check("chk_requests_target", sql`((target_kind = 'manager'::text) AND (target_department_id IS NULL)) OR ((target_kind = 'department'::text) AND (target_department_id IS NOT NULL))`),
	check("chk_requests_status", sql`status = ANY (ARRAY['open'::text, 'in_progress'::text, 'resolved'::text])`),
	check("chk_requests_link_url", sql`(link_url IS NULL) OR ((link_url ~* '^https?://'::text) AND (length(link_url) <= 2000))`),
]);

export const ai_usage = pgTable("ai_usage", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	user_id: uuid(),
	subject_table: text(),
	subject_id: uuid(),
	kind: text().notNull(),
	provider: text().notNull(),
	status: text().default('pending').notNull(),
	error: text(),
	audio_seconds: numeric({ precision: 10, scale:  1 }),
	input_tokens: integer(),
	output_tokens: integer(),
	estimated_chf: numeric({ precision: 10, scale:  4 }).notNull(),
	actual_chf: numeric({ precision: 10, scale:  4 }),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	finished_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_ai_usage_created").using("btree", table.created_at.asc().nullsLast()),
	index("idx_ai_usage_org_created").using("btree", table.organization_id.asc().nullsLast(), table.created_at.asc().nullsLast()),
	index("idx_ai_usage_user_created").using("btree", table.user_id.asc().nullsLast(), table.created_at.asc().nullsLast()),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "ai_usage_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "ai_usage_user_id_fkey"
		}).onDelete("set null"),
	check("chk_ai_usage_kind", sql`kind ~ '^[a-z][a-z0-9_.-]*$'::text`),
	check("chk_ai_usage_status", sql`status = ANY (ARRAY['pending'::text, 'ok'::text, 'failed'::text])`),
	check("chk_ai_usage_subject", sql`(subject_table IS NULL) = (subject_id IS NULL)`),
]);

export const news_posts = pgTable("news_posts", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid(),
	author_user_id: uuid(),
	texts: jsonb().notNull(),
	require_ack: boolean().default(false).notNull(),
	published_at: timestamp({ withTimezone: true, mode: 'string' }),
	is_public: boolean().default(false).notNull(),
}, (table) => [
	index("idx_news_posts_org").using("btree", table.organization_id.asc().nullsLast(), table.published_at.desc().nullsFirst()),
	index("idx_news_posts_product").using("btree", table.published_at.desc().nullsFirst()).where(sql`(organization_id IS NULL)`),
	index("idx_news_posts_public").using("btree", table.published_at.desc().nullsFirst()).where(sql`is_public`),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "news_posts_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.author_user_id],
			foreignColumns: [users.id],
			name: "news_posts_author_user_id_fkey"
		}).onDelete("set null"),
	check("chk_news_posts_texts", sql`jsonb_typeof(texts) = 'object'::text`),
	check("chk_news_posts_public", sql`(organization_id IS NULL) OR (NOT is_public)`),
]);

export const newsletter_subscribers = pgTable("newsletter_subscribers", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	email: citext("email").notNull(),
	lang: text().default('de').notNull(),
	status: text().default('pending').notNull(),
	token_hash: text().notNull(),
	site_origin: text().notNull(),
	requested_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	confirmed_at: timestamp({ withTimezone: true, mode: 'string' }),
	unsubscribed_at: timestamp({ withTimezone: true, mode: 'string' }),
	last_mail_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	uniqueIndex("uq_newsletter_token").using("btree", table.token_hash.asc().nullsLast()),
	unique("newsletter_subscribers_email_key").on(table.email),
	check("chk_newsletter_lang", sql`lang = ANY (ARRAY['de'::text, 'fr'::text, 'it'::text, 'en'::text])`),
	check("chk_newsletter_status", sql`status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'unsubscribed'::text])`),
]);

export const basicdata_versions = pgTable("basicdata_versions", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	user_id: uuid().notNull(),
	version_nr: integer().default(0).notNull(),
	created: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	lastmodified: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	lastmodified_by_user_id: uuid(),
	history: jsonb().default([]).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "basicdata_versions_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.lastmodified_by_user_id],
			foreignColumns: [users.id],
			name: "basicdata_versions_lastmodified_by_user_id_fkey"
		}).onDelete("set null"),
	unique("basicdata_versions_user_id_key").on(table.user_id),
	check("chk_basicdata_versions_version_nr_non_negative", sql`version_nr >= 0`),
]);

export const absences = pgTable("absences", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	user_id: uuid().notNull(),
	date_start: date().notNull(),
	date_end: date().notNull(),
	status: absence_status().default('pending').notNull(),
	reviewed_by_user_id: uuid(),
	reviewed_at: timestamp({ withTimezone: true, mode: 'string' }),
	review_note: text(),
	note: text(),
	absence_type: varchar({ length: 64 }).default('vacation').notNull(),
	half_day: boolean().default(false).notNull(),
	document_id: uuid(),
}, (table) => [
	index("idx_absences_org_status").using("btree", table.organization_id.asc().nullsLast(), table.status.asc().nullsLast()),
	index("idx_absences_user").using("btree", table.user_id.asc().nullsLast(), table.date_start.asc().nullsLast()),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "absences_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "absences_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.reviewed_by_user_id],
			foreignColumns: [users.id],
			name: "absences_reviewed_by_user_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.document_id],
			foreignColumns: [documents.id],
			name: "absences_document_id_fkey"
		}).onDelete("set null"),
	check("chk_absence_order", sql`date_end >= date_start`),
	check("chk_absence_half_day_single_day", sql`(NOT half_day) OR (date_start = date_end)`),
]);

export const field_config = pgTable("field_config", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid(),
	form_id: varchar({ length: 64 }).notNull(),
	field_key: varchar({ length: 64 }).notNull(),
	is_custom: boolean().default(false).notNull(),
	config: jsonb().default({}).notNull(),
}, (table) => [
	uniqueIndex("uq_field_config").using("btree", sql`COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid)`, sql`form_id`, sql`field_key`),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "field_config_organization_id_fkey"
		}).onDelete("cascade"),
]);

export const org_holidays = pgTable("org_holidays", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	date: date().notNull(),
	name: text(),
	fraction: numeric({ precision: 3, scale:  2 }).default('1').notNull(),
	observed: boolean().default(true).notNull(),
	location_id: uuid(),
}, (table) => [
	uniqueIndex("uq_org_holidays").using("btree", sql`organization_id`, sql`date`, sql`COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid)`),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "org_holidays_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.location_id],
			foreignColumns: [locations.id],
			name: "org_holidays_location_id_fkey"
		}).onDelete("cascade"),
	check("chk_org_holidays_fraction", sql`(fraction > (0)::numeric) AND (fraction <= (1)::numeric)`),
]);

export const work_schedules = pgTable("work_schedules", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	user_id: uuid().notNull(),
	valid_from: date().notNull(),
	workload_percent: numeric({ precision: 5, scale:  2 }).default('100').notNull(),
	day_minutes: integer().array().notNull(),
	time_recording: text().default('full').notNull(),
	exemption_reason: text(),
}, (table) => [
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "work_schedules_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "work_schedules_user_id_fkey"
		}).onDelete("cascade"),
	unique("uq_work_schedules").on(table.organization_id, table.user_id, table.valid_from),
	check("chk_work_schedules_days", sql`array_length(day_minutes, 1) = 7`),
	check("chk_work_schedules_workload", sql`(workload_percent >= (0)::numeric) AND (workload_percent <= (100)::numeric)`),
	check("chk_work_schedules_recording", sql`time_recording = ANY (ARRAY['full'::text, 'daily'::text, 'none'::text])`),
	check("chk_work_schedules_exemption", sql`((time_recording = 'none'::text) AND (exemption_reason IS NOT NULL) AND (exemption_reason = ANY (ARRAY['senior_executive'::text, 'waiver'::text]))) OR ((time_recording <> 'none'::text) AND (exemption_reason IS NULL))`),
]);

export const balance_adjustments = pgTable("balance_adjustments", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	user_id: uuid().notNull(),
	balance: text().notNull(),
	kind: text().notNull(),
	effective_date: date().notNull(),
	amount: numeric({ precision: 10, scale:  2 }).notNull(),
	note: text(),
	created_by_user_id: uuid(),
}, (table) => [
	index("idx_balance_adjustments_user").using("btree", table.organization_id.asc().nullsLast(), table.user_id.asc().nullsLast(), table.effective_date.asc().nullsLast()),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "balance_adjustments_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "balance_adjustments_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.created_by_user_id],
			foreignColumns: [users.id],
			name: "balance_adjustments_created_by_user_id_fkey"
		}).onDelete("set null"),
	check("chk_balance_adjustments_kind", sql`kind = ANY (ARRAY['opening'::text, 'correction'::text, 'payout'::text])`),
	check("chk_balance_adjustments_balance", sql`balance = ANY (ARRAY['overtime'::text, 'vacation'::text, 'legal_overtime'::text])`),
]);

export const vacation_entitlements = pgTable("vacation_entitlements", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	user_id: uuid().notNull(),
	year: integer().notNull(),
	days: numeric({ precision: 6, scale:  2 }).notNull(),
	note: text(),
}, (table) => [
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "vacation_entitlements_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "vacation_entitlements_user_id_fkey"
		}).onDelete("cascade"),
	unique("uq_vacation_entitlements").on(table.organization_id, table.user_id, table.year),
	check("chk_vacation_entitlements_year", sql`(year >= 2000) AND (year <= 2100)`),
	check("chk_vacation_entitlements_days", sql`(days >= (0)::numeric) AND (days <= (366)::numeric)`),
]);

export const assistant_prompts = pgTable("assistant_prompts", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	user_id: uuid().notNull(),
	prompt: text().notNull(),
	is_favorite: boolean().default(false).notNull(),
	use_count: integer().default(1).notNull(),
	last_used_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_assistant_prompts_user").using("btree", table.organization_id.asc().nullsLast(), table.user_id.asc().nullsLast(), table.last_used_at.desc().nullsFirst()),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "assistant_prompts_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "assistant_prompts_user_id_fkey"
		}).onDelete("cascade"),
	unique("uq_assistant_prompts").on(table.organization_id, table.user_id, table.prompt),
	check("chk_assistant_prompts_length", sql`(char_length(prompt) >= 1) AND (char_length(prompt) <= 2000)`),
]);

export const employee_assignments = pgTable("employee_assignments", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	user_id: uuid().notNull(),
	valid_from: date().notNull(),
	department_id: uuid(),
	job_function: text(),
	manager_user_id: uuid(),
	location_id: uuid(),
	is_management: boolean().default(false).notNull(),
}, (table) => [
	index("idx_employee_assignments_manager").using("btree", table.organization_id.asc().nullsLast(), table.manager_user_id.asc().nullsLast()),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "employee_assignments_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "employee_assignments_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.department_id],
			foreignColumns: [departments.id],
			name: "employee_assignments_department_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.manager_user_id],
			foreignColumns: [users.id],
			name: "employee_assignments_manager_user_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.location_id],
			foreignColumns: [locations.id],
			name: "employee_assignments_location_id_fkey"
		}).onDelete("restrict"),
	unique("uq_employee_assignments").on(table.organization_id, table.user_id, table.valid_from),
	check("chk_employee_assignments_manager", sql`(manager_user_id IS NULL) OR (manager_user_id <> user_id)`),
]);

export const project_time_periods = pgTable("project_time_periods", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	user_id: uuid().notNull(),
	project_id: uuid().notNull(),
	period_start: date().notNull(),
	period_end: date().notNull(),
	status: timesheet_status().default('open').notNull(),
	submitted_at: timestamp({ withTimezone: true, mode: 'string' }),
	reviewed_by_user_id: uuid(),
	reviewed_at: timestamp({ withTimezone: true, mode: 'string' }),
	review_note: text(),
}, (table) => [
	index("idx_project_time_periods_project").using("btree", table.project_id.asc().nullsLast(), table.period_start.asc().nullsLast()),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "project_time_periods_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "project_time_periods_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.project_id],
			foreignColumns: [projects.id],
			name: "project_time_periods_project_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.reviewed_by_user_id],
			foreignColumns: [users.id],
			name: "project_time_periods_reviewed_by_user_id_fkey"
		}).onDelete("set null"),
	unique("uq_project_time_periods").on(table.organization_id, table.user_id, table.project_id, table.period_start),
	check("chk_project_time_periods_range", sql`period_end > period_start`),
]);

export const work_time_months = pgTable("work_time_months", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	user_id: uuid().notNull(),
	month: date().notNull(),
	timesheet_period_id: uuid(),
	scheduled_minutes: integer().default(0).notNull(),
	holiday_minutes: integer().default(0).notNull(),
	absence_minutes: jsonb().default({}).notNull(),
	target_minutes: integer().notNull(),
	actual_minutes: integer().notNull(),
	delta_minutes: integer().notNull(),
	vacation_days: numeric({ precision: 6, scale:  2 }).default('0').notNull(),
	closed_by_user_id: uuid(),
	closed_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	legal_overtime_minutes: integer(),
}, (table) => [
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "work_time_months_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.timesheet_period_id],
			foreignColumns: [timesheet_periods.id],
			name: "work_time_months_timesheet_period_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.closed_by_user_id],
			foreignColumns: [users.id],
			name: "work_time_months_closed_by_user_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "work_time_months_organization_id_fkey"
		}).onDelete("cascade"),
	unique("uq_work_time_months").on(table.organization_id, table.user_id, table.month),
	check("chk_work_time_months_first", sql`EXTRACT(day FROM month) = (1)::numeric`),
]);

export const departments = pgTable("departments", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	name: text().notNull(),
	leader_user_id: uuid(),
	is_active: boolean().default(true).notNull(),
	sort_order: integer().default(0).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "departments_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.leader_user_id],
			foreignColumns: [users.id],
			name: "departments_leader_user_id_fkey"
		}).onDelete("set null"),
	unique("uq_departments_name").on(table.organization_id, table.name),
	check("chk_departments_name", sql`length(btrim(name)) > 0`),
]);

export const databasechangelog = pgTable("databasechangelog", {
	id: varchar({ length: 255 }).notNull(),
	author: varchar({ length: 255 }).notNull(),
	filename: varchar({ length: 255 }).notNull(),
	dateexecuted: timestamp({ mode: 'string' }).notNull(),
	orderexecuted: integer().notNull(),
	exectype: varchar({ length: 10 }).notNull(),
	md5sum: varchar({ length: 35 }),
	description: varchar({ length: 255 }),
	comments: varchar({ length: 255 }),
	tag: varchar({ length: 255 }),
	liquibase: varchar({ length: 20 }),
	contexts: varchar({ length: 255 }),
	labels: varchar({ length: 255 }),
	deployment_id: varchar({ length: 10 }),
});

export const databasechangeloglock = pgTable("databasechangeloglock", {
	id: integer().primaryKey().notNull(),
	locked: boolean().notNull(),
	lockgranted: timestamp({ mode: 'string' }),
	lockedby: varchar({ length: 255 }),
});

export const user_identities = pgTable("user_identities", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	user_id: uuid().notNull(),
	provider: auth_provider_type().notNull(),
	provider_user_id: varchar({ length: 255 }).notNull(),
	password_hash: varchar({ length: 255 }),
	metadata: jsonb().default({}).notNull(),
	last_sign_in_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_user_identities_user_id").using("btree", table.user_id.asc().nullsLast()),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "user_identities_user_id_fkey"
		}).onDelete("cascade"),
	unique("uq_provider_user_id").on(table.provider, table.provider_user_id),
]);

export const balance_years = pgTable("balance_years", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	user_id: uuid().notNull(),
	year: integer().notNull(),
	overtime_minutes: integer().notNull(),
	legal_overtime_minutes: integer().notNull(),
	vacation_days: numeric({ precision: 8, scale:  2 }).notNull(),
	incomplete_months: integer().default(0).notNull(),
	closed_by_user_id: uuid(),
	closed_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "balance_years_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "balance_years_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.closed_by_user_id],
			foreignColumns: [users.id],
			name: "balance_years_closed_by_user_id_fkey"
		}).onDelete("set null"),
	unique("uq_balance_years").on(table.organization_id, table.user_id, table.year),
	check("chk_balance_years_year", sql`(year >= 2000) AND (year <= 2100)`),
]);

export const organization_domains = pgTable("organization_domains", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	domain: citext("domain").notNull(),
	verification_token: varchar({ length: 255 }).notNull(),
	verified_at: timestamp({ withTimezone: true, mode: 'string' }),
	auto_join_enabled: boolean().default(false).notNull(),
}, (table) => [
	index("idx_org_domains_domain").using("btree", table.domain.asc().nullsLast()),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "organization_domains_organization_id_fkey"
		}).onDelete("cascade"),
	unique("uq_org_domain").on(table.domain),
]);

export const roles = pgTable("roles", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid(),
	name: varchar({ length: 64 }).notNull(),
	description: varchar({ length: 255 }),
	is_system_role: boolean().default(false).notNull(),
	settings: jsonb().default({}).notNull(),
	translations: jsonb().default({}).notNull(),
	admin_user_ids: uuid().array().default(sql`'{}'`).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "roles_organization_id_fkey"
		}).onDelete("cascade"),
	unique("uq_role_per_org").on(table.organization_id, table.name),
]);

export const permissions = pgTable("permissions", {
	id: varchar({ length: 64 }).primaryKey().notNull(),
	description: varchar({ length: 255 }).notNull(),
});

export const teams = pgTable("teams", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	name: varchar({ length: 100 }).notNull(),
	description: varchar({ length: 255 }),
	lead_user_id: uuid(),
}, (table) => [
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "teams_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.lead_user_id],
			foreignColumns: [users.id],
			name: "teams_lead_user_id_fkey"
		}).onDelete("set null"),
	unique("uq_org_team_name").on(table.organization_id, table.name),
]);

export const organization_memberships = pgTable("organization_memberships", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	user_id: uuid().notNull(),
	status: membership_status().default('active').notNull(),
	scim_external_id: varchar({ length: 255 }),
	joined_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
	is_active: boolean().default(true).notNull(),
	settings: jsonb().default({}).notNull(),
	exit_at: timestamp({ withTimezone: true, mode: 'string' }),
	start_date: date(),
	probation_until: date(),
}, (table) => [
	index("idx_memberships_org").using("btree", table.organization_id.asc().nullsLast()),
	index("idx_memberships_scim").using("btree", table.scim_external_id.asc().nullsLast()),
	index("idx_memberships_user").using("btree", table.user_id.asc().nullsLast()),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "organization_memberships_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "organization_memberships_user_id_fkey"
		}).onDelete("cascade"),
	unique("uq_org_user_membership").on(table.organization_id, table.user_id),
	check("chk_membership_exit_after_joined", sql`(exit_at IS NULL) OR (joined_at IS NULL) OR (exit_at > joined_at)`),
]);

export const organization_licenses = pgTable("organization_licenses", {
	organization_id: uuid().notNull(),
	module_id: text().notNull(),
	valid_until: date(),
}, (table) => [
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "organization_licenses_organization_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.organization_id, table.module_id], name: "organization_licenses_pkey"}),
]);

export const organization_invitations = pgTable("organization_invitations", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	email: citext("email").notNull(),
	role_id: uuid().notNull(),
	token: varchar({ length: 255 }).notNull(),
	invited_by_user_id: uuid().notNull(),
	status: invitation_status().default('pending').notNull(),
	expires_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	index("idx_invitations_email").using("btree", table.email.asc().nullsLast()),
	index("idx_invitations_token").using("btree", table.token.asc().nullsLast()),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "organization_invitations_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.role_id],
			foreignColumns: [roles.id],
			name: "organization_invitations_role_id_fkey"
		}),
	foreignKey({
			columns: [table.invited_by_user_id],
			foreignColumns: [users.id],
			name: "organization_invitations_invited_by_user_id_fkey"
		}),
	unique("organization_invitations_token_key").on(table.token),
]);

export const users = pgTable("users", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	email: citext("email").notNull(),
	email_verified_at: timestamp({ withTimezone: true, mode: 'string' }),
	display_name: varchar({ length: 100 }).notNull(),
	avatar_url: varchar({ length: 1024 }),
	locale: varchar({ length: 10 }).default('en').notNull(),
	timezone: varchar({ length: 50 }).default('UTC').notNull(),
	status: user_status().default('active').notNull(),
	first_name: varchar({ length: 100 }),
	middle_name: varchar({ length: 100 }),
	last_name: varchar({ length: 100 }),
	settings: jsonb().default({}).notNull(),
	is_active: boolean().default(true).notNull(),
	basicdata: jsonb().default({}).notNull(),
}, (table) => [
	unique("users_email_key").on(table.email),
]);

export const audit_logs = pgTable("audit_logs", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	actor_user_id: uuid(),
	action: varchar({ length: 128 }).notNull(),
	target_type: varchar({ length: 64 }).notNull(),
	target_id: varchar({ length: 255 }).notNull(),
	metadata: jsonb().default({}).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_audit_logs_actor").using("btree", table.actor_user_id.asc().nullsLast()),
	index("idx_audit_logs_org_date").using("btree", table.organization_id.asc().nullsLast(), table.created_at.desc().nullsFirst()),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "audit_logs_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.actor_user_id],
			foreignColumns: [users.id],
			name: "audit_logs_actor_user_id_fkey"
		}).onDelete("set null"),
]);

export const locations = pgTable("locations", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	name: text().notNull(),
	canton: varchar({ length: 2 }).notNull(),
	municipality: text(),
}, (table) => [
	uniqueIndex("uq_locations_name").using("btree", sql`organization_id`, sql`lower(name)`),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "locations_organization_id_fkey"
		}).onDelete("cascade"),
	check("chk_locations_name", sql`(char_length(name) >= 1) AND (char_length(name) <= 100)`),
	check("chk_locations_canton", sql`(canton)::text ~ '^[A-Z]{2}$'::text`),
]);

export const projects = pgTable("projects", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	name: varchar({ length: 255 }).notNull(),
	owner_user_id: uuid(),
	cost_item: varchar({ length: 255 }),
	type: project_type().default('internal').notNull(),
}, (table) => [
	index("idx_projects_org").using("btree", table.organization_id.asc().nullsLast()),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "projects_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.owner_user_id],
			foreignColumns: [users.id],
			name: "projects_owner_user_id_fkey"
		}).onDelete("set null"),
]);

export const subprojects = pgTable("subprojects", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	project_id: uuid().notNull(),
	organization_id: uuid().notNull(),
	name: varchar({ length: 255 }).notNull(),
	owner_user_id: uuid(),
	cost_item: varchar({ length: 255 }),
	type: subproject_type().default('phase').notNull(),
}, (table) => [
	index("idx_subprojects_org").using("btree", table.organization_id.asc().nullsLast()),
	index("idx_subprojects_project").using("btree", table.project_id.asc().nullsLast()),
	foreignKey({
			columns: [table.project_id],
			foreignColumns: [projects.id],
			name: "subprojects_project_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "subprojects_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.owner_user_id],
			foreignColumns: [users.id],
			name: "subprojects_owner_user_id_fkey"
		}).onDelete("set null"),
]);

export const project_times = pgTable("project_times", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	user_id: uuid().notNull(),
	organization_id: uuid().notNull(),
	project_id: uuid(),
	subproject_id: uuid(),
	start_time: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	end_time: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	comment: text(),
}, (table) => [
	index("idx_project_times_org_start").using("btree", table.organization_id.asc().nullsLast(), table.start_time.asc().nullsLast()),
	index("idx_project_times_project").using("btree", table.project_id.asc().nullsLast()),
	index("idx_project_times_user_start").using("btree", table.user_id.asc().nullsLast(), table.start_time.asc().nullsLast()),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "project_times_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "project_times_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.project_id],
			foreignColumns: [projects.id],
			name: "project_times_project_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.subproject_id],
			foreignColumns: [subprojects.id],
			name: "project_times_subproject_id_fkey"
		}).onDelete("set null"),
	check("chk_project_time_order", sql`end_time > start_time`),
]);

export const static_data = pgTable("static_data", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	entity: varchar({ length: 128 }).notNull(),
	entity_uuid: uuid(),
	enum_name: varchar({ length: 128 }).notNull(),
	values: jsonb().default({}).notNull(),
	translation: jsonb().default({}).notNull(),
	organization_id: uuid(),
	operator_keys: text().array().default(sql`'{}'`).notNull(),
}, (table) => [
	index("idx_static_data_global_entity").using("btree", table.entity.asc().nullsLast(), table.enum_name.asc().nullsLast()).where(sql`(organization_id IS NULL)`),
	index("idx_static_data_org_entity").using("btree", table.organization_id.asc().nullsLast(), table.entity.asc().nullsLast(), table.enum_name.asc().nullsLast()),
	uniqueIndex("uq_static_data_org_entity_enum").using("btree", sql`COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid)`, sql`entity`, sql`enum_name`),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "static_data_organization_id_fkey"
		}).onDelete("cascade"),
]);

export const timesheet_periods = pgTable("timesheet_periods", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	user_id: uuid().notNull(),
	period_start: date().notNull(),
	period_end: date().notNull(),
	status: timesheet_status().default('open').notNull(),
	submitted_at: timestamp({ withTimezone: true, mode: 'string' }),
	reviewed_by_user_id: uuid(),
	reviewed_at: timestamp({ withTimezone: true, mode: 'string' }),
	review_note: text(),
}, (table) => [
	index("idx_timesheet_periods_org_status").using("btree", table.organization_id.asc().nullsLast(), table.status.asc().nullsLast()),
	index("idx_timesheet_periods_user").using("btree", table.user_id.asc().nullsLast(), table.period_start.asc().nullsLast()),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "timesheet_periods_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "timesheet_periods_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.reviewed_by_user_id],
			foreignColumns: [users.id],
			name: "timesheet_periods_reviewed_by_user_id_fkey"
		}).onDelete("set null"),
	unique("uq_timesheet_period").on(table.organization_id, table.user_id, table.period_start),
	check("chk_timesheet_period_order", sql`period_end > period_start`),
]);

export const organizations = pgTable("organizations", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	parent_organization_id: uuid(),
	slug: citext("slug").notNull(),
	name: varchar({ length: 100 }).notNull(),
	type: organization_type().default('personal').notNull(),
	avatar_url: varchar({ length: 1024 }),
	created_by_user_id: uuid().notNull(),
	is_active: boolean().default(true).notNull(),
	country: varchar({ length: 2 }),
	settings: jsonb().default({}).notNull(),
	enforce_sso: boolean().default(false).notNull(),
	enforce_mfa: boolean().default(false).notNull(),
	allowed_email_domains: text().array().default(sql`'{}'`).notNull(),
	session_duration_minutes: integer().default(1440).notNull(),
	ip_allowlist: inet().array().default(sql`'{}'`).notNull(),
	sso_config: jsonb().default({}).notNull(),
}, (table) => [
	index("idx_organizations_parent").using("btree", table.parent_organization_id.asc().nullsLast()),
	foreignKey({
			columns: [table.parent_organization_id],
			foreignColumns: [table.id],
			name: "organizations_parent_organization_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.created_by_user_id],
			foreignColumns: [users.id],
			name: "organizations_created_by_user_id_fkey"
		}),
	unique("organizations_slug_key").on(table.slug),
]);

export const versions = pgTable("versions", {
	version_id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	source_table: text().notNull(),
	source_table_uuid: uuid().notNull(),
	version_nr: integer().default(1).notNull(),
	created: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	created_by_user_id: uuid(),
	lastmodified: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	lastmodified_by_user_id: uuid(),
	lastmodified_by_workflow_id: uuid(),
	history: jsonb().default([]).notNull(),
}, (table) => [
	uniqueIndex("uq_versions_source_table_record").using("btree", table.source_table.asc().nullsLast(), table.source_table_uuid.asc().nullsLast()),
	foreignKey({
			columns: [table.created_by_user_id],
			foreignColumns: [users.id],
			name: "versions_created_by_user_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.lastmodified_by_user_id],
			foreignColumns: [users.id],
			name: "versions_lastmodified_by_user_id_fkey"
		}).onDelete("set null"),
	check("chk_versions_version_nr_positive", sql`version_nr >= 1`),
]);

export const workflow_definitions = pgTable("workflow_definitions", {
	workflow_def_id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	name: text().notNull(),
	description: text(),
	steps: jsonb().default([]).notNull(),
	config: jsonb(),
}, (table) => [
	index("idx_workflow_definitions_org").using("btree", table.organization_id.asc().nullsLast()),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "workflow_definitions_organization_id_fkey"
		}).onDelete("cascade"),
]);

export const workflows = pgTable("workflows", {
	workflow_id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	workflow_def_id: uuid().notNull(),
	source_table: text().notNull(),
	source_table_uuid: uuid().notNull(),
	workflow_data: jsonb().default({}).notNull(),
	workflow_started: timestamp({ withTimezone: true, mode: 'string' }),
	workflow_finished: timestamp({ withTimezone: true, mode: 'string' }),
	workflow_to_be_finished_until: timestamp({ withTimezone: true, mode: 'string' }),
	step: text(),
	step_status: text(),
	workflow_step_started: timestamp({ withTimezone: true, mode: 'string' }),
	workflow_step_finished: timestamp({ withTimezone: true, mode: 'string' }),
	workflow_step_to_be_finished_until: timestamp({ withTimezone: true, mode: 'string' }),
	assigned_to_user_id: uuid().array(),
	assigned_to_team_id: uuid(),
	notification: jsonb().default({}).notNull(),
	steps: jsonb(),
}, (table) => [
	index("idx_workflows_def").using("btree", table.workflow_def_id.asc().nullsLast()),
	index("idx_workflows_source").using("btree", table.source_table.asc().nullsLast(), table.source_table_uuid.asc().nullsLast()),
	index("idx_workflows_team").using("btree", table.assigned_to_team_id.asc().nullsLast()),
	foreignKey({
			columns: [table.workflow_def_id],
			foreignColumns: [workflow_definitions.workflow_def_id],
			name: "workflows_workflow_def_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.assigned_to_team_id],
			foreignColumns: [teams.id],
			name: "workflows_assigned_to_team_id_fkey"
		}).onDelete("set null"),
	check("chk_workflows_assignee_required", sql`(assigned_to_user_id IS NOT NULL) OR (assigned_to_team_id IS NOT NULL)`),
]);

export const notifications = pgTable("notifications", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	recipient_user_id: uuid().notNull(),
	type: text().notNull(),
	title: text().notNull(),
	body: text(),
	source_table: text().notNull(),
	source_table_uuid: uuid().notNull(),
	workflow_id: uuid(),
	data: jsonb().default({}).notNull(),
	read_at: timestamp({ withTimezone: true, mode: 'string' }),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_notifications_recipient_created").using("btree", table.recipient_user_id.asc().nullsLast(), table.created_at.desc().nullsFirst()),
	index("idx_notifications_recipient_unread").using("btree", table.recipient_user_id.asc().nullsLast()).where(sql`(read_at IS NULL)`),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "notifications_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.recipient_user_id],
			foreignColumns: [users.id],
			name: "notifications_recipient_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.workflow_id],
			foreignColumns: [workflows.workflow_id],
			name: "notifications_workflow_id_fkey"
		}).onDelete("cascade"),
]);

export const work_times = pgTable("work_times", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	user_id: uuid().notNull(),
	organization_id: uuid().notNull(),
	check_in: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	check_out: timestamp({ withTimezone: true, mode: 'string' }),
	comment: text(),
	home_office: boolean().default(false).notNull(),
	client_ip: varchar({ length: 64 }),
}, (table) => [
	index("idx_work_times_org_check_in").using("btree", table.organization_id.asc().nullsLast(), table.check_in.asc().nullsLast()),
	index("idx_work_times_user_check_in").using("btree", table.user_id.asc().nullsLast(), table.check_in.asc().nullsLast()),
	uniqueIndex("uq_work_times_one_open_session").using("btree", table.user_id.asc().nullsLast()).where(sql`(check_out IS NULL)`),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "work_times_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "work_times_organization_id_fkey"
		}).onDelete("cascade"),
	check("chk_work_time_order", sql`(check_out IS NULL) OR (check_out > check_in)`),
]);

export const work_time_balance_entries = pgTable("work_time_balance_entries", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	user_id: uuid().notNull(),
	balance_type: balance_entry_type().notNull(),
	source_table: text(),
	source_table_uuid: uuid(),
	target_minutes: numeric({ precision: 10, scale:  2 }),
	actual_minutes: numeric({ precision: 10, scale:  2 }),
	delta_minutes: numeric({ precision: 10, scale:  2 }).notNull(),
	note: text(),
	created_by_user_id: uuid(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_work_time_balance_entries_org_user").using("btree", table.organization_id.asc().nullsLast(), table.user_id.asc().nullsLast(), table.created_at.asc().nullsLast()),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "work_time_balance_entries_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "work_time_balance_entries_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.created_by_user_id],
			foreignColumns: [users.id],
			name: "work_time_balance_entries_created_by_user_id_fkey"
		}).onDelete("set null"),
]);

export const documents = pgTable("documents", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	file_name: text().notNull(),
	mime_type: text().notNull(),
	size_bytes: integer().notNull(),
	storage_path: text().notNull(),
	source_table: text(),
	source_table_id: uuid(),
	uploaded_by_user_id: uuid(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	encrypted_key: text(),
	key_id: text(),
}, (table) => [
	index("idx_documents_organization").using("btree", table.organization_id.asc().nullsLast()),
	index("idx_documents_source").using("btree", table.source_table.asc().nullsLast(), table.source_table_id.asc().nullsLast()),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "documents_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.uploaded_by_user_id],
			foreignColumns: [users.id],
			name: "documents_uploaded_by_user_id_fkey"
		}).onDelete("set null"),
	check("chk_documents_encryption", sql`(encrypted_key IS NULL) = (key_id IS NULL)`),
]);

export const request_messages = pgTable("request_messages", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	request_id: uuid().notNull(),
	author_user_id: uuid(),
	kind: text().default('message').notNull(),
	body: text(),
	data: jsonb().default({}).notNull(),
	posted_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_request_messages_request").using("btree", table.request_id.asc().nullsLast(), table.posted_at.asc().nullsLast()),
	foreignKey({
			columns: [table.request_id],
			foreignColumns: [requests.id],
			name: "request_messages_request_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.author_user_id],
			foreignColumns: [users.id],
			name: "request_messages_author_user_id_fkey"
		}).onDelete("set null"),
	check("chk_request_messages_kind", sql`kind = ANY (ARRAY['message'::text, 'event'::text])`),
]);

export const timesheet_documents = pgTable("timesheet_documents", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	user_id: uuid().notNull(),
	document_id: uuid().notNull(),
	timesheet_period_id: uuid(),
	period_start: date().notNull(),
	issued_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	superseded_at: timestamp({ withTimezone: true, mode: 'string' }),
	kind: text().notNull(),
}, (table) => [
	index("idx_timesheet_documents_user").using("btree", table.organization_id.asc().nullsLast(), table.user_id.asc().nullsLast()),
	uniqueIndex("uq_timesheet_documents_current_project").using("btree", table.organization_id.asc().nullsLast(), table.user_id.asc().nullsLast(), table.period_start.asc().nullsLast()).where(sql`((superseded_at IS NULL) AND (kind = 'project_timesheet'::text))`),
	uniqueIndex("uq_timesheet_documents_current_ts").using("btree", table.timesheet_period_id.asc().nullsLast()).where(sql`((superseded_at IS NULL) AND (timesheet_period_id IS NOT NULL))`),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "timesheet_documents_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "timesheet_documents_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.document_id],
			foreignColumns: [documents.id],
			name: "timesheet_documents_document_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.timesheet_period_id],
			foreignColumns: [timesheet_periods.id],
			name: "timesheet_documents_timesheet_period_id_fkey"
		}).onDelete("cascade"),
	check("chk_timesheet_documents_kind", sql`((kind = 'timesheet'::text) AND (timesheet_period_id IS NOT NULL)) OR ((kind = 'project_timesheet'::text) AND (timesheet_period_id IS NULL))`),
]);

export const report_schedules = pgTable("report_schedules", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	saved_report_id: uuid().notNull(),
	frequency: text().notNull(),
	weekday: integer(),
	month_day: integer(),
	hour: integer().default(6).notNull(),
	time_zone: text().notNull(),
	format: text().default('pdf').notNull(),
	recipient_user_ids: uuid().array().default(sql`'{}'`).notNull(),
	is_active: boolean().default(true).notNull(),
	next_run_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	last_run_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_report_schedules_due").using("btree", table.next_run_at.asc().nullsLast()).where(sql`is_active`),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "report_schedules_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.saved_report_id],
			foreignColumns: [saved_reports.id],
			name: "report_schedules_saved_report_id_fkey"
		}).onDelete("cascade"),
	unique("report_schedules_saved_report_id_key").on(table.saved_report_id),
	check("chk_report_schedules_hour", sql`(hour >= 0) AND (hour <= 23)`),
	check("chk_report_schedules_frequency", sql`((frequency = 'weekly'::text) AND ((weekday >= 1) AND (weekday <= 7))) OR ((frequency = 'monthly'::text) AND ((month_day >= 1) AND (month_day <= 28)))`),
	check("chk_report_schedules_format", sql`format = ANY (ARRAY['pdf'::text, 'xlsx'::text])`),
]);

export const personnel_documents = pgTable("personnel_documents", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	user_id: uuid().notNull(),
	document_id: uuid().notNull(),
	title: text().notNull(),
	category: text().notNull(),
	document_date: date(),
	visible_to_employee: boolean().default(false).notNull(),
	uploaded_by_user_id: uuid(),
}, (table) => [
	index("idx_personnel_documents_user").using("btree", table.organization_id.asc().nullsLast(), table.user_id.asc().nullsLast()),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "personnel_documents_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "personnel_documents_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.document_id],
			foreignColumns: [documents.id],
			name: "personnel_documents_document_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.uploaded_by_user_id],
			foreignColumns: [users.id],
			name: "personnel_documents_uploaded_by_user_id_fkey"
		}).onDelete("set null"),
	unique("personnel_documents_document_id_key").on(table.document_id),
	check("chk_personnel_documents_title", sql`length(btrim(title)) > 0`),
	check("chk_personnel_documents_category", sql`category = ANY (ARRAY['evaluation'::text, 'bonus'::text, 'contract'::text, 'certificate'::text, 'salary'::text, 'other'::text])`),
]);

export const saved_reports = pgTable("saved_reports", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	owner_user_id: uuid().notNull(),
	name: text().notNull(),
	report_id: text().notNull(),
	settings: jsonb().default({}).notNull(),
	shared_roles: text().array().default(sql`'{}'`).notNull(),
}, (table) => [
	index("idx_saved_reports_org").using("btree", table.organization_id.asc().nullsLast(), table.owner_user_id.asc().nullsLast()),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "saved_reports_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.owner_user_id],
			foreignColumns: [users.id],
			name: "saved_reports_owner_user_id_fkey"
		}).onDelete("cascade"),
	check("chk_saved_reports_name", sql`(length(btrim(name)) >= 1) AND (length(btrim(name)) <= 120)`),
]);

export const report_runs = pgTable("report_runs", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	schedule_id: uuid(),
	user_id: uuid().notNull(),
	document_id: uuid(),
	title: text().notNull(),
	period_from: text().notNull(),
	period_to: text().notNull(),
	ran_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	error: text(),
}, (table) => [
	index("idx_report_runs_schedule").using("btree", table.schedule_id.asc().nullsLast(), table.ran_at.asc().nullsLast()),
	index("idx_report_runs_user").using("btree", table.organization_id.asc().nullsLast(), table.user_id.asc().nullsLast(), table.ran_at.asc().nullsLast()),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "report_runs_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.schedule_id],
			foreignColumns: [report_schedules.id],
			name: "report_runs_schedule_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "report_runs_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.document_id],
			foreignColumns: [documents.id],
			name: "report_runs_document_id_fkey"
		}).onDelete("cascade"),
	unique("report_runs_document_id_key").on(table.document_id),
]);

export const news_post_departments = pgTable("news_post_departments", {
	post_id: uuid().notNull(),
	department_id: uuid().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.post_id],
			foreignColumns: [news_posts.id],
			name: "news_post_departments_post_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.department_id],
			foreignColumns: [departments.id],
			name: "news_post_departments_department_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.post_id, table.department_id], name: "news_post_departments_pkey"}),
]);

export const news_post_documents = pgTable("news_post_documents", {
	post_id: uuid().notNull(),
	document_id: uuid().notNull(),
}, (table) => [
	index("idx_news_post_documents_document").using("btree", table.document_id.asc().nullsLast()),
	foreignKey({
			columns: [table.post_id],
			foreignColumns: [news_posts.id],
			name: "news_post_documents_post_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.document_id],
			foreignColumns: [documents.id],
			name: "news_post_documents_document_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.post_id, table.document_id], name: "news_post_documents_pkey"}),
]);

export const role_permissions = pgTable("role_permissions", {
	role_id: uuid().notNull(),
	permission_id: varchar({ length: 64 }).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.role_id],
			foreignColumns: [roles.id],
			name: "role_permissions_role_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.permission_id],
			foreignColumns: [permissions.id],
			name: "role_permissions_permission_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.role_id, table.permission_id], name: "role_permissions_pkey"}),
]);

export const request_message_documents = pgTable("request_message_documents", {
	message_id: uuid().notNull(),
	document_id: uuid().notNull(),
}, (table) => [
	index("idx_request_message_documents_document").using("btree", table.document_id.asc().nullsLast()),
	foreignKey({
			columns: [table.message_id],
			foreignColumns: [request_messages.id],
			name: "request_message_documents_message_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.document_id],
			foreignColumns: [documents.id],
			name: "request_message_documents_document_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.message_id, table.document_id], name: "request_message_documents_pkey"}),
]);

export const project_teams = pgTable("project_teams", {
	project_id: uuid().notNull(),
	team_id: uuid().notNull(),
}, (table) => [
	index("idx_project_teams_team").using("btree", table.team_id.asc().nullsLast()),
	foreignKey({
			columns: [table.project_id],
			foreignColumns: [projects.id],
			name: "project_teams_project_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.team_id],
			foreignColumns: [teams.id],
			name: "project_teams_team_id_fkey"
		}).onDelete("restrict"),
	primaryKey({ columns: [table.project_id, table.team_id], name: "project_teams_pkey"}),
]);

export const newsletter_deliveries = pgTable("newsletter_deliveries", {
	post_id: uuid().notNull(),
	subscriber_id: uuid().notNull(),
	sent_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.post_id],
			foreignColumns: [news_posts.id],
			name: "newsletter_deliveries_post_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.subscriber_id],
			foreignColumns: [newsletter_subscribers.id],
			name: "newsletter_deliveries_subscriber_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.post_id, table.subscriber_id], name: "newsletter_deliveries_pkey"}),
]);

export const team_members = pgTable("team_members", {
	team_id: uuid().notNull(),
	membership_id: uuid().notNull(),
	team_role_id: uuid(),
}, (table) => [
	foreignKey({
			columns: [table.team_id],
			foreignColumns: [teams.id],
			name: "team_members_team_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.membership_id],
			foreignColumns: [organization_memberships.id],
			name: "team_members_membership_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.team_role_id],
			foreignColumns: [roles.id],
			name: "team_members_team_role_id_fkey"
		}).onDelete("set null"),
	primaryKey({ columns: [table.team_id, table.membership_id], name: "team_members_pkey"}),
]);

export const news_post_reads = pgTable("news_post_reads", {
	post_id: uuid().notNull(),
	user_id: uuid().notNull(),
	read_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	acknowledged_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_news_post_reads_user").using("btree", table.user_id.asc().nullsLast()),
	foreignKey({
			columns: [table.post_id],
			foreignColumns: [news_posts.id],
			name: "news_post_reads_post_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "news_post_reads_user_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.post_id, table.user_id], name: "news_post_reads_pkey"}),
]);

export const membership_roles = pgTable("membership_roles", {
	membership_id: uuid().notNull(),
	role_id: uuid().notNull(),
	granted_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	granted_by_user_id: uuid(),
}, (table) => [
	index("idx_membership_roles_role").using("btree", table.role_id.asc().nullsLast()),
	foreignKey({
			columns: [table.membership_id],
			foreignColumns: [organization_memberships.id],
			name: "membership_roles_membership_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.role_id],
			foreignColumns: [roles.id],
			name: "membership_roles_role_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.granted_by_user_id],
			foreignColumns: [users.id],
			name: "membership_roles_granted_by_user_id_fkey"
		}).onDelete("set null"),
	primaryKey({ columns: [table.membership_id, table.role_id], name: "membership_roles_pkey"}),
]);

export const work_time_balances = pgTable("work_time_balances", {
	organization_id: uuid().notNull(),
	user_id: uuid().notNull(),
	overtime_minutes: numeric({ precision: 10, scale:  2 }).default('0').notNull(),
	vacation_minutes: numeric({ precision: 10, scale:  2 }).default('0').notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "work_time_balances_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "work_time_balances_user_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.organization_id, table.user_id], name: "work_time_balances_pkey"}),
]);
export const audit = pgView("audit", {	uuid: uuid(),
	entity: varchar({ length: 64 }),
	entity_uuid: varchar({ length: 255 }),
	action: varchar({ length: 128 }),
	actionby: uuid(),
	organization_id: uuid(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }),
}).as(sql`SELECT id AS uuid, target_type AS entity, target_id AS entity_uuid, action, actor_user_id AS actionby, organization_id, created_at FROM audit_logs`);

export const user_two_factor = pgTable("user_two_factor", {
	user_id: uuid().primaryKey().notNull(),
	secret_enc: text().notNull(),
	enabled: boolean().default(false).notNull(),
	recovery_hashes: text().array().default(sql`'{}'`).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	last_step: bigint({ mode: "number" }).default(0).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "user_two_factor_user_id_fkey"
		}).onDelete("cascade"),
]);

export const exchange_rates = pgTable("exchange_rates", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid(),
	currency: char({ length: 3 }).notNull(),
	target_currency: char({ length: 3 }).notNull(),
	valid_from: date().notNull(),
	rate: numeric({ precision: 18, scale:  8 }).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "exchange_rates_organization_id_fkey"
		}).onDelete("cascade"),
	unique("uq_exchange_rates").on(table.organization_id, table.currency, table.target_currency, table.valid_from),
	check("chk_exchange_rates_currency", sql`currency ~ '^[A-Z]{3}$'::text`),
	check("chk_exchange_rates_target", sql`(target_currency ~ '^[A-Z]{3}$'::text) AND (target_currency <> currency)`),
	check("chk_exchange_rates_rate", sql`rate > (0)::numeric`),
]);
