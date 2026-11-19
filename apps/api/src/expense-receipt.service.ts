import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { azureOpenAiClient, azureOpenAiConfig, chatErrorCode } from './ai-client';
import { AiBudgetService, azurePrices, chatChf, estimateChatChf } from './ai-budget.service';
import { CaseAiService, caseAiAvailability } from './case-ai.service';
import { extractPdfText, isPdf } from './case-document-text';
import {
  RECEIPT_IMAGE_ESTIMATE_CHARS, RECEIPT_MAX_TOKENS, buildReceiptMessages, isHeic, parseReceiptAnswer, receiptImageMime, type ReceiptSuggestion,
} from './expense-receipt';

/**
 * Receipt recognition on the expense form, for every organization with expenses, whenever the
 * instance has Azure OpenAI (Switzerland, "Standard" deployment). Never another provider: receipts
 * carry names, places and card details. Goes through AiBudgetService like the Cases AI (the
 * instance budget and the organization's monthly AI limit); nothing is stored here.
 */
@Injectable()
export class ExpenseReceiptService {
  private readonly logger = new Logger('ExpenseReceipt');

  constructor(
    private readonly budget: AiBudgetService,
    private readonly caseAi: CaseAiService,
  ) {}

  available(): boolean {
    return caseAiAvailability().azureOpenai;
  }

  async scan(orgId: string, userId: string, file: Buffer, categories: Record<string, string>, today: string): Promise<ReceiptSuggestion> {
    if (!this.available()) throw new ServiceUnavailableException('ai-provider-not-configured');
    let receipt: { imageDataUrl?: string; text?: string };
    const mime = receiptImageMime(file);
    if (mime) receipt = { imageDataUrl: `data:${mime};base64,${file.toString('base64')}` };
    else if (isPdf(file)) {
      // A PDF's text layer is cheaper and more exact than an image; a scan without one can't be read here.
      const text = await extractPdfText(file);
      if (!text) throw new BadRequestException('receipt-pdf-no-text');
      receipt = { text };
    } else if (isHeic(file)) throw new BadRequestException('receipt-heic');
    else throw new BadRequestException('receipt-format');

    const prices = azurePrices()!;
    const config = azureOpenAiConfig()!;
    const messages = buildReceiptMessages(receipt, categories);
    const inputChars = (receipt.text?.length ?? 0) + (receipt.imageDataUrl ? RECEIPT_IMAGE_ESTIMATE_CHARS : 0) + 2_000;
    const orgLimitChf = (await this.caseAi.settings(orgId)).monthlyLimitChf;
    const id = await this.budget.reserve({
      orgId, userId, caseId: null, kind: 'receipt', provider: 'azure-openai',
      estimateChf: estimateChatChf(inputChars, RECEIPT_MAX_TOKENS, prices), orgLimitChf,
    });
    this.logger.log(`Receipt scan: org ${orgId}, user ${userId}, ${receipt.imageDataUrl ? mime : 'pdf text'}, ${file.length} bytes`);
    const context = { orgId, orgLimitChf };
    let answer: string;
    try {
      const completion = await azureOpenAiClient(config, 60_000).chat.completions.create({
        model: config.deployment, messages, max_completion_tokens: RECEIPT_MAX_TOKENS, response_format: { type: 'json_object' },
      });
      const usage = completion.usage;
      await this.budget.finish(id, {
        ok: true, inputTokens: usage?.prompt_tokens, outputTokens: usage?.completion_tokens,
        actualChf: usage ? chatChf(usage.prompt_tokens, usage.completion_tokens, prices) : null,
      }, context);
      answer = completion.choices[0]?.message?.content ?? '';
    } catch (error) {
      const status = (error as { status?: number }).status;
      const code = chatErrorCode(status, 'receipt-unreadable');
      this.logger.warn(`Receipt scan failed for org ${orgId}: ${error instanceof Error ? error.message : error}`);
      await this.budget.finish(id, { ok: false, error: code, actualChf: status === undefined ? null : 0 }, context);
      throw new ServiceUnavailableException(code);
    }
    try {
      return parseReceiptAnswer(answer, Object.keys(categories), today);
    } catch {
      throw new BadRequestException('receipt-unreadable');
    }
  }
}
