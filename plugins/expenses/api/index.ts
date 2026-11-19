import { defineApiPlugin } from '@worktime3/api/plugin';
import { ExchangeRatesController } from './exchange-rates.controller';
import { ExpenseReceiptService } from './expense-receipt.service';
import { EXPENSES_API_REPORT } from './expense-report';
import { EXPENSE_TEAM_VIEWS } from './team-views';
import { EXPENSES_BACKUP, EXPENSES_PAYROLL } from './import-export';
import { expenseReceipts } from './documents';
import { EXPENSE_WORKFLOWS } from './workflow';
import { ExpenseReportsController } from './expense-reports.controller';
import { ExpensesController } from './expenses.controller';
import { ReceiptHandoffController } from './receipt-handoff.controller';
import { ReceiptHandoffService } from './receipt-handoff.service';

export default defineApiPlugin({
  id: 'expenses',
  controllers: [ExpensesController, ExpenseReportsController, ExchangeRatesController, ReceiptHandoffController],
  providers: [ExpenseReceiptService, ReceiptHandoffService],
  reports: [EXPENSES_API_REPORT],
  teamViews: EXPENSE_TEAM_VIEWS,
  payroll: [EXPENSES_PAYROLL],
  backup: EXPENSES_BACKUP,
  workflows: EXPENSE_WORKFLOWS,
  documents: { expense: expenseReceipts },
});
