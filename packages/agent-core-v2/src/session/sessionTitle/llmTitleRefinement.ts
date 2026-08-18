import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';

export interface ISessionLlmTitleRefinement {
  readonly _serviceBrand: undefined;
}

export const ISessionLlmTitleRefinement: ServiceIdentifier<ISessionLlmTitleRefinement> =
  createDecorator<ISessionLlmTitleRefinement>('sessionLlmTitleRefinement');
