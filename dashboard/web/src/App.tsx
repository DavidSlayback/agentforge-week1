import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import type { SessionDto } from '../../core/dto.ts';
import { isAllergyRow, isHeaderDto } from '../../core/guards.ts';
import { parsePatientUuid, type PatientUuid } from '../../core/ids.ts';
import { BASE, fetchSession, lookupByMrn, type Fetcher } from './api.ts';
import { AllergiesCard } from './cards/AllergiesCard.tsx';
import { PatientHeader } from './components/PatientHeader.tsx';
import { useCard } from './useCard.ts';

/** One view per URL (7.09): `/dashboard/` or `/dashboard/patients/:puuid`. */
export function routeFromPath(pathname: string): { readonly view: 'landing' } | { readonly view: 'patient'; readonly patientId: PatientUuid } | { readonly view: 'not-found' } {
  if (pathname === `${BASE}/` || pathname === BASE) return { view: 'landing' };
  const m = /^\/dashboard\/patients\/([^/]+)\/?$/.exec(pathname);
  const patientId = m ? parsePatientUuid(m[1]) : null;
  return patientId ? { view: 'patient', patientId } : { view: 'not-found' };
}

function SignInLink({ returnTo }: { readonly returnTo: string }) {
  return (
    <a className="button" href={`${BASE}/login?returnTo=${encodeURIComponent(returnTo)}`}>
      Sign in with OpenEMR
    </a>
  );
}

function SignOutForm() {
  return (
    <form method="post" action={`${BASE}/logout`} className="signout">
      <button type="submit">Sign out</button>
    </form>
  );
}

function PatientView({ fetcher, patientId }: { readonly fetcher: Fetcher; readonly patientId: PatientUuid }) {
  const header = useCard(fetcher, `${BASE}/bff/patients/${patientId}/header`, patientId, isHeaderDto);
  // Cards load in parallel with the header, each with its own state (7.08).
  const allergies = useCard(fetcher, `${BASE}/bff/patients/${patientId}/allergies`, patientId, isAllergyRow);
  return (
    <>
      <PatientHeader state={header} />
      <div className="cards">
        <AllergiesCard state={allergies} />
      </div>
      <p className="not-ported">Cards added in later slices: Medical Problems, Medications, Prescriptions, Care Team, Vitals.</p>
    </>
  );
}

function Landing({
  fetcher,
  session,
  navigate,
  signInFailed,
}: {
  readonly fetcher: Fetcher;
  readonly session: SessionDto;
  readonly navigate: (path: string) => void;
  readonly signInFailed: boolean;
}) {
  const [mrn, setMrn] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const onSubmit = useCallback(
    async (e: SyntheticEvent<HTMLFormElement>) => {
      e.preventDefault();
      setMessage(null);
      const result = await lookupByMrn(fetcher, mrn.trim());
      switch (result.kind) {
        case 'found':
          navigate(`${BASE}/patients/${result.patientId}`);
          return;
        case 'not-found':
          setMessage('No patient has that MRN.');
          return;
        case 'forbidden':
          setMessage('You are not authorized to search patients.');
          return;
        case 'reauth':
          setMessage('Your session has ended. Sign in again.');
          return;
        case 'error':
          setMessage(`Patient lookup failed. Reference ${result.correlationId} (${result.code}).`);
          return;
      }
    },
    [fetcher, mrn, navigate],
  );

  if (!session.authenticated) {
    return (
      <section aria-labelledby="signin-heading">
        <h2 id="signin-heading">Sign in</h2>
        {signInFailed ? (
          <p className="state state-error" role="alert">
            Sign-in failed, please retry.
          </p>
        ) : null}
        <SignInLink returnTo={`${BASE}/`} />
      </section>
    );
  }
  return (
    <section aria-labelledby="select-heading">
      <h2 id="select-heading">Open a patient</h2>
      <form className="mrn-form" onSubmit={(e) => void onSubmit(e)}>
        <label htmlFor="mrn">MRN</label>
        <input id="mrn" name="mrn" value={mrn} onChange={(e) => {
            setMrn(e.target.value);
          }} autoComplete="off" required maxLength={32} />
        <button type="submit">Open</button>
      </form>
      {message ? (
        <p className="state state-error" role="alert">
          {message}
        </p>
      ) : null}
      {session.demoPatients.length > 0 ? (
        <>
          <h3>Demo patients (configured)</h3>
          <ul>
            {session.demoPatients.map((p) => (
              <li key={p.patientId}>
                <a
                  href={`${BASE}/patients/${p.patientId}`}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(`${BASE}/patients/${p.patientId}`);
                  }}
                >
                  {p.label}
                </a>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

export function App({ fetcher }: { readonly fetcher: Fetcher }) {
  const [path, setPath] = useState(() => window.location.pathname);
  const [session, setSession] = useState<SessionDto | null>(null);

  useEffect(() => {
    const onPop = (): void => {
      setPath(window.location.pathname);
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
    };
  }, []);

  useEffect(() => {
    let live = true;
    void fetchSession(fetcher).then((s) => {
      if (live) setSession(s);
    });
    return () => {
      live = false;
    };
  }, [fetcher]);

  const navigate = useCallback((to: string) => {
    window.history.pushState(null, '', to);
    setPath(to);
  }, []);

  const route = routeFromPath(path);
  const signInFailed = new URLSearchParams(window.location.search).get('signin') === 'failed';

  return (
    <>
      <header className="topbar">
        <h1>
          <a
            href={`${BASE}/`}
            onClick={(e) => {
              e.preventDefault();
              navigate(`${BASE}/`);
            }}
          >
            Patient Dashboard
          </a>
        </h1>
        {session?.authenticated ? <SignOutForm /> : null}
      </header>
      <main>
        {session === null ? (
          <p className="state state-loading" role="status">
            Loading…
          </p>
        ) : route.view === 'landing' ? (
          <Landing fetcher={fetcher} session={session} navigate={navigate} signInFailed={signInFailed} />
        ) : route.view === 'not-found' ? (
          <p className="state state-error" role="alert">
            Page not found.
          </p>
        ) : session.authenticated ? (
          <PatientView fetcher={fetcher} patientId={route.patientId} />
        ) : (
          <section aria-labelledby="signin-heading">
            <h2 id="signin-heading">Sign in to view this patient</h2>
            <SignInLink returnTo={path} />
          </section>
        )}
      </main>
    </>
  );
}
