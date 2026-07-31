import { err, ok, type Result } from '../../../../src/core/execution/result.js';
import type { UiKinded } from '../../../../src/agentic/ui/component.js';
import type { ComponentPropsValidatorRegistry } from '../../../../src/agentic/ui/validator.js';

/**
 * A synthetic component-descriptor union used only to exercise the
 * generic `src/agentic/ui` machinery in isolation — the UI-side
 * counterpart to `tests/core/fixtures/counterEngine.ts`'s role for
 * `core/execution`. Deliberately test-only, not under `src/`: this repo
 * owns the generic contract (`UiKinded`, `UiRenderProposal`,
 * `ComponentPropsValidatorRegistry`, ...), not any real clinical
 * component catalog — that belongs to whichever Design System
 * Guardrail #3 assigns rendering to, not to xHIS-core.
 */
export interface VitalsEntryPanelProps {
  readonly encounterId: string;
  readonly prefilledTemperatureCelsius?: number;
  readonly prefilledHeartRateBpm?: number;
}

export interface PatientSummaryCardProps {
  readonly encounterId: string;
  readonly summaryText: string;
}

export type ExampleUiComponent =
  | { readonly component: 'VitalsEntryPanel'; readonly props: VitalsEntryPanelProps }
  | { readonly component: 'PatientSummaryCard'; readonly props: PatientSummaryCardProps };

// `ExampleUiComponent` already satisfies `UiKinded` structurally; this
// line is just documentation of that fact for readers of the fixture —
// same role `counterEngine.ts`'s `_AssertKinded` plays for `Kinded`.
type _AssertUiKinded = ExampleUiComponent extends UiKinded ? true : never;
void (0 as unknown as _AssertUiKinded);

function validateVitalsEntryPanel(
  candidate: unknown,
): Result<Extract<ExampleUiComponent, { component: 'VitalsEntryPanel' }>, readonly string[]> {
  const c = candidate as Record<string, unknown>;
  const props = c['props'] as Record<string, unknown> | undefined;
  const issues: string[] = [];

  if (typeof props?.['encounterId'] !== 'string' || props['encounterId'].length === 0) {
    issues.push("'props.encounterId' must be a non-empty string");
  }
  if (props?.['prefilledTemperatureCelsius'] !== undefined && typeof props['prefilledTemperatureCelsius'] !== 'number') {
    issues.push("'props.prefilledTemperatureCelsius' must be a number when present");
  }
  if (props?.['prefilledHeartRateBpm'] !== undefined && typeof props['prefilledHeartRateBpm'] !== 'number') {
    issues.push("'props.prefilledHeartRateBpm' must be a number when present");
  }

  if (issues.length > 0) {
    return err(issues);
  }

  return ok({
    component: 'VitalsEntryPanel',
    props: {
      encounterId: props!['encounterId'] as string,
      prefilledTemperatureCelsius: props!['prefilledTemperatureCelsius'] as number | undefined,
      prefilledHeartRateBpm: props!['prefilledHeartRateBpm'] as number | undefined,
    },
  });
}

function validatePatientSummaryCard(
  candidate: unknown,
): Result<Extract<ExampleUiComponent, { component: 'PatientSummaryCard' }>, readonly string[]> {
  const c = candidate as Record<string, unknown>;
  const props = c['props'] as Record<string, unknown> | undefined;
  const issues: string[] = [];

  if (typeof props?.['encounterId'] !== 'string' || props['encounterId'].length === 0) {
    issues.push("'props.encounterId' must be a non-empty string");
  }
  if (typeof props?.['summaryText'] !== 'string' || props['summaryText'].length === 0) {
    issues.push("'props.summaryText' must be a non-empty string");
  }

  if (issues.length > 0) {
    return err(issues);
  }

  return ok({
    component: 'PatientSummaryCard',
    props: {
      encounterId: props!['encounterId'] as string,
      summaryText: props!['summaryText'] as string,
    },
  });
}

/**
 * Assembled as a single object literal checked with `satisfies` — see
 * `__typetests__/exhaustiveness.ts` for the compile-time proof that
 * this is total over `ExampleUiComponent`.
 */
export const exampleComponentPropsValidators = {
  VitalsEntryPanel: validateVitalsEntryPanel,
  PatientSummaryCard: validatePatientSummaryCard,
} satisfies ComponentPropsValidatorRegistry<ExampleUiComponent>;
