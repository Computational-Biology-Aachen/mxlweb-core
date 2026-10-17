<!--
 @component
 Protocol source for a "protocol time course" fit (ADR 0009): either a PAM
 light protocol (duration-based step groups, expanded via `expandProtocol`
 into one parameter's piecewise-constant values — e.g. an NPQ measurement)
 or an uploaded protocol table (`t_end` plus one column per overridden
 parameter, each row a segment ending at its `t_end`).

 Writes the resulting absolute-time `ProtocolStep[]` into the bindable
 `protocol` (undefined until a source is complete).
-->

<script lang="ts">
  import { Button } from "@computational-biology-aachen/design";
  import {
    expandProtocol,
    PREDEFINED_PROTOCOLS,
    type PamGroup,
    type ProtocolStep,
  } from "../pam";
  import { parseCsvFile, type ParsedCsv } from "./csvParse";

  export type ProtocolPreset = {
    label: string;
    groups: PamGroup[];
    /** Parameter the preset's light intensities apply to. */
    ppfdKey?: string;
  };

  let {
    parameterNames,
    presets = [],
    protocol = $bindable(),
    disabled = false,
  }: {
    parameterNames: string[];
    /** Site-specific presets (e.g. the model's own PAM analyses), offered
     * before the generic {@link PREDEFINED_PROTOCOLS}. */
    presets?: ProtocolPreset[];
    protocol?: ProtocolStep[];
    disabled?: boolean;
  } = $props();

  let allPresets = $derived<ProtocolPreset[]>([
    ...presets,
    ...PREDEFINED_PROTOCOLS.map((p) => ({ label: p.name, groups: p.groups })),
  ]);

  const LIGHT_KEY_PATTERN = /^(ppfd|pfd|pfd_?in|light|i)$/i;

  let source = $state<"pam" | "csv">("pam");

  // ---- PAM step groups ----------------------------------------------------

  // Starts from the first preset (the model's own PAM protocol, when the
  // site passes one) so the common case needs no editing at all.
  function initialPamSetup(): {
    label: string;
    groups: PamGroup[];
    ppfdKey: string;
  } {
    const preset = allPresets[0];
    return {
      label: preset?.label ?? "",
      groups: structuredClone($state.snapshot(preset?.groups ?? [])),
      ppfdKey:
        (preset?.ppfdKey && parameterNames.includes(preset.ppfdKey)
          ? preset.ppfdKey
          : undefined) ??
        parameterNames.find((n) => LIGHT_KEY_PATTERN.test(n)) ??
        parameterNames[0] ??
        "",
    };
  }
  const initial = initialPamSetup();
  let groups = $state<PamGroup[]>(initial.groups);
  let ppfdKey = $state(initial.ppfdKey);
  let presetLabel = $state(initial.label);

  function loadPreset(label: string) {
    const preset = allPresets.find((p) => p.label === label);
    if (!preset) return;
    groups = structuredClone($state.snapshot(preset.groups));
    if (preset.ppfdKey && parameterNames.includes(preset.ppfdKey)) {
      ppfdKey = preset.ppfdKey;
    }
    presetLabel = label;
    emit();
  }

  function editGroups(update: (draft: PamGroup[]) => void) {
    const draft = $state.snapshot(groups) as PamGroup[];
    update(draft);
    groups = draft;
    presetLabel = "";
    emit();
  }

  let pamSegmentCount = $derived(
    groups.reduce(
      (n, g) =>
        n + g.repetitions * g.steps.filter((s) => s.duration > 0).length,
      0,
    ),
  );
  let pamDuration = $derived(
    groups.reduce(
      (t, g) =>
        t +
        g.repetitions *
          g.steps.reduce((d, s) => d + Math.max(s.duration, 0), 0),
      0,
    ),
  );

  // ---- Protocol table upload ----------------------------------------------

  let csv = $state<ParsedCsv | null>(null);
  let tEndColumn = $state<string | undefined>(undefined);
  let columnParams = $state<Record<string, string>>({});
  let fileInput = $state<HTMLInputElement | null>(null);
  let fileError = $state<string | null>(null);

  async function handleFile(event: Event) {
    fileError = null;
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const parsed = await parseCsvFile(file);
      csv = parsed;
      tEndColumn =
        parsed.headers.find((h) => /^t_?end$/i.test(h)) ?? parsed.headers[0];
      columnParams = Object.fromEntries(
        parsed.headers
          .filter((h) => h !== tEndColumn)
          .map((h) => [
            h,
            parameterNames.find((n) => n.toLowerCase() === h.toLowerCase()) ??
              "",
          ]),
      );
      emit();
    } catch (e) {
      fileError = e instanceof Error ? e.message : "Failed to parse file";
    }
    input.value = "";
  }

  function csvProtocol(): ProtocolStep[] | undefined {
    if (!csv || tEndColumn === undefined) return undefined;
    const tEnd = csv.columns[tEndColumn];
    const mapped = Object.entries(columnParams).filter(
      ([column, param]) => column !== tEndColumn && param !== "",
    );
    const steps: ProtocolStep[] = [];
    for (let i = 0; i < csv.rowCount; i++) {
      if (!Number.isFinite(tEnd[i])) continue;
      const step: ProtocolStep = { t_end: tEnd[i] };
      for (const [column, param] of mapped) {
        const value = csv.columns[column][i];
        // An empty cell keeps the previous segment's value — the worker
        // only overrides keys a step actually carries.
        if (Number.isFinite(value)) step[param] = value;
      }
      steps.push(step);
    }
    steps.sort((a, b) => a.t_end - b.t_end);
    return steps.length > 0 ? steps : undefined;
  }

  // ---- Output ---------------------------------------------------------------

  function emit() {
    protocol =
      source === "pam"
        ? ppfdKey !== "" && pamSegmentCount > 0
          ? expandProtocol($state.snapshot(groups) as PamGroup[], ppfdKey)
          : undefined
        : csvProtocol();
  }

  // The initial PAM preset is a complete protocol from the start.
  emit();
