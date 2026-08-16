-- Kudina — lender/cooperative verification layer
-- Run this once in the Supabase SQL editor (or via `supabase db push`).
--
-- Design: the browser never talks to Supabase directly. Every read/write
-- goes through a Vercel serverless function using the service-role key.
-- So RLS is enabled with NO policies — that locks every table to
-- service-role access only, which is exactly what we want.

create extension if not exists pgcrypto;

-- One row per trader. The full app state (ledger, susu, network, profile)
-- lives in state_json, mirroring exactly what the trader app already keeps
-- in window.storage / localStorage. Score is computed on read, never stored,
-- so it's always derived fresh from real activity.
create table if not exists traders (
  id uuid primary key,
  secret_hash text not null,
  business_name text,
  phone text,
  business_type text,
  location text,
  registered boolean,
  state_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Short codes a trader hands to a lender/cooperative. Revocable at any time,
-- optionally expiring, scoped to a single trader.
create table if not exists share_codes (
  id uuid primary key default gen_random_uuid(),
  trader_id uuid not null references traders(id) on delete cascade,
  code text not null unique,
  label text,
  revoked boolean not null default false,
  expires_at timestamptz,
  access_count integer not null default 0,
  last_accessed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists share_codes_trader_id_idx on share_codes(trader_id);
create index if not exists share_codes_code_idx on share_codes(code) where revoked = false;

-- Lightweight audit trail — every time a lender pulls up a score, log it.
-- Lets a trader see who's checked their score, from their own Profile tab.
create table if not exists share_code_views (
  id bigint generated always as identity primary key,
  code text not null,
  trader_id uuid not null references traders(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  viewer_note text
);

create index if not exists share_code_views_trader_id_idx on share_code_views(trader_id);

-- Throttles the public, unauthenticated /api/lender/verify endpoint by IP,
-- so it can't be scripted into a code-guessing brute force. Codes are drawn
-- from a large alphabet (32^8 combinations) so brute force is already
-- impractical, but this closes the door on casual abuse/scraping too.
create table if not exists rate_limit_hits (
  id bigint generated always as identity primary key,
  bucket_key text not null,
  created_at timestamptz not null default now()
);

create index if not exists rate_limit_hits_bucket_idx on rate_limit_hits(bucket_key, created_at);

-- Housekeeping: nothing calls this automatically — run it occasionally
-- (e.g. a Supabase cron / pg_cron job) or just let old rows accumulate,
-- they're tiny. Safe to run any time.
-- delete from rate_limit_hits where created_at < now() - interval '1 day';

-- ============================================================
-- WALLET — Monnify-backed merchant wallet
-- ============================================================
-- Kudina never custodies funds itself (that requires a CBN Mobile Money
-- Operator or Payment Service Bank license). Instead, every trader gets a
-- Monnify Reserved Account — a real bank account under Moniepoint
-- Microfinance Bank, which the merchant funds by transferring into it
-- exactly like any other bank transfer. `wallets.balance` is Kudina's own
-- ledger of that account's activity, kept in sync via Monnify's webhook.

create table if not exists wallets (
  id uuid primary key default gen_random_uuid(),
  trader_id uuid not null unique references traders(id) on delete cascade,
  monnify_account_reference text not null unique,
  monnify_reservation_reference text,
  account_number text,
  account_name text,
  bank_name text,
  bank_code text,
  bvn_linked boolean not null default false,
  balance numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists wallet_transactions (
  id bigint generated always as identity primary key,
  trader_id uuid not null references traders(id) on delete cascade,
  wallet_id uuid not null references wallets(id) on delete cascade,
  type text not null check (type in ('credit','debit')),
  source text not null, -- 'monnify_reserved_account' | 'payout' | 'vend_purchase' | 'manual_adjustment'
  amount numeric(14,2) not null check (amount > 0),
  balance_after numeric(14,2),
  provider_reference text, -- Monnify transactionReference / disbursement reference
  client_reference text, -- client-generated key so a resubmitted/retried withdraw request can't double-spend
  narration text,
  raw_payload jsonb,
  status text not null default 'completed', -- 'pending' | 'completed' | 'failed'
  created_at timestamptz not null default now()
);

-- Enforces exactly-once processing per Monnify transaction — the single
-- most important line in this whole module. Without it, a webhook retry
-- (which Monnify does on purpose if your endpoint is slow) double-credits
-- the wallet.
create unique index if not exists wallet_transactions_provider_ref_idx
  on wallet_transactions(provider_reference) where provider_reference is not null;

create unique index if not exists wallet_transactions_client_ref_idx
  on wallet_transactions(trader_id, client_reference) where client_reference is not null;

create index if not exists wallet_transactions_trader_id_idx on wallet_transactions(trader_id, created_at desc);
create index if not exists wallet_transactions_pending_payout_idx
  on wallet_transactions(created_at) where status = 'pending' and type = 'debit' and source = 'payout';

-- Atomically credits a wallet AND records the transaction in one DB
-- round-trip, so a webhook retry can never double-credit: the unique index
-- above makes the insert a no-op on repeat, and we simply report back
-- "already processed" instead of crediting twice.
create or replace function credit_wallet_idempotent(
  p_wallet_id uuid,
  p_trader_id uuid,
  p_amount numeric,
  p_provider_reference text,
  p_narration text,
  p_raw_payload jsonb
) returns table(new_balance numeric, was_duplicate boolean)
language plpgsql
as $$
declare
  v_new_balance numeric;
  v_inserted_id bigint;
begin
  insert into wallet_transactions (trader_id, wallet_id, type, source, amount, provider_reference, narration, raw_payload, status)
  values (p_trader_id, p_wallet_id, 'credit', 'monnify_reserved_account', p_amount, p_provider_reference, p_narration, p_raw_payload, 'completed')
  on conflict (provider_reference) do nothing
  returning id into v_inserted_id;

  if v_inserted_id is null then
    select balance into v_new_balance from wallets where id = p_wallet_id;
    return query select v_new_balance, true;
    return;
  end if;

  update wallets set balance = balance + p_amount, updated_at = now()
  where id = p_wallet_id
  returning balance into v_new_balance;

  update wallet_transactions set balance_after = v_new_balance where id = v_inserted_id;

  return query select v_new_balance, false;
end;
$$;

-- Atomically checks-and-debits (the `where balance >= p_amount` guard stops
-- two concurrent withdrawals from both succeeding against the same
-- balance), AND is idempotent on p_client_reference — a retried/resubmitted
-- request with the same key returns the original result instead of
-- debiting twice. The unique index above is the actual backstop for the
-- narrow race between the existence check and the insert; a conflict there
-- surfaces as a normal Postgres error the caller can catch and recover from.
create or replace function debit_wallet_for_payout(
  p_wallet_id uuid,
  p_trader_id uuid,
  p_amount numeric,
  p_client_reference text,
  p_narration text
) returns table(new_balance numeric, transaction_id bigint, was_duplicate boolean)
language plpgsql
as $$
declare
  v_new_balance numeric;
  v_txn_id bigint;
  v_existing record;
begin
  if p_client_reference is not null then
    select id, balance_after into v_existing
    from wallet_transactions
    where trader_id = p_trader_id and client_reference = p_client_reference;

    if found then
      return query select v_existing.balance_after, v_existing.id, true;
      return;
    end if;
  end if;

  update wallets set balance = balance - p_amount, updated_at = now()
  where id = p_wallet_id and balance >= p_amount
  returning balance into v_new_balance;

  if v_new_balance is null then
    raise exception 'insufficient_funds';
  end if;

  insert into wallet_transactions (trader_id, wallet_id, type, source, amount, balance_after, client_reference, narration, status)
  values (p_trader_id, p_wallet_id, 'debit', 'payout', p_amount, v_new_balance, p_client_reference, p_narration, 'pending')
  returning id into v_txn_id;

  return query select v_new_balance, v_txn_id, false;
end;
$$;

-- Used to reverse a debit if Monnify reports the payout failed after we'd
-- already deducted it (e.g. destination account rejected the transfer).
create or replace function refund_failed_payout(
  p_transaction_id bigint
) returns numeric
language plpgsql
as $$
declare
  v_wallet_id uuid;
  v_amount numeric;
  v_status text;
  v_new_balance numeric;
begin
  select wallet_id, amount, status into v_wallet_id, v_amount, v_status
  from wallet_transactions where id = p_transaction_id for update;

  if v_status is null then
    raise exception 'transaction_not_found';
  end if;
  if v_status = 'failed' then
    select balance into v_new_balance from wallets where id = v_wallet_id;
    return v_new_balance; -- already refunded, don't double-refund
  end if;

  update wallets set balance = balance + v_amount, updated_at = now()
  where id = v_wallet_id
  returning balance into v_new_balance;

  update wallet_transactions set status = 'failed', balance_after = v_new_balance
  where id = p_transaction_id;

  return v_new_balance;
end;
$$;

-- ============================================================
-- VEND — data/airtime resale (VTU) via VTpass
-- ============================================================
-- Debits go through the same wallet_transactions ledger as everything
-- else (source = 'vend_purchase'), so wallet balance stays a single source
-- of truth. vend_orders holds the VTU-specific detail (network, phone,
-- product, cost vs sell price) that doesn't belong on a generic ledger row.

create table if not exists vend_orders (
  id bigint generated always as identity primary key,
  trader_id uuid not null references traders(id) on delete cascade,
  wallet_transaction_id bigint references wallet_transactions(id),
  kind text not null check (kind in ('data','airtime','electricity','cable','exam')),
  network text, -- mtn/airtel/glo/9mobile (data & airtime) or a DISCO/cable/exam serviceID otherwise
  phone text not null,
  biller_code text, -- meter number (electricity), smartcard number (cable), or JAMB Profile ID — null for data/airtime/WAEC
  customer_name text, -- resolved via merchant-verify before purchase, for electricity/cable/JAMB
  variation_code text,
  product_name text,
  cost_price numeric(14,2), -- what we actually paid the provider (known for sure only once delivered)
  sell_price numeric(14,2) not null, -- what was debited from the trader's wallet
  provider text not null default 'vtpass',
  provider_request_id text not null,
  provider_transaction_id text,
  client_reference text,
  status text not null default 'pending', -- 'pending' | 'delivered' | 'failed' | 'refunded'
  raw_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists vend_orders_provider_request_idx on vend_orders(provider_request_id);
create unique index if not exists vend_orders_client_ref_idx
  on vend_orders(trader_id, client_reference) where client_reference is not null;
create index if not exists vend_orders_trader_id_idx on vend_orders(trader_id, created_at desc);
create index if not exists vend_orders_pending_idx on vend_orders(created_at) where status = 'pending';

-- Same shape as debit_wallet_for_payout (atomic check-and-debit, idempotent
-- on client_reference) but a separate function rather than a generalized
-- one — these move real money and duplicating a few lines is a smaller
-- risk than reworking the payout path that's already been tested.
create or replace function debit_wallet_for_vend(
  p_wallet_id uuid,
  p_trader_id uuid,
  p_amount numeric,
  p_client_reference text,
  p_narration text
) returns table(new_balance numeric, transaction_id bigint, was_duplicate boolean)
language plpgsql
as $$
declare
  v_new_balance numeric;
  v_txn_id bigint;
  v_existing record;
begin
  if p_client_reference is not null then
    select id, balance_after into v_existing
    from wallet_transactions
    where trader_id = p_trader_id and client_reference = p_client_reference;

    if found then
      return query select v_existing.balance_after, v_existing.id, true;
      return;
    end if;
  end if;

  update wallets set balance = balance - p_amount, updated_at = now()
  where id = p_wallet_id and balance >= p_amount
  returning balance into v_new_balance;

  if v_new_balance is null then
    raise exception 'insufficient_funds';
  end if;

  insert into wallet_transactions (trader_id, wallet_id, type, source, amount, balance_after, client_reference, narration, status)
  values (p_trader_id, p_wallet_id, 'debit', 'vend_purchase', p_amount, v_new_balance, p_client_reference, p_narration, 'pending')
  returning id into v_txn_id;

  return query select v_new_balance, v_txn_id, false;
end;
$$;

alter table vend_orders enable row level security;
alter table wallets enable row level security;
alter table wallet_transactions enable row level security;
alter table traders enable row level security;
alter table share_codes enable row level security;
alter table share_code_views enable row level security;
alter table rate_limit_hits enable row level security;
-- No policies defined on purpose: anon/authenticated roles get zero access.
-- Only the service_role key (used exclusively by /api/* functions) can
-- read or write these tables.
