# Whale simulation: a company's life

`life.cjs` plays the company **Whale** day by day from its founding (2008-01-01) to yesterday, through the API's own services, and then checks the result over real HTTP.\
It is meant to show the app as it is after years of real use: realistic volumes, every flow and permission exercised, and where the time goes.\
It runs on **test** or **preprod** (GitHub workflow), on a developer's **dev** database, or on a scratch database (`local-check`).

## What happens

**The company** (spec by Fabio, 2026-11-27):
- Whale grows from a handful of people to **200** today.
- **Roles:** 5% HR, 5% finance (Whale's own role `finance`: payment runs and billing), 10% leads (`manager`), 5% IT support (`admin`, at least one of them also `developer`), the rest members (a tenth of them also developers).
- **Admin:** `admin@whale.com` with the password `admin` is owner and admin; the founder does HR until the first HR person comes, then gives the role away.
- About 10% give notice each year (HR records the last day some weeks ahead); people join on their first day through an invitation they accept.
- Ten departments at the founding, more later (Data & Analytics 2013, Security 2018, AI Lab 2023); a team per business department; people move between departments and teams; customer projects come and go (each with its customer and rate in billing).

**Every working day:**
- Everyone at work books their time, and project hours where they work on projects (only projects of their team).
- Some are ill (recorded that morning); some forget a day (the manager notices it at the month's end).
- People ask for vacation weeks ahead (about 25 days a year, more in summer); the manager decides one to three days later and now and then says no (asked again later).
- Expenses: travel and meals with customers (billable on the customer's project), supplies and software in the office.
- 0 to 10 Free Flows: to the manager or a department (HR, IT support, finance, customer service), sometimes with a due date (set by the asker or later by whoever handles it); most are taken, answered and resolved in the next days, about a quarter never get an answer.

**Each month:**
- On the first working days everyone hands in the month before: the timesheet (to the manager), the project hours (to each project's owner) and an expense report; the decisions come some days later; now and then one is sent back, completed and handed in again.
- HR follows up around the 20th (reminds, decides, completes), so **every month is closed within a month**.
- HR makes a payment run around the 12th, finance pays it; finance invoices each customer for the month before (hours and billable expenses), paid some weeks later.
- Now and then someone moves (an address change, a flow to HR) or forgets their password (the real reset link).

**Each year:** HR closes the year before for everyone in late January, the rest in late February, so **every year is closed a month after its last month**.

**At the end, over HTTP** (real logins: admin, a member, their manager, an HR person):
- **Data:** row counts and consistency, nobody books after their last day, every approved month has its closing, every month closed within a month, every person-year closed.
- **Paging:** the expense lists page correctly.
- **Security:** a member does not see another company's directory (Acme of the demo seed) and cannot decide someone else's step.
- **Timings:** three serial calls each of the directory, the approvals, the timesheet and expense-report lists, the monthly balances and the year-end overview (loopback, not a load test).

## How it works

- `life.cjs` boots the API's Nest application **without HTTP** (`NestFactory.createApplicationContext(AppModule)`, the plugins included) and calls its controllers as the person who acts (`{ kind: 'local', sub: <user id> }`), so every check, flow and permission runs as in real use.
- A day has an **agenda**: the company's things first (people come and go, structure), then what people do (in parallel, `SIM_PARALLEL`), then everyone at work books the day.
- **Decisions** go to whoever the record's open flow step waits for (`decide()`), step by step, with the step's rules (a work step such as paying cannot be sent back).
- **SQL** only where no service can act in the past or the spec asks for something the service refuses; each place says `SQL:` in the code:
  - an account's join date (the service says now, a leaver's exit must lie after it);
  - the admin's 8-character-short demo password `admin`, set once (as the demo seed does), never changed after;
  - the billing licence where the instance has no operator (a fresh dev database; on test and preprod the operator grants it).
- Mails are read as the person's mailbox would show them (invitation token, password reset link); the instance's mail goes to its Mailpit.
- The API's own timers (reminders, HR tasks) are off in the simulation's process; the instance itself keeps them.
- Random but reproducible: the same `SIM_SEED` gives the same company.

## Running it

**On test or preprod (GitHub):**

```sh
gh workflow run test-simulation.yml --ref main -f environment=preprod -f confirmation='SIMULATE preprod'
gh run list --workflow test-simulation.yml
```

It resets the instance first (`vps.yml` `reset-seed` with the image of the commit it runs from: wait until `build-push` of that commit is done), then runs `life.cjs` inside the API container; it refuses when Whale exists already.\
It takes about an hour or more (mostly the daily bookings).

**On dev** (your own database; it is reset first):

```sh
npm run dev:resetdb
node scripts/with-env.mjs dev node test/simulation/life.cjs dev     # checks over HTTP against the dev API on 8001
```

**On a scratch database** (nothing of yours touched):

```sh
createdb apensum_simulation_check                                   # in the dev Postgres
DATABASE_URL=postgresql://…/apensum_simulation_check npm run db:migrate
# an API on it (for the HTTP checks), e.g. API_PORT=8012, then:
SIM_API=http://127.0.0.1:8012/api/v1/ DATABASE_URL=… node test/simulation/life.cjs local-check
```

**Options:** `SIM_UNTIL=YYYY-MM-DD` stops early (no checks then), `SIM_SEED` changes the randomness, `SIM_PARALLEL` sets how many people act at once (8), `SIM_API` the API for the checks.

## What it found so far

- **A leaver's year could never be closed** (months after the exit counted as open): fixed, months after the employment are `after-end`.
- **Where the time goes** (database sampled during a run, 78% busy): writing the history (`versions`, about a quarter, now written in batches: about a third faster overall), the overlap checks of bookings, looking up roles and permissions for every call, the flow definition written again at every flow start, the manager re-routing over all open flows at every decision.
