export * from '@qcomp/fdc3-context';

import {
  BrowserTypes,
  BrowserTypesCore,
  BrowserTypesValidation,
  BridgingTypes,
  BridgingTypesCore,
  BridgingTypesValidation,
} from '@qcomp/fdc3-schema';
export {
  BridgingTypes,
  BridgingTypesCore,
  BridgingTypesValidation,
  BrowserTypes,
  BrowserTypesCore,
  BrowserTypesValidation,
};

import { DesktopAgent, AppIdentifier } from '@qcomp/fdc3-standard';
export * from '@qcomp/fdc3-standard';
export { AppIdentifier };

export { getAgent, fdc3Ready } from '@qcomp/fdc3-get-agent';

declare global {
  interface Window {
    fdc3?: DesktopAgent;
  }
}
