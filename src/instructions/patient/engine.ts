import { createEngine } from '../../core/execution/engine.js';
import { patientHandlerRegistry } from './handlers/index.js';

export const patientEngine = createEngine(patientHandlerRegistry);
