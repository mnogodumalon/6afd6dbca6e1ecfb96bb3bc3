import { useEffect, useMemo, useState } from 'react';
import { PublicShell } from '@/components/PublicShell';
import { OptionVote } from '@/components/blocks/OptionVote';
import { LoadProblem } from '@/components/blocks/LoadProblem';
import {
  loadPublicPagesConfig, PageUnavailableError,
  type PublicPagesConfig, type PublicPageConfig,
} from '@/lib/publicClient';
import { createPublicPort } from '@/lib/journey/publicPort';
import { VOTES, fieldText, type JourneyRecord } from '@/lib/journey';
import { tx } from '@/i18n';

const SLUG = 'termin-abstimmen';

export default function TerminAbstimmen() {
  const [cfg, setCfg] = useState<PublicPagesConfig | null>(null);
  const [page, setPage] = useState<PublicPageConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [dead, setDead] = useState(false);
  const [problem, setProblem] = useState(false);
  const [umfrage, setUmfrage] = useState<JourneyRecord | null>(null);
  const [attempt, setAttempt] = useState(0);

  const linkedId = useMemo(() => {
    const h = typeof window !== 'undefined' ? window.location.hash : '';
    return new URLSearchParams(h.split('?')[1] ?? '').get('umfrage');
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setProblem(false);
    loadPublicPagesConfig(SLUG)
      .then(async c => {
        if (!alive) return;
        const p = c?.pages[SLUG] ?? null;
        setCfg(c);
        setPage(p);
        if (c && p && linkedId) {
          try {
            const rec = await createPublicPort(c, p).get('umfragen', linkedId);
            if (!alive) return;
            if (rec) setUmfrage(rec);
            else setDead(true);
          } catch (e) {
            if (!alive) return;
            if (e instanceof PageUnavailableError) setDead(true);
            else setProblem(true);
          }
        }
        if (alive) setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setProblem(true);
        setLoading(false);
      });
    return () => { alive = false; };
  }, [linkedId, attempt]);

  const port = useMemo(() => (cfg && page ? createPublicPort(cfg, page) : null), [cfg, page]);

  if (loading) return <PublicShell loading />;
  if (problem) {
    return (
      <PublicShell title={tx('Termin abstimmen')}>
        <LoadProblem onRetry={() => setAttempt(a => a + 1)} />
      </PublicShell>
    );
  }
  if (!cfg || !page) return <PublicShell unavailable />;
  if (!linkedId) {
    return (
      <PublicShell title={tx('Termin abstimmen')}>
        <p className="text-sm text-muted-foreground">
          {tx('Bitte öffne den Link oder QR-Code deiner Umfrage, um abzustimmen.')}
        </p>
      </PublicShell>
    );
  }
  if (dead || !umfrage) {
    return (
      <PublicShell title={tx('Termin abstimmen')}>
        <p className="text-sm text-muted-foreground" data-public-unavailable="">
          {tx('Dieser Link ist nicht mehr gültig. Bitte den aktuellen Link oder QR-Code verwenden.')}
        </p>
      </PublicShell>
    );
  }

  const titel = fieldText(umfrage, 'titel');
  const beschreibung = fieldText(umfrage, 'beschreibung');
  const ort = fieldText(umfrage, 'ort');

  return (
    <PublicShell title={titel || tx('Termin abstimmen')} description={beschreibung || undefined} wide>
      <div className="space-y-4">
        {ort && <p className="text-sm text-muted-foreground">{tx('Ort')}: {ort}</p>}
        <OptionVote port={port} vote={VOTES[SLUG]} parentId={linkedId} draftKey={SLUG} />
      </div>
    </PublicShell>
  );
}
