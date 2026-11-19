import { defineApiPlugin } from '@worktime3/api/plugin';
import { ExchangeRatesController } from './exchange-rates.controller';
import { ExpenseReceiptService } from './expense-receipt.service';
import { ExpenseReportsController } from './expense-reports.controller';
import { ExpensesController } from './expenses.controller';
import { ReceiptHandoffController } from './receipt-handoff.controller';
import { ReceiptHandoffService } from './receipt-handoff.service';

export default defineApiPlugin({
  id: 'expenses',
  controllers: [ExpensesController, ExpenseReportsController, ExchangeRatesController, ReceiptHandoffController],
  providers: [ExpenseReceiptService, ReceiptHandoffService],
});
