import type { HandlerRegistry } from '../../../core/execution/handler.js';
import type { ImagingContext, ImagingEffect, ImagingError, ImagingInstruction } from '../types.js';
import { cancelStudyHandler } from './cancelStudy.js';
import { orderStudyHandler } from './orderStudy.js';
import { recordStudyStoredHandler } from './recordStudyStored.js';
import { reportStudyHandler } from './reportStudy.js';

export const imagingHandlerRegistry = {
  OrderStudy: orderStudyHandler,
  RecordStudyStored: recordStudyStoredHandler,
  ReportStudy: reportStudyHandler,
  CancelStudy: cancelStudyHandler,
} satisfies HandlerRegistry<ImagingContext, ImagingInstruction, ImagingEffect, ImagingError>;
