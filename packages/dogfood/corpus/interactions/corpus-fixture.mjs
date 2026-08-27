// The interaction for the runner's own fixture: let it draw for four seconds
// while a recording runs. Enough frames of real readback work to cross the
// per-episode heavy-work gate, and nothing else.
import { recordInteraction, sleep } from './shared.mjs';

export default async function drive({ page }) {
  await recordInteraction(page, () => sleep(4000));
}
