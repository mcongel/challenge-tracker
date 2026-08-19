/** The reversible parked-sale machinery — trim, undo, and sale editing —
 * extracted whole from DataContext. The converging-write / compensating-
 * delete discipline in trimCore and undoCore is deliberate and load-bearing:
 * bodies here moved VERBATIM (state fields become hook args), and any future
 * change should be reviewed against the failure modes the comments name. */

import { useCallback } from 'react';
import type { CashEvent } from '../../lib/engine';
import {
  adjustmentsForLots, buildSaleSnapshot, consumeLotsFifo, planSaleRestore, roundCents, trimPreview,
} from '../../lib/engine';
import type {
  LotConsumption, ParkedLot, ParkedLotAdjustment, ParkedPosition, ParkedSale, ParkedSaleSnapshot,
} from '../../lib/engine';
import {
  db, fetchAll, mapParked, mapParkedLot, mapParkedLotAdjustment, mapParkedSale, parkedSalePayload,
} from '../../lib/db';
import { errorMessage } from '../../lib/utils';

export function useParkedSales(args: {
  parked: ParkedPosition[];
  parkedLots: ParkedLot[];
  parkedLotAdjustments: ParkedLotAdjustment[];
  refresh: () => Promise<void>;
  recomputeParkedAggregate: (positionId: string) => Promise<void>;
  insertDepositWithTwin: (e: Omit<CashEvent, 'id'>, vooPriceThatDay: number) => Promise<unknown>;
  insertRocAllocations: (divLot: Pick<ParkedLot, 'id' | 'parkedPositionId' | 'amount' | 'date'>) => Promise<void>;
}) {
  const {
    parked, parkedLots, parkedLotAdjustments, refresh, recomputeParkedAggregate,
    insertDepositWithTwin, insertRocAllocations,
  } = args;

  const deleteParkedSale = useCallback(
    async (id: string) => {
      const { error: err } = await db().from('parked_sales').delete().eq('id', id);
      if (err) throw err;
      await refresh();
    },
    [refresh],
  );

  const updateParkedSale = useCallback(
    async (
      id: string,
      patch: Partial<Pick<ParkedSale, 'date' | 'costBasis' | 'ltShares' | 'fundedChallenge' | 'notes'>>,
    ) => {
      const payload: Record<string, unknown> = {};
      if (patch.date !== undefined) payload.date = patch.date;
      if (patch.costBasis !== undefined) payload.cost_basis = patch.costBasis;
      if (patch.ltShares !== undefined) payload.lt_shares = patch.ltShares;
      if (patch.fundedChallenge !== undefined) payload.funded_challenge = patch.fundedChallenge;
      if (patch.notes !== undefined) payload.notes = patch.notes;
      const { error: err } = await db().from('parked_sales').update(payload).eq('id', id);
      if (err) throw err;
      await refresh();
    },
    [refresh],
  );

  /** The sale itself: consume lots, write the consumption snapshot, insert
   * the sale row, recompute the aggregate. Takes its data as arguments (never
   * React state) so a caller working from fresh DB reads — sale editing —
   * behaves identically to one working from state. NO ledger writes and NO
   * refresh here; recordTrim layers those on. */
  const trimCore = useCallback(
    async (args: {
      position: ParkedPosition;
      lots: ParkedLot[];
      adjustments: ParkedLotAdjustment[];
      /** For dividend-stamp lookups on carried (cross-position) ROC rows. */
      allLots: ParkedLot[];
      shares: number;
      pricePerShare: number;
      date: string;
      fundedChallenge: boolean;
      /** Broker/regulatory fees — proceeds record NET (the tax treatment). */
      fees?: number;
      notes?: string | null;
    }) => {
      const client = db();
      const { position: p, lots: positionLots, adjustments: positionAdjustments } = args;
      let costBasis: number | null = null;
      let ltShares: number | null = null;
      let snapshot: ParkedSaleSnapshot | null = null;
      let consumption: LotConsumption | null = null;
      let dripDeletes: string[] = [];
      let hardDeletes: string[] = [];
      let consumedBasis: number | null = null;
      if (positionLots.length > 0) {
        // Consume lots oldest-first so remaining basis and unlock clocks stay
        // honest — and so the sale record carries the real basis and LT split.
        const preview = trimPreview(
          positionLots, args.shares, args.pricePerShare, args.date, positionAdjustments,
        );
        // ROC-adjusted basis — what the sale is actually taxed against.
        costBasis = roundCents(preview.adjustedCostBasis);
        // Undated shares count as LT, matching estimatedPileTax's documented
        // assumption (and the TrimModal estimate).
        ltShares = preview.ltShares + preview.unknownShares;
        consumption = consumeLotsFifo(positionLots, args.shares, positionAdjustments);
        // DRIP dividend lots double as income records. Selling their
        // reinvested shares is right (the basis went into the sale), but the
        // dividend still happened — keep the lot at zero shares so trailing
        // income and the YTD tax estimate don't shrink retroactively.
        // (Account-cash math tells sold-DRIP relics from cash dividends by
        // price: cash dividends have none.) The partition and the consumed
        // cash-spending basis both come straight from consumeLotsFifo — one
        // source, so they can't diverge from what was actually consumed.
        dripDeletes = consumption.dripDeletes;
        hardDeletes = consumption.hardDeletes;
        const stampLookup = new Map(args.allLots.map((l) => [l.id, l.rocAllocatedAt ?? null]));
        snapshot = buildSaleSnapshot(
          p, positionLots, positionAdjustments, consumption, dripDeletes,
          (id) => stampLookup.get(id),
        );
        const raw = roundCents(consumption.cashSpendingBasisConsumed);
        consumedBasis = raw > 0 ? raw : null;
      }

      if (!consumption) {
        // No lot history (legacy) — adjust the aggregate directly, and do it
        // BEFORE the sale row: a snapshot-less sale has no Undo, so a
        // mid-failure must leave "no sale record" (repairable in Edit), never
        // a phantom sale over undiminished shares.
        const remaining = p.shares - args.shares;
        if (remaining > 1e-9) {
          const { error: err } = await client
            .from('parked_positions').update({ shares: remaining }).eq('id', p.id);
          if (err) throw err;
        } else {
          const { error: err } = await client.from('parked_positions').delete().eq('id', p.id);
          if (err) throw err;
        }
      }

      // For lot-backed trims the sale row (and its undo snapshot) is written
      // FIRST: a mid-failure below leaves a recorded sale whose Undo
      // converges — restoring only what actually applied — instead of eaten
      // shares with no record.
      const { data: saleRow, error: saleErr } = await client
        .from('parked_sales')
        .insert(
          parkedSalePayload({
            ticker: p.ticker,
            accountId: p.accountId,
            date: args.date,
            shares: args.shares,
            pricePerShare: args.pricePerShare,
            proceeds: roundCents(args.shares * args.pricePerShare - (args.fees ?? 0)),
            costBasis,
            ltShares,
            fundedChallenge: args.fundedChallenge,
            consumedBasis,
            consumed: snapshot,
            notes: args.notes ?? null,
          }),
        )
        .select('id')
        .single();
      if (saleErr) {
        if (!consumption) {
          throw new Error(
            `Shares were reduced but the sale record failed (${saleErr.message}). Fix the share count in Edit, then re-record the sale.`,
          );
        }
        throw saleErr;
      }
      const saleId = saleRow.id as string;

      if (consumption) {
        for (const u of consumption.updates) {
          const { error: err } = await client
            .from('parked_lots').update({ shares: u.shares, amount: u.amount }).eq('id', u.id);
          if (err) throw err;
        }
        for (const a of consumption.adjustmentUpdates) {
          const { error: err } = await client
            .from('parked_lot_adjustments').update({ amount: a.amount }).eq('id', a.id);
          if (err) throw err;
        }
        for (const id of dripDeletes) {
          const { error: err } = await client
            .from('parked_lots').update({ shares: 0 }).eq('id', id);
          if (err) throw err;
        }
        if (hardDeletes.length > 0) {
          const { error: err } = await client.from('parked_lots').delete().in('id', hardDeletes);
          if (err) throw err;
        }
        await recomputeParkedAggregate(p.id);
      }
      return saleId;
    },
    [recomputeParkedAggregate],
  );

  const recordTrim = useCallback(
    async ({
      parkedId, shares, pricePerShare, date, depositVooPrice, fees = 0,
    }: {
      parkedId: string;
      shares: number;
      pricePerShare: number;
      date: string;
      depositVooPrice?: number;
      /** SEC/FINRA-style sell fees — the sale and any funding deposit record net. */
      fees?: number;
    }) => {
      const client = db();
      const p = parked.find((x) => x.id === parkedId);
      if (!p) throw new Error('Parked position not found');
      if (shares <= 0) throw new Error('Shares must be positive');
      if (shares > p.shares + 1e-9) {
        throw new Error(`Only ${p.shares} shares parked; cannot trim ${shares}`);
      }
      const positionLots = parkedLots.filter((l) => l.parkedPositionId === parkedId);
      try {
        // The sale starts UNFUNDED and is marked funded only after the
        // Deposit + twin actually land — so the record never claims a ledger
        // deposit that doesn't exist, no matter where a failure hits.
        const saleId = await trimCore({
          position: p,
          lots: positionLots,
          adjustments: adjustmentsForLots(positionLots, parkedLotAdjustments),
          allLots: parkedLots,
          shares,
          pricePerShare,
          date,
          fundedChallenge: false,
          fees,
          notes: fees > 0 ? `net of $${fees.toFixed(2)} fees` : null,
        });

        if (depositVooPrice) {
          try {
            await insertDepositWithTwin(
              {
                date,
                type: 'Deposit',
                // What actually moved: proceeds net of fees.
                amount: roundCents(shares * pricePerShare - fees),
                sourceDestination: `${p.ticker} trim (${p.account})`,
                accountId: p.accountId,
              },
              depositVooPrice,
            );
          } catch (fundErr) {
            throw new Error(
              `Sale recorded, but funding the challenge failed. ${errorMessage(fundErr)} The sale stays marked unfunded.`,
            );
          }
          const { error: markErr } = await client
            .from('parked_sales').update({ funded_challenge: true }).eq('id', saleId);
          if (markErr) {
            throw new Error(
              `Deposit recorded, but the sale couldn't be marked as challenge-funded (${markErr.message}) — pile account cash will double-count the proceeds until it is.`,
            );
          }
        }
      } finally {
        // Refresh even on failure — a mid-trim error leaves a recorded sale
        // whose Undo affordance must be visible immediately. refresh() never
        // rejects (fetch failures land in the context's error banner).
        await refresh();
      }
    },
    [refresh, parked, parkedLots, parkedLotAdjustments, trimCore, insertDepositWithTwin],
  );

  /** Undo a snapshot-bearing sale: fresh-read everything, build the
   * converging restore plan, apply it, delete the sale row LAST so a failed
   * attempt is simply retried. Never touches the challenge ledger (a funded
   * sale's Deposit + shadow twin stay — the UI warns). No refresh — callers. */
  const undoCore = useCallback(
    async (saleId: string) => {
      const client = db();
      const { data: saleRow, error: saleErr } = await client
        .from('parked_sales').select('*').eq('id', saleId).single();
      if (saleErr) throw saleErr;
      const sale = mapParkedSale(saleRow);
      const snapshot = sale.consumed;
      if (!snapshot) throw new Error('This sale predates undo support — edit its numbers instead.');

      // LIFO invariant, enforced where it matters (both undo AND edit route
      // through here): restoring an older sale beneath a newer one would
      // corrupt both records' basis history.
      const { data: newer, error: newerErr } = await client
        .from('parked_sales')
        .select('id')
        .eq('ticker', sale.ticker)
        .eq('account_id', sale.accountId)
        .not('consumed', 'is', null)
        .gt('created_at', sale.createdAt ?? '')
        .limit(1);
      if (newerErr) throw newerErr;
      if ((newer ?? []).length > 0) {
        throw new Error(`Undo or edit the newer ${sale.ticker} sale first — restores go newest-first.`);
      }

      // Fresh reads: the position, its lots, snapshot-referenced lots (which
      // may live on other positions after transfers), and both adjustment
      // views (by lot and by snapshot row id).
      const { data: posRow, error: posErr } = await client
        .from('parked_positions')
        .select('*, account:accounts(name)')
        .eq('id', snapshot.positionId)
        .maybeSingle();
      if (posErr) throw posErr;
      const position = posRow ? mapParked(posRow) : null;

      const refIds = [
        ...new Set([
          ...snapshot.slices.map((s) => s.lotId),
          ...snapshot.slices.flatMap((s) =>
            s.adjustments.map((a) => a.dividendLotId).filter((x): x is string => Boolean(x)),
          ),
        ]),
      ];
      const [byPos, byIds] = await Promise.all([
        client.from('parked_lots').select('*').eq('parked_position_id', snapshot.positionId),
        client.from('parked_lots').select('*').in('id', refIds),
      ]);
      if (byPos.error) throw byPos.error;
      if (byIds.error) throw byIds.error;
      const lotMap = new Map(
        [...(byPos.data ?? []), ...(byIds.data ?? [])].map((r) => {
          const l = mapParkedLot(r);
          return [l.id, l] as const;
        }),
      );
      const lots = [...lotMap.values()];
      // A snapshot adjustment's share lot is always its slice's lot, and rows
      // cascade with their lot — so the by-lot query covers every restorable
      // row; a row whose lot vanished is gone and goes through the upsert path.
      const lotIds = lots.map((l) => l.id);
      let adjustments: ParkedLotAdjustment[] = [];
      if (lotIds.length > 0) {
        const { data: adjRows, error: adjErr } = await client
          .from('parked_lot_adjustments').select('*').in('share_lot_id', lotIds);
        if (adjErr) throw adjErr;
        adjustments = (adjRows ?? []).map(mapParkedLotAdjustment);
      }

      const plan = planSaleRestore(sale, snapshot, {
        position,
        lots,
        adjustments,
        dividendLots: lots.filter((l) => l.source === 'dividend'),
      });

      // If the holding was re-bought after the full sale, a fresh position
      // row owns (ticker, account) — restore the lots under it instead of
      // colliding with the unique key.
      let effectivePositionId = snapshot.positionId;
      if (plan.recreatePosition) {
        const { data: clash, error: clashErr } = await client
          .from('parked_positions')
          .select('id')
          .eq('ticker', plan.recreatePosition.ticker)
          .eq('account_id', plan.recreatePosition.accountId)
          .maybeSingle();
        if (clashErr) throw clashErr;
        if (clash) {
          effectivePositionId = clash.id as string;
        } else {
          const { error: err } = await client.from('parked_positions').upsert({
            id: plan.recreatePosition.id,
            ticker: plan.recreatePosition.ticker,
            account_id: plan.recreatePosition.accountId,
            category: snapshot.position.category,
            shares: 0, // recomputed from restored lots below
            avg_cost: snapshot.position.avgCost,
            current_price: snapshot.position.currentPrice,
            trim_rank: snapshot.position.trimRank,
            dividend_rate: snapshot.position.dividendRate,
            dividend_frequency: snapshot.position.dividendFrequency,
            notes: snapshot.position.notes,
          });
          if (err) throw err;
        }
      }
      if (plan.revivePrice !== null) {
        const { error: err } = await client
          .from('parked_positions')
          .update({ current_price: plan.revivePrice })
          .eq('id', snapshot.positionId);
        if (err) throw err;
      }
      if (plan.lotUpserts.length > 0) {
        const { error: err } = await client.from('parked_lots').upsert(
          plan.lotUpserts.map((u) => ({
            id: u.id,
            parked_position_id: effectivePositionId,
            date: u.date,
            source: u.source,
            shares: u.shares,
            price: u.price,
            amount: u.amount,
            classification: u.classification,
            ex_date: u.exDate,
            reclassified_at: u.reclassifiedAt,
            roc_allocated_at: u.rocAllocatedAt,
            roc_overflow: u.rocOverflow,
            origin: u.origin,
            notes: u.notes,
          })),
          { onConflict: 'id', ignoreDuplicates: true },
        );
        if (err) throw err;
      }
      const lotSetResults = await Promise.all(
        plan.lotSets.map((s) =>
          client.from('parked_lots').update({ shares: s.shares, amount: s.amount }).eq('id', s.id),
        ),
      );
      for (const r of lotSetResults) if (r.error) throw r.error;
      if (plan.adjustmentUpserts.length > 0) {
        const { error: err } = await client.from('parked_lot_adjustments').upsert(
          plan.adjustmentUpserts.map((u) => ({
            id: u.id,
            share_lot_id: u.shareLotId,
            dividend_lot_id: u.dividendLotId,
            amount: u.amount,
          })),
          { onConflict: 'id', ignoreDuplicates: true },
        );
        if (err) throw err;
      }
      const adjSetResults = await Promise.all(
        plan.adjustmentSets.map((s) =>
          client.from('parked_lot_adjustments').update({ amount: s.amount }).eq('id', s.id),
        ),
      );
      for (const r of adjSetResults) if (r.error) throw r.error;
      for (const r of plan.reallocate) {
        await insertRocAllocations(r); // idempotent; re-spreads over restored basis — stays serial
      }
      await recomputeParkedAggregate(effectivePositionId);
      const { error: delErr } = await client.from('parked_sales').delete().eq('id', saleId);
      if (delErr) throw delErr;
    },
    [recomputeParkedAggregate, insertRocAllocations],
  );

  const undoParkedSale = useCallback(
    async (saleId: string) => {
      try {
        await undoCore(saleId);
      } finally {
        await refresh();
      }
    },
    [refresh, undoCore],
  );

  /** Edit a sale's numbers = undo it exactly, then re-run the sale core with
   * the corrected values against FRESH data. Carries the funded flag and
   * notes; never writes ledger rows (a funded sale's Deposit is the owner's
   * to reconcile if proceeds changed). */
  const editParkedSaleAmounts = useCallback(
    async (
      saleId: string,
      next: {
        shares: number;
        pricePerShare: number;
        date: string;
        fundedChallenge?: boolean;
        notes?: string | null;
      },
    ) => {
      const client = db();
      if (next.shares <= 0) throw new Error('Shares must be positive');
      if (next.pricePerShare <= 0) throw new Error('Price must be positive');
      const { data: saleRow, error: saleErr } = await client
        .from('parked_sales').select('*').eq('id', saleId).single();
      if (saleErr) throw saleErr;
      const old = mapParkedSale(saleRow);
      if (!old.consumed) throw new Error('This sale predates undo support — edit its numbers instead.');
      // Validate BEFORE the destructive undo — a rejected edit must leave the
      // sale record untouched. After restore, availability is the current
      // position's shares plus what this sale removed.
      const { data: prePosRow, error: prePosErr } = await client
        .from('parked_positions')
        .select('shares')
        .eq('ticker', old.ticker)
        .eq('account_id', old.accountId)
        .maybeSingle();
      if (prePosErr) throw prePosErr;
      const available = Number(prePosRow?.shares ?? 0) + old.shares;
      if (next.shares > available + 1e-9) {
        throw new Error(
          `Only ${Math.round(available * 1e8) / 1e8} shares would be available; cannot sell ${next.shares}.`,
        );
      }
      try {
        await undoCore(saleId);
        try {
          // By ticker+account, not the snapshot's position id — undo may have
          // retargeted a re-bought position.
          const { data: posRow, error: posErr } = await client
            .from('parked_positions')
            .select('*, account:accounts(name)')
            .eq('ticker', old.ticker)
            .eq('account_id', old.accountId)
            .single();
          if (posErr) throw posErr;
          const position = mapParked(posRow);
          if (next.shares > position.shares + 1e-9) {
            throw new Error(`Only ${position.shares} shares parked; cannot sell ${next.shares}`);
          }
          // All lots, not just the position's — snapshot stamps for carried
          // (cross-position) ROC rows need the wide lookup.
          const { data: allLotRows, error: lotsErr } = await fetchAll(
            () => client.from('parked_lots').select('*').order('id'),
          );
          if (lotsErr) throw lotsErr;
          const allLots = (allLotRows ?? []).map(mapParkedLot);
          const lots = allLots.filter((l) => l.parkedPositionId === position.id);
          let adjustments: ParkedLotAdjustment[] = [];
          if (lots.length > 0) {
            const { data: adjRows, error: adjErr } = await client
              .from('parked_lot_adjustments').select('*').in('share_lot_id', lots.map((l) => l.id));
            if (adjErr) throw adjErr;
            adjustments = (adjRows ?? []).map(mapParkedLotAdjustment);
          }
          // A fee-bearing sale stores proceeds below shares × price; carry
          // that implied fee through the re-apply or the edit would silently
          // regross the proceeds.
          const impliedFees = Math.max(
            0,
            roundCents(roundCents(old.shares * old.pricePerShare) - old.proceeds),
          );
          await trimCore({
            position,
            lots,
            adjustments,
            allLots,
            shares: next.shares,
            pricePerShare: next.pricePerShare,
            date: next.date,
            fundedChallenge: next.fundedChallenge ?? old.fundedChallenge,
            fees: impliedFees,
            notes: next.notes !== undefined ? next.notes : old.notes ?? null,
          });
        } catch (redoErr) {
          const msg = redoErr instanceof Error ? redoErr.message : String(redoErr);
          throw new Error(
            `The sale was undone but re-applying failed (${msg}). If a new sale row appeared, Undo it to converge; otherwise your shares are restored — record the sale again.`,
          );
        }
      } finally {
        await refresh();
      }
    },
    [refresh, undoCore, trimCore],
  );

  return { deleteParkedSale, updateParkedSale, recordTrim, undoParkedSale, editParkedSaleAmounts };
}
