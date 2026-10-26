import { AppIdentifier, AppMetadata, AppProvidableContextMetadata, ImplementationMetadata } from '@qcomp/fdc3-standard';
import { Context } from '@qcomp/fdc3-context';

export interface AppSupport {
  findInstances(app: AppIdentifier): Promise<Array<AppIdentifier>>;
  getAppMetadata(app: AppIdentifier): Promise<AppMetadata>;
  open(app: AppIdentifier, context?: Context | null, metadata?: AppProvidableContextMetadata): Promise<AppIdentifier>;
  close(): Promise<void>;
  getImplementationMetadata(): Promise<ImplementationMetadata>;
}
