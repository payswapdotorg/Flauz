// synthetic workbench contribution (fixture): registers at AfterRestored (allowed)
import { registerWorkbenchContribution2, WorkbenchPhase } from 'vs/workbench/common/contributions.js';
registerWorkbenchContribution2('flauz.bridgeContrib', class {}, WorkbenchPhase.AfterRestored);
