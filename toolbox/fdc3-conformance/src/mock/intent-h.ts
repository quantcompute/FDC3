import { getAgent } from '@qcomp/fdc3';
import { closeWindowOnCompletion } from './mock-functions';

getAgent().then(async fdc3 => {
  await closeWindowOnCompletion(fdc3);
});
