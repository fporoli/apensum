import { defineApiPlugin } from '@worktime3/api/plugin';
import { ExchangeRatesController } from './exchange-rates.controller';
import { ExpenseReceiptService } from './expense-receipt.service';
import { EXPENSES_API_REPORT } from './expense-report';
import { EXPENSE_TEAM_VIEWS } from './team-views';
import { EXPENSES_PAYROLL } from './import-export';
import { expenseReceipts } from './documents';
import { EXPENSE_WORKFLOWS } from './workflow';
import { EXPENSE_FORM } from '../shared/form';
import { ExpenseReportsController } from './expense-reports.controller';
import { ExpensesController } from './expenses.controller';
import { ReceiptHandoffController } from './receipt-handoff.controller';
import { ReceiptHandoffService } from './receipt-handoff.service';
import { EXPENSE_ASSISTANT_TOOLS } from './assistant-tools';

export default defineApiPlugin({
  id: 'expenses',
  controllers: [ExpensesController, ExpenseReportsController, ExchangeRatesController, ReceiptHandoffController],
  providers: [ExpenseReceiptService, ReceiptHandoffService],
  reports: [EXPENSES_API_REPORT],
  teamViews: EXPENSE_TEAM_VIEWS,
  payroll: [EXPENSES_PAYROLL],
  workflows: EXPENSE_WORKFLOWS,
  documents: { expense: expenseReceipts },
  forms: [EXPENSE_FORM],
  assistantTools: EXPENSE_ASSISTANT_TOOLS,
});
