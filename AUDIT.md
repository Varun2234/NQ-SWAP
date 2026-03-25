# Audit Report: NQ-Swap Backend Engineer Submission

## Candidate
Varun

## Assignment Reviewed
**Backend Engineer (The Indexer & Data Architect)**

Build a resilient DEX indexer that:
1. Streams blocks from an Ethereum node.
2. Parses transactions and logs.
3. Detects whale swaps above $100k that are sandwiched by MEV bots.
4. Stores raw and decoded data in PostgreSQL using daily partitioning.
5. Exposes `GET /whales?date=YYYY-MM-DD`.
6. Fails over to a backup RPC node without losing the block being processed.
7. Includes `docker-compose.yml` and `THOUGHTS.md` covering re-org handling.

---

## Final Verdict

**Overall score: 44/100**

**Recommendation: Fail**

This submission shows a good project skeleton and some correct architectural instincts, but it does not fully satisfy the core technical requirements of the assignment. The largest gaps are:

- no transaction log ingestion,
- no real swap decoding,
- heuristic rather than reliable sandwich detection,
- estimated rather than actual MEV profit calculation,
- database schema not wired into docker-compose,
- no concrete chain re-org correction strategy.

---

## Category Scores

### 1. Ingestion — 10/20

#### What was implemented
- Node.js service using `ethers`, `express`, and `pg`.
- Polls latest block number.
- Fetches blocks and transaction details.
- Processes transactions in a loop.

#### Credit earned
- Basic JSON-RPC ingestion is present.
- The system does continuously process blocks.

#### Problems
- The assignment required parsing **transactions and logs**.
- The implementation fetches blocks and transactions only.
- There is no receipt fetching, no log ingestion, and no event decoding.

#### Scoring note
Good skeleton, but missing a major part of the ingestion requirement.

---

### 2. Filtering Logic / Sandwich Detection — 9/30

#### What was implemented
- Checks the previous and next transactions around a candidate transaction.
- Considers a transaction a whale trade if it goes to a known DEX router and has high ETH value.
- Treats a transaction as sandwiched if the previous and next transactions come from the same address.

#### Credit earned
- The candidate recognized that adjacent transactions matter.
- The candidate attempted to identify front-run and back-run structure.

#### Problems
- This is not real swap detection.
- It does not decode calldata or logs.
- It misses ERC-20 swaps where `tx.value` is zero.
- It does not confirm the surrounding transactions are swaps in the same pool/path.
- It does not verify token movement or price impact.
- It can generate false positives very easily.

#### Profit calculation issue
- MEV profit is estimated using a fixed 0.5% slippage assumption minus gas cost.
- This is not a real profit calculation from on-chain state changes.

#### Scoring note
Some conceptual effort is visible, but this is far below what the assignment asked for.

---

### 3. Storage / PostgreSQL / Partitioning — 8/20

#### What was implemented
- SQL schema file includes:
  - `blocks`
  - `transactions`
  - `whale_transactions`
- `transactions` is partitioned by timestamp.
- A helper function exists to create a daily partition.

#### Credit earned
- The candidate understood the need for partitioning.
- Block and transaction persistence logic exists.

#### Problems
- The Docker Compose setup does **not** mount `init.sql` into the Postgres initialization directory.
- That means the provided stack does not automatically create the schema.
- The code stores only partial raw data.
- The schema has `decoded_data`, but the code never fills it.
- `gas_used` is also not populated.
- The transaction insert uses `ON CONFLICT DO NOTHING`, but the table has no unique constraint on `tx_hash`, so retries can create duplicate transaction rows.

#### Scoring note
The candidate designed a partitioned schema, but the actual delivered system is incomplete and unsafe in retry scenarios.

---

### 4. API — 8/10

#### What was implemented
- `GET /whales?date=YYYY-MM-DD`
- Returns whale transaction rows ordered by profit.
- Includes count and transaction list.

#### Credit earned
- This requirement is mostly satisfied.

#### Problems
- Date validation is minimal.
- It depends on the detector and storage logic being correct, which they are not.

#### Scoring note
API layer is one of the stronger parts of the submission.

---

### 5. Resilience / RPC Failover — 6/10

#### What was implemented
- Primary and backup RPC URLs are supported.
- On RPC error, the code rotates to the next provider.
- Block number only increments after the block processing step completes.

#### Credit earned
- There is a clear attempt to avoid skipping blocks during RPC failure.

#### Problems
- Failed transaction fetches inside a block are logged and skipped, not retried as part of the block unit.
- That means sandwich analysis can run on an incomplete transaction list.
- If the transaction list is incomplete, the “immediately before and after” logic becomes unreliable.
- There is no persistent checkpoint/state table.
- The confirmation count is hardcoded to 12 in processing logic instead of consistently using config.

#### Scoring note
Some resilience exists, but it is not strong enough for the assignment as written.

---

### 6. THOUGHTS.md / Re-org Strategy — 3/10

#### What was expected
The assignment explicitly required a strategy for handling chain re-organizations, including how invalidated blocks would be corrected.

#### What was submitted
- The document mentions confirmations.
- It mentions that re-org handling could be added later.
- It lists rollback logic as future work.

#### Problems
- There is no actual implemented or documented re-org correction strategy.
- The write-up does not explain:
  - parent hash validation,
  - identifying divergence,
  - invalidating orphaned blocks,
  - deleting/recomputing derived records,
  - replaying from the fork point.

#### Scoring note
This deliverable is substantially incomplete.

---

## Strengths

- Clean modular file structure.
- Sensible separation between RPC manager, block processor, detector, DB layer, and API.
- Good choice of common tooling for a quick prototype.
- Reasonable first-pass understanding of failover and confirmation depth.

---

## Critical Gaps

1. No log ingestion or receipt parsing.
2. No real swap decoding.
3. Sandwich detection is heuristic and unreliable.
4. Profit is not actually derived from on-chain outcomes.
5. Schema initialization is not wired into Docker Compose.
6. Retry behavior can create duplicate transaction rows.
7. No durable indexing checkpoint.
8. No real re-org correction strategy in `THOUGHTS.md`.

---

## Would I Pass This Submission?

**No.**

I would describe this as a promising prototype or scaffold, but not a completed solution to the test. It demonstrates some backend engineering ability, but it does not meet the accuracy and resilience bar required by the assignment.

---

## What Would Be Needed to Pass

At minimum, I would expect:

- fetch transaction receipts and logs,
- decode swap events and calldata,
- validate that front-run and back-run are real surrounding swaps tied to the same opportunity,
- compute MEV profit from actual token deltas,
- properly initialize the Postgres schema from `docker-compose.yml`,
- enforce unique transaction identifiers to prevent duplicates,
- persist indexing progress,
- provide a documented and implementable re-org rollback/replay strategy.

---

## Suggested Interview Outcome

**Result:** Do not pass the test as submitted.

**Alternative framing:** Worth interviewing only if the role is junior-to-mid and the company is comfortable treating this as an incomplete prototype rather than a completed backend indexing exercise.
