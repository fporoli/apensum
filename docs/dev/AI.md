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
