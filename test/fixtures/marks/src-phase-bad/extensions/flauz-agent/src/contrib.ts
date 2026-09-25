// synthetic workbench contribution (fixture): registers at BlockRestore (forbidden — pre-Restored work)
import { registerWorkbenchContribution2, WorkbenchPhase } from 'vs/workbench/common/contributions.js';
registerWorkbenchContribution2('flauz.earlyContrib', class {}, WorkbenchPhase.BlockRestore);
