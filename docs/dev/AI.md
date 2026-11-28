# AI

Azure OpenAI in Switzerland, the budget, the assistant and its tools.\
Moved from CLAUDE.md as it was; CLAUDE.md keeps the rules that apply everywhere and points here.

- AI is Azure OpenAI in Switzerland only (no other provider anywhere), every call through `AiBudgetService`.\
  AI assistant (`assistant.service.ts`): tool-calling on the Azure deployment, one budget reservation per question (kind `assistant`, up to `ASSISTANT_ROUNDS` model rounds, settled with the tokens used).\
  Tools (`assistant-tools.ts` contract, core ones in `assistant-core-tools.ts`: working time, project time, absences, balances, approvals, flows, the monthly report and project timesheet (status, submit), the team calendar, the directory; plugins via `ApiPlugin.assistantTools`: expenses, roster (shifts, wishes), billing (invoices, read only), hrplus (certificates, loans; by default everyone the caller sees), hr (where reviews stand, never their content), notes; none for cases (encrypted) or whistle) call the page's controller method with a request made for the caller (`ctx.get(Controller)`, `ctx.req`), so they run exactly the REST checks; never query around them.\
  A tool is offered only when the caller may see its `object`.\
  Times are wall-clock in the caller's `users.timezone` (else Europe/Zurich); `*-confirm` warnings are resent only after the user agrees.\
  The system prompt keeps working time and project time apart.\
  The web opens it from the header's sparkle button or Ctrl+/ as a panel sliding in from the right (an overlay; the pin docks it and the page makes room; full screen on a phone).\
  Each person's questions are kept per organization (`assistant_prompts` 084, `GET/POST/DELETE assistant/prompts`, only their own): asked again = moved up, starred = favourite, non-favourites beyond the newest 30 dropped; the answers are not kept.\
  The empty panel lists favourites and recent questions to ask again.
- Levels (`AI_LEVELS` in `packages/shared/src/ai.ts`: `standard` "Schnell", `advanced` "Gründlich", `max` "Maximal"): each level of the instance is a deployment on its Azure resource with its own prices (`instanceLevel`: `AZURE_OPENAI_DEPLOYMENT` and `AZURE_OPENAI_CHF_PER_1M_INPUT/OUTPUT` for standard, the same names ending in `_ADVANCED` / `_MAX`, and `AZURE_OPENAI_REASONING[_…]` low/medium/high for a reasoning model); a level without deployment or prices is not offered.\
  An operator sets per organization the highest level it may use (`settings.ai.maxLevel`, default standard; Organization settings -> AI and costs), since the instance pays.\
  Every chat call asks `AiBudgetService.chatTarget(orgId, level)` where to go and calls with `chatParams` (model, token limit, `reasoning_effort`), `targetEstimateChf` and `targetChf`: the assistant, receipts and roster at standard, Cases at the level the assessor picks (its select in the assessment, kept per browser).\
  A reasoning model's token limit gets room for thinking (`completionTokens`: ×2/×3/×4) and a longer timeout.\
  `ai_usage.level` (125) records the level.
- An organization's own Azure OpenAI resource (`settings.ai.own`: endpoint, a deployment per level with standard required, reasoning effort, the region and when it was checked; `PUT/DELETE organizations/:orgId/ai-settings/own`, for whoever edits Organization settings): its key is sealed with the documents master key (`organization_ai_keys` 125, `sealSecret`, rewrapped by `db:encrypt-documents -- --rewrap`), never sent back; its last four characters (`key_hint` 126) tell keys apart.\
  Saving tries every deployment once (`probeOwnDeployment`, a tiny call Azure bills to the organization) and keeps it only when Azure answers from Switzerland (`x-ms-region`, `SWISS_REGION`); without `DOCUMENTS_KEY` there is nowhere to keep a key and it is refused.\
  With it, every chat call of the organization goes there (its levels are the ones deployed there, no maximum), as provider `azure-openai-own`: neither the instance's budget nor the organization's limit counts those rows (CHF 0), only the per-user limits apply.\
  Transcription stays on the instance's resource.
