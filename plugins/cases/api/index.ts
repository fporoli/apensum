import { defineApiPlugin } from '@worktime3/api/plugin';
import { CaseAiService } from './case-ai.service';
import { CaseKeysController } from './case-keys.controller';
import { CasesController } from './cases.controller';
import { CasesService } from './cases.service';

export default defineApiPlugin({
  id: 'cases',
  controllers: [CasesController, CaseKeysController],
  providers: [CasesService, CaseAiService],
});
