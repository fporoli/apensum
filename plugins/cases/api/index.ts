import { defineApiPlugin } from '@worktime3/api/plugin';
import { CaseAiService } from './case-ai.service';
import { CasesController } from './cases.controller';
import { CasesService } from './cases.service';

export default defineApiPlugin({
  id: 'cases',
  controllers: [CasesController],
  providers: [CasesService, CaseAiService],
});
