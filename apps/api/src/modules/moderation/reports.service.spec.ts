import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';

import { UsersService } from '../users/users.service';
import { ReportsService } from './reports.service';
import { Report } from './schemas/report.schema';

/** Chainable query stub whose `.exec()` resolves to `result`. */
function queryReturning(result: unknown): { exec: jest.Mock } {
  return { exec: jest.fn().mockResolvedValue(result) };
}

/** Minimal hydrated-report stub the service maps via `toContract`. */
function reportDoc(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    _id: { toString: () => 'report-1' },
    fromUserId: { toString: () => FROM },
    againstUserId: { toString: () => AGAINST },
    matchId: null,
    reason: 'spam',
    details: null,
    status: 'open',
    get: (_k: string) => new Date('2026-05-31T00:00:00.000Z'),
    ...over,
  };
}

const FROM = '507f1f77bcf86cd799439011';
const AGAINST = '507f1f77bcf86cd799439012';

describe('ReportsService', () => {
  let service: ReportsService;
  let reportModel: {
    exists: jest.Mock;
    create: jest.Mock;
    find: jest.Mock;
    findByIdAndUpdate: jest.Mock;
  };
  let usersService: { findById: jest.Mock };

  beforeEach(async () => {
    reportModel = {
      exists: jest.fn(),
      create: jest.fn(),
      find: jest.fn(),
      findByIdAndUpdate: jest.fn(),
    };
    usersService = { findById: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: getModelToken(Report.name), useValue: reportModel },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    service = moduleRef.get(ReportsService);
  });

  describe('createReport', () => {
    it('rejects a self-report before any DB work', async () => {
      await expect(
        service.createReport(FROM, { againstUserId: FROM, reason: 'spam' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(usersService.findById).not.toHaveBeenCalled();
      expect(reportModel.create).not.toHaveBeenCalled();
    });

    it('404s when the reported user does not exist', async () => {
      usersService.findById.mockResolvedValue(null);
      await expect(
        service.createReport(FROM, { againstUserId: AGAINST, reason: 'spam' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(reportModel.create).not.toHaveBeenCalled();
    });

    it('dedupes: rejects a repeat report against the same user within the window', async () => {
      usersService.findById.mockResolvedValue({ _id: AGAINST });
      reportModel.exists.mockReturnValue(queryReturning({ _id: 'existing' }));

      await expect(
        service.createReport(FROM, { againstUserId: AGAINST, reason: 'spam' }),
      ).rejects.toBeInstanceOf(ConflictException);

      // The dedupe query is scoped to (reporter, target) within a recent window.
      const [filter] = reportModel.exists.mock.calls[0] as [Record<string, unknown>];
      expect(filter).toMatchObject({
        createdAt: expect.objectContaining({ $gte: expect.any(Date) }),
      });
      expect(reportModel.create).not.toHaveBeenCalled();
    });

    it('creates an OPEN report when the target exists and there is no recent duplicate', async () => {
      usersService.findById.mockResolvedValue({ _id: AGAINST });
      reportModel.exists.mockReturnValue(queryReturning(null));
      reportModel.create.mockResolvedValue(reportDoc());

      const result = await service.createReport(FROM, {
        againstUserId: AGAINST,
        reason: 'spam',
      });

      expect(reportModel.create).toHaveBeenCalledTimes(1);
      const [doc] = reportModel.create.mock.calls[0] as [Record<string, unknown>];
      expect(doc).toMatchObject({ reason: 'spam', status: 'open', details: null });
      expect(result.status).toBe('open');
      expect(result.id).toBe('report-1');
    });
  });

  describe('resolveReport', () => {
    it('rejects a non-terminal target status', async () => {
      await expect(service.resolveReport('report-1', 'open')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.resolveReport('report-1', 'reviewing')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('404s an invalid id without a DB write', async () => {
      await expect(service.resolveReport('not-an-id', 'resolved')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(reportModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('404s an unknown report', async () => {
      reportModel.findByIdAndUpdate.mockReturnValue(queryReturning(null));
      await expect(
        service.resolveReport('507f1f77bcf86cd799439013', 'dismissed'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('sets the status and returns the updated report', async () => {
      reportModel.findByIdAndUpdate.mockReturnValue(
        queryReturning(reportDoc({ status: 'resolved' })),
      );

      const result = await service.resolveReport('507f1f77bcf86cd799439013', 'resolved');

      const [, update, options] = reportModel.findByIdAndUpdate.mock.calls[0] as [
        unknown,
        Record<string, unknown>,
        Record<string, unknown>,
      ];
      expect(update).toEqual({ $set: { status: 'resolved' } });
      expect(options).toMatchObject({ new: true });
      expect(result.status).toBe('resolved');
    });
  });

  describe('listReports', () => {
    it('filters by status and paginates with limit+1 lookahead', async () => {
      // Return limit+1 docs to exercise hasMore + nextCursor.
      const docs = [
        reportDoc({ _id: { toString: () => 'r3' } }),
        reportDoc({ _id: { toString: () => 'r2' } }),
        reportDoc({ _id: { toString: () => 'r1' } }),
      ];
      const chain = {
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(docs),
      };
      reportModel.find.mockReturnValue(chain);

      const page = await service.listReports({ limit: 2 }, 'open');

      // status filter applied.
      const [filter] = reportModel.find.mock.calls[0] as [Record<string, unknown>];
      expect(filter).toMatchObject({ status: 'open' });
      // limit+1 requested.
      expect(chain.limit).toHaveBeenCalledWith(3);
      // Page trimmed to limit, hasMore true, cursor = last kept id.
      expect(page.items).toHaveLength(2);
      expect(page.hasMore).toBe(true);
      expect(page.nextCursor).toBe('r2');
    });

    it('returns an empty terminal page for an invalid cursor', async () => {
      const page = await service.listReports({ limit: 20, cursor: 'not-an-id' });
      expect(page).toEqual({ items: [], nextCursor: null, hasMore: false });
      expect(reportModel.find).not.toHaveBeenCalled();
    });
  });
});