</script>

<div class="protocol-editor">
  <div class="source-row">
    <label>
      <input
        type="radio"
        name="protocol-source"
        value="pam"
        disabled={disabled}
        bind:group={source}
        onchange={emit}
      />
      PAM light protocol
    </label>
    <label>
      <input
        type="radio"
        name="protocol-source"
        value="csv"
        disabled={disabled}
        bind:group={source}
        onchange={emit}
      />
      Protocol table (CSV)
    </label>
  </div>

  {#if source === "pam"}
    <div class="pam-header">
      <label>
        Preset
        <select
          value={presetLabel}
          disabled={disabled}
          onchange={(e) => loadPreset((e.target as HTMLSelectElement).value)}
        >
          <option value="">(custom)</option>
          {#each allPresets as preset (preset.label)}
            <option value={preset.label}>{preset.label}</option>
          {/each}
        </select>
      </label>
      <label>
        Light parameter
        <select
          bind:value={ppfdKey}
          disabled={disabled}
          onchange={emit}
        >
          {#each parameterNames as name (name)}
            <option value={name}>{name}</option>
          {/each}
        </select>
      </label>
    </div>

    <table>
      <thead>
        <tr>
          <th>Group</th>
          <th>Repetitions</th>
          <th>Steps (light intensity × duration)</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each groups as group, gi (gi)}
          <tr>
            <td>{gi + 1}</td>
            <td>
              <input
                type="number"
                min="1"
                step="1"
                aria-label="Repetitions"
                value={group.repetitions}
                disabled={disabled}
                onchange={(e) =>
                  editGroups((d) => {
                    d[gi].repetitions = Math.max(
                      1,
                      Math.round(Number((e.target as HTMLInputElement).value)),
                    );
                  })}
              />
            </td>
            <td>
              <div class="steps">
                {#each group.steps as step, si (si)}
                  <div class="step">
                    <input
                      type="number"
                      step="any"
                      aria-label="Light intensity"
                      title="Light intensity"
                      value={step.pfd}
                      disabled={disabled}
                      onchange={(e) =>
                        editGroups((d) => {
                          d[gi].steps[si].pfd = Number(
                            (e.target as HTMLInputElement).value,
                          );
                        })}
                    />
                    <span class="unit">×</span>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      aria-label="Duration"
                      title="Duration"
                      value={step.duration}
                      disabled={disabled}
                      onchange={(e) =>
                        editGroups((d) => {
                          d[gi].steps[si].duration = Number(
                            (e.target as HTMLInputElement).value,
                          );
                        })}
                    />
                    <button
                      type="button"
                      class="link"
                      disabled={disabled || group.steps.length <= 1}
                      onclick={() =>
                        editGroups((d) => {
                          d[gi].steps.splice(si, 1);
                        })}>remove</button
                    >
                  </div>
                {/each}
                <button
                  type="button"
                  class="link"
                  disabled={disabled}
                  onclick={() =>
                    editGroups((d) => {
                      d[gi].steps.push({ pfd: 5000, duration: 0.8 });
                    })}>+ step</button
                >
              </div>
            </td>
            <td>
              <button
                type="button"
                class="link"
                disabled={disabled}
                onclick={() =>
                  editGroups((d) => {
                    d.splice(gi, 1);
                  })}>remove group</button
              >
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
    <div class="footer">
      <button
        type="button"
        class="link"
        disabled={disabled}
        onclick={() =>
          editGroups((d) => {
            d.push({ steps: [{ pfd: 100, duration: 10 }], repetitions: 1 });
          })}>+ group</button
      >
      <span class="info"
        >{pamSegmentCount} segments, total duration {pamDuration.toPrecision(
          4,
        )}</span
      >
    </div>
  {:else}
    <input
      type="file"
      accept=".csv,.tsv,.txt"
      bind:this={fileInput}
      onchange={handleFile}
      style="display:none"
    />
    {#if fileError}
      <p class="error">{fileError}</p>
    {/if}
    {#if csv}
      <table>
        <thead>
          <tr>
            <th>Column</th>
            <th>Sets</th>
          </tr>
        </thead>
        <tbody>
          {#each csv.headers as header (header)}
            <tr>
              <td>{header}</td>
              <td>
                {#if header === tEndColumn}
                  <span class="badge">segment end time (t_end)</span>
                {:else}
                  <select
                    value={columnParams[header] ?? ""}
                    disabled={disabled}
                    onchange={(e) => {
                      columnParams = {
                        ...columnParams,
                        [header]: (e.target as HTMLSelectElement).value,
                      };
                      emit();
                    }}
                  >
                    <option value="">(ignore)</option>
                    {#each parameterNames as name (name)}
                      <option value={name}>{name}</option>
                    {/each}
                  </select>
                  <button
                    type="button"
                    class="link"
                    disabled={disabled}
                    onclick={() => {
                      tEndColumn = header;
                      emit();
                    }}>use as t_end</button
                  >
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      <div class="footer">
        <span class="info">{protocol?.length ?? 0} segments</span>
        <Button
          variant="secondary"
          disabled={disabled}
          onclick={() => {
            csv = null;
            emit();
          }}>Remove protocol</Button
        >
      </div>
    {:else}
      <p class="info">
        One row per segment: a <code>t_end</code> column (when the segment
        ends) plus one column per parameter it sets.
      </p>
      <Button
        variant="secondary"
        disabled={disabled}
        onclick={() => fileInput?.click()}>Upload protocol</Button
      >
    {/if}
  {/if}
</div>

<style>
  input,
  select {
    border: var(--border);
    border-radius: var(--radius-lg);
    background-color: transparent;
    padding: 0.35rem 0.5rem;
    width: auto;
    font-size: inherit;
    font-family: inherit;
  }
  input:disabled,
  select:disabled,
  button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .protocol-editor {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    font-size: 0.875rem;
  }
  .source-row,
  .pam-header {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
  }
  .source-row label,
  .pam-header label {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    text-align: left;
  }
  th,
  td {
    vertical-align: top;
    padding: 0.35rem 0.5rem;
  }
  th {
    background-color: #e5e7eb;
    font-weight: var(--weight-bold);
    font-size: 0.7rem;
    text-transform: uppercase;
  }
  td input[type="number"] {
    width: 5.5rem;
  }
  .steps {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
  }
  .step {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .unit,
  .info {
    color: var(--color-text-muted);
    font-size: 0.8rem;
  }
  .footer {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
  }
  .badge {
    color: var(--color-primary);
    font-weight: 600;
  }
  .link {
    cursor: pointer;
    border: none;
    background: none;
    color: var(--color-text-muted);
    font-size: 0.75rem;
    text-decoration: underline;
  }
  .error {
    margin: 0;
    color: var(--color-danger);
  }
  p {
    margin: 0;
  }
</style>
