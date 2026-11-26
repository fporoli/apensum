--liquibase formatted sql

-- The flow types' list (static_data flows/flow_type) says where they are now set up: in the Flow-Designer, which adds
-- and renames them and sets their steps (113, workflow-configs.controller.ts `flow-types`). Replaces 112's text.

--changeset worktime:114-flow-type-description
UPDATE static_data SET description = '{
  "de": "Die Flow-Arten, die man unter «Neuer Flow» wählt (Service, Support, HR …). Pro Art: Reihenfolge und ob sie vertraulich ist (nur die Person und die Bearbeitenden sehen sie). Anlegen, umbenennen und ihre Schritte festlegen: im Flow-Designer.",
  "fr": "Les types de flow que l''on choisit sous « Nouveau flow » (service, support, RH …). Pour chacun : l''ordre et s''il est confidentiel (visible seulement par la personne et ceux qui le traitent). Créer, renommer et définir leurs étapes : dans le Flow-Designer.",
  "it": "I tipi di flow che si scelgono sotto «Nuovo flow» (servizio, supporto, HR …). Per ciascuno: l''ordine e se è confidenziale (lo vedono solo la persona e chi lo tratta). Crearli, rinominarli e definirne le fasi: nel Flow-Designer.",
  "en": "The flow types people choose under «New flow» (service, support, HR …). Per type: its order and whether it is confidential (only the person and its handlers see it). Add, rename and set their steps in the Flow-Designer."}'::jsonb
WHERE organization_id IS NULL AND entity = 'flows' AND enum_name = 'flow_type';
