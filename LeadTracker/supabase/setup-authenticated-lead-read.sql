grant select on public.leads to authenticated;

create policy "Authenticated users can read leads"
on public.leads
for select
to authenticated
using (true);
