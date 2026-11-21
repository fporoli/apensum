import { defineApiPlugin } from '@worktime3/api/plugin';
import { CaseAiService } from './case-ai.service';
import { CaseKeysController } from './case-keys.controller';
import { CasesController } from './cases.controller';
import { CasesService } from './cases.service';
import { ASSESSMENT_FORM, CASE_FORM } from '../shared/forms';

export default defineApiPlugin({
  id: 'cases',
  controllers: [CasesController, CaseKeysController],
  providers: [CasesService, CaseAiService],
  // The organization's own fields on cases and assessments, defined in design mode.
  forms: [CASE_FORM, ASSESSMENT_FORM],
});
