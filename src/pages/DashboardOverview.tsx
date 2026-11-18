import { useMemo, useRef, useState } from 'react';
import { IconPlus, IconMapPin, IconCheck, IconClipboardList, IconUsers } from '@tabler/icons-react';
import type { DashboardData } from '@/hooks/useDashboardData';
import { useEntityCrud } from '@/components/EntityCrud';
import { flowActionFor, countOf, decided } from '@/config/plan';
import type { Terminvorschlaege } from '@/types/app';
import { extractRecordId } from '@/services/livingAppsService';
import { formatDateTime, lookupKey } from '@/lib/formatters';
import { submissionsOf, topOne } from '@/lib/journey';
import { gruss, useClock } from '@/lib/polish';
import { appLabel, tx } from '@/i18n';
import { Button } from '@/components/ui/button';
import { DashboardGrid } from '@/components/DashboardGrid';
import { StatStrip, StatStripItem } from '@/components/StatCard';
import { WorkList } from '@/components/WorkList';
import { HeroBanner } from '@/components/HeroBanner';
import { RecordDoorLink } from '@/components/widgets/RecordDoorLink';

type Filter = 'all' | 'offen' | 'geschlossen' | 'leer';

interface DateStat { termin: Terminvorschlaege; yes: number; maybe: number }

