import { describe, expect, it } from 'vitest';
import { validateComponent } from '../../../src/agentic/ui/validator.js';
import { exampleComponentPropsValidators } from './fixtures/exampleComponents.js';

describe('validateComponent', () => {
  it('validates a well-formed candidate into a typed component', () => {
    const result = validateComponent(exampleComponentPropsValidators, {
      component: 'VitalsEntryPanel',
      props: { encounterId: 'encounter-1', prefilledTemperatureCelsius: 37.2 },
    });

    expect(result).toEqual({
      ok: true,
      value: {
        component: 'VitalsEntryPanel',
        props: { encounterId: 'encounter-1', prefilledTemperatureCelsius: 37.2, prefilledHeartRateBpm: undefined },
      },
    });
  });

  it('rejects a candidate missing required props, with a specific reason', () => {
    const result = validateComponent(exampleComponentPropsValidators, {
      component: 'VitalsEntryPanel',
      props: {},
    });

    expect(result).toEqual({ ok: false, error: ["'props.encounterId' must be a non-empty string"] });
  });

  it("rejects an unknown 'component' value", () => {
    const result = validateComponent(exampleComponentPropsValidators, { component: 'NotARealPanel', props: {} });

    expect(result).toEqual({ ok: false, error: ["unknown component 'NotARealPanel'"] });
  });

  it('rejects a candidate with no string component field at all', () => {
    expect(validateComponent(exampleComponentPropsValidators, { props: {} })).toEqual({
      ok: false,
      error: ["expected a string 'component' field"],
    });
    expect(validateComponent(exampleComponentPropsValidators, 'not an object')).toEqual({
      ok: false,
      error: ['expected a component descriptor object'],
    });
    expect(validateComponent(exampleComponentPropsValidators, null)).toEqual({
      ok: false,
      error: ['expected a component descriptor object'],
    });
  });
});
