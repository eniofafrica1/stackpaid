-- STACKPAID ADDITIVE DATABASE MIGRATION
-- Review existing columns before running. This script does not drop existing tables.
-- Existing profiles must have: id, full_name, email, balance, is_activated, is_admin.
-- Existing tasks must have BIGINT id and: title, platform, reward, task_url, status.
-- Existing task_submissions must have: id, user_id, task_id BIGINT, proof, status.

alter table public.profiles
  add column if not exists balance numeric(12,2) not null default 0,
  add column if not exists is_activated boolean not null default false,
  add column if not exists is_admin boolean not null default false,
  add column if not exists full_name text,
  add column if not exists email text;

alter table public.tasks
  add column if not exists title text,
  add column if not exists platform text,
  add column if not exists description text,
  add column if not exists reward numeric(12,2) not null default 0,
  add column if not exists task_url text,
  add column if not exists status text not null default 'active',
  add column if not exists created_at timestamptz not null default now();

alter table public.task_submissions
  add column if not exists proof text,
  add column if not exists status text not null default 'pending',
  add column if not exists created_at timestamptz not null default now();

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  reference text not null unique,
  amount numeric(12,2) not null,
  status text not null default 'pending' check (status in ('pending','successful','failed')),
  created_at timestamptz not null default now()
);

create table if not exists public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  amount numeric(12,2) not null check (amount >= 5000),
  bank_name text not null,
  account_number text not null,
  account_name text not null,
  status text not null default 'pending' check (status in ('pending','paid','rejected')),
  payout_reference text,
  created_at timestamptz not null default now()
);

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  amount numeric(12,2) not null,
  transaction_type text not null check (transaction_type in ('credit','debit')),
  description text,
  reference text unique,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.tasks enable row level security;
alter table public.task_submissions enable row level security;
alter table public.payments enable row level security;
alter table public.withdrawals enable row level security;
alter table public.wallet_transactions enable row level security;

-- Drop/recreate only policies owned by this project, not tables.
drop policy if exists "StackPaid users read own profile" on public.profiles;
create policy "StackPaid users read own profile" on public.profiles
for select to authenticated using (auth.uid() = id);

drop policy if exists "StackPaid users read active tasks" on public.tasks;
create policy "StackPaid users read active tasks" on public.tasks
for select to authenticated using (status = 'active');

drop policy if exists "StackPaid users read own submissions" on public.task_submissions;
create policy "StackPaid users read own submissions" on public.task_submissions
for select to authenticated using (
  auth.uid() = user_id OR
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
);

drop policy if exists "StackPaid users insert own submissions" on public.task_submissions;
create policy "StackPaid users insert own submissions" on public.task_submissions
for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "StackPaid users read own payments" on public.payments;
create policy "StackPaid users read own payments" on public.payments
for select to authenticated using (auth.uid() = user_id);

drop policy if exists "StackPaid users read own withdrawals" on public.withdrawals;
create policy "StackPaid users read own withdrawals" on public.withdrawals
for select to authenticated using (
  auth.uid() = user_id OR
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
);

drop policy if exists "StackPaid users request own withdrawals" on public.withdrawals;
create policy "StackPaid users request own withdrawals" on public.withdrawals
for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "StackPaid users read own wallet transactions" on public.wallet_transactions;
create policy "StackPaid users read own wallet transactions" on public.wallet_transactions
for select to authenticated using (auth.uid() = user_id);

-- Atomic reward approval; prevents duplicate approval/credit.
create or replace function public.stackpaid_approve_submission(
  p_submission_id uuid, p_reward numeric
) returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.task_submissions%rowtype;
begin
  select * into s from public.task_submissions
  where id = p_submission_id and status = 'pending' for update;
  if not found then raise exception 'Submission is missing or already reviewed'; end if;
  update public.task_submissions set status = 'approved' where id = s.id;
  update public.profiles set balance = balance + p_reward where id = s.user_id;
  insert into public.wallet_transactions(user_id,amount,transaction_type,description,reference)
  values(s.user_id,p_reward,'credit','Approved task reward','task-'||s.id::text);
  return jsonb_build_object('approved',true);
end; $$;

-- Reserve withdrawal balance at request time, atomically.
create or replace function public.stackpaid_request_withdrawal(
  p_user_id uuid, p_amount numeric, p_bank_name text, p_account_number text, p_account_name text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := p_user_id; wid uuid;
begin
  if uid is null then raise exception 'Login required'; end if;
  if p_amount < 5000 then raise exception 'Minimum withdrawal is 5000'; end if;
  update public.profiles set balance = balance - p_amount
  where id = uid and is_activated = true and balance >= p_amount;
  if not found then raise exception 'Insufficient balance or account not activated'; end if;
  insert into public.withdrawals(user_id,amount,bank_name,account_number,account_name)
  values(uid,p_amount,p_bank_name,p_account_number,p_account_name) returning id into wid;
  insert into public.wallet_transactions(user_id,amount,transaction_type,description,reference)
  values(uid,p_amount,'debit','Withdrawal requested','withdrawal-'||wid::text);
  return jsonb_build_object('id',wid,'status','pending');
end; $$;

-- Only service role backend should call this function.
create or replace function public.stackpaid_review_withdrawal(
  p_withdrawal_id uuid, p_decision text, p_payout_reference text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare w public.withdrawals%rowtype;
begin
  select * into w from public.withdrawals where id=p_withdrawal_id and status='pending' for update;
  if not found then raise exception 'Withdrawal missing or already processed'; end if;
  if p_decision='paid' then
    update public.withdrawals set status='paid',payout_reference=p_payout_reference where id=w.id;
  elsif p_decision='rejected' then
    update public.withdrawals set status='rejected' where id=w.id;
    update public.profiles set balance=balance+w.amount where id=w.user_id;
    insert into public.wallet_transactions(user_id,amount,transaction_type,description,reference)
    values(w.user_id,w.amount,'credit','Rejected withdrawal returned','withdrawal-return-'||w.id::text);
  else raise exception 'Invalid decision'; end if;
  return jsonb_build_object('updated',true);
end; $$;

revoke all on function public.stackpaid_approve_submission(uuid,numeric) from public, anon, authenticated;
revoke all on function public.stackpaid_review_withdrawal(uuid,text,text) from public, anon, authenticated;
grant execute on function public.stackpaid_approve_submission(uuid,numeric) to service_role;
grant execute on function public.stackpaid_review_withdrawal(uuid,text,text) to service_role;
revoke all on function public.stackpaid_request_withdrawal(uuid,numeric,text,text,text) from public, anon, authenticated;
grant execute on function public.stackpaid_request_withdrawal(uuid,numeric,text,text,text) to service_role;

-- IMPORTANT: After migration, manually set your own profile is_admin=true
-- using the Supabase dashboard. Never allow public sign-up to set is_admin.