export default function DashboardOverview({ data }: { data: DashboardData }) {
  const { umfragen, terminvorschlaege, antworten, terminvorschlaegeMap } = data;
  const clock = useClock();
  const [filter, setFilter] = useState<Filter>('all');
  const statsRef = useRef(new Map<string, { top: Terminvorschlaege | null; open: boolean }>());

  // ONE write path to close a poll: the flow that owns it (powers card, aside list, overlay footer)
  const closeAction = (pollId: string) => {
    const s = statsRef.current.get(pollId);
    if (!s || !s.open || !s.top) return undefined;
    const go = flowActionFor('umfragen', 'finaler_termin', pollId, s.top.record_id);
    return go ? { label: tx('Termin festlegen'), onClick: go } : undefined;
  };

  const crud = useEntityCrud(data, {
    footer: (top) => {
      if (top.type !== 'umfragen') return undefined;
      const a = closeAction(top.record.record_id);
      return a ? { label: tx('Top-Termin festlegen & schließen'), onClick: a.onClick } : undefined;
    },
  });
  const enrichedUmfragen = crud.enriched.umfragen;

  const polls = useMemo(() => {
    return enrichedUmfragen.map(u => {
      const id = u.record_id;
      const dates: DateStat[] = terminvorschlaege
        .filter(t => extractRecordId(t.fields.umfrage) === id)
        .sort((a, b) => (a.fields.beginn ?? '').localeCompare(b.fields.beginn ?? ''))
        .map(t => {
          const mine = antworten.filter(a => extractRecordId(a.fields.terminvorschlag) === t.record_id);
          return {
            termin: t,
            yes: mine.filter(a => lookupKey(a.fields.antwort) === 'ja').length,
            maybe: mine.filter(a => lookupKey(a.fields.antwort) === 'vielleicht').length,
          };
        });
      const ans = antworten.filter(a => extractRecordId(a.fields.umfrage) === id);
      const subs = submissionsOf(ans, { names: ['vorname', 'nachname'] });
      const best = topOne(dates, [d => d.yes, d => d.maybe], d => d.termin.fields.beginn);
      const open = lookupKey(u.fields.status) !== 'geschlossen';
      const hasVotes = best ? best.yes + best.maybe > 0 : false;
      const top = hasVotes && best ? best.termin : null;
      statsRef.current.set(id, { top, open });
      const finalDone = decided('umfragen', 'finaler_termin', u.fields);
      const finalId = finalDone ? extractRecordId(u.fields.finaler_termin) : null;
      return { u, id, dates, subs, best: hasVotes ? best : null, open, top, finalId };
    }).sort((a, b) => Number(b.open) - Number(a.open) || (b.u.createdat ?? '').localeCompare(a.u.createdat ?? ''));
  }, [enrichedUmfragen, terminvorschlaege, antworten]);

  const openPolls = polls.filter(p => p.open);
  const closedPolls = polls.filter(p => !p.open);
  const emptyPolls = openPolls.filter(p => p.subs.length === 0);
  const shown = polls.filter(p =>
    filter === 'all' ? true
      : filter === 'offen' ? p.open
        : filter === 'geschlossen' ? !p.open
          : p.open && p.subs.length === 0);
  const toggle = (f: Filter) => setFilter(cur => (cur === f ? 'all' : f));

  const latest = useMemo(() => polls
    .flatMap(p => p.subs.map(s => ({ p, s })))
    .sort((a, b) => String(b.s.createdAt ?? '').localeCompare(String(a.s.createdAt ?? ''))),
  [polls]);

  const readyToClose = openPolls.filter(p => p.top);

  let context: string;
  if (polls.length === 0) context = tx('Lege deine erste Umfrage an und teile den Link.');
  else if (readyToClose.length > 0) {
    const first = readyToClose[0];
    context = tx`„${first.u.fields.titel ?? ''}“ hat schon ${countOf('antworten', first.subs.length, appLabel('antworten'))} — du kannst den Termin festlegen.`;
  } else if (openPolls.length > 0) {
    const first = openPolls[0];
    context = tx`„${first.u.fields.titel ?? ''}“ wartet noch auf die ersten Antworten.`;
  } else {
    const first = closedPolls[0];
    context = tx`Alle Umfragen sind abgeschlossen, zuletzt „${first.u.fields.titel ?? ''}“.`;
  }

  const finalLabel = (id: string | null) => id ? formatDateTime(terminvorschlaegeMap.get(id)?.fields.beginn) : '';

  const hero = polls.length === 0 ? (
    <HeroBanner
      icon={<IconClipboardList size={18} />}
      action={{ label: tx('Erste Umfrage anlegen'), onClick: () => crud.umfragen.openCreate({ status: 'offen' }) }}
    >
      {tx('Noch keine Umfrage — lege Titel und Ort fest, trage Terminvorschläge ein und teile den Link.')}
    </HeroBanner>
  ) : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{gruss(clock)}</h1>
          <p className="text-sm text-muted-foreground">{context}</p>
        </div>
        {crud.umfragen.canWrite && (
          <Button onClick={() => crud.umfragen.openCreate({ status: 'offen' })} className="w-full sm:w-auto">
            <IconPlus size={16} className="shrink-0" />
            {tx('Neue Umfrage')}
          </Button>
        )}
      </div>

      <DashboardGrid
        variant="split"
        hero={hero}
        kpis={polls.length > 0 ? (
          <StatStrip>
            <StatStripItem
              title={tx('Offen')} value={openPolls.length}
              tone={openPolls.length > 0 ? 'primary' : 'default'}
              onClick={() => toggle('offen')} active={filter === 'offen'}
            />
            <StatStripItem
              title={tx('Ohne Antworten')} value={emptyPolls.length}
              tone={emptyPolls.length > 0 ? 'warning' : 'default'}
              onClick={() => toggle('leer')} active={filter === 'leer'}
            />
            <StatStripItem
              title={tx('Geschlossen')} value={closedPolls.length}
              onClick={() => toggle('geschlossen')} active={filter === 'geschlossen'}
            />
          </StatStrip>
        ) : undefined}
        aside={polls.length > 0 ? (
          <WorkList
            title={tx('Neueste Antworten')}
            max={6}
            items={latest.map(({ p, s }) => {
              const act = closeAction(p.id);
              return {
                id: `${p.id}|${s.key}`,
                title: s.name || tx('Ohne Namen'),
                secondLine: (
                  <>
                    <span className="text-muted-foreground">{p.u.fields.titel}</span>
                    <span className="text-muted-foreground"> · {formatDateTime(s.createdAt ?? undefined)}</span>
                  </>
                ),
                action: act,
              };
            })}
            onItemClick={(id: string) => {
              const poll = polls.find(p => p.id === id.split('|')[0]);
              if (poll) crud.umfragen.openDetail(poll.u);
            }}
            empty={{
              text: openPolls.length > 0
                ? tx`Noch keine Antworten — teile den Link von „${openPolls[0].u.fields.titel ?? ''}“.`
                : tx('Noch keine Antworten.'),
            }}
          />
        ) : undefined}
        primary={
          <div className="space-y-3">
            {shown.length === 0 && polls.length > 0 && (
              <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">{tx('Keine Umfrage in dieser Ansicht.')}</p>
            )}
            {shown.map(p => {
              const act = closeAction(p.id);
              const isFinal = (id: string) => p.finalId === id;
              return (
                <div key={p.id} className="overflow-hidden rounded-xl border bg-card">
                  <button
                    type="button"
                    onClick={() => crud.umfragen.openDetail(p.u)}
                    className="flex w-full min-w-0 items-start justify-between gap-3 p-4 text-left hover:bg-muted/40"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{p.u.fields.titel}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {p.u.fields.ort && (
                          <span className="inline-flex min-w-0 items-center gap-1">
                            <IconMapPin size={14} className="shrink-0" />
                            <span className="truncate">{p.u.fields.ort}</span>
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1">
                          <IconUsers size={14} className="shrink-0" />
                          {countOf('antworten', p.subs.length, appLabel('antworten'))}
                        </span>
                      </div>
                    </div>
                    <span className={`shrink-0 text-xs font-medium ${p.open ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                      {p.open ? tx('Offen') : tx('Geschlossen')}
                    </span>
                  </button>

                  {p.finalId && (
                    <div className="flex items-center gap-2 border-t bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">
                      <IconCheck size={16} className="shrink-0" />
                      <span className="min-w-0 truncate">{tx`Final: ${finalLabel(p.finalId)}`}</span>
                    </div>
                  )}

                  {p.dates.length > 0 && (
                    <ul className="divide-y border-t text-sm">
                      {p.dates.slice(0, 5).map(d => {
                        const best = p.best?.termin.record_id === d.termin.record_id;
                        return (
                          <li
                            key={d.termin.record_id}
                            className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 ${best || isFinal(d.termin.record_id) ? 'bg-emerald-50' : ''}`}
                          >
                            <span className="min-w-0 truncate">{formatDateTime(d.termin.fields.beginn)}</span>
                            <span className="flex shrink-0 items-center gap-3 text-xs">
                              <span className={best ? 'font-semibold text-emerald-700' : 'text-muted-foreground'}>{tx`${d.yes} Ja`}</span>
                              <span className="text-muted-foreground">{tx`${d.maybe} Vielleicht`}</span>
                            </span>
                          </li>
                        );
                      })}
                      {p.dates.length > 5 && (
                        <li className="px-4 py-2 text-xs text-muted-foreground">{tx`+${p.dates.length - 5} weitere Termine`}</li>
                      )}
                    </ul>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t p-3">
                    <RecordDoorLink page="termin-abstimmen" recordId={p.id} />
                    {act && (
                      <Button size="sm" onClick={act.onClick} className="w-full sm:w-auto">
                        {act.label}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        }
      />
      {crud.surfaces}
    </div>
  );
}
