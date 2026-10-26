import { AppIdentifier, AppMetadata } from '@qcomp/fdc3-standard';
import { Messaging } from '@qcomp/fdc3-agent-proxy';
import { DefaultAppSupport } from '@qcomp/fdc3-agent-proxy';

export class NoopAppSupport extends DefaultAppSupport {
  constructor(messaging: Messaging, messageExchangeTimeout: number, appLaunchTimeout: number) {
    super(messaging, messageExchangeTimeout, appLaunchTimeout);
  }

  async getAppMetadata(app: AppIdentifier): Promise<AppMetadata> {
    return {
      appId: app.appId,
    };
  }
}
