import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import type { Settings } from '@chess-llama/contracts';

import {
  gatewayKeys,
  useGateway,
  useHealth,
  useSettings,
} from '../api/queries.js';
import { ProblemBanner } from '../components/problem-banner.js';
import { useAbortScope } from './abort-scope.js';

export function SettingsRoute() {
  const query = useSettings();
  const health = useHealth();
  if (query.isPending)
    return (
      <p className="route-loading" role="status">
        Loading settings…
      </p>
    );
  if (query.isError) {
    return (
      <ProblemBanner
        error={query.error}
        onReconnect={() => {
          void query.refetch();
        }}
      />
    );
  }
  return (
    <SettingsForm
      initial={query.data}
      loadedProfileId={health.data?.components.model.profileId}
    />
  );
}

function SettingsForm({
  initial,
  loadedProfileId,
}: {
  initial: Settings;
  loadedProfileId: string | null | undefined;
}) {
  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(false);
  const initialProfileId = useRef(initial.modelProfileId);
  const gateway = useGateway();
  const queryClient = useQueryClient();
  const abortable = useAbortScope();
  const update = useMutation({
    mutationFn: (value: Settings) =>
      abortable((signal) => gateway.updateSettings(value, signal)),
    onSuccess: (value) => {
      queryClient.setQueryData(gatewayKeys.settings(), value);
      void queryClient.invalidateQueries({
        queryKey: gatewayKeys.settings(),
        exact: true,
      });
      setForm(value);
      setSaved(true);
    },
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaved(false);
    update.mutate(form);
  };
  const profileChanged =
    form.modelProfileId !== (loadedProfileId ?? initialProfileId.current);

  return (
    <section className="settings-page" aria-labelledby="settings-title">
      <p className="eyebrow">Local preferences</p>
      <h1 id="settings-title">Settings</h1>
      <form className="settings-form" onSubmit={submit}>
        <fieldset>
          <legend>Board</legend>
          <label>
            Preferred side
            <select
              value={form.preferredHumanColor}
              onChange={(event) =>
                setForm({
                  ...form,
                  preferredHumanColor: event.target.value as 'white' | 'black',
                })
              }
            >
              <option value="white">White</option>
              <option value="black">Black</option>
            </select>
          </label>
          <label>
            Board orientation
            <select
              value={form.boardOrientation}
              onChange={(event) =>
                setForm({
                  ...form,
                  boardOrientation: event.target.value as 'white' | 'black',
                })
              }
            >
              <option value="white">White</option>
              <option value="black">Black</option>
            </select>
          </label>
          <label>
            Theme
            <select
              value={form.theme}
              onChange={(event) =>
                setForm({
                  ...form,
                  theme: event.target.value as Settings['theme'],
                })
              }
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </fieldset>

        <fieldset>
          <legend>Opponent</legend>
          <label>
            Commentary style
            <select
              value={form.commentaryStyle}
              onChange={(event) =>
                setForm({
                  ...form,
                  commentaryStyle: event.target
                    .value as Settings['commentaryStyle'],
                })
              }
            >
              <option value="concise">Concise</option>
              <option value="coach">Coach</option>
              <option value="playful">Playful</option>
            </select>
          </label>
          <label>
            Model profile
            <select
              value={form.modelProfileId}
              onChange={(event) =>
                setForm({ ...form, modelProfileId: event.target.value })
              }
            >
              <option value="qwen3-4b-q4-k-m">
                Qwen3-4B · Q4_K_M (default)
              </option>
              <option value="qwen3-1.7b-q4-k-m">
                Qwen3-1.7B · Q4_K_M (experimental)
              </option>
            </select>
          </label>
          <label>
            Candidate limit
            <input
              type="number"
              min="1"
              max="5"
              required
              value={form.stockfishCandidateLimit}
              onChange={(event) =>
                setForm({
                  ...form,
                  stockfishCandidateLimit: Number(event.target.value),
                })
              }
            />
          </label>
          <label>
            Stockfish move time (ms)
            <input
              type="number"
              min="25"
              max="1000"
              step="25"
              required
              value={form.stockfishMoveTimeMs}
              onChange={(event) =>
                setForm({
                  ...form,
                  stockfishMoveTimeMs: Number(event.target.value),
                })
              }
            />
          </label>
        </fieldset>

        {profileChanged ? (
          <div className="restart-notice" role="status">
            <strong>Restart the model to apply this profile.</strong>
            <code>chess-llama model start --profile {form.modelProfileId}</code>
          </div>
        ) : null}
        <div className="form-actions">
          <button
            className="button primary"
            type="submit"
            disabled={update.isPending}
          >
            {update.isPending ? 'Saving…' : 'Save settings'}
          </button>
          <span aria-live="polite">{saved ? 'Settings saved.' : ''}</span>
        </div>
      </form>
      <ProblemBanner error={update.error} />
    </section>
  );
}
