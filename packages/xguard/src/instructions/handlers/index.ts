import type { HandlerRegistry } from '@xhis/core';
import type { OpsContext, OpsEffect, OpsError, OpsInstruction } from '../types.js';
import { cordonNodeHandler } from './cordonNode.js';
import { reprovisionSandboxHandler } from './reprovisionSandbox.js';
import { restartContainerHandler } from './restartContainer.js';
import { scaleDeploymentHandler } from './scaleDeployment.js';

/**
 * Assembled as a single object literal with arrow-function values,
 * checked with `satisfies` — the identical pattern (and the identical
 * reasoning) every clinical domain's own handler registry follows, see
 * `@xhis/core`'s `instructions/bed/handlers/index.ts`.
 */
export const opsHandlerRegistry = {
  ReprovisionSandbox: reprovisionSandboxHandler,
  CordonNode: cordonNodeHandler,
  RestartContainer: restartContainerHandler,
  ScaleDeployment: scaleDeploymentHandler,
} satisfies HandlerRegistry<OpsContext, OpsInstruction, OpsEffect, OpsError>;
