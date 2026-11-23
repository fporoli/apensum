import { BadRequestException } from '@nestjs/common';

export function listPage(page?: string, pageSize?: string): { offset: number; size: number } | null {
  if (page === undefined && pageSize === undefined) return null;
  const index = Number(page ?? '0');
  const size = Number(pageSize ?? '25');
  const offset = index * size;
  if (!/^\d+$/.test(page ?? '0') || !/^\d+$/.test(pageSize ?? '25') || !Number.isSafeInteger(offset) || size < 1 || size > 100 || offset > 2_147_483_647) {
    throw new BadRequestException('invalid-pagination');
  }
  return { offset, size };
}

export function pageRows<T>(rows: T[], size: number): { entries: T[]; hasMore: boolean } {
  return { entries: rows.slice(0, size), hasMore: rows.length > size };
}
